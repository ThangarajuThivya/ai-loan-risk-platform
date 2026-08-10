"use strict";

/**
 * Customer-initiated repayments (040).
 *
 * Kept out of loan.controller.js — which is already the largest file in this
 * codebase — because this is a self-contained flow with its own external
 * dependency (the gateway). Nothing here re-implements repayment arithmetic:
 * amounts come from repaymentQuote.service.js and posting goes through
 * paymentIntentModel.settleWithin → loanModel.recordPaymentWithin.
 *
 * THE TRUST BOUNDARY, stated once because every handler below depends on it:
 *
 *   The browser chooses a KIND of payment. The server chooses the AMOUNT.
 *   The gateway — not the browser — confirms the money moved.
 *
 * So a tampered client can pick "settlement" when it meant "instalment", and
 * gets charged the real settlement figure. It cannot lower a charge, cannot
 * mark its own payment succeeded, and cannot post to the ledger at all: only
 * a signed webhook or a server-to-server session lookup does that.
 */

const { validationResult } = require("express-validator");

const loanModel = require("../models/loanModel");
const paymentIntentModel = require("../models/paymentIntentModel");
const notificationModel = require("../models/notificationModel");
const stripeService = require("../services/stripe.service");
// Only for the webhook's lease branch — see stripeWebhook.
const leaseDownPaymentController = require("./leaseDownPayment.controller");
const leaseRentalController = require("./leaseRental.controller");
const {
  buildQuoteOptions,
  resolvePayment,
} = require("../services/repaymentQuote.service");
const { computeArrears, computeOutstanding } = require("../services/repayment.service");
const { generatePaymentReceiptPdf } = require("../services/paymentReceipt.service");

const toDateOnly = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;

/**
 * Load an application and confirm the caller may act on it as the BORROWER.
 * Distinct from loan.controller.js's read checks, which also admit staff:
 * paying is something only the borrower does, so staff are refused here even
 * though they can read everything about the same loan. Staff record payments
 * through their own endpoint.
 *
 * A missing application and someone else's application both come back 404,
 * matching withdrawApplication — a 403 would confirm the application exists.
 */
async function loadOwnedApplication(req) {
  const applicationId = Number(req.params.id);
  const row = await loanModel.findApplicationById(applicationId);
  if (!row || row.user_id !== req.user.user_id) return { notFound: true, applicationId };
  return { row, applicationId };
}

// GET /api/loans/:id/repayment-options (owner) — every amount this borrower
// could pay right now, so the portal never has to work one out for itself.
exports.getRepaymentOptions = async (req, res) => {
  try {
    const { row, applicationId, notFound } = await loadOwnedApplication(req);
    if (notFound) return res.status(404).json({ message: "Application not found." });

    if (!row.account_id) {
      return res.status(409).json({
        message: "This application has no disbursed loan to repay yet.",
      });
    }

    const schedule = await loanModel.getRepaymentSchedule(applicationId);
    const options = buildQuoteOptions(schedule);

    return res.status(200).json({
      application_id: applicationId,
      account_no: row.account_no,
      account_status: row.account_status,
      // Card payment is optional infrastructure: the portal must be able to
      // say "unavailable" rather than offer a button that throws.
      gateway_available: stripeService.isConfigured(),
      currency: stripeService.CURRENCY.toUpperCase(),
      payable: options.payable && row.account_status === "active",
      min_payment: options.minPayment,
      outstanding: options.outstanding,
      arrears: computeArrears(schedule),
      settlement: options.payable ? options.settlement : null,
      next_installment: options.nextInstallment
        ? {
            installment_no: options.nextInstallment.installmentNo,
            // Present only when a tiny residual rolled forward into a
            // following instalment — see nextInstallmentDue. Lets the UI
            // say "Pay instalments 3–4" instead of quietly mislabelling a
            // combined charge as a single instalment.
            through_installment_no: options.nextInstallment.throughInstallmentNo,
            due_date: toDateOnly(options.nextInstallment.dueDate),
            amount: options.nextInstallment.amount,
          }
        : null,
    });
  } catch (err) {
    console.error("GET REPAYMENT OPTIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to load repayment options." });
  }
};

// POST /api/loans/:id/payments/checkout (owner) — open a gateway session for
// one payment attempt. Returns a URL to redirect to; records nothing against
// the loan. The money is only posted when the gateway confirms it.
exports.createCheckout = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  if (!stripeService.isConfigured()) {
    return res.status(503).json({
      message: "Online card payment is not available at the moment. Please contact support.",
    });
  }

  const { kind, amount } = req.body;

  try {
    const { row, applicationId, notFound } = await loadOwnedApplication(req);
    if (notFound) return res.status(404).json({ message: "Application not found." });

    if (!row.account_id) {
      return res.status(409).json({
        message: "This application has no disbursed loan to repay yet.",
      });
    }
    if (row.account_status !== "active") {
      return res.status(409).json({
        message: `This loan is ${row.account_status}; no further payments can be made.`,
      });
    }

    const schedule = await loanModel.getRepaymentSchedule(applicationId);

    // The amount is decided HERE, from the schedule — `amount` in the body is
    // only consulted for kind === 'custom', and even then only as a bounded
    // request. See repaymentQuote.service.js.
    const quote = resolvePayment({ installments: schedule, kind, amount });
    if (!quote.ok) {
      return res.status(400).json({
        message: quote.message,
        reason: quote.reason,
        outstanding: quote.outstanding,
      });
    }

    // The intent row exists before the gateway session so the session's
    // metadata can point at it, and so an attempt that dies during creation
    // still leaves a trace rather than vanishing.
    const intent = await paymentIntentModel.create({
      accountId: row.account_id,
      userId: req.user.user_id,
      amount: quote.amount,
      currency: stripeService.CURRENCY,
      paymentType: quote.paymentType,
    });

    let session;
    try {
      session = await stripeService.createCheckoutSession({
        amount: quote.amount,
        description: `${quote.description} · ${row.account_no || `Application #${applicationId}`}`,
        applicationId,
        intentId: intent.id,
        customerEmail: req.user.email,
      });
    } catch (err) {
      // A gateway that refuses the session (bad key, unsupported currency)
      // must not leave a 'created' intent lying around looking payable. The
      // intent has no session id yet, so it is failed by its own id.
      console.error("STRIPE CHECKOUT SESSION ERROR:", err.message);
      await paymentIntentModel.markFailedById(intent.id, err.message).catch(() => {});
      return res.status(502).json({
        message:
          "We could not reach the payment provider. Please try again shortly, or contact support if it persists.",
      });
    }

    await paymentIntentModel.attachSession(intent.id, session.id);

    return res.status(201).json({
      intent_id: intent.id,
      session_id: session.id,
      checkout_url: session.url,
      amount: quote.amount,
      currency: stripeService.CURRENCY.toUpperCase(),
      payment_type: quote.paymentType,
    });
  } catch (err) {
    console.error("CREATE CHECKOUT ERROR:", err);
    return res.status(500).json({ message: "Failed to start the payment." });
  }
};

/**
 * Shared by the poll endpoint and the webhook: turn a settled intent into the
 * customer's notification. After commit in both cases — a notification about
 * a payment that rolled back would be a lie.
 */
async function notifySettled(userId, applicationId, payment, outstandingAfter, closed) {
  const lines = [
    `We have received your payment of LKR ${Number(payment.amount).toLocaleString("en-LK", { minimumFractionDigits: 2 })} for loan #${applicationId}.`,
    `Receipt reference ${payment.referenceNo}.`,
    closed
      ? "This payment cleared your loan in full — your loan account is now closed."
      : `Outstanding balance is now LKR ${Number(outstandingAfter).toLocaleString("en-LK", { minimumFractionDigits: 2 })}.`,
  ];
  await notificationModel
    .create({
      userId,
      title: closed ? "Loan fully repaid" : "Payment received",
      message: lines.join(" "),
    })
    .catch((e) => console.error("PAYMENT NOTIFICATION ERROR:", e));
}

/**
 * Settle a session and notify, shared by the poll endpoint and the webhook so
 * the two can never drift.
 *
 * `applicationId` is optional because the webhook may not have it: Stripe
 * metadata is set by us and therefore trustworthy, but a session created
 * before a deploy might lack it, so we fall back to deriving it from the
 * intent's account. Returns the settle result unchanged.
 */
async function settleAndNotify({ sessionId, providerPaymentRef, paidOn, applicationId }) {
  const result = await paymentIntentModel.settle({ sessionId, providerPaymentRef, paidOn });
  if (!result.settled) return result;

  const appId =
    applicationId ?? (await loanModel.findApplicationIdByAccountId(result.intent.account_id));
  if (!appId) return result;

  const schedule = await loanModel.getRepaymentSchedule(appId);
  await notifySettled(
    result.intent.user_id,
    appId,
    result.payment,
    computeOutstanding(schedule).total,
    result.payment.accountClosed
  );
  return result;
}

// GET /api/loans/:id/payments/intents/:sessionId (owner) — what happened to
// this attempt.
//
// RECONCILES, not just reports. If the intent is still 'created' this asks the
// gateway directly whether the session was paid and, if so, settles it through
// the very same idempotent gate the webhook uses. That matters because the
// browser redirect routinely beats the webhook, and on localhost the webhook
// may never arrive at all (no Stripe CLI running) — without this, a customer
// whose card was charged would be looking at an unpaid loan.
exports.getIntentStatus = async (req, res) => {
  try {
    const { row, applicationId, notFound } = await loadOwnedApplication(req);
    if (notFound) return res.status(404).json({ message: "Application not found." });

    const sessionId = String(req.params.sessionId);
    let intent = await paymentIntentModel.findBySessionId(sessionId);

    // Ownership is re-checked on the INTENT, not just the application: the
    // session id is in a URL the customer can edit, so it must not be usable
    // to read someone else's payment attempt.
    if (!intent || intent.user_id !== req.user.user_id || intent.account_id !== row.account_id) {
      return res.status(404).json({ message: "Payment attempt not found." });
    }

    if (intent.status === "created" && stripeService.isConfigured()) {
      let session = null;
      try {
        session = await stripeService.retrieveSession(sessionId);
      } catch (err) {
        console.error("STRIPE SESSION RETRIEVE ERROR:", err.message);
      }
      if (session?.paymentStatus === "paid") {
        await settleAndNotify({
          sessionId,
          providerPaymentRef: session.paymentIntentId,
          applicationId,
        });
        intent = await paymentIntentModel.findBySessionId(sessionId);
      } else if (session && session.paymentStatus === "unpaid") {
        // Still open, or abandoned. Left as 'created' — Stripe expires the
        // session itself and the webhook records that; guessing here would
        // race a customer who is still typing their card number.
        intent = await paymentIntentModel.findBySessionId(sessionId);
      }
    }

    return res.status(200).json({
      session_id: sessionId,
      status: intent.status,
      amount: Number(intent.amount),
      currency: String(intent.currency).toUpperCase(),
      payment_type: intent.payment_type,
      payment_id: intent.payment_id,
      failure_reason: intent.failure_reason,
    });
  } catch (err) {
    console.error("GET INTENT STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to check the payment status." });
  }
};

// GET /api/loans/:id/payments/:paymentId/receipt.pdf (owner, staff, or admin)
// — available for staff-keyed payments too, not only card ones: a cash
// payment at a branch deserves the same receipt.
exports.getPaymentReceipt = async (req, res) => {
  const applicationId = Number(req.params.id);
  const paymentId = Number(req.params.paymentId);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) return res.status(404).json({ message: "Application not found." });

    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const found = await loanModel.getPaymentWithAllocations(applicationId, paymentId);
    if (!found) return res.status(404).json({ message: "Payment not found." });
    const { payment, allocations } = found;

    // The balance AS IT STANDS NOW, not as at the payment. Reconstructing the
    // historical position would need to replay the ledger, and a receipt the
    // borrower opens six months later should tell them where they are today.
    const schedule = await loanModel.getRepaymentSchedule(applicationId);
    const outstandingAfter = computeOutstanding(schedule);

    const pdf = await generatePaymentReceiptPdf({
      referenceNo: payment.reference_no || `PMT-${String(payment.id).padStart(6, "0")}`,
      applicationId,
      accountNo: payment.account_no,
      borrowerName: [payment.first_name, payment.last_name].filter(Boolean).join(" "),
      amount: Number(payment.amount),
      paidOn: toDateOnly(payment.paid_on),
      method: payment.method,
      paymentType: payment.payment_type,
      recordedByName:
        [payment.recorded_by_first_name, payment.recorded_by_last_name].filter(Boolean).join(" ") ||
        null,
      allocations: allocations.map((a) => ({
        installmentNo: a.installment_no,
        dueDate: toDateOnly(a.due_date),
        feeAmount: Number(a.fee_amount),
        interestAmount: Number(a.interest_amount),
        principalAmount: Number(a.principal_amount),
      })),
      outstandingAfter,
      loanClosed: payment.account_status === "closed" && outstandingAfter.total <= 0,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="receipt-${payment.reference_no || paymentId}.pdf"`
    );
    return res.status(200).send(pdf);
  } catch (err) {
    console.error("GET PAYMENT RECEIPT ERROR:", err);
    return res.status(500).json({ message: "Failed to generate the receipt." });
  }
};

// POST /api/payments/stripe/webhook — the gateway telling us what happened.
// THE authority on whether money moved.
//
// Mounted with express.raw ahead of express.json (see app.js): signature
// verification needs the exact bytes Stripe signed, and a parsed-then-
// restringified body will not match.
//
// Always answers 2xx once the signature is valid, even when we could not post
// the payment. A non-2xx makes Stripe retry for days, and retrying will not
// fix a loan that was already closed by another route — the intent is marked
// 'failed' with a reason instead, which is a support problem, not a delivery
// problem.
exports.stripeWebhook = async (req, res) => {
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    // The entire security boundary of this endpoint. Without it, anyone who
    // knew the URL could clear a stranger's loan with a forged POST.
    console.error("STRIPE WEBHOOK SIGNATURE ERROR:", err.message);
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    const session = event.data?.object;

    // L5 — this is the ONLY place a webhook signature is verified, so the
    // lease branch dispatches from here rather than owning a second endpoint
    // with its own (inevitably drifting) verification. `kind` rides in the
    // signed metadata, so it is trustworthy in a way a query parameter would
    // not be. Sessions created before this field existed have no `kind` and
    // fall through to the loan path, which is where they belong.
    if (session?.metadata?.kind === "lease_down_payment") {
      await leaseDownPaymentController.handleWebhookEvent(event.type, session);
      return res.status(200).json({ received: true });
    }

    // L10 — the same dispatch for a monthly rental. A separate ledger and a
    // separate intent table, so a separate branch; what they share is this
    // one verified entry point.
    if (session?.metadata?.kind === "lease_rental") {
      await leaseRentalController.handleWebhookEvent(event.type, session);
      return res.status(200).json({ received: true });
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        if (session?.payment_status !== "paid") break;
        const applicationId = session.metadata?.application_id
          ? Number(session.metadata.application_id)
          : null;
        const result = await settleAndNotify({
          sessionId: session.id,
          providerPaymentRef:
            typeof session.payment_intent === "string" ? session.payment_intent : null,
          applicationId,
        });
        if (result.rejected) {
          console.error(
            `STRIPE WEBHOOK: payment for session ${session.id} could not be posted (${result.reason})`
          );
        }
        break;
      }
      case "checkout.session.async_payment_failed":
        await paymentIntentModel.markUnsuccessful(session.id, "failed", "Payment failed");
        break;
      case "checkout.session.expired":
        await paymentIntentModel.markUnsuccessful(session.id, "expired", "Checkout expired");
        break;
      default:
        // Unsubscribed event types are acknowledged, not errored — Stripe
        // sends more than we asked for and retrying them helps nobody.
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("STRIPE WEBHOOK HANDLER ERROR:", err);
    // A genuine server fault IS worth a retry, unlike a business rejection.
    return res.status(500).json({ message: "Webhook handling failed." });
  }
};

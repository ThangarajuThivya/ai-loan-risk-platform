"use strict";

/**
 * Lease down payment (L5) — both channels.
 *
 * The lessee owes one amount at signing: their down payment plus any
 * unwaived fees. It can arrive by card online or as cash/transfer/cheque
 * keyed in by staff, and often as a mix of both. Both land in one ledger, so
 * "has this lease been settled?" is a single question with a single answer.
 *
 * WHO ASSERTS WHAT. A card payment is the institution OBSERVING money arrive
 * — confirmed by a signed webhook, with `recorded_by` left NULL. An offline
 * receipt is a member of staff ASSERTING it arrived, and their id is
 * mandatory. That distinction is the whole reason the column is nullable and
 * is worth preserving; see 040's header, which sets out the same principle
 * for loan repayments.
 */

const { validationResult } = require("express-validator");

const dpModel = require("../models/leaseDownPayment.model");
const leaseAppModel = require("../models/leaseApplication.model");
const stripeService = require("../services/stripe.service");
const leaseNotifier = require("../services/leaseNotifier.service");

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  return true;
}

/** Owner, staff or admin may read; only the owner may pay by card. */
async function load(req) {
  const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
  if (!application) return { error: { status: 404, message: "Lease application not found." } };
  const isOwner = application.lessee_id === req.user.user_id;
  const isStaff = ["admin", "staff"].includes(req.user.role);
  if (!isOwner && !isStaff) return { error: { status: 403, message: "Permission denied" } };
  return { application, isOwner, isStaff };
}

/** GET /api/leases/:id/down-payment — what is owed, what has arrived. */
exports.getPosition = async (req, res) => {
  try {
    const { application, error } = await load(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const position = await dpModel.getSigningPosition(application.id);
    if (!position) {
      return res.status(200).json({
        payable: false,
        // Not an error: nothing is owed until terms are agreed, and quoting
        // a figure earlier would invite payment against terms that can still
        // change.
        reason: "No accepted quotation yet — nothing is payable.",
        receipts: [],
      });
    }

    const receipts = await dpModel.listReceipts(application.id);
    return res.status(200).json({
      payable: !position.settled,
      gateway_available: stripeService.isConfigured(),
      ...position,
      receipts,
    });
  } catch (err) {
    console.error("GET LEASE DOWN PAYMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the down payment position." });
  }
};

/**
 * POST /api/leases/:id/down-payment/receipts — staff record an offline receipt.
 */
exports.recordReceipt = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const position = await dpModel.getSigningPosition(application.id);
    if (!position) {
      return res.status(409).json({
        message: "Nothing is payable yet — this lease has no accepted quotation.",
      });
    }
    if (position.settled) {
      return res.status(409).json({ message: "The signing amount has already been settled in full." });
    }

    const result = await dpModel.recordOfflineReceipt({
      applicationId: application.id,
      lesseeId: application.lessee_id,
      amount: Number(req.body.amount),
      method: req.body.method,
      referenceNo: req.body.reference_no,
      paidOn: req.body.paid_on || new Date().toISOString().slice(0, 10),
      // Mandatory for an offline receipt — see this module's header.
      recordedBy: req.user.user_id,
      notes: req.body.notes,
      dueTotal: position.dueTotal,
    });

    if (result.overpayment) {
      return res.status(409).json({
        message:
          `That would take the total past what is owed. LKR ${result.outstanding.toLocaleString("en-LK")} ` +
          `is still outstanding of LKR ${result.dueTotal.toLocaleString("en-LK")}.`,
        outstanding: result.outstanding,
      });
    }

    const updated = await dpModel.getSigningPosition(application.id);
    const receipts = await dpModel.listReceipts(application.id);
    leaseNotifier.downPaymentReceived(application, Number(req.body.amount), updated);
    return res.status(201).json({ receipt_id: result.receiptId, ...updated, receipts });
  } catch (err) {
    console.error("RECORD LEASE RECEIPT ERROR:", err);
    return res.status(500).json({ message: "Failed to record the receipt." });
  }
};

/**
 * POST /api/leases/:id/down-payment/checkout — start an online card payment.
 *
 * The AMOUNT IS DECIDED HERE, from the accepted quotation, never taken from
 * the request body. A client can choose to pay, but not how much.
 */
exports.createCheckout = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    if (application.lessee_id !== req.user.user_id) {
      return res.status(403).json({ message: "Permission denied" });
    }
    if (!stripeService.isConfigured()) {
      return res.status(503).json({
        message: "Online card payment is not available at the moment. Please contact support.",
      });
    }

    const position = await dpModel.getSigningPosition(application.id);
    if (!position) {
      return res.status(409).json({
        message: "Nothing is payable yet — accept your quotation first.",
      });
    }
    if (position.settled) {
      return res.status(409).json({ message: "Your signing amount has already been paid in full." });
    }

    // Always the full outstanding balance: a partial card payment would let
    // a lessee leave a lease part-settled with no way to finish it online.
    const amount = position.outstanding;

    // The intent exists before the session so the session's metadata can
    // point at it, and so an attempt that dies mid-creation still leaves a
    // trace rather than vanishing.
    const intent = await dpModel.createIntent({
      applicationId: application.id,
      lesseeId: req.user.user_id,
      amount,
      currency: stripeService.CURRENCY,
    });

    let session;
    try {
      session = await stripeService.createCheckoutSession({
        amount,
        description: `Lease signing payment · ${application.make} ${application.model} · #${application.id}`,
        applicationId: application.id,
        intentId: intent.id,
        customerEmail: req.user.email,
        kind: "lease_down_payment",
        returnPath: `/dashboard/leases/${application.id}`,
      });
    } catch (err) {
      // A gateway that refuses the session must not leave a 'created' intent
      // lying around looking payable.
      console.error("LEASE CHECKOUT SESSION ERROR:", err.message);
      await dpModel.markFailedById(intent.id, err.message).catch(() => {});
      return res.status(502).json({
        message:
          "We could not reach the payment provider. Please try again shortly, or contact support if it persists.",
      });
    }

    await dpModel.attachSession(intent.id, session.id);

    return res.status(201).json({
      intent_id: intent.id,
      session_id: session.id,
      checkout_url: session.url,
      amount,
      currency: stripeService.CURRENCY.toUpperCase(),
    });
  } catch (err) {
    console.error("CREATE LEASE CHECKOUT ERROR:", err);
    return res.status(500).json({ message: "Failed to start the payment." });
  }
};

/**
 * GET /api/leases/:id/down-payment/status?session_id=… — the return page.
 *
 * Belt and braces against a lost webhook: asks the gateway directly whether
 * the session was paid and, if so, settles it through the SAME gate the
 * webhook uses. Whichever arrives first wins; the other finds the intent
 * already settled and does nothing.
 */
exports.getIntentStatus = async (req, res) => {
  try {
    const { application, error } = await load(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ message: "session_id is required." });

    const intent = await dpModel.findIntentBySessionId(sessionId);
    // Ownership is re-checked against the INTENT, not just the application:
    // the session id arrives on a redirect the customer could edit.
    if (!intent || intent.application_id !== application.id) {
      return res.status(404).json({ message: "Payment attempt not found." });
    }
    if (intent.lessee_id !== req.user.user_id && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    if (intent.status === "created") {
      let paid = false;
      let paymentRef = null;
      try {
        // stripeService.retrieveSession returns a MAPPED, camelCase object
        // ({ id, status, paymentStatus, paymentIntentId, ... }) — NOT the raw
        // Stripe session. Reading Stripe's own snake_case names here yields
        // undefined, `paid` stays false, and a genuinely paid card silently
        // never settles. That is exactly what happened: six live attempts,
        // five of them charged, none recorded. The webhook path below is
        // different — it receives the RAW Stripe object and correctly uses
        // snake_case.
        const session = await stripeService.retrieveSession(sessionId);
        paid = session?.paymentStatus === "paid";
        paymentRef = session?.paymentIntentId || null;
      } catch (err) {
        console.error("LEASE SESSION RECONCILE ERROR:", err.message);
      }
      if (paid) {
        const settleResult = await dpModel.settle({ sessionId, providerPaymentRef: paymentRef });
        if (settleResult.settled) {
          await notifySettledCardPayment(application.id, settleResult.intent.amount);
        }
      }
    }

    const latest = await dpModel.findIntentBySessionId(sessionId);
    const position = await dpModel.getSigningPosition(application.id);
    return res.status(200).json({
      status: latest.status,
      failure_reason: latest.failure_reason,
      amount: latest.amount,
      ...(position || {}),
    });
  } catch (err) {
    console.error("LEASE INTENT STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to check the payment." });
  }
};

/**
 * Called by the shared Stripe webhook once the signature has been verified.
 *
 * Exported rather than routed: there must be exactly ONE place that verifies
 * a webhook signature, and that is repayment.controller.stripeWebhook. This
 * is the lease branch of its dispatch.
 */
/**
 * Notify after a card down payment has actually been POSTED.
 *
 * Both the webhook and the return-page reconcile call `dpModel.settle`, but
 * its exactly-once gate means only one of them ever comes back
 * `settled: true` — the other sees `alreadySettled`. Hanging the
 * notification off that flag therefore makes it exactly-once for free,
 * without needing a dedupe key on an event that is otherwise allowed to
 * repeat (two genuine payments of the same amount are two real events).
 */
async function notifySettledCardPayment(applicationId, amount) {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(applicationId);
    if (!application) return;
    const position = await dpModel.getSigningPosition(applicationId);
    await leaseNotifier.downPaymentReceived(application, Number(amount), position);
  } catch (err) {
    console.error("[leaseDownPayment] notify failed:", err.message);
  }
}

exports.handleWebhookEvent = async (eventType, session) => {
  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (session?.payment_status !== "paid") return;
      const result = await dpModel.settle({
        sessionId: session.id,
        providerPaymentRef:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
      });
      if (result.rejected) {
        // Real money was taken for something the ledger will not accept.
        // Loud, because somebody now owes a refund.
        console.error(
          `LEASE WEBHOOK: down payment for session ${session.id} could not be posted (${result.reason})`
        );
      } else if (result.settled) {
        await notifySettledCardPayment(result.intent.application_id, result.intent.amount);
      }
      return;
    }
    case "checkout.session.async_payment_failed":
      await dpModel.markUnsuccessful(session.id, "failed", "Payment failed");
      return;
    case "checkout.session.expired":
      await dpModel.markUnsuccessful(session.id, "expired", "Checkout expired");
      return;
    default:
      return;
  }
};

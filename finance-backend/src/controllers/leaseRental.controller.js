"use strict";

/**
 * The lessee paying their own rentals.
 *
 * Until now a rental could only be keyed in by staff, which meant the one
 * payment a lessee makes sixty times over the life of a lease was the one
 * payment they could not make themselves.
 *
 * THE CLIENT SENDS A KIND, NEVER A PRICE. Every figure comes from
 * leaseRentalQuote.service, computed server-side from the schedule and the
 * ledger. A tampered client can choose a different KIND of payment but can
 * never change what it is charged. `custom` is the single exception, and
 * even it is a bounded request: the amount is re-validated against the real
 * outstanding balance here, and again inside the settlement transaction,
 * before any card is charged.
 */

const { validationResult } = require("express-validator");

const leaseAppModel = require("../models/leaseApplication.model");
const agreementModel = require("../models/leaseAgreement.model");
const intentModel = require("../models/leaseRentalIntent.model");
const stripeService = require("../services/stripe.service");
const leaseNotifier = require("../services/leaseNotifier.service");
const {
  buildRentalOptions,
  resolvePaymentAmount,
} = require("../services/leaseRentalQuote.service");

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  return true;
}

/**
 * Load the application, its agreement, and today's options.
 *
 * The lessee may read and pay; staff and admin may read. A lease nobody owns
 * is not readable by a customer at all.
 */
async function load(req, { ownerOnly = false } = {}) {
  const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
  if (!application) return { error: { status: 404, message: "Lease application not found." } };

  const isOwner = application.lessee_id === req.user.user_id;
  const isStaff = ["admin", "staff"].includes(req.user.role);
  if (ownerOnly ? !isOwner : !isOwner && !isStaff) {
    return { error: { status: 403, message: "Permission denied" } };
  }

  const agreement = await agreementModel.findAgreementByApplication(application.id);
  if (!agreement) {
    return {
      application,
      agreement: null,
      // Not an error: a lease with no agreement has no rentals to pay, and
      // saying so is the honest answer to "can I pay yet?".
      reason: "This lease is not active yet — rentals begin once the vehicle is registered to us.",
    };
  }

  const schedule = await agreementModel.findRentalSchedule(agreement.id);
  const rentals = await agreementModel.findRentals(agreement.id);
  const received = rentals.reduce((sum, r) => sum + Number(r.amount), 0);
  const options = buildRentalOptions({
    schedule,
    received,
    monthlyRental: Number(agreement.monthly_rental),
  });

  return { application, agreement, schedule, rentals, options };
}

/** GET /api/leases/:id/rentals/options — what may be paid, and for how much. */
exports.getOptions = async (req, res) => {
  try {
    const { application, agreement, reason, options, rentals, error } = await load(req);
    if (error) return res.status(error.status).json({ message: error.message });

    if (!agreement) {
      return res.status(200).json({ payable: false, reason, rentals: [] });
    }

    return res.status(200).json({
      agreement_no: agreement.agreement_no,
      agreement_status: agreement.status,
      monthly_rental: Number(agreement.monthly_rental),
      // Card payment is optional infrastructure: the portal must be able to
      // say "unavailable" rather than offer a button that throws.
      gateway_available: stripeService.isConfigured(),
      currency: stripeService.CURRENCY.toUpperCase(),
      ...options,
      // A completed or terminated lease is readable but not payable,
      // whatever the arithmetic says.
      payable: Boolean(options?.payable) && agreement.status === "active",
      rentals,
      application_id: application.id,
    });
  } catch (err) {
    console.error("GET LEASE RENTAL OPTIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to load rental payment options." });
  }
};

/**
 * POST /api/leases/:id/rentals/checkout — open a card payment for one rental.
 *
 * Records nothing against the lease. The money is only posted when the
 * gateway confirms it.
 */
exports.createCheckout = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const { application, agreement, reason, options, error } = await load(req, { ownerOnly: true });
    if (error) return res.status(error.status).json({ message: error.message });
    if (!agreement) return res.status(409).json({ message: reason });
    if (agreement.status !== "active") {
      return res.status(409).json({
        message: `This lease is ${agreement.status}; no further rentals can be paid.`,
      });
    }

    if (!stripeService.isConfigured()) {
      return res.status(503).json({
        message: "Online card payment is not available at the moment. Please contact support.",
      });
    }

    const kind = req.body.kind || "rental";
    const resolved = resolvePaymentAmount(options, kind, req.body.amount);
    if (resolved.error) {
      return res.status(409).json({ message: resolved.message, code: resolved.error });
    }

    // The intent exists before the session so the session's metadata can
    // point at it, and so an attempt that dies mid-creation still leaves a
    // trace rather than vanishing.
    const intent = await intentModel.createIntent({
      agreementId: agreement.id,
      lesseeId: req.user.user_id,
      amount: resolved.amount,
      currency: stripeService.CURRENCY,
      paymentKind: kind,
    });

    const label =
      kind === "settlement"
        ? "Early settlement"
        : kind === "arrears"
          ? "Overdue rentals"
          : kind === "custom"
            ? "Lease payment"
            : `Rental ${options.nextRental?.rentalNo ?? ""}`.trim();

    let session;
    try {
      session = await stripeService.createCheckoutSession({
        amount: resolved.amount,
        description: `${label} · ${application.make} ${application.model} · ${agreement.agreement_no}`,
        applicationId: application.id,
        intentId: intent.id,
        customerEmail: req.user.email,
        kind: "lease_rental",
        returnPath: `/dashboard/leases/${application.id}`,
      });
    } catch (err) {
      // A gateway that refuses the session must not leave a 'created' intent
      // lying around looking payable.
      console.error("LEASE RENTAL CHECKOUT SESSION ERROR:", err.message);
      await intentModel.markFailedById(intent.id, `Could not open a checkout session: ${err.message}`);
      return res.status(502).json({
        message: "Couldn't start the payment. Please try again shortly.",
      });
    }

    await intentModel.attachSession(intent.id, session.id);
    return res.status(201).json({
      intent_id: intent.id,
      amount: resolved.amount,
      kind,
      checkout_url: session.url,
    });
  } catch (err) {
    console.error("CREATE LEASE RENTAL CHECKOUT ERROR:", err);
    return res.status(500).json({ message: "Failed to start the payment." });
  }
};

/**
 * GET /api/leases/:id/rentals/status?session_id=… — the return-page reconcile.
 *
 * Asks the gateway directly whether the session was paid, and settles it if
 * so. Belt and braces for a webhook that is slow or was never configured; it
 * goes through the same exactly-once gate, so a webhook that already landed
 * makes this a no-op.
 */
exports.getIntentStatus = async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ message: "session_id is required." });

    const intent = await intentModel.findIntentBySessionId(sessionId);
    if (!intent) return res.status(404).json({ message: "Payment not found." });

    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }
    // The session must belong to THIS lease, or an owner could reconcile a
    // stranger's payment through their own URL.
    const agreement = await agreementModel.findAgreementByApplication(application.id);
    if (!agreement || intent.agreement_id !== agreement.id) {
      return res.status(404).json({ message: "Payment not found." });
    }

    if (intent.status === "created") {
      // retrieveSession returns a MAPPED, camelCase object — not the raw
      // Stripe session. See leaseDownPayment.controller's note: reading
      // Stripe's snake_case names here means a paid card never settles.
      const session = await stripeService.retrieveSession(sessionId);
      if (session?.paymentStatus === "paid") {
        const settleResult = await intentModel.settle({
          sessionId,
          providerPaymentRef: session.paymentIntentId || null,
        });
        if (settleResult.settled) {
          await notifySettledRental(settleResult.intent, settleResult.completed);
        }
      } else if (session?.status === "expired") {
        await intentModel.markUnsuccessful(sessionId, "expired", "The checkout session expired");
      }
    }

    const fresh = await intentModel.findIntentById(intent.id);
    return res.status(200).json({
      status: fresh.status,
      amount: Number(fresh.amount),
      kind: fresh.payment_kind,
      rental_id: fresh.rental_id,
      failure_reason: fresh.failure_reason,
    });
  } catch (err) {
    console.error("GET LEASE RENTAL STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to check the payment." });
  }
};

/**
 * Dispatched from repayment.controller's webhook, which is the ONLY place a
 * Stripe signature is verified. `kind` rides in the signed metadata, so it
 * is trustworthy in a way a query parameter would not be.
 */
/**
 * Notify after a card RENTAL has actually been posted.
 *
 * Same reasoning as the down-payment path: `intentModel.settle` is
 * exactly-once, so only one of the webhook and the return-page reconcile
 * ever reports `settled: true`. Hanging the notice off that makes it
 * exactly-once without deduping an event that is legitimately repeatable.
 *
 * `completed` distinguishes the final rental from an ordinary one, and the
 * intent's own `payment_kind` distinguishes an early settlement from simply
 * reaching the end of the term — two different things to be congratulated on.
 */
async function notifySettledRental(intent, completed) {
  try {
    const agreement = await agreementModel.findAgreementById(intent.agreement_id);
    if (!agreement) return;
    const application = await leaseAppModel.findLeaseApplicationById(agreement.application_id);
    if (!application) return;
    const position = await agreementModel.getRentalPosition(agreement.id);
    await leaseNotifier.rentalReceived(application, Number(intent.amount), position, {
      settlement: intent.payment_kind === "settlement",
    });
    void completed;
  } catch (err) {
    console.error("[leaseRental] notify failed:", err.message);
  }
}

exports.handleWebhookEvent = async (eventType, session) => {
  const sessionId = session?.id;
  if (!sessionId) return;

  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (session.payment_status && session.payment_status !== "paid") return;
      const result = await intentModel.settle({
        sessionId,
        providerPaymentRef: session.payment_intent || null,
      });
      if (result.rejected) {
        console.error("LEASE RENTAL PAYMENT COULD NOT BE POSTED:", sessionId, result.reason);
      } else if (result.settled) {
        await notifySettledRental(result.intent, result.completed);
      }
      return;
    }
    case "checkout.session.async_payment_failed":
      await intentModel.markUnsuccessful(sessionId, "failed", "The gateway reported a failed payment");
      return;
    case "checkout.session.expired":
      await intentModel.markUnsuccessful(sessionId, "expired", "The checkout session expired");
      return;
    default:
      // Everything else is noise for this flow.
  }
};

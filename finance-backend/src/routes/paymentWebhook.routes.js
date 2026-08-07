const express = require("express");

const router = express.Router();

const repaymentController = require("../controllers/repayment.controller");

// POST /api/payments/stripe/webhook (040) — the payment gateway telling us a
// payment succeeded, failed or expired.
//
// NO verifyToken, deliberately: Stripe is not a logged-in user of this system
// and cannot present a JWT. Authentication is the request SIGNATURE instead,
// checked in the controller via stripe.service.constructWebhookEvent. That
// check is the entire security boundary here — an unsigned or wrongly-signed
// request is rejected with a 400 before anything is read from it.
//
// express.raw is applied at the mount point in app.js rather than here,
// because it has to run BEFORE the global express.json(): verification needs
// the exact bytes Stripe signed, and a body that has been parsed and
// re-serialised will not match the signature.
router.post("/stripe/webhook", repaymentController.stripeWebhook);

module.exports = router;

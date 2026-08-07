const express = require("express");

const router = express.Router();

const consentController = require("../controllers/consent.controller");
const { verifyToken } = require("../middleware/auth.middleware");

// GET /api/consents/policies — current policy text/version for every
// consent type. No PII, just config — any authenticated user may read it.
router.get("/policies", verifyToken, consentController.getPolicies);

// GET /api/consents/status — the caller's own granted/missing consents.
router.get("/status", verifyToken, consentController.getStatus);

// GET /api/consents/history — full audit trail (self, or any user for staff/admin).
router.get("/history", verifyToken, consentController.getHistory);

// POST /api/consents — grant one or more consents.
router.post("/", verifyToken, consentController.grantConsents);

module.exports = router;

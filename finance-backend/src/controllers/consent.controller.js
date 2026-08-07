"use strict";

/**
 * J1 — consent management. See consent.service.js for the policy config and
 * consentModel.js for the append-only audit log this reads/writes.
 */

const consentModel = require("../models/consentModel");
const {
  CONSENT_POLICIES,
  REQUIRED_CONSENT_TYPES,
  isKnownConsentType,
  isConsentCurrent,
  findMissingConsents,
} = require("../services/consent.service");

// GET /api/consents/policies — the current policy text/version for every
// consent type this system asks for. Public within auth (no PII), so the
// frontend can render the checkboxes without a second round trip per type.
exports.getPolicies = (req, res) => {
  const policies = REQUIRED_CONSENT_TYPES.map((type) => ({
    consent_type: type,
    version: CONSENT_POLICIES[type].version,
    title_key: CONSENT_POLICIES[type].titleKey,
    body_key: CONSENT_POLICIES[type].bodyKey,
  }));
  return res.json({ policies });
};

// GET /api/consents/status — what the caller has already granted, and what
// is still missing before loan processing may proceed. This is the single
// source of truth the apply wizard checks before letting a submission
// through, and that the server-side gate (loan.controller.js#assess) also
// checks — the frontend check is for UX; the backend check is the actual
// control.
exports.getStatus = async (req, res) => {
  try {
    const latestByType = await consentModel.getLatestConsentsByUser(
      req.user.user_id
    );
    const consents = REQUIRED_CONSENT_TYPES.map((type) => {
      const latest = latestByType.get(type) || null;
      return {
        consent_type: type,
        required_version: CONSENT_POLICIES[type].version,
        granted_version: latest ? latest.policy_version : null,
        granted_at: latest ? latest.created_at : null,
        current: isConsentCurrent(latest, type),
      };
    });
    const missing = findMissingConsents(latestByType);
    return res.json({ consents, missing, all_granted: missing.length === 0 });
  } catch (err) {
    console.error("GET CONSENT STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to load consent status." });
  }
};

// POST /api/consents — grant one or more consents. Body: { consents: [{
// consent_type, policy_version }] }. Each grant is a fresh audit row (see
// consentModel.recordConsent) — re-granting an already-current consent is
// harmless, just another timestamped row.
exports.grantConsents = async (req, res) => {
  const submitted = Array.isArray(req.body.consents) ? req.body.consents : [];
  if (!submitted.length) {
    return res.status(400).json({ message: "At least one consent must be provided." });
  }

  for (const item of submitted) {
    if (!isKnownConsentType(item.consent_type)) {
      return res.status(400).json({ message: `Unknown consent_type "${item.consent_type}".` });
    }
    const requiredVersion = CONSENT_POLICIES[item.consent_type].version;
    if (item.policy_version !== requiredVersion) {
      return res.status(400).json({
        message: `Stale policy_version for "${item.consent_type}" — expected ${requiredVersion}, got ${item.policy_version}. Reload the consent text and try again.`,
      });
    }
  }

  try {
    for (const item of submitted) {
      await consentModel.recordConsent({
        userId: req.user.user_id,
        consentType: item.consent_type,
        policyVersion: item.policy_version,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
    }
    const latestByType = await consentModel.getLatestConsentsByUser(req.user.user_id);
    const missing = findMissingConsents(latestByType);
    return res.status(201).json({ missing, all_granted: missing.length === 0 });
  } catch (err) {
    console.error("GRANT CONSENT ERROR:", err);
    return res.status(500).json({ message: "Failed to record consent." });
  }
};

// GET /api/consents/history — the full audit trail for the caller, or (for
// staff/admin) for a given user_id. What a compliance review would ask for.
exports.getHistory = async (req, res) => {
  try {
    const requestedUserId = req.query.user_id ? Number(req.query.user_id) : null;
    const isStaff = req.user.role === "admin" || req.user.role === "staff";
    if (requestedUserId && !isStaff) {
      return res.status(403).json({ message: "Not authorized to view another user's consent history." });
    }
    const targetUserId = requestedUserId || req.user.user_id;
    const history = await consentModel.getConsentHistory(targetUserId);
    return res.json({ history });
  } catch (err) {
    console.error("GET CONSENT HISTORY ERROR:", err);
    return res.status(500).json({ message: "Failed to load consent history." });
  }
};

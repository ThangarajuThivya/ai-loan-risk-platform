"use strict";

/**
 * The compliance policy behind J1 — what consent is required, and at what
 * version, before this system will pull a credit bureau record or process
 * an applicant's personal data.
 *
 * Bumping a version here does NOT retroactively invalidate anything (past
 * user_consents rows keep the version they were actually granted under —
 * see migration 042's header). It means every user is asked again next
 * time they need a gate that now requires the new version.
 */

const CONSENT_POLICIES = {
  data_processing: {
    version: "1.0",
    titleKey: "consent.dataProcessing.title",
    bodyKey: "consent.dataProcessing.body",
  },
  credit_bureau_check: {
    version: "1.0",
    titleKey: "consent.creditBureau.title",
    bodyKey: "consent.creditBureau.body",
  },
};

const REQUIRED_CONSENT_TYPES = Object.keys(CONSENT_POLICIES);

function isKnownConsentType(type) {
  return Object.prototype.hasOwnProperty.call(CONSENT_POLICIES, type);
}

/**
 * @param {object|null} latestRow the most recent user_consents row for this
 *   consent_type, or null if the user has never granted it.
 * @param {string} consentType
 * @returns {boolean} whether that grant still satisfies the CURRENT policy.
 */
function isConsentCurrent(latestRow, consentType) {
  const policy = CONSENT_POLICIES[consentType];
  if (!policy || !latestRow) return false;
  return !!latestRow.granted && latestRow.policy_version === policy.version;
}

/**
 * @param {Map<string, object>} latestByType consent_type -> latest row
 * @returns {string[]} the consent types still missing/outdated, i.e. what
 *   must be granted before processing may proceed.
 */
function findMissingConsents(latestByType) {
  return REQUIRED_CONSENT_TYPES.filter(
    (type) => !isConsentCurrent(latestByType.get(type), type)
  );
}

module.exports = {
  CONSENT_POLICIES,
  REQUIRED_CONSENT_TYPES,
  isKnownConsentType,
  isConsentCurrent,
  findMissingConsents,
};

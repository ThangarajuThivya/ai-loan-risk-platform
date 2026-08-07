"use strict";

/**
 * Runnable test script for consent.service.js (J1).
 *   node src/services/__tests__/consent.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  CONSENT_POLICIES,
  REQUIRED_CONSENT_TYPES,
  isKnownConsentType,
  isConsentCurrent,
  findMissingConsents,
} = require("../consent.service");

// --- isKnownConsentType -----------------------------------------------

assert.strictEqual(isKnownConsentType("data_processing"), true);
assert.strictEqual(isKnownConsentType("credit_bureau_check"), true);
assert.strictEqual(isKnownConsentType("marketing"), false);
assert.strictEqual(isKnownConsentType(""), false);
assert.strictEqual(isKnownConsentType(undefined), false);

// --- isConsentCurrent ---------------------------------------------------

// No row at all — never consented.
assert.strictEqual(isConsentCurrent(null, "data_processing"), false);

// Current version, granted.
assert.strictEqual(
  isConsentCurrent(
    { granted: 1, policy_version: CONSENT_POLICIES.data_processing.version },
    "data_processing"
  ),
  true
);

// Stale version — the policy text has since changed, so an old grant does
// not satisfy the CURRENT requirement, even though something was granted.
assert.strictEqual(
  isConsentCurrent({ granted: 1, policy_version: "0.1" }, "data_processing"),
  false
);

// granted=0 is a revocation, and must never be treated as consent even if
// the version otherwise matches.
assert.strictEqual(
  isConsentCurrent(
    { granted: 0, policy_version: CONSENT_POLICIES.credit_bureau_check.version },
    "credit_bureau_check"
  ),
  false
);

// Unknown consent type — nothing can be "current" against a policy that
// doesn't exist.
assert.strictEqual(
  isConsentCurrent({ granted: 1, policy_version: "1.0" }, "not_a_real_type"),
  false
);

// --- findMissingConsents -------------------------------------------------

// Nothing granted at all — every required type is missing.
assert.deepStrictEqual(
  findMissingConsents(new Map()).sort(),
  [...REQUIRED_CONSENT_TYPES].sort()
);

// Everything granted at the current version — nothing missing. This is the
// load-bearing case for the loan.controller.js#assess gate: a returning,
// fully-consented applicant must be let straight through with zero friction.
{
  const allCurrent = new Map(
    REQUIRED_CONSENT_TYPES.map((type) => [
      type,
      { granted: 1, policy_version: CONSENT_POLICIES[type].version },
    ])
  );
  assert.deepStrictEqual(findMissingConsents(allCurrent), []);
}

// One granted, one missing — only the missing one is reported, not both.
{
  const partial = new Map([
    [
      "data_processing",
      { granted: 1, policy_version: CONSENT_POLICIES.data_processing.version },
    ],
  ]);
  assert.deepStrictEqual(findMissingConsents(partial), ["credit_bureau_check"]);
}

// A revoked grant (granted=0) must still count as missing, not satisfied.
{
  const revoked = new Map([
    ["data_processing", { granted: 0, policy_version: CONSENT_POLICIES.data_processing.version }],
    ["credit_bureau_check", { granted: 1, policy_version: CONSENT_POLICIES.credit_bureau_check.version }],
  ]);
  assert.deepStrictEqual(findMissingConsents(revoked), ["data_processing"]);
}

// A stale-version grant must still count as missing — re-consent is
// required whenever the policy text has moved on.
{
  const stale = new Map([
    ["data_processing", { granted: 1, policy_version: "0.1" }],
    ["credit_bureau_check", { granted: 1, policy_version: CONSENT_POLICIES.credit_bureau_check.version }],
  ]);
  assert.deepStrictEqual(findMissingConsents(stale), ["data_processing"]);
}

console.log("consent.service.js: all assertions passed.");

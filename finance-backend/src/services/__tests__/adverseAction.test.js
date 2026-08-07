"use strict";

/**
 * Runnable test script for adverse-action documentation (D4).
 *   node src/services/__tests__/adverseAction.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  REASONS,
  REASON_CODES,
  findReason,
  isValidReasonCode,
  deriveReasonCodesFromPolicy,
  buildAdverseActionRecord,
} = require("../adverseAction.service");
const { evaluateCreditPolicy } = require("../creditPolicy.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("catalog integrity");

check("every reason has a code, label, and description", () => {
  for (const r of REASONS) {
    assert(r.code && typeof r.code === "string", `missing code: ${JSON.stringify(r)}`);
    assert(r.label && typeof r.label === "string", `${r.code}: missing label`);
    assert(r.description && typeof r.description === "string", `${r.code}: missing description`);
    assert(Array.isArray(r.policyRuleCodes), `${r.code}: policyRuleCodes must be an array`);
  }
});

check("codes are unique", () => {
  assert.strictEqual(new Set(REASON_CODES).size, REASON_CODES.length);
});

check("REASON_CODES matches the catalog order exactly", () => {
  assert.deepStrictEqual(REASON_CODES, REASONS.map((r) => r.code));
});

check("findReason / isValidReasonCode agree with the catalog", () => {
  for (const r of REASONS) {
    assert.strictEqual(findReason(r.code), r);
    assert.strictEqual(isValidReasonCode(r.code), true);
  }
  assert.strictEqual(findReason("NOT_A_CODE"), undefined);
  assert.strictEqual(isValidReasonCode("NOT_A_CODE"), false);
  assert.strictEqual(isValidReasonCode(""), false);
  assert.strictEqual(isValidReasonCode(undefined), false);
});

check("codes with no policy mapping are the ones a machine could never infer", () => {
  // These exist purely for a human to select — asserted explicitly so a
  // future edit that accidentally gives one of them a policyRuleCodes entry
  // (silently turning a staff-only reason into an auto-suggested one) fails
  // a test instead of shipping quietly.
  for (const code of ["UNABLE_TO_VERIFY", "ADVERSE_INFORMATION", "HIGH_RISK_ASSESSMENT", "OTHER"]) {
    assert.deepStrictEqual(findReason(code).policyRuleCodes, [], code);
  }
});

check("OTHER is flagged as requiring a note; the rest are not", () => {
  assert.strictEqual(findReason("OTHER").requiresNote, true);
  for (const r of REASONS) {
    if (r.code === "OTHER") continue;
    assert.strictEqual(r.requiresNote, undefined, r.code);
  }
});

console.log("deriveReasonCodesFromPolicy");

check("maps a single policy rule code to its one adverse-action reason", () => {
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(["CRIB_SCORE"]), [
    "INSUFFICIENT_CREDIT_HISTORY",
  ]);
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(["AGE_MIN"]), ["AGE_INELIGIBLE"]);
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(["AGE_AT_MATURITY"]), ["AGE_INELIGIBLE"]);
});

check("several policy rules collapse into ONE reason, not several near-duplicates", () => {
  // An applicant is owed "your obligations are too high," not four
  // sentences about DTI/residual-income/loan-to-income/facility-count.
  const codes = deriveReasonCodesFromPolicy([
    "DTI_LIMIT",
    "RESIDUAL_INCOME",
    "LOAN_TO_INCOME",
    "EXISTING_FACILITIES",
  ]);
  assert.deepStrictEqual(codes, ["EXCESSIVE_OBLIGATIONS"]);
});

check("multiple distinct findings produce multiple distinct reasons, in catalog order", () => {
  // Input order is PREVIOUS_DEFAULTS, CRIB_SCORE, AGE_MIN — the output
  // follows the CATALOG's order (INSUFFICIENT_CREDIT_HISTORY appears before
  // DELINQUENT_CREDIT_HISTORY in REASONS), not the input order, so the
  // suggested list is stable regardless of how D1 happened to order its
  // own reason_codes.
  const codes = deriveReasonCodesFromPolicy(["PREVIOUS_DEFAULTS", "CRIB_SCORE", "AGE_MIN"]);
  assert.deepStrictEqual(codes, [
    "INSUFFICIENT_CREDIT_HISTORY",
    "DELINQUENT_CREDIT_HISTORY",
    "AGE_INELIGIBLE",
  ]);
});

check("an unrecognised policy code derives nothing, rather than throwing", () => {
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(["SOME_FUTURE_RULE"]), []);
});

check("no input derives no reasons", () => {
  assert.deepStrictEqual(deriveReasonCodesFromPolicy([]), []);
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(), []);
});

check("the mapping is deterministic and idempotent", () => {
  const a = deriveReasonCodesFromPolicy(["PREVIOUS_DEFAULTS", "GUARANTOR_DEFAULTS"]);
  const b = deriveReasonCodesFromPolicy(["PREVIOUS_DEFAULTS", "GUARANTOR_DEFAULTS"]);
  assert.deepStrictEqual(a, b);
  // Both PREVIOUS_DEFAULTS and GUARANTOR_DEFAULTS map to the SAME reason —
  // must not appear twice.
  assert.deepStrictEqual(a, ["DELINQUENT_CREDIT_HISTORY"]);
});

console.log("deriveReasonCodesFromPolicy × the real policy engine");

check("every policy rule that can decline maps to a real adverse-action reason", () => {
  // Walk the policy engine's own decline-capable rules and confirm each has
  // SOME mapping here — a rule that can decline an application but has no
  // adverse-action reason would leave an auto-rejected applicant with no
  // structured explanation at all, which is the exact failure D4 exists to
  // prevent. Built from a real evaluateCreditPolicy() call, not a hardcoded
  // copy of D1's rule list, so this stays honest if D1's rules change.
  const declined = evaluateCreditPolicy({
    applicant: {
      age: 70,
      monthlyIncome: 10000,
      monthlyExpense: 20000,
      employmentType: "Contract",
      yearsEmployed: 0,
      existingLoans: 6,
      previousDefaults: 3,
      cribScore: 400,
      guarantorDefaults: 2,
    },
    loan: { amount: 50000000, tenureMonths: 12, emi: 5000000 },
  });
  assert.strictEqual(declined.outcome, "decline");
  const failedOrReferred = declined.rules
    .filter((r) => r.status === "fail" || r.status === "refer")
    .map((r) => r.code);
  assert(failedOrReferred.length > 0, "test setup: expected several rules to fire");

  const derived = deriveReasonCodesFromPolicy(declined.reason_codes);
  assert(derived.length > 0);
  // Every code creditPolicy actually returned as a reason must translate.
  for (const ruleCode of declined.reason_codes) {
    const mapped = REASONS.some((r) => r.policyRuleCodes.includes(ruleCode));
    assert(mapped, `policy rule code ${ruleCode} has no adverse-action mapping`);
  }
});

console.log("D5 mappings (guarantor reliability / collateral coverage)");

check("GUARANTOR_RELIABILITY maps to its own dedicated reason", () => {
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(["GUARANTOR_RELIABILITY"]), [
    "GUARANTOR_RELIABILITY_CONCERN",
  ]);
});

check("COLLATERAL_COVERAGE maps to its own dedicated reason", () => {
  assert.deepStrictEqual(deriveReasonCodesFromPolicy(["COLLATERAL_COVERAGE"]), [
    "INSUFFICIENT_COLLATERAL",
  ]);
});

check("the two D5 reasons don't collide with any D1 reason's mapping", () => {
  const g = findReason("GUARANTOR_RELIABILITY_CONCERN");
  const c = findReason("INSUFFICIENT_COLLATERAL");
  assert.deepStrictEqual(g.policyRuleCodes, ["GUARANTOR_RELIABILITY"]);
  assert.deepStrictEqual(c.policyRuleCodes, ["COLLATERAL_COVERAGE"]);
  for (const r of REASONS) {
    if (r.code === "GUARANTOR_RELIABILITY_CONCERN" || r.code === "INSUFFICIENT_COLLATERAL") continue;
    assert(!r.policyRuleCodes.includes("GUARANTOR_RELIABILITY"), r.code);
    assert(!r.policyRuleCodes.includes("COLLATERAL_COVERAGE"), r.code);
  }
});

console.log("buildAdverseActionRecord");

const SNAPSHOT = {
  riskLabel: 2,
  riskCategory: "High Risk",
  probLow: 0.05,
  probMedium: 0.15,
  probHigh: 0.8,
  modelVersion: "abc123def456",
  policyVersion: "cp-1.0",
  policyOutcome: "decline",
  matrixVersion: "dm-1.0",
  matrixAction: "auto_reject",
  pricedInterestRate: 16.5,
};

check("assembles a record carrying the full immutable snapshot", () => {
  const rec = buildAdverseActionRecord({
    reasonCodes: ["DELINQUENT_CREDIT_HISTORY"],
    decisionSource: "system",
    decidedBy: null,
    note: "Automatic rejection.",
    snapshot: SNAPSHOT,
  });
  assert.deepStrictEqual(rec.reasonCodes, ["DELINQUENT_CREDIT_HISTORY"]);
  assert.strictEqual(rec.reasons.length, 1);
  assert.strictEqual(rec.reasons[0].code, "DELINQUENT_CREDIT_HISTORY");
  assert.strictEqual(rec.reasons[0].label, findReason("DELINQUENT_CREDIT_HISTORY").label);
  assert.strictEqual(rec.decisionSource, "system");
  assert.strictEqual(rec.decidedBy, null);
  assert.strictEqual(rec.modelVersion, "abc123def456");
  assert.strictEqual(rec.matrixAction, "auto_reject");
  assert.strictEqual(rec.pricedInterestRate, 16.5);
});

check("rejects an empty reason list — a rejection must always have a reason", () => {
  assert.throws(
    () => buildAdverseActionRecord({ reasonCodes: [], decisionSource: "manual" }),
    /at least one reason code/
  );
  assert.throws(
    () => buildAdverseActionRecord({ decisionSource: "manual" }),
    /at least one reason code/
  );
});

check("rejects an invented reason code", () => {
  assert.throws(
    () => buildAdverseActionRecord({ reasonCodes: ["NOT_REAL"], decisionSource: "manual" }),
    /Unknown adverse-action reason code/
  );
});

check("rejects an invalid decisionSource", () => {
  assert.throws(
    () =>
      buildAdverseActionRecord({
        reasonCodes: ["OTHER"],
        decisionSource: "robot",
        note: "x",
      }),
    /decisionSource/
  );
});

check("deduplicates reason codes while preserving first-seen order", () => {
  const rec = buildAdverseActionRecord({
    reasonCodes: ["INSUFFICIENT_CREDIT_HISTORY", "DELINQUENT_CREDIT_HISTORY", "INSUFFICIENT_CREDIT_HISTORY"],
    decisionSource: "manual",
    decidedBy: 7,
  });
  assert.deepStrictEqual(rec.reasonCodes, [
    "INSUFFICIENT_CREDIT_HISTORY",
    "DELINQUENT_CREDIT_HISTORY",
  ]);
  assert.strictEqual(rec.reasons.length, 2);
});

check("an omitted snapshot stores every field as null, never guessed", () => {
  const rec = buildAdverseActionRecord({ reasonCodes: ["OTHER"], decisionSource: "manual", decidedBy: 3, note: "x" });
  for (const field of [
    "riskLabel",
    "riskCategory",
    "probLow",
    "probMedium",
    "probHigh",
    "modelVersion",
    "policyVersion",
    "policyOutcome",
    "matrixVersion",
    "matrixAction",
    "pricedInterestRate",
  ]) {
    assert.strictEqual(rec[field], null, field);
  }
});

check("a manual rejection carries the reviewer's decidedBy and note through untouched", () => {
  const rec = buildAdverseActionRecord({
    reasonCodes: ["EXCESSIVE_OBLIGATIONS"],
    decisionSource: "manual",
    decidedBy: 42,
    note: "Confirmed with the applicant by phone.",
    snapshot: SNAPSHOT,
  });
  assert.strictEqual(rec.decidedBy, 42);
  assert.strictEqual(rec.note, "Confirmed with the applicant by phone.");
});

console.log(`\n${passed} assertions passed.`);

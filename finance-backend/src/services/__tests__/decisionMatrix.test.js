"use strict";

/**
 * Runnable test script for the decision policy matrix (D2).
 *   node src/services/__tests__/decisionMatrix.test.js
 * Exits non-zero on the first failed assertion.
 *
 * Two things are worth testing hard here and are tested hard below: that
 * every one of the nine cells does what the documented table says, and that
 * the override gate cannot be walked around — a reviewer deciding against
 * the system must always be asked why, in the right direction.
 */

const assert = require("assert");
const {
  evaluateDecisionMatrix,
  requiresOverride,
  overrideReasonsFor,
  isValidOverrideReason,
  findOverrideReason,
  MATRIX,
  MATRIX_VERSION,
  DECISION_ACTIONS,
  OVERRIDE_REASONS,
  OVERRIDE_REASON_CODES,
} = require("../decisionMatrix.service");
const { evaluateCreditPolicy } = require("../creditPolicy.service");
const { canTransition } = require("../applicationStatus.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const POLICY_OUTCOMES = ["pass", "refer", "decline"];
const RISK_LABELS = [0, 1, 2];

/** Shorthand for the action a (policy, risk) pair produces. */
function actionFor(policyOutcome, riskLabel) {
  return evaluateDecisionMatrix({ policyOutcome, riskLabel }).action;
}

console.log("the matrix itself");

check("every cell of the documented table produces its documented action", () => {
  // The table from the module docblock, transcribed independently. If the
  // MATRIX constant is edited without intent, this fails.
  const expected = {
    pass: { 0: "auto_approve", 1: "manual_review", 2: "manual_review" },
    refer: { 0: "manual_review", 1: "manual_review", 2: "manual_review" },
    decline: { 0: "auto_reject", 1: "auto_reject", 2: "auto_reject" },
  };
  for (const outcome of POLICY_OUTCOMES) {
    for (const label of RISK_LABELS) {
      assert.strictEqual(
        actionFor(outcome, label),
        expected[outcome][label],
        `${outcome} × risk ${label}`
      );
    }
  }
});

check("a policy decline is unaffected by the risk band", () => {
  // The whole argument for the decline row: a mandatory criterion cannot be
  // bought off with a good score. If this ever stops holding, the criterion
  // was never mandatory.
  const actions = RISK_LABELS.map((label) => actionFor("decline", label));
  assert.deepStrictEqual(actions, ["auto_reject", "auto_reject", "auto_reject"]);
});

check("exactly one cell auto-approves", () => {
  const approving = [];
  for (const outcome of POLICY_OUTCOMES) {
    for (const label of RISK_LABELS) {
      if (actionFor(outcome, label) === "auto_approve") approving.push(`${outcome}/${label}`);
    }
  }
  assert.deepStrictEqual(approving, ["pass/0"]);
});

check("only auto_reject ever acts on its own", () => {
  for (const outcome of POLICY_OUTCOMES) {
    for (const label of RISK_LABELS) {
      const result = evaluateDecisionMatrix({ policyOutcome: outcome, riskLabel: label });
      assert.strictEqual(
        result.acts_automatically,
        result.action === "auto_reject",
        `${outcome}/${label} acts_automatically disagreed with its action`
      );
    }
  }
});

check("every cell yields a known action, and every action is reachable", () => {
  const seen = new Set();
  for (const outcome of POLICY_OUTCOMES) {
    for (const label of RISK_LABELS) {
      const action = actionFor(outcome, label);
      assert(DECISION_ACTIONS.includes(action), `unknown action ${action}`);
      seen.add(action);
    }
  }
  assert.strictEqual(seen.size, DECISION_ACTIONS.length);
});

check("the MATRIX constant and the evaluated result never disagree", () => {
  for (const outcome of POLICY_OUTCOMES) {
    for (const label of RISK_LABELS) {
      assert.strictEqual(MATRIX[outcome][label], actionFor(outcome, label));
    }
  }
});

console.log("inputs and degradation");

check("evaluations are stamped with the matrix version", () => {
  assert.strictEqual(
    evaluateDecisionMatrix({ policyOutcome: "pass", riskLabel: 0 }).matrix_version,
    MATRIX_VERSION
  );
});

check("unrecognised inputs fall to a human, never to an automatic verdict", () => {
  // The safe default, and the only defensible one — a matrix that guesses
  // when it doesn't recognise its own inputs is worse than no matrix.
  for (const bad of [
    {},
    { policyOutcome: "pass" },
    { riskLabel: 0 },
    { policyOutcome: "banana", riskLabel: 0 },
    { policyOutcome: "decline", riskLabel: 9 },
    { policyOutcome: null, riskLabel: null },
  ]) {
    const result = evaluateDecisionMatrix(bad);
    assert.strictEqual(result.action, "manual_review", JSON.stringify(bad));
    assert.strictEqual(result.acts_automatically, false);
  }
});

check("a risk label arriving as a string from SQL still resolves", () => {
  assert.strictEqual(actionFor("pass", "0"), "auto_approve");
  assert.strictEqual(actionFor("decline", "2"), "auto_reject");
});

check("every result carries a rationale naming the risk band", () => {
  const r = evaluateDecisionMatrix({ policyOutcome: "pass", riskLabel: 0 });
  assert(r.rationale.length > 0);
  assert.match(r.rationale, /low risk/i);
  const d = evaluateDecisionMatrix({ policyOutcome: "decline", riskLabel: 2 });
  assert.match(d.rationale, /mandatory credit policy/i);
});

check("the same inputs always produce the same result", () => {
  const a = evaluateDecisionMatrix({ policyOutcome: "refer", riskLabel: 1 });
  const b = evaluateDecisionMatrix({ policyOutcome: "refer", riskLabel: 1 });
  assert.deepStrictEqual(a, b);
});

console.log("end-to-end with the real policy engine");

check("a clean, low-risk applicant reaches auto_approve", () => {
  // Fed from creditPolicy's real output rather than a hand-written "pass",
  // so a change to D1's aggregation that silently stops producing 'pass'
  // shows up here.
  const policy = evaluateCreditPolicy({
    applicant: {
      age: 35,
      monthlyIncome: 200000,
      monthlyExpense: 80000,
      employmentType: "Permanent",
      yearsEmployed: 6,
      existingLoans: 1,
      previousDefaults: 0,
      cribScore: 720,
      guarantorDefaults: 0,
    },
    loan: { amount: 1500000, tenureMonths: 36, emi: 50000 },
  });
  assert.strictEqual(policy.outcome, "pass");
  assert.strictEqual(actionFor(policy.outcome, 0), "auto_approve");
});

check("a mandatory policy breach reaches auto_reject even at low risk", () => {
  const policy = evaluateCreditPolicy({
    applicant: { age: 35, monthlyIncome: 200000, monthlyExpense: 80000, previousDefaults: 2 },
    loan: { amount: 1500000, tenureMonths: 36, emi: 50000 },
  });
  assert.strictEqual(policy.outcome, "decline");
  assert.strictEqual(actionFor(policy.outcome, 0), "auto_reject");
});

check("a referred policy never auto-approves, whatever the model says", () => {
  const policy = evaluateCreditPolicy({
    applicant: { age: 35, monthlyIncome: 200000, monthlyExpense: 80000, existingLoans: 5 },
    loan: { amount: 1500000, tenureMonths: 36, emi: 50000 },
  });
  assert.strictEqual(policy.outcome, "refer");
  for (const label of RISK_LABELS) {
    assert.strictEqual(actionFor(policy.outcome, label), "manual_review");
  }
});

console.log("override gate");

check("agreeing with the matrix needs no reason code", () => {
  assert.strictEqual(
    requiresOverride({ targetStatus: "approved", matrixAction: "auto_approve" }).required,
    false
  );
  assert.strictEqual(
    requiresOverride({ targetStatus: "rejected", matrixAction: "auto_reject" }).required,
    false
  );
});

check("approving what the matrix wanted rejected is a lenient override", () => {
  const r = requiresOverride({ targetStatus: "approved", matrixAction: "auto_reject" });
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.direction, "lenient");
  assert(r.reason);
});

check("rejecting what the matrix wanted approved is a strict override", () => {
  const r = requiresOverride({ targetStatus: "rejected", matrixAction: "auto_approve" });
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.direction, "strict");
});

check("approving over a policy decline is gated whatever the matrix said", () => {
  // Belt and braces: the most consequential thing a reviewer can do here
  // must not depend on which cell happened to fire.
  for (const matrixAction of ["auto_reject", "manual_review", "auto_approve", null]) {
    const r = requiresOverride({
      targetStatus: "approved",
      matrixAction,
      policyOutcome: "decline",
    });
    assert.strictEqual(r.required, true, `matrixAction=${matrixAction}`);
    assert.strictEqual(r.direction, "lenient");
  }
});

check("manual_review cannot be contradicted, so neither verdict is an override", () => {
  for (const targetStatus of ["approved", "rejected"]) {
    assert.strictEqual(
      requiresOverride({ targetStatus, matrixAction: "manual_review" }).required,
      false
    );
  }
});

check("workflow moves are never treated as overrides", () => {
  // Demanding a justification for opening a file would train reviewers to
  // pick a code at random, which is worse than not asking.
  for (const targetStatus of ["under_review", "more_info_required", "disbursed", "closed"]) {
    assert.strictEqual(
      requiresOverride({ targetStatus, fromStatus: "pending", matrixAction: "auto_reject" })
        .required,
      false,
      targetStatus
    );
  }
});

check("reopening a rejection always requires a reason", () => {
  const r = requiresOverride({
    fromStatus: "rejected",
    targetStatus: "under_review",
    matrixAction: "auto_reject",
  });
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.direction, "lenient");
});

check("reopening is the only way out of rejected, and only for an admin", () => {
  // The gate above is meaningless if the transition itself isn't there —
  // and dangerous if any reviewer could take it. Asserted against the real
  // status machine, not a copy of it.
  assert(canTransition("rejected", "under_review", "admin"));
  assert(!canTransition("rejected", "under_review", "staff"));
  assert(!canTransition("rejected", "approved", "admin"));
});

check("an application with no matrix evaluation is decided the old way", () => {
  // Everything assessed before D2 must keep working without a reason code.
  for (const targetStatus of ["approved", "rejected"]) {
    assert.strictEqual(
      requiresOverride({ targetStatus, matrixAction: null }).required,
      false
    );
    assert.strictEqual(requiresOverride({ targetStatus }).required, false);
  }
});

check("an unrecognised stored action does not silently gate or ungate", () => {
  assert.strictEqual(
    requiresOverride({ targetStatus: "approved", matrixAction: "something_else" }).required,
    false
  );
});

console.log("reason codes");

check("codes are unique and well-formed", () => {
  const codes = OVERRIDE_REASONS.map((r) => r.code);
  assert.strictEqual(new Set(codes).size, codes.length);
  for (const r of OVERRIDE_REASONS) {
    assert(r.code && r.label && r.description, `incomplete reason: ${JSON.stringify(r)}`);
    assert(
      ["lenient", "strict", "any"].includes(r.direction),
      `${r.code}: bad direction ${r.direction}`
    );
  }
  assert.deepStrictEqual(OVERRIDE_REASON_CODES, codes);
});

check("a lenient override is never offered a strict-only justification", () => {
  // "Adverse information came to light" as the stated reason for an
  // APPROVAL would poison the audit trail more quietly than a missing code.
  const lenient = overrideReasonsFor("lenient").map((r) => r.code);
  assert(lenient.includes("POLICY_EXCEPTION"));
  assert(!lenient.includes("ADVERSE_INFORMATION"));
  assert(!lenient.includes("VERIFICATION_FAILED"));
});

check("a strict override is never offered a lenient-only justification", () => {
  const strict = overrideReasonsFor("strict").map((r) => r.code);
  assert(strict.includes("ADVERSE_INFORMATION"));
  assert(!strict.includes("POLICY_EXCEPTION"));
  assert(!strict.includes("ADDITIONAL_SECURITY"));
});

check("'any' codes are offered in both directions", () => {
  for (const direction of ["lenient", "strict"]) {
    const codes = overrideReasonsFor(direction).map((r) => r.code);
    assert(codes.includes("OTHER"), direction);
    assert(codes.includes("DATA_CORRECTION"), direction);
  }
});

check("omitting the direction returns the whole catalogue", () => {
  assert.strictEqual(overrideReasonsFor().length, OVERRIDE_REASONS.length);
});

check("validation matches exactly what the catalogue offers", () => {
  // The API hands a client overrideReasonsFor(direction) and then validates
  // with isValidOverrideReason — if those two ever diverge, a reviewer gets
  // a 422 for picking an option they were shown.
  for (const direction of ["lenient", "strict"]) {
    for (const reason of OVERRIDE_REASONS) {
      const offered = overrideReasonsFor(direction).some((r) => r.code === reason.code);
      assert.strictEqual(
        isValidOverrideReason(reason.code, direction),
        offered,
        `${reason.code} / ${direction}`
      );
    }
  }
});

check("an invented code is never valid", () => {
  assert(!isValidOverrideReason("MADE_UP", "lenient"));
  assert(!isValidOverrideReason("", "lenient"));
  assert(!isValidOverrideReason(undefined));
});

check("codes that mean nothing alone are flagged as needing a note", () => {
  assert.strictEqual(findOverrideReason("OTHER").requiresNote, true);
  assert.strictEqual(findOverrideReason("DATA_CORRECTION").requiresNote, true);
  assert.strictEqual(findOverrideReason("POLICY_EXCEPTION").requiresNote, undefined);
});

console.log(`\n${passed} assertions passed.`);

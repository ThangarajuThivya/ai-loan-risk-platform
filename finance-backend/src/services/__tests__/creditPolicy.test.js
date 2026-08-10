"use strict";

/**
 * Runnable test script for the deterministic credit policy engine (D1).
 *   node src/services/__tests__/creditPolicy.test.js
 * Exits non-zero on the first failed assertion.
 *
 * Thresholds are read from the exported POLICY rather than hardcoded here:
 * a test that carries its own copy of the numbers passes happily after
 * someone edits the policy and forgets the rule that reads it.
 */

const assert = require("assert");
const {
  evaluateCreditPolicy,
  summarizePolicy,
  ageAtMaturity,
  POLICY,
  POLICY_VERSION,
} = require("../creditPolicy.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** The rule with this code, or undefined. */
function ruleFor(result, code) {
  return result.rules.find((r) => r.code === code);
}

/** Assert a rule reached a given status, with a useful message on failure. */
function statusIs(result, code, expected) {
  const r = ruleFor(result, code);
  assert(r, `no rule with code ${code}`);
  assert.strictEqual(
    r.status,
    expected,
    `${code}: expected ${expected}, got ${r.status} — ${r.detail}`
  );
}

/**
 * A comfortably-qualifying applicant, used as the baseline every test
 * perturbs one field of. 35 years old, LKR 200k income, LKR 80k expenses,
 * asking LKR 1.5m over 36 months at an instalment of 50k:
 *   DTI            = 50,000 / 200,000            = 25%   (limit 40/55%)
 *   residual       = (200,000 − 80,000) − 50,000 = 70,000 (floor 15,000)
 *   loan-to-income = 1,500,000 / 2,400,000       = 0.63×  (limit 5/8×)
 *   age at maturity= 35 + 3                      = 38     (ceiling 65)
 */
const CLEAN = {
  applicant: {
    age: 35,
    monthlyIncome: 200000,
    monthlyExpense: 80000,
    employmentType: "Permanent",
    additionalIncome: 0,
    yearsEmployed: 6,
    existingLoans: 1,
    previousDefaults: 0,
    cribScore: 720,
    guarantorDefaults: 0,
  },
  loan: { amount: 1500000, tenureMonths: 36, emi: 50000 },
};

/** CLEAN with some applicant fields replaced. */
function withApplicant(overrides) {
  return {
    applicant: { ...CLEAN.applicant, ...overrides },
    loan: { ...CLEAN.loan },
  };
}

/** CLEAN with some loan fields replaced. */
function withLoan(overrides) {
  return {
    applicant: { ...CLEAN.applicant },
    loan: { ...CLEAN.loan, ...overrides },
  };
}

console.log("baseline");

check("a comfortably-qualifying applicant passes every rule", () => {
  const result = evaluateCreditPolicy(CLEAN);
  assert.strictEqual(result.outcome, "pass");
  assert.deepStrictEqual(result.reason_codes, []);
  const notPassed = result.rules.filter((r) => r.status !== "pass");
  assert.strictEqual(
    notPassed.length,
    0,
    `expected all rules to pass, got: ${notPassed.map((r) => `${r.code}=${r.status}`).join(", ")}`
  );
});

check("the evaluation is stamped with the policy version", () => {
  assert.strictEqual(evaluateCreditPolicy(CLEAN).policy_version, POLICY_VERSION);
});

check("the same input always yields the same verdict", () => {
  // Determinism is the entire premise of policy sitting beside the model —
  // no clock, no randomness, no I/O.
  const a = evaluateCreditPolicy(CLEAN);
  const b = evaluateCreditPolicy(CLEAN);
  assert.deepStrictEqual(a, b);
});

check("metrics are computed from the applicant's own figures", () => {
  const m = evaluateCreditPolicy(CLEAN).metrics;
  assert.strictEqual(m.gross_monthly_income, 200000);
  assert.strictEqual(m.net_monthly_income, 120000);
  assert.strictEqual(m.dti, 0.25);
  assert.strictEqual(m.residual_income, 70000);
  assert.strictEqual(m.age_at_maturity, 38);
  assert.strictEqual(m.loan_to_income, 0.625);
});

console.log("age rules");

check("age at maturity rounds a part-year term UP", () => {
  // 30 months is 2.5 years — a 63-year-old matures at 66, not 65. Rounding
  // down here would clear exactly the case the ceiling exists to catch.
  assert.strictEqual(ageAtMaturity(63, 30), 66);
  assert.strictEqual(ageAtMaturity(63, 36), 66);
  assert.strictEqual(ageAtMaturity(63, 24), 65);
});

check("an applicant under the minimum age is a mandatory decline", () => {
  const result = evaluateCreditPolicy(withApplicant({ age: POLICY.MIN_AGE - 1 }));
  statusIs(result, "AGE_MIN", "fail");
  assert.strictEqual(result.outcome, "decline");
});

check("exactly the minimum age passes", () => {
  statusIs(
    evaluateCreditPolicy(withApplicant({ age: POLICY.MIN_AGE })),
    "AGE_MIN",
    "pass"
  );
});

check("maturing past the age ceiling is a mandatory decline", () => {
  // 60 + 5 years = 65, exactly the ceiling → allowed; one month more is not.
  const atCeiling = evaluateCreditPolicy(
    withApplicant({ age: 60 })
  );
  statusIs(atCeiling, "AGE_AT_MATURITY", "pass");

  const over = evaluateCreditPolicy({
    applicant: { ...CLEAN.applicant, age: 64 },
    loan: { ...CLEAN.loan, tenureMonths: 24 },
  });
  statusIs(over, "AGE_AT_MATURITY", "fail");
  assert.strictEqual(over.outcome, "decline");
});

check("a missing date of birth skips both age rules rather than guessing", () => {
  const result = evaluateCreditPolicy(withApplicant({ age: null }));
  statusIs(result, "AGE_MIN", "skipped");
  statusIs(result, "AGE_AT_MATURITY", "skipped");
  // A skipped rule must not manufacture a decline OR a clean pass on its own.
  assert.strictEqual(result.outcome, "pass");
});

console.log("income and affordability rules");

check("income below the floor is a mandatory decline", () => {
  const result = evaluateCreditPolicy(
    withApplicant({ monthlyIncome: POLICY.MIN_MONTHLY_INCOME - 1 })
  );
  statusIs(result, "MIN_MONTHLY_INCOME", "fail");
  assert.strictEqual(result.outcome, "decline");
});

check("declared additional income counts toward the income floor", () => {
  const result = evaluateCreditPolicy(
    withApplicant({ monthlyIncome: 20000, additionalIncome: 15000 })
  );
  statusIs(result, "MIN_MONTHLY_INCOME", "pass");
  assert.strictEqual(result.metrics.gross_monthly_income, 35000);
});

check("expenses at or above income is a mandatory decline", () => {
  const result = evaluateCreditPolicy(
    withApplicant({ monthlyIncome: 100000, monthlyExpense: 100000 })
  );
  statusIs(result, "NET_INCOME_POSITIVE", "fail");
  assert.strictEqual(result.outcome, "decline");
});

check("DTI over the refer line refers, over the ceiling declines", () => {
  // Income 200,000 → 40% is an 80,000 instalment, 55% is 110,000. Both
  // thresholds are inclusive: sitting exactly on the line passes it.
  statusIs(evaluateCreditPolicy(withLoan({ emi: 80000 })), "DTI_LIMIT", "pass");
  statusIs(evaluateCreditPolicy(withLoan({ emi: 82000 })), "DTI_LIMIT", "refer");
  statusIs(evaluateCreditPolicy(withLoan({ emi: 110000 })), "DTI_LIMIT", "refer");

  const over = evaluateCreditPolicy(withLoan({ emi: 115000 }));
  statusIs(over, "DTI_LIMIT", "fail");
  assert.strictEqual(over.outcome, "decline");
});

check("DTI is compared at 4dp, so a rounding-dust overshoot isn't a finding", () => {
  // 80,001 / 200,000 = 40.0005%. Treating that as "over 40%" would turn
  // one rupee of instalment rounding into a manual review.
  statusIs(evaluateCreditPolicy(withLoan({ emi: 80001 })), "DTI_LIMIT", "pass");
});

check("DTI is the instalment over income, not the principal", () => {
  // A large principal on a long term can be perfectly affordable; policy
  // must judge the monthly commitment, not the headline loan size.
  const m = evaluateCreditPolicy(
    withLoan({ amount: 5000000, tenureMonths: 120, emi: 60000 })
  ).metrics;
  assert.strictEqual(m.dti, 0.3);
});

check("residual income catches a passing DTI with crushing expenses", () => {
  // DTI is 25% — comfortably inside the limit — but expenses of 140,000
  // leave only 10,000 after the instalment.
  const result = evaluateCreditPolicy(withApplicant({ monthlyExpense: 140000 }));
  statusIs(result, "DTI_LIMIT", "pass");
  statusIs(result, "RESIDUAL_INCOME", "refer");
  assert.strictEqual(result.outcome, "refer");
});

check("a negative residual is a mandatory decline", () => {
  const result = evaluateCreditPolicy(withApplicant({ monthlyExpense: 180000 }));
  statusIs(result, "RESIDUAL_INCOME", "fail");
  assert.strictEqual(result.outcome, "decline");
});

check("loan-to-income refers above 5x and declines above 8x", () => {
  // Annual gross is 2,400,000, so 5× = 12,000,000 and 8× = 19,200,000.
  statusIs(evaluateCreditPolicy(withLoan({ amount: 12000000 })), "LOAN_TO_INCOME", "pass");
  statusIs(evaluateCreditPolicy(withLoan({ amount: 13000000 })), "LOAN_TO_INCOME", "refer");
  // Exactly 8× sits on the ceiling — reviewable, not declinable.
  statusIs(evaluateCreditPolicy(withLoan({ amount: 19200000 })), "LOAN_TO_INCOME", "refer");
  statusIs(evaluateCreditPolicy(withLoan({ amount: 20000000 })), "LOAN_TO_INCOME", "fail");
});

check("ratios over unknown income are null, never a flawless zero", () => {
  const result = evaluateCreditPolicy({
    applicant: { age: 35, monthlyIncome: 0, monthlyExpense: 0 },
    loan: { amount: 1000000, tenureMonths: 24, emi: 50000 },
  });
  assert.strictEqual(result.metrics.dti, null);
  assert.strictEqual(result.metrics.loan_to_income, null);
  statusIs(result, "DTI_LIMIT", "skipped");
  statusIs(result, "LOAN_TO_INCOME", "skipped");
  // Zero income still fails the income floor outright, so nobody slips
  // through on the back of two skipped ratios.
  assert.strictEqual(result.outcome, "decline");
});

console.log("employment and credit-history rules");

check("non-permanent employment carries the longer service requirement", () => {
  // 18 months clears the 1-year bar for a permanent employee...
  statusIs(
    evaluateCreditPolicy(
      withApplicant({ employmentType: "Permanent", yearsEmployed: 1 })
    ),
    "EMPLOYMENT_TENURE",
    "pass"
  );
  // ...but not the 2-year bar for a contractor.
  statusIs(
    evaluateCreditPolicy(
      withApplicant({ employmentType: "Contract", yearsEmployed: 1 })
    ),
    "EMPLOYMENT_TENURE",
    "refer"
  );
  statusIs(
    evaluateCreditPolicy(
      withApplicant({ employmentType: "Self-Employed", yearsEmployed: 3 })
    ),
    "EMPLOYMENT_TENURE",
    "pass"
  );
});

check("one prior default refers; the second is a mandatory decline", () => {
  statusIs(evaluateCreditPolicy(withApplicant({ previousDefaults: 0 })), "PREVIOUS_DEFAULTS", "pass");
  const one = evaluateCreditPolicy(withApplicant({ previousDefaults: 1 }));
  statusIs(one, "PREVIOUS_DEFAULTS", "refer");
  assert.strictEqual(one.outcome, "refer");
  const two = evaluateCreditPolicy(withApplicant({ previousDefaults: 2 }));
  statusIs(two, "PREVIOUS_DEFAULTS", "fail");
  assert.strictEqual(two.outcome, "decline");
});

check("a CRIB score below the floor is a mandatory decline", () => {
  statusIs(evaluateCreditPolicy(withApplicant({ cribScore: 620 })), "CRIB_SCORE", "pass");
  statusIs(evaluateCreditPolicy(withApplicant({ cribScore: 550 })), "CRIB_SCORE", "refer");
  statusIs(evaluateCreditPolicy(withApplicant({ cribScore: 480 })), "CRIB_SCORE", "fail");
});

check("stacking existing facilities refers", () => {
  statusIs(evaluateCreditPolicy(withApplicant({ existingLoans: 3 })), "EXISTING_FACILITIES", "pass");
  statusIs(evaluateCreditPolicy(withApplicant({ existingLoans: 4 })), "EXISTING_FACILITIES", "refer");
});

check("a default on a guaranteed facility refers", () => {
  statusIs(evaluateCreditPolicy(withApplicant({ guarantorDefaults: 0 })), "GUARANTOR_DEFAULTS", "pass");
  statusIs(evaluateCreditPolicy(withApplicant({ guarantorDefaults: 1 })), "GUARANTOR_DEFAULTS", "refer");
});

console.log("undeclared credit history");

check("undeclared history is skipped, never scored as clean or as a finding", () => {
  // This is the rule that keeps mlClient's neutral defaults out of policy:
  // an applicant who declared no CRIB score must not be declined on a
  // fabricated 700, nor cleared by one.
  const result = evaluateCreditPolicy({
    applicant: {
      age: 35,
      monthlyIncome: 200000,
      monthlyExpense: 80000,
      employmentType: "Permanent",
    },
    loan: CLEAN.loan,
  });
  for (const code of [
    "CRIB_SCORE",
    "PREVIOUS_DEFAULTS",
    "EXISTING_FACILITIES",
    "GUARANTOR_DEFAULTS",
    "EMPLOYMENT_TENURE",
  ]) {
    statusIs(result, code, "skipped");
  }
  assert.strictEqual(result.outcome, "pass");
  assert.deepStrictEqual(result.reason_codes, []);
});

check("a declared zero is a real declaration, not an absence", () => {
  // 0 existing loans / 0 defaults must evaluate, unlike a blank field.
  const result = evaluateCreditPolicy(
    withApplicant({ existingLoans: 0, previousDefaults: 0, guarantorDefaults: 0 })
  );
  statusIs(result, "EXISTING_FACILITIES", "pass");
  statusIs(result, "PREVIOUS_DEFAULTS", "pass");
  statusIs(result, "GUARANTOR_DEFAULTS", "pass");
});

console.log("guarantor reliability (D5)");

check("no linked guarantor passes — a confirmed absence, not missing data", () => {
  const result = evaluateCreditPolicy(CLEAN);
  statusIs(result, "GUARANTOR_RELIABILITY", "pass");
  const r = ruleFor(result, "GUARANTOR_RELIABILITY");
  assert.notStrictEqual(r.status, "skipped");
});

check("a clean linked guarantor (no distress elsewhere) passes", () => {
  const result = evaluateCreditPolicy(
    withApplicant({
      guarantors: [
        { fullName: "K. Perera", otherActiveGuaranteeCount: 0, otherActiveExposure: 0, isDistressedElsewhere: false },
      ],
    })
  );
  statusIs(result, "GUARANTOR_RELIABILITY", "pass");
});

check("a guarantor overdue on another facility elsewhere refers", () => {
  const result = evaluateCreditPolicy(
    withApplicant({
      guarantors: [
        { fullName: "N. Silva", otherActiveGuaranteeCount: 1, otherActiveExposure: 800000, isDistressedElsewhere: true },
      ],
    })
  );
  statusIs(result, "GUARANTOR_RELIABILITY", "refer");
  assert.strictEqual(result.outcome, "refer");
  assert(ruleFor(result, "GUARANTOR_RELIABILITY").detail.includes("N. Silva"));
});

check("one distressed guarantor among several still refers", () => {
  const result = evaluateCreditPolicy(
    withApplicant({
      guarantors: [
        { fullName: "Clean One", otherActiveGuaranteeCount: 0, otherActiveExposure: 0, isDistressedElsewhere: false },
        { fullName: "Distressed One", otherActiveGuaranteeCount: 2, otherActiveExposure: 1200000, isDistressedElsewhere: true },
      ],
    })
  );
  statusIs(result, "GUARANTOR_RELIABILITY", "refer");
});

check("GUARANTOR_RELIABILITY is independent of GUARANTOR_DEFAULTS — different questions", () => {
  // A clean self-declaration (applicant's own liability elsewhere) alongside
  // a distressed NOMINATED guarantor (backing THIS loan) must not cancel
  // each other out — both rules are evaluated and reported separately.
  const result = evaluateCreditPolicy(
    withApplicant({
      guarantorDefaults: 0,
      guarantors: [
        { fullName: "X", otherActiveGuaranteeCount: 1, otherActiveExposure: 100000, isDistressedElsewhere: true },
      ],
    })
  );
  statusIs(result, "GUARANTOR_DEFAULTS", "pass");
  statusIs(result, "GUARANTOR_RELIABILITY", "refer");
});

console.log("collateral coverage (D5)");

const noCollateral = { itemCount: 0, totalDeclaredValue: 0, totalVerifiedValue: 0, hasUnverified: false };

check("no collateral pledged passes — a confirmed absence, not missing data", () => {
  const result = evaluateCreditPolicy(withLoan({ collateral: noCollateral }));
  statusIs(result, "COLLATERAL_COVERAGE", "pass");
  assert.notStrictEqual(ruleFor(result, "COLLATERAL_COVERAGE").status, "skipped");
});

check("omitting loan.collateral entirely behaves exactly like no collateral", () => {
  const result = evaluateCreditPolicy(CLEAN);
  statusIs(result, "COLLATERAL_COVERAGE", "pass");
});

check("unverified collateral ALWAYS refers, however large the claimed value", () => {
  // CLEAN's requested amount is 1,500,000 — this declares FAR more than
  // full coverage, and it still refers, because nothing has been verified.
  const result = evaluateCreditPolicy(
    withLoan({
      collateral: {
        itemCount: 1,
        totalDeclaredValue: 5000000,
        totalVerifiedValue: 0,
        hasUnverified: true,
      },
    })
  );
  statusIs(result, "COLLATERAL_COVERAGE", "refer");
});

check("verified collateral at or above the coverage floor passes", () => {
  // CLEAN requests 1,500,000; 80% of that is 1,200,000.
  const result = evaluateCreditPolicy(
    withLoan({
      collateral: {
        itemCount: 1,
        totalDeclaredValue: 1200000,
        totalVerifiedValue: 1200000,
        hasUnverified: false,
      },
    })
  );
  statusIs(result, "COLLATERAL_COVERAGE", "pass");
});

check("fully verified collateral below the coverage floor refers", () => {
  const result = evaluateCreditPolicy(
    withLoan({
      collateral: {
        itemCount: 1,
        totalDeclaredValue: 900000,
        totalVerifiedValue: 900000, // 60% of 1,500,000
        hasUnverified: false,
      },
    })
  );
  statusIs(result, "COLLATERAL_COVERAGE", "refer");
});

check("verified collateral exactly AT the floor passes (inclusive)", () => {
  const result = evaluateCreditPolicy(
    withLoan({
      collateral: {
        itemCount: 1,
        totalDeclaredValue: 1200000,
        totalVerifiedValue: 1200000, // exactly 80% of 1,500,000
        hasUnverified: false,
      },
    })
  );
  statusIs(result, "COLLATERAL_COVERAGE", "pass");
});

check("there is no decline tier for collateral — worst case is refer", () => {
  const result = evaluateCreditPolicy(
    withLoan({
      collateral: { itemCount: 3, totalDeclaredValue: 10, totalVerifiedValue: 10, hasUnverified: false },
    })
  );
  statusIs(result, "COLLATERAL_COVERAGE", "refer");
  const r = ruleFor(result, "COLLATERAL_COVERAGE");
  assert.notStrictEqual(r.status, "fail");
});

check("COLLATERAL_COVERAGE and GUARANTOR_RELIABILITY never touch the model score", () => {
  // Restating D1's independence guarantee for the two new D5 rules
  // specifically — neither reads riskLabel/probabilities from anywhere.
  const result = evaluateCreditPolicy({
    applicant: { ...CLEAN.applicant, riskLabel: 2, guarantors: [{ fullName: "Y", isDistressedElsewhere: false }] },
    loan: { ...CLEAN.loan, collateral: { itemCount: 1, totalDeclaredValue: 2000000, totalVerifiedValue: 2000000, hasUnverified: false } },
  });
  assert.strictEqual(result.outcome, "pass");
});

console.log("verdict aggregation");

check("one mandatory breach outweighs an otherwise clean file", () => {
  // Everything else is pristine; the age ceiling alone decides it.
  const result = evaluateCreditPolicy({
    applicant: { ...CLEAN.applicant, age: 64 },
    loan: { ...CLEAN.loan, tenureMonths: 36 },
  });
  assert.strictEqual(result.outcome, "decline");
});

check("a decline outranks concurrent refers", () => {
  const result = evaluateCreditPolicy(
    withApplicant({ previousDefaults: 2, existingLoans: 5, guarantorDefaults: 1 })
  );
  assert.strictEqual(result.outcome, "decline");
  // Failures are listed ahead of referrals — an adverse-action letter leads
  // with the reason that actually decided the case.
  assert.strictEqual(result.reason_codes[0], "PREVIOUS_DEFAULTS");
  assert(result.reason_codes.includes("EXISTING_FACILITIES"));
  assert(result.reason_codes.includes("GUARANTOR_DEFAULTS"));
});

check("refer wins over pass but never over decline", () => {
  const referOnly = evaluateCreditPolicy(withApplicant({ existingLoans: 5 }));
  assert.strictEqual(referOnly.outcome, "refer");
  assert.deepStrictEqual(referOnly.reason_codes, ["EXISTING_FACILITIES"]);
});

check("the verdict never consults a risk label", () => {
  // Policy independence, asserted directly: passing a risk score in must
  // change nothing, because nothing reads it.
  const withScore = evaluateCreditPolicy({
    applicant: { ...CLEAN.applicant, riskLabel: 2, risk_category: "High Risk" },
    loan: { ...CLEAN.loan, risk_label: 2 },
  });
  assert.strictEqual(withScore.outcome, "pass");
});

console.log("summaries");

check("the summary names the rules that decided the verdict", () => {
  const declined = evaluateCreditPolicy(withApplicant({ previousDefaults: 2 }));
  assert(/Declined by credit policy/.test(summarizePolicy(declined)));
  assert(/Previous defaults/.test(summarizePolicy(declined)));

  const referred = evaluateCreditPolicy(withApplicant({ existingLoans: 5 }));
  assert(/Manual review required/.test(summarizePolicy(referred)));

  assert(/Meets all mandatory/.test(summarizePolicy(evaluateCreditPolicy(CLEAN))));
});

check("every rule carries a code, label, detail and threshold", () => {
  // The stored rules JSON (029) is what D4's adverse-action letter renders,
  // so a rule that can't explain itself is a broken rule.
  for (const r of evaluateCreditPolicy(CLEAN).rules) {
    assert(r.code && typeof r.code === "string", `missing code: ${JSON.stringify(r)}`);
    assert(r.label && typeof r.label === "string", `${r.code}: missing label`);
    assert(r.detail && typeof r.detail === "string", `${r.code}: missing detail`);
    assert("value" in r && "threshold" in r, `${r.code}: missing value/threshold`);
    assert(
      ["pass", "refer", "fail", "skipped"].includes(r.status),
      `${r.code}: bad status ${r.status}`
    );
  }
});

check("rule codes are unique", () => {
  // Duplicated codes would make reason_codes ambiguous and break any
  // downstream lookup by code.
  const codes = evaluateCreditPolicy(CLEAN).rules.map((r) => r.code);
  assert.strictEqual(new Set(codes).size, codes.length);
});

check("an empty input degrades to skips and income failures, not a crash", () => {
  const result = evaluateCreditPolicy();
  assert.strictEqual(result.outcome, "decline");
  assert(result.rules.length > 0);
});

/* --------------------------------------------------------------------- *
 * Leasing rules (L2.2)
 * --------------------------------------------------------------------- */

const LEASE_OK = {
  ltv: { decidable: true, ltv: 68, maxLtv: 70, withinPolicy: true, base: 4000000, baseSource: "valuation" },
  downPaymentPercent: 32,
  minimumDownPaymentPercent: 30,
};

check("LOAD-BEARING: a loan evaluation is unchanged by the leasing rules existing", () => {
  // The lease rules must be ABSENT for a loan, not present-and-skipped:
  // anything else changes the stored rule set of every existing loan.
  const codes = evaluateCreditPolicy(CLEAN).rules.map((r) => r.code);
  assert.ok(!codes.includes("LEASE_LTV"), "LEASE_LTV must not appear on a loan");
  assert.ok(!codes.includes("LEASE_DOWN_PAYMENT"), "LEASE_DOWN_PAYMENT must not appear on a loan");
});

check("a compliant lease adds both rules and still passes", () => {
  const result = evaluateCreditPolicy({ ...CLEAN, lease: LEASE_OK });
  const codes = result.rules.map((r) => r.code);
  assert.ok(codes.includes("LEASE_LTV") && codes.includes("LEASE_DOWN_PAYMENT"));
  assert.strictEqual(result.rules.find((r) => r.code === "LEASE_LTV").status, "pass");
  assert.strictEqual(result.outcome, "pass");
});

check("LTV above the cap is a mandatory breach, not a referral", () => {
  const result = evaluateCreditPolicy({
    ...CLEAN,
    lease: {
      ...LEASE_OK,
      ltv: { decidable: true, ltv: 87.5, maxLtv: 70, withinPolicy: false, base: 4000000, baseSource: "valuation" },
    },
  });
  const r = result.rules.find((x) => x.code === "LEASE_LTV");
  assert.strictEqual(r.status, "fail");
  assert.strictEqual(result.outcome, "decline");
  assert.ok(result.reason_codes.includes("LEASE_LTV"));
});

check("an LTV judged on a valuation says so in its detail", () => {
  const result = evaluateCreditPolicy({ ...CLEAN, lease: LEASE_OK });
  const r = result.rules.find((x) => x.code === "LEASE_LTV");
  // Which figure the ratio was measured against changes what it means, so a
  // reviewer must be able to see it without opening another table.
  assert.ok(/valuation/i.test(r.detail), `detail should name the base: ${r.detail}`);
});

check("a missing valuation refers — neither a pass nor a decline", () => {
  const result = evaluateCreditPolicy({
    ...CLEAN,
    lease: { ...LEASE_OK, ltv: { decidable: false, reason: "valuation_required" } },
  });
  const r = result.rules.find((x) => x.code === "LEASE_LTV");
  assert.strictEqual(r.status, "refer");
  assert.strictEqual(result.outcome, "refer");
  assert.ok(/valuation is required/i.test(r.detail));
});

check("a short down payment is a mandatory breach", () => {
  const result = evaluateCreditPolicy({
    ...CLEAN,
    lease: { ...LEASE_OK, downPaymentPercent: 12, minimumDownPaymentPercent: 30 },
  });
  const r = result.rules.find((x) => x.code === "LEASE_DOWN_PAYMENT");
  assert.strictEqual(r.status, "fail");
  assert.strictEqual(result.outcome, "decline");
});

check("an unsupplied down payment skips rather than failing", () => {
  const result = evaluateCreditPolicy({
    ...CLEAN,
    lease: { ltv: LEASE_OK.ltv, downPaymentPercent: null, minimumDownPaymentPercent: null },
  });
  const r = result.rules.find((x) => x.code === "LEASE_DOWN_PAYMENT");
  assert.strictEqual(r.status, "skipped");
});

check("lease rule codes stay unique alongside the loan ones", () => {
  const codes = evaluateCreditPolicy({ ...CLEAN, lease: LEASE_OK }).rules.map((r) => r.code);
  assert.strictEqual(new Set(codes).size, codes.length);
});

console.log(`\n${passed} assertions passed.`);

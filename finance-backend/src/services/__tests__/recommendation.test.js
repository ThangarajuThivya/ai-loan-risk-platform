"use strict";

/**
 * Runnable test script for the recommendation engine (no test runner needed).
 *   node src/services/__tests__/recommendation.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  computeEmi,
  computeFlatEmi,
  computeEmiForRateType,
  maxAffordableAmount,
  affordabilityFactor,
  pickLoanType,
  buildRecommendation,
} = require("../recommendation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// Assert two numbers are equal within an absolute tolerance.
function closeTo(actual, expected, tol, msg) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${msg}: expected ${expected} ± ${tol}, got ${actual}`
  );
}

console.log("computeEmi");

check("matches hand-checked value for (2,500,000 @ 14.5% / 36m)", () => {
  // Hand-checked: P=2,500,000 r=0.145/12 n=36 → 86,052.443607
  const emi = computeEmi(2500000, 14.5, 36);
  closeTo(emi, 86052.443607, 1e-4, "EMI");
});

check("r = 0 falls back to straight-line repayment", () => {
  assert.strictEqual(computeEmi(1200000, 0, 12), 100000);
});

check("principal <= 0 gives 0", () => {
  assert.strictEqual(computeEmi(0, 14.5, 36), 0);
});

check("tenure <= 0 throws", () => {
  assert.throws(() => computeEmi(1000000, 14.5, 0));
});

check("1-month tenure pays off the whole principal in one instalment", () => {
  // r = 14.5/12/100, growth = (1+r)^1 = 1+r, EMI = P*r*(1+r) / r = P*(1+r)
  const emi = computeEmi(100000, 14.5, 1);
  closeTo(emi, 100000 * (1 + 14.5 / 12 / 100), 1e-9, "1-month EMI");
});

console.log("computeFlatEmi (G1 — two of the six seeded products are rate_type='flat')");

check("matches hand-checked value: P=1,200,000 @ 12% / 12m", () => {
  // totalInterest = 1,200,000 * 0.12 * (12/12) = 144,000
  // EMI = (1,200,000 + 144,000) / 12 = 112,000
  assert.strictEqual(computeFlatEmi(1200000, 12, 12), 112000);
});

check("zero rate is straight-line principal / tenure, same as computeEmi's r=0 case", () => {
  assert.strictEqual(computeFlatEmi(1200000, 0, 12), 100000);
});

check("principal <= 0 gives 0", () => {
  assert.strictEqual(computeFlatEmi(0, 12, 12), 0);
});

check("tenure <= 0 throws", () => {
  assert.throws(() => computeFlatEmi(1000000, 12, 0));
});

check("1-month tenure charges exactly one month's flat interest", () => {
  // totalInterest = 100,000 * 0.12 * (1/12) = 1,000; EMI = 101,000
  assert.strictEqual(computeFlatEmi(100000, 12, 1), 101000);
});

check("flat EMI is always >= the reducing-balance EMI for the same inputs", () => {
  // Flat charges interest on the original principal for the full term;
  // reducing charges it only on what's still owed — flat can never be
  // cheaper for the borrower at the same headline rate.
  const flat = computeFlatEmi(2500000, 14.5, 36);
  const reducing = computeEmi(2500000, 14.5, 36);
  assert(flat >= reducing, `expected flat (${flat}) >= reducing (${reducing})`);
});

console.log("computeEmiForRateType (dispatch — see loan_products.rate_type)");

check("'flat' dispatches to computeFlatEmi", () => {
  assert.strictEqual(
    computeEmiForRateType(1200000, 12, 12, "flat"),
    computeFlatEmi(1200000, 12, 12)
  );
});

check("'reducing' dispatches to computeEmi", () => {
  assert.strictEqual(
    computeEmiForRateType(2500000, 14.5, 36, "reducing"),
    computeEmi(2500000, 14.5, 36)
  );
});

check("an unrecognised or missing rate_type falls back to reducing-balance", () => {
  const expected = computeEmi(2500000, 14.5, 36);
  assert.strictEqual(computeEmiForRateType(2500000, 14.5, 36, "bogus"), expected);
  assert.strictEqual(computeEmiForRateType(2500000, 14.5, 36, undefined), expected);
});

console.log("affordabilityFactor / risk bands");

check("Low (0) = 0.50, Medium (1) = 0.35, High (2) = 0.20", () => {
  assert.strictEqual(affordabilityFactor(0), 0.5);
  assert.strictEqual(affordabilityFactor(1), 0.35);
  assert.strictEqual(affordabilityFactor(2), 0.2);
});

check("unknown risk label falls back to most conservative (0.20)", () => {
  assert.strictEqual(affordabilityFactor(99), 0.2);
});

console.log("maxAffordableAmount");

check("scales maxEMI by the risk-band affordability factor", () => {
  const income = 200000;
  // Low band allows a larger principal than High for the same income.
  const low = maxAffordableAmount(income, 0, 14.5, 36);
  const high = maxAffordableAmount(income, 2, 14.5, 36);
  assert(low > high, "Low-risk affordable amount should exceed High-risk");
});

check("non-positive income gives 0", () => {
  assert.strictEqual(maxAffordableAmount(0, 0, 14.5, 36), 0);
});

check("r = 0 inverts straight-line correctly", () => {
  // maxEMI = 100000 * 0.5 = 50000; over 12 months at 0% → 600000 principal.
  assert.strictEqual(maxAffordableAmount(100000, 0, 0, 12), 600000);
});

console.log("principal-inversion round-trip");

check("EMI of maxAffordableAmount output ≈ maxEMI for each band", () => {
  const income = 175000;
  const rate = 14.5;
  const tenure = 48;
  for (const risk of [0, 1, 2]) {
    const maxEmi = income * affordabilityFactor(risk);
    const principal = maxAffordableAmount(income, risk, rate, tenure);
    const emiBack = computeEmi(principal, rate, tenure);
    closeTo(emiBack, maxEmi, 0.01, `round-trip risk=${risk}`);
  }
});

console.log("pickLoanType");

check("purpose keywords map to SL products", () => {
  assert.strictEqual(pickLoanType({ purpose: "home construction" }), "Housing");
  assert.strictEqual(pickLoanType({ purpose: "buy a car" }), "Vehicle / Leasing");
  assert.strictEqual(pickLoanType({ purpose: "vehicle leasing" }), "Vehicle / Leasing");
  assert.strictEqual(pickLoanType({ purpose: "university tuition" }), "Education");
  assert.strictEqual(pickLoanType({ purpose: "working capital for shop" }), "Business");
  assert.strictEqual(pickLoanType({ purpose: "gold pawning" }), "Pawning");
});

check("small high-risk ask with no clear purpose → Pawning", () => {
  assert.strictEqual(
    pickLoanType({ purpose: "cash", amount: 100000, income: 40000, riskLabel: 2 }),
    "Pawning"
  );
});

check("defaults to Personal", () => {
  assert.strictEqual(
    pickLoanType({ purpose: "personal expenses", amount: 500000, income: 150000, riskLabel: 0 }),
    "Personal"
  );
});

console.log("buildRecommendation");

check("returns the full recommendation shape", () => {
  const rec = buildRecommendation({
    netIncome: 175000,
    riskLabel: 1,
    annualRatePct: 14.5,
    tenureMonths: 48,
    purpose: "buy a van",
  });
  assert.deepStrictEqual(Object.keys(rec).sort(), [
    "affordability_factor",
    "loan_type",
    "recommended_amount",
    "recommended_emi",
  ]);
  assert.strictEqual(rec.loan_type, "Vehicle / Leasing");
  assert.strictEqual(rec.affordability_factor, 0.35);
  // EMI of the recommended amount should not exceed the affordable ceiling.
  const maxEmi = 175000 * 0.35;
  assert(rec.recommended_emi <= maxEmi + 0.5, "recommended EMI within affordable ceiling");
});

check("caps recommended amount at the affordable maximum", () => {
  const affordable = maxAffordableAmount(100000, 2, 14.5, 24);
  const rec = buildRecommendation({
    netIncome: 100000,
    riskLabel: 2,
    annualRatePct: 14.5,
    tenureMonths: 24,
    requestedAmount: 10000000, // far more than affordable
    purpose: "personal",
  });
  assert.strictEqual(rec.recommended_amount, Math.floor(affordable));
});

check("honours a smaller requested amount", () => {
  const rec = buildRecommendation({
    netIncome: 500000,
    riskLabel: 0,
    annualRatePct: 14.5,
    tenureMonths: 36,
    requestedAmount: 300000,
    purpose: "personal",
  });
  assert.strictEqual(rec.recommended_amount, 300000);
});

console.log(`\nAll ${passed} assertions passed.`);

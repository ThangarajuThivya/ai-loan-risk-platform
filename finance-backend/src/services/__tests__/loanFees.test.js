"use strict";

/**
 * Runnable test script for loan fees, net disbursement, and effective APR (I1).
 *   node src/services/__tests__/loanFees.test.js
 * Exits non-zero on the first failed assertion.
 *
 * The load-bearing test in here is "a zero-fee loan's effective APR equals
 * its nominal rate". That is the property that proves the IRR solver is
 * actually solving the right equation — if the maths were wrong, that
 * identity would not hold, and every fee-laden APR it produces would be
 * quietly wrong in a way no other assertion would catch.
 */

const assert = require("assert");
const {
  FEE_TYPES,
  CALC_METHODS,
  resolveFee,
  resolveFees,
  applyWaivers,
  summarizeFees,
  computeEffectiveApr,
  buildOfferFees,
} = require("../loanFees.service");
const { computeEmi, computeFlatEmi } = require("../recommendation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const closeTo = (actual, expected, tol, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ~${expected}, got ${actual} (tolerance ${tol})`
  );

/** A loan_product_fees-shaped config row. */
const cfg = (o = {}) => ({
  fee_type: "processing",
  label: "Processing fee",
  calc_method: "percentage",
  rate_or_amount: 2,
  min_amount: null,
  max_amount: null,
  active: 1,
  ...o,
});

console.log("resolveFee — percentage");

check("takes a straight percentage of the APPROVED amount", () => {
  assert.strictEqual(resolveFee(cfg({ rate_or_amount: 2 }), 500000).amount, 10000);
  assert.strictEqual(resolveFee(cfg({ rate_or_amount: 1.5 }), 200000).amount, 3000);
});

check("clamps up to the configured floor", () => {
  // 2% of 50,000 = 1,000, but the floor is 2,500.
  assert.strictEqual(resolveFee(cfg({ min_amount: 2500 }), 50000).amount, 2500);
});

check("clamps down to the configured ceiling", () => {
  // 2% of 10,000,000 = 200,000, but the ceiling is 50,000.
  assert.strictEqual(resolveFee(cfg({ max_amount: 50000 }), 10000000).amount, 50000);
});

check("leaves an in-range percentage untouched by the caps", () => {
  assert.strictEqual(
    resolveFee(cfg({ min_amount: 2500, max_amount: 50000 }), 500000).amount,
    10000
  );
});

check("rounds to 2dp rather than carrying float noise", () => {
  const amount = resolveFee(cfg({ rate_or_amount: 0.5 }), 333333).amount;
  assert.strictEqual(amount, 1666.67);
});

console.log("\nresolveFee — fixed");

check("ignores the approved amount entirely", () => {
  const c = cfg({ calc_method: "fixed", rate_or_amount: 2000 });
  assert.strictEqual(resolveFee(c, 100000).amount, 2000);
  assert.strictEqual(resolveFee(c, 9999999).amount, 2000);
});

check("ignores min/max — a flat fee is already its own answer", () => {
  const c = cfg({ calc_method: "fixed", rate_or_amount: 2000, min_amount: 5000, max_amount: 100 });
  assert.strictEqual(resolveFee(c, 500000).amount, 2000);
});

check("never produces a negative fee", () => {
  assert.ok(resolveFee(cfg({ rate_or_amount: -5 }), 500000).amount >= 0);
});

console.log("\nresolveFees");

check("drops inactive fees so no caller can forget to", () => {
  const fees = resolveFees(
    [cfg(), cfg({ fee_type: "documentation", active: 0 }), cfg({ fee_type: "other", active: false })],
    500000
  );
  assert.strictEqual(fees.length, 1);
  assert.strictEqual(fees[0].fee_type, "processing");
});

check("survives an empty or missing config list", () => {
  assert.deepStrictEqual(resolveFees([], 500000), []);
  assert.deepStrictEqual(resolveFees(undefined, 500000), []);
});

check("every advertised fee type and calc method resolves", () => {
  for (const fee_type of FEE_TYPES) {
    for (const calc_method of CALC_METHODS) {
      const r = resolveFee(cfg({ fee_type, calc_method, rate_or_amount: 1000 }), 500000);
      assert.ok(Number.isFinite(r.amount) && r.amount >= 0, `${fee_type}/${calc_method}`);
    }
  }
});

console.log("\napplyWaivers");

const THREE = () =>
  resolveFees(
    [
      cfg({ fee_type: "processing", rate_or_amount: 2 }),
      cfg({ fee_type: "documentation", calc_method: "fixed", rate_or_amount: 2000 }),
      cfg({ fee_type: "credit_life_insurance", rate_or_amount: 0.5 }),
    ],
    500000
  );

check("zeroes the waived fee but KEEPS the line and its reason", () => {
  const out = applyWaivers(THREE(), [{ fee_type: "processing", reason: "Loyal customer" }]);
  assert.strictEqual(out.length, 3, "the line must not be dropped");
  const p = out.find((f) => f.fee_type === "processing");
  assert.strictEqual(p.amount, 0);
  assert.strictEqual(p.waived, true);
  assert.strictEqual(p.waived_reason, "Loyal customer");
  assert.strictEqual(p.original_amount, 10000, "what would have been charged is preserved");
});

check("leaves un-waived fees completely alone", () => {
  const out = applyWaivers(THREE(), [{ fee_type: "processing", reason: "x" }]);
  const doc = out.find((f) => f.fee_type === "documentation");
  assert.strictEqual(doc.amount, 2000);
  assert.strictEqual(doc.waived, false);
});

check("does not mutate its input", () => {
  const original = THREE();
  applyWaivers(original, [{ fee_type: "processing", reason: "x" }]);
  assert.strictEqual(original.find((f) => f.fee_type === "processing").amount, 10000);
});

check("ignores a waiver for a fee that isn't on this offer", () => {
  const out = applyWaivers(THREE(), [{ fee_type: "nonexistent", reason: "x" }]);
  assert.strictEqual(out.filter((f) => f.waived).length, 0);
});

check("handles multiple waivers at once", () => {
  const out = applyWaivers(THREE(), [
    { fee_type: "processing", reason: "a" },
    { fee_type: "documentation", reason: "b" },
  ]);
  assert.strictEqual(out.filter((f) => f.waived).length, 2);
});

console.log("\nsummarizeFees");

check("totals the lines and nets them off the approved amount", () => {
  const s = summarizeFees(THREE(), 500000);
  // 10,000 + 2,000 + 2,500
  assert.strictEqual(s.total_fees, 14500);
  assert.strictEqual(s.net_disbursed, 485500);
});

check("a waived fee lowers the total and raises the net", () => {
  const s = summarizeFees(
    applyWaivers(THREE(), [{ fee_type: "processing", reason: "x" }]),
    500000
  );
  assert.strictEqual(s.total_fees, 4500);
  assert.strictEqual(s.net_disbursed, 495500);
});

check("no fees means net === approved", () => {
  const s = summarizeFees([], 500000);
  assert.strictEqual(s.total_fees, 0);
  assert.strictEqual(s.net_disbursed, 500000);
});

check("never nets below zero, even on a misconfigured fee schedule", () => {
  const s = summarizeFees(
    resolveFees([cfg({ calc_method: "fixed", rate_or_amount: 999999 })], 1000),
    1000
  );
  assert.strictEqual(s.net_disbursed, 0);
});

console.log("\ncomputeEffectiveApr — the known-answer check");

check("a ZERO-FEE loan's APR equals its nominal rate (proves the solver)", () => {
  // If this identity fails, the IRR is solving the wrong equation and every
  // fee-laden APR it returns is wrong in a way nothing else here would catch.
  for (const [principal, rate, months] of [
    [500000, 14, 24],
    [1000000, 11.5, 60],
    [250000, 18, 12],
    [75000, 9.25, 36],
  ]) {
    const emi = computeEmi(principal, rate, months);
    const apr = computeEffectiveApr({ netDisbursed: principal, emi, tenureMonths: months });
    closeTo(apr, rate, 0.02, `zero-fee APR at ${rate}% over ${months}m`);
  }
});

check("fees push the APR ABOVE the nominal rate", () => {
  const emi = computeEmi(500000, 14, 24);
  const apr = computeEffectiveApr({ netDisbursed: 485500, emi, tenureMonths: 24 });
  assert.ok(apr > 14, `expected > 14, got ${apr}`);
});

check("more fees means a strictly higher APR", () => {
  const emi = computeEmi(500000, 14, 24);
  const low = computeEffectiveApr({ netDisbursed: 495000, emi, tenureMonths: 24 });
  const high = computeEffectiveApr({ netDisbursed: 470000, emi, tenureMonths: 24 });
  assert.ok(high > low, `${high} should exceed ${low}`);
});

check("the same fee costs MORE on a short loan than a long one", () => {
  // Fees are paid once but earned back over the term, so a 12-month loan
  // feels them far more than a 60-month one. A solver that got this
  // backwards would be inverting the time value of money.
  const shortEmi = computeEmi(500000, 14, 12);
  const longEmi = computeEmi(500000, 14, 60);
  const shortApr = computeEffectiveApr({ netDisbursed: 485500, emi: shortEmi, tenureMonths: 12 });
  const longApr = computeEffectiveApr({ netDisbursed: 485500, emi: longEmi, tenureMonths: 60 });
  assert.ok(shortApr > longApr, `short ${shortApr} should exceed long ${longApr}`);
});

check("works for a FLAT-rate loan too (APR far exceeds the quoted flat rate)", () => {
  // A flat 8.5% is famously not 8.5% — the borrower repays principal down
  // while still paying interest on the original. The APR must expose that.
  const emi = computeFlatEmi(1000000, 8.5, 36);
  const apr = computeEffectiveApr({ netDisbursed: 1000000, emi, tenureMonths: 36 });
  assert.ok(apr > 14, `flat 8.5% should surface as a much higher APR, got ${apr}`);
});

console.log("\ncomputeEffectiveApr — refuses rather than guesses");

check("returns null (not 0) when the borrower repays no more than received", () => {
  assert.strictEqual(
    computeEffectiveApr({ netDisbursed: 100000, emi: 1000, tenureMonths: 12 }),
    null
  );
  assert.strictEqual(
    computeEffectiveApr({ netDisbursed: 12000, emi: 1000, tenureMonths: 12 }),
    null
  );
});

check("returns null on non-finite, zero, or negative inputs", () => {
  const bad = [
    { netDisbursed: NaN, emi: 1000, tenureMonths: 12 },
    { netDisbursed: 100000, emi: NaN, tenureMonths: 12 },
    { netDisbursed: 100000, emi: 1000, tenureMonths: NaN },
    { netDisbursed: 0, emi: 1000, tenureMonths: 12 },
    { netDisbursed: -1, emi: 1000, tenureMonths: 12 },
    { netDisbursed: 100000, emi: 0, tenureMonths: 12 },
    { netDisbursed: 100000, emi: 1000, tenureMonths: 0 },
    { netDisbursed: 100000, emi: 1000, tenureMonths: -5 },
  ];
  for (const input of bad) {
    assert.strictEqual(computeEffectiveApr(input), null, JSON.stringify(input));
  }
});

check("returns null rather than clamping when the true rate is absurd", () => {
  // Net 1,000 repaid as 12 × 10,000 is a rate beyond anything quotable;
  // clamping to the bracket ceiling would state a confidently wrong number.
  assert.strictEqual(
    computeEffectiveApr({ netDisbursed: 1000, emi: 10000, tenureMonths: 12 }),
    null
  );
});

console.log("\nbuildOfferFees — the one call an offer makes");

check("returns lines, totals, net, and APR together and consistently", () => {
  const emi = computeEmi(500000, 14, 24);
  const out = buildOfferFees({
    feeConfigs: [
      cfg({ fee_type: "processing", rate_or_amount: 2, min_amount: 2500, max_amount: 50000 }),
      cfg({ fee_type: "documentation", calc_method: "fixed", rate_or_amount: 2000 }),
      cfg({ fee_type: "credit_life_insurance", rate_or_amount: 0.5, max_amount: 25000 }),
    ],
    approvedAmount: 500000,
    emi,
    tenureMonths: 24,
  });

  assert.strictEqual(out.lines.length, 3);
  assert.strictEqual(out.total_fees, 14500);
  assert.strictEqual(out.net_disbursed, 485500);
  assert.ok(out.effective_apr > 14, "APR must exceed the 14% nominal rate");
  // Internal consistency: the three figures must agree with each other.
  closeTo(
    out.net_disbursed + out.total_fees,
    500000,
    0.01,
    "net + fees must reconstruct the approved amount"
  );
});

check("waiving every fee collapses the APR back to the nominal rate", () => {
  const emi = computeEmi(500000, 14, 24);
  const out = buildOfferFees({
    feeConfigs: [
      cfg({ fee_type: "processing", rate_or_amount: 2 }),
      cfg({ fee_type: "documentation", calc_method: "fixed", rate_or_amount: 2000 }),
    ],
    approvedAmount: 500000,
    emi,
    tenureMonths: 24,
    waivers: [
      { fee_type: "processing", reason: "a" },
      { fee_type: "documentation", reason: "b" },
    ],
  });
  assert.strictEqual(out.total_fees, 0);
  assert.strictEqual(out.net_disbursed, 500000);
  closeTo(out.effective_apr, 14, 0.02, "fully-waived APR");
});

check("a product with no configured fees yields a clean zero-fee offer", () => {
  const emi = computeEmi(500000, 14, 24);
  const out = buildOfferFees({
    feeConfigs: [],
    approvedAmount: 500000,
    emi,
    tenureMonths: 24,
  });
  assert.deepStrictEqual(out.lines, []);
  assert.strictEqual(out.total_fees, 0);
  assert.strictEqual(out.net_disbursed, 500000);
  closeTo(out.effective_apr, 14, 0.02, "no-fee APR");
});

console.log(`\n${passed} assertions passed.`);

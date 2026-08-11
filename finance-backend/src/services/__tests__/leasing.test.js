"use strict";

/**
 * Runnable test script for vehicle leasing maths (L0.2).
 *   node src/services/__tests__/leasing.test.js
 * Exits non-zero on the first failed assertion.
 *
 * Two load-bearing tests in here, in the same spirit as loanFees.test.js's
 * "a zero-fee loan's effective APR equals its nominal rate":
 *
 *   1. Settling a flat-rate lease before paying ANY rental costs exactly the
 *      financed amount. If the sum-of-digits rebate were wrong in either
 *      direction that identity would break, and every settlement figure the
 *      service produced would be quietly wrong with nothing else to catch it.
 *
 *   2. An inflated invoice and an inflated valuation are BOTH caught. The
 *      used-vehicle case below passes LTV on the invoice and fails it on the
 *      valuation — which is the entire reason valuationBase takes the lower
 *      of the two rather than trusting either one.
 */

const assert = require("assert");
const {
  MIN_DOWN_PAYMENT_PERCENT,
  MAX_LTV_PERCENT,
  requiresValuation,
  resolveDownPayment,
  computeFinancedAmount,
  valuationBase,
  computeLtv,
  assessLtv,
  buildLeaseQuote,
  unearnedInterestRebate,
  computeEarlySettlement,
} = require("../leasing.service");
const { computeFlatEmi } = require("../recommendation.service");

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

console.log("leasing.service — down payment, LTV, quote, early settlement");

/* ------------------------------------------------------------------ *
 * Valuation requirement
 * ------------------------------------------------------------------ */

check("every condition needs an independent valuation, brand new included", () => {
  assert.strictEqual(requiresValuation("brand_new"), true);
  assert.strictEqual(requiresValuation("reconditioned"), true);
  assert.strictEqual(requiresValuation("used"), true);
});

/* ------------------------------------------------------------------ *
 * Down payment
 * ------------------------------------------------------------------ */

check("an absolute down payment is echoed back with its percentage", () => {
  const d = resolveDownPayment({
    vehiclePrice: 5000000,
    condition: "brand_new",
    downPaymentAmount: 1000000,
  });
  assert.strictEqual(d.amount, 1000000);
  assert.strictEqual(d.percent, 20);
  assert.strictEqual(d.meetsMinimum, true);
  assert.strictEqual(d.shortfall, 0);
});

check("a percentage down payment resolves to an amount", () => {
  const d = resolveDownPayment({
    vehiclePrice: 5000000,
    condition: "used",
    downPaymentPercent: 30,
  });
  assert.strictEqual(d.amount, 1500000);
  assert.strictEqual(d.percent, 30);
  assert.strictEqual(d.meetsMinimum, true);
});

check("supplying neither quotes the policy minimum for the condition", () => {
  const d = resolveDownPayment({ vehiclePrice: 4000000, condition: "reconditioned" });
  assert.strictEqual(d.minimumPercent, MIN_DOWN_PAYMENT_PERCENT.reconditioned);
  assert.strictEqual(d.amount, 1000000); // 25% of 4,000,000
  assert.strictEqual(d.meetsMinimum, true);
});

check("a short down payment is reported, never silently topped up", () => {
  const d = resolveDownPayment({
    vehiclePrice: 5000000,
    condition: "used", // needs 30% = 1,500,000
    downPaymentAmount: 1000000,
  });
  // The figure the customer actually offered survives untouched.
  assert.strictEqual(d.amount, 1000000);
  assert.strictEqual(d.percent, 20);
  assert.strictEqual(d.meetsMinimum, false);
  assert.strictEqual(d.shortfall, 500000);
});

check("the minimum rises as the vehicle gets older", () => {
  assert.ok(
    MIN_DOWN_PAYMENT_PERCENT.brand_new < MIN_DOWN_PAYMENT_PERCENT.reconditioned &&
      MIN_DOWN_PAYMENT_PERCENT.reconditioned < MIN_DOWN_PAYMENT_PERCENT.used,
    "brand_new < reconditioned < used must hold"
  );
});

check("a down payment at or above the vehicle price is not a lease", () => {
  assert.strictEqual(
    resolveDownPayment({ vehiclePrice: 3000000, condition: "used", downPaymentAmount: 3000000 }),
    null
  );
  assert.strictEqual(
    resolveDownPayment({ vehiclePrice: 3000000, condition: "used", downPaymentAmount: 3500000 }),
    null
  );
});

check("degenerate down-payment inputs return null rather than a number", () => {
  assert.strictEqual(resolveDownPayment({ vehiclePrice: 0, condition: "used" }), null);
  assert.strictEqual(resolveDownPayment({ vehiclePrice: -1, condition: "used" }), null);
  assert.strictEqual(resolveDownPayment({ vehiclePrice: NaN, condition: "used" }), null);
  assert.strictEqual(
    resolveDownPayment({ vehiclePrice: 1000000, condition: "used", downPaymentAmount: -5 }),
    null
  );
});

check("financed amount is price minus down payment, and guards its inputs", () => {
  assert.strictEqual(computeFinancedAmount(5000000, 1000000), 4000000);
  assert.strictEqual(computeFinancedAmount(5000000, 5000000), null);
  assert.strictEqual(computeFinancedAmount(0, 0), null);
  assert.strictEqual(computeFinancedAmount(5000000, -1), null);
});

/* ------------------------------------------------------------------ *
 * Valuation base — the anti-inflation rule
 * ------------------------------------------------------------------ */

check("a brand-new vehicle with no valuation yet has no base at all", () => {
  const b = valuationBase({ condition: "brand_new", invoicePrice: 5000000 });
  assert.strictEqual(b, null);
});

check("a brand-new vehicle's invoice can still be its base, once valued", () => {
  const b = valuationBase({
    condition: "brand_new",
    invoicePrice: 5000000,
    valuationAmount: 5200000, // a valuation ABOVE invoice never inflates the base
  });
  assert.deepStrictEqual(b, { base: 5000000, source: "invoice" });
});

check("an INFLATED INVOICE is caught — the lower valuation becomes the base", () => {
  const b = valuationBase({
    condition: "used",
    invoicePrice: 5000000, // what the paperwork claims
    valuationAmount: 4000000, // what it is actually worth
  });
  assert.deepStrictEqual(b, { base: 4000000, source: "valuation" });
});

check("an INFLATED VALUATION is caught — the lower invoice becomes the base", () => {
  const b = valuationBase({
    condition: "used",
    invoicePrice: 4000000, // what is really being paid
    valuationAmount: 6000000, // a friendly valuer's number
  });
  assert.deepStrictEqual(b, { base: 4000000, source: "invoice" });
});

check("a missing valuation on a used vehicle yields no base at all", () => {
  assert.strictEqual(valuationBase({ condition: "used", invoicePrice: 5000000 }), null);
  assert.strictEqual(
    valuationBase({ condition: "reconditioned", invoicePrice: 5000000, valuationAmount: 0 }),
    null
  );
});

/* ------------------------------------------------------------------ *
 * LTV
 * ------------------------------------------------------------------ */

check("LTV is financed over base, as a percentage", () => {
  assert.strictEqual(computeLtv(4000000, 5000000), 80);
  assert.strictEqual(computeLtv(3500000, 4000000), 87.5);
  assert.strictEqual(computeLtv(0, 5000000), 0);
  assert.strictEqual(computeLtv(4000000, 0), null);
});

check("a brand-new lease is undecidable before its own valuation is back", () => {
  const a = assessLtv({
    condition: "brand_new",
    invoicePrice: 5000000,
    financedAmount: 4000000, // 20% down
  });
  assert.strictEqual(a.decidable, false);
  assert.strictEqual(a.reason, "valuation_required");
});

check("a compliant brand-new lease is within policy, once valued", () => {
  const a = assessLtv({
    condition: "brand_new",
    invoicePrice: 5000000,
    valuationAmount: 5000000,
    financedAmount: 4000000, // 20% down
  });
  assert.strictEqual(a.decidable, true);
  assert.strictEqual(a.ltv, 80);
  assert.strictEqual(a.maxLtv, MAX_LTV_PERCENT.brand_new);
  assert.strictEqual(a.withinPolicy, true);
  assert.strictEqual(a.baseSource, "invoice");
});

check(
  "LOAD-BEARING: a used lease that passes on invoice FAILS on valuation",
  () => {
    const input = {
      condition: "used",
      invoicePrice: 5000000,
      valuationAmount: 4000000,
      financedAmount: 3500000, // customer put down 30% of the invoice
    };

    // Judged against the invoice it looks fine — exactly 70%, the cap.
    assert.strictEqual(computeLtv(input.financedAmount, input.invoicePrice), 70);

    // Judged against what the asset is worth, the lender is 87.5% exposed.
    const a = assessLtv(input);
    assert.strictEqual(a.decidable, true);
    assert.strictEqual(a.base, 4000000);
    assert.strictEqual(a.baseSource, "valuation");
    assert.strictEqual(a.ltv, 87.5);
    assert.strictEqual(a.withinPolicy, false);
  }
);

check("a missing valuation is undecidable — neither a pass nor a fail", () => {
  const a = assessLtv({ condition: "used", invoicePrice: 5000000, financedAmount: 3500000 });
  assert.strictEqual(a.decidable, false);
  assert.strictEqual(a.reason, "valuation_required");
  // Crucially, it must not have quietly answered the question.
  assert.strictEqual(a.withinPolicy, undefined);
});

check("the LTV cap tightens as the vehicle gets older", () => {
  assert.ok(
    MAX_LTV_PERCENT.brand_new > MAX_LTV_PERCENT.reconditioned &&
      MAX_LTV_PERCENT.reconditioned > MAX_LTV_PERCENT.used
  );
});

/* ------------------------------------------------------------------ *
 * The quote
 * ------------------------------------------------------------------ */

const QUOTE = buildLeaseQuote({
  vehiclePrice: 5000000,
  condition: "brand_new",
  annualRatePct: 8.5,
  tenureMonths: 60,
  rateType: "flat",
  downPaymentPercent: 20,
});

check("a flat-rate lease quote is arithmetically consistent", () => {
  assert.strictEqual(QUOTE.downPaymentAmount, 1000000);
  assert.strictEqual(QUOTE.financedAmount, 4000000);
  // 4,000,000 × 8.5% × 5 years = 1,700,000
  assert.strictEqual(QUOTE.totalInterest, 1700000);
  assert.strictEqual(QUOTE.totalRentals, 5700000);
  assert.strictEqual(QUOTE.rental, 95000);
  assert.strictEqual(QUOTE.totalCost, 6700000); // down payment + all rentals
});

check("the rental delegates to the shared EMI maths, not a second formula", () => {
  closeTo(
    QUOTE.rental,
    computeFlatEmi(4000000, 8.5, 60),
    0.01,
    "quote rental vs computeFlatEmi"
  );
});

check("financed + interest always equals the rentals collected", () => {
  closeTo(
    QUOTE.financedAmount + QUOTE.totalInterest,
    QUOTE.totalRentals,
    0.01,
    "financed + interest vs total rentals"
  );
});

check("a quote carries its down-payment shortfall rather than hiding it", () => {
  const short = buildLeaseQuote({
    vehiclePrice: 5000000,
    condition: "used",
    annualRatePct: 8.5,
    tenureMonths: 60,
    downPaymentPercent: 10, // policy wants 30
  });
  assert.strictEqual(short.meetsMinimumDownPayment, false);
  assert.strictEqual(short.downPaymentShortfall, 1000000);
  // It still quotes, so staff can see the numbers before deciding.
  assert.strictEqual(short.financedAmount, 4500000);
});

check("a reducing-rate lease costs less than a flat one at the same rate", () => {
  const reducing = buildLeaseQuote({
    vehiclePrice: 5000000,
    condition: "brand_new",
    annualRatePct: 8.5,
    tenureMonths: 60,
    rateType: "reducing",
    downPaymentPercent: 20,
  });
  assert.ok(
    reducing.totalInterest < QUOTE.totalInterest,
    "reducing-balance interest must be lower than flat at the same headline rate"
  );
});

check("degenerate quote inputs return null", () => {
  const base = {
    vehiclePrice: 5000000,
    condition: "brand_new",
    annualRatePct: 8.5,
    tenureMonths: 60,
  };
  assert.strictEqual(buildLeaseQuote({ ...base, vehiclePrice: 0 }), null);
  assert.strictEqual(buildLeaseQuote({ ...base, tenureMonths: 0 }), null);
  assert.strictEqual(buildLeaseQuote({ ...base, tenureMonths: 12.5 }), null);
  assert.strictEqual(buildLeaseQuote({ ...base, annualRatePct: -1 }), null);
});

/* ------------------------------------------------------------------ *
 * Early settlement
 * ------------------------------------------------------------------ */

check("nothing paid yet means the whole interest is unearned", () => {
  const rebate = unearnedInterestRebate({
    totalInterest: 1700000,
    tenureMonths: 60,
    instalmentsPaid: 0,
  });
  assert.strictEqual(rebate, 1700000);
});

check("a lease run to term has no interest left to rebate", () => {
  assert.strictEqual(
    unearnedInterestRebate({ totalInterest: 1700000, tenureMonths: 60, instalmentsPaid: 60 }),
    0
  );
});

check("the rebate shrinks monotonically as rentals are paid", () => {
  let previous = Infinity;
  for (let paid = 0; paid <= 60; paid += 6) {
    const rebate = unearnedInterestRebate({
      totalInterest: 1700000,
      tenureMonths: 60,
      instalmentsPaid: paid,
    });
    assert.ok(rebate < previous, `rebate must fall at ${paid} paid (${rebate} !< ${previous})`);
    previous = rebate;
  }
});

check("sum-of-digits rebates more than straight-line at the same point", () => {
  // Half way through, a naive pro-rata would hand back exactly half.
  const sumOfDigits = unearnedInterestRebate({
    totalInterest: 1700000,
    tenureMonths: 60,
    instalmentsPaid: 30,
  });
  assert.ok(
    sumOfDigits < 850000,
    "front-loaded interest means less than half is still unearned at the midpoint"
  );
  closeTo(sumOfDigits, 1700000 * ((30 * 31) / (60 * 61)), 0.01, "sum-of-digits rebate");
});

check("rebate rejects impossible instalment counts", () => {
  assert.strictEqual(
    unearnedInterestRebate({ totalInterest: 100, tenureMonths: 12, instalmentsPaid: 13 }),
    null
  );
  assert.strictEqual(
    unearnedInterestRebate({ totalInterest: 100, tenureMonths: 12, instalmentsPaid: -1 }),
    null
  );
  assert.strictEqual(
    unearnedInterestRebate({ totalInterest: 100, tenureMonths: 12, instalmentsPaid: 1.5 }),
    null
  );
});

check(
  "LOAD-BEARING: settling before any rental is paid costs exactly the financed amount",
  () => {
    // The identity that proves the rebate maths. Gross outstanding is every
    // rental including all its interest; the rebate is all of that interest
    // because none has been earned. What is left must be the sum advanced —
    // no more, no less. Any error in the formula breaks this exactly.
    const s = computeEarlySettlement({
      rental: QUOTE.rental,
      totalInterest: QUOTE.totalInterest,
      tenureMonths: QUOTE.tenureMonths,
      instalmentsPaid: 0,
    });
    assert.strictEqual(s.instalmentsRemaining, 60);
    assert.strictEqual(s.grossOutstanding, 5700000);
    assert.strictEqual(s.interestRebate, 1700000);
    closeTo(s.settlementAmount, QUOTE.financedAmount, 0.01, "settlement with nothing paid");
  }
);

check("settling after the final rental costs nothing", () => {
  const s = computeEarlySettlement({
    rental: QUOTE.rental,
    totalInterest: QUOTE.totalInterest,
    tenureMonths: 60,
    instalmentsPaid: 60,
  });
  assert.strictEqual(s.instalmentsRemaining, 0);
  assert.strictEqual(s.grossOutstanding, 0);
  assert.strictEqual(s.settlementAmount, 0);
});

check("settling midway is the remaining rentals less the unearned interest", () => {
  const s = computeEarlySettlement({
    rental: 95000,
    totalInterest: 1700000,
    tenureMonths: 60,
    instalmentsPaid: 30,
  });
  assert.strictEqual(s.instalmentsRemaining, 30);
  assert.strictEqual(s.grossOutstanding, 2850000);
  closeTo(s.interestRebate, 431967.21, 0.01, "midpoint rebate");
  closeTo(s.settlementAmount, 2418032.79, 0.01, "midpoint settlement");
});

check("settlement is always cheaper than paying the remaining rentals out", () => {
  for (let paid = 0; paid < 60; paid += 5) {
    const s = computeEarlySettlement({
      rental: 95000,
      totalInterest: 1700000,
      tenureMonths: 60,
      instalmentsPaid: paid,
    });
    assert.ok(
      s.settlementAmount < s.grossOutstanding,
      `settling early must beat paying on at ${paid} instalments paid`
    );
  }
});

check("settlement rejects degenerate inputs", () => {
  assert.strictEqual(
    computeEarlySettlement({ rental: 0, totalInterest: 100, tenureMonths: 12, instalmentsPaid: 1 }),
    null
  );
  assert.strictEqual(
    computeEarlySettlement({
      rental: 1000,
      totalInterest: 100,
      tenureMonths: 12,
      instalmentsPaid: 13,
    }),
    null
  );
});

console.log(`\n${passed} passed`);

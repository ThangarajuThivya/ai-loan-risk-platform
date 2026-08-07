"use strict";

/**
 * Runnable test script for loan-offer terms and the flat-rate EMI they
 * depend on (no test runner needed).
 *   node src/services/__tests__/loanOffer.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  buildOfferTerms,
  DEFAULT_OFFER_VALIDITY_DAYS,
  MAX_OFFER_VALIDITY_DAYS,
} = require("../loanOffer.service");
const {
  computeEmi,
  computeFlatEmi,
  computeEmiForRateType,
} = require("../recommendation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function closeTo(actual, expected, tol, msg) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${msg}: expected ${expected} ± ${tol}, got ${actual}`
  );
}

// A reducing-balance product and a flat one, mirroring the seeded catalogue
// (003_seed_loan_products.sql has 4 reducing + 2 flat).
const REDUCING_PRODUCT = {
  interest_rate: 14.5,
  rate_type: "reducing",
  min_amount: 100000,
  max_amount: 5000000,
  min_tenure_months: 6,
  max_tenure_months: 60,
};
const FLAT_PRODUCT = { ...REDUCING_PRODUCT, rate_type: "flat" };

const APPLICATION = {
  requested_amount: 2500000,
  tenure_months: 36,
  recommended_amount: 2000000,
};

console.log("computeFlatEmi");

check("matches the hand-checked flat-rate figure", () => {
  // P=1,200,000 @ 10% flat for 24m:
  //   interest = 1,200,000 × 0.10 × 2 = 240,000
  //   EMI      = 1,440,000 / 24       = 60,000
  assert.strictEqual(computeFlatEmi(1200000, 10, 24), 60000);
});

check("a flat loan always costs MORE per month than reducing at the same rate", () => {
  // This is the whole reason rate_type has to drive the formula: quoting a
  // flat product with the reducing formula would understate the instalment.
  const flat = computeFlatEmi(2500000, 14.5, 36);
  const reducing = computeEmi(2500000, 14.5, 36);
  assert(flat > reducing, `flat ${flat} should exceed reducing ${reducing}`);
});

check("zero interest degenerates to straight-line, same as reducing", () => {
  assert.strictEqual(computeFlatEmi(1200000, 0, 12), 100000);
  assert.strictEqual(computeEmi(1200000, 0, 12), 100000);
});

check("principal <= 0 gives 0; tenure <= 0 throws", () => {
  assert.strictEqual(computeFlatEmi(0, 14.5, 36), 0);
  assert.throws(() => computeFlatEmi(1000000, 14.5, 0));
});

console.log("computeEmiForRateType");

check("dispatches on rate_type", () => {
  assert.strictEqual(
    computeEmiForRateType(2500000, 14.5, 36, "flat"),
    computeFlatEmi(2500000, 14.5, 36)
  );
  assert.strictEqual(
    computeEmiForRateType(2500000, 14.5, 36, "reducing"),
    computeEmi(2500000, 14.5, 36)
  );
});

check("an unknown/missing rate_type falls back to reducing (the column default)", () => {
  const expected = computeEmi(2500000, 14.5, 36);
  assert.strictEqual(computeEmiForRateType(2500000, 14.5, 36, undefined), expected);
  assert.strictEqual(computeEmiForRateType(2500000, 14.5, 36, "nonsense"), expected);
});

console.log("buildOfferTerms — fallbacks");

check("with no overrides, offers the RECOMMENDED amount, not the requested one", () => {
  // The point of the feature: clicking Approve without editing anything
  // must not silently grant whatever was asked for regardless of
  // affordability.
  const terms = buildOfferTerms({ application: APPLICATION, product: REDUCING_PRODUCT });
  assert.strictEqual(terms.amount, 2000000);
  assert.notStrictEqual(terms.amount, APPLICATION.requested_amount);
});

check("falls back to the requested amount when there is no recommendation", () => {
  const terms = buildOfferTerms({
    application: { requested_amount: 800000, tenure_months: 24, recommended_amount: null },
    product: REDUCING_PRODUCT,
  });
  assert.strictEqual(terms.amount, 800000);
});

check("a recommended amount of 0 is honoured, not treated as missing", () => {
  // 0 is a real recommendation ("we can't responsibly lend anything") and
  // must NOT fall through to the requested amount — that would turn a
  // decline-by-affordability into a full-value offer. It is rejected as
  // non-positive, forcing staff to counter-offer explicitly.
  assert.throws(
    () =>
      buildOfferTerms({
        application: { ...APPLICATION, recommended_amount: 0 },
        product: REDUCING_PRODUCT,
      }),
    /positive/
  );
});

check("with no overrides and no priced rate, offers the PRODUCT's rate (pre-D3 behaviour)", () => {
  const terms = buildOfferTerms({ application: APPLICATION, product: REDUCING_PRODUCT });
  assert.strictEqual(terms.interestRate, REDUCING_PRODUCT.interest_rate);
});

check("with no overrides, offers the rate this application was ASSESSED at (D3)", () => {
  // The whole point of snapshotting priced_interest_rate (031): approving
  // must quote what the applicant's own assessment priced, not a fresh read
  // of the product that could have been re-priced since.
  const terms = buildOfferTerms({
    application: { ...APPLICATION, priced_interest_rate: 12.75 },
    product: REDUCING_PRODUCT,
  });
  assert.strictEqual(terms.interestRate, 12.75);
  assert.notStrictEqual(terms.interestRate, REDUCING_PRODUCT.interest_rate);
});

check("a staff override still beats the priced rate", () => {
  const terms = buildOfferTerms({
    application: { ...APPLICATION, priced_interest_rate: 12.75 },
    product: REDUCING_PRODUCT,
    overrides: { interest_rate: 15 },
  });
  assert.strictEqual(terms.interestRate, 15);
});

check("staff overrides beat both the recommendation and the request", () => {
  const terms = buildOfferTerms({
    application: APPLICATION,
    product: REDUCING_PRODUCT,
    overrides: { amount: 1500000, tenure_months: 48, interest_rate: 12 },
  });
  assert.strictEqual(terms.amount, 1500000);
  assert.strictEqual(terms.tenureMonths, 48);
  assert.strictEqual(terms.interestRate, 12);
});

check("rate and rate_type come from the PRODUCT, not the recommendation", () => {
  const terms = buildOfferTerms({ application: APPLICATION, product: FLAT_PRODUCT });
  assert.strictEqual(terms.interestRate, 14.5);
  assert.strictEqual(terms.rateType, "flat");
});

console.log("buildOfferTerms — money");

check("EMI is computed with the product's own formula", () => {
  const reducing = buildOfferTerms({ application: APPLICATION, product: REDUCING_PRODUCT });
  const flat = buildOfferTerms({ application: APPLICATION, product: FLAT_PRODUCT });
  closeTo(reducing.emi, computeEmi(2000000, 14.5, 36), 0.01, "reducing EMI");
  closeTo(flat.emi, computeFlatEmi(2000000, 14.5, 36), 0.01, "flat EMI");
  assert(flat.emi > reducing.emi, "the flat offer must quote the higher instalment");
});

check("a client-supplied emi is ignored — the instalment is never taken on trust", () => {
  const terms = buildOfferTerms({
    application: APPLICATION,
    product: REDUCING_PRODUCT,
    overrides: { emi: 1, offered_emi: 1, totalRepayable: 1 },
  });
  closeTo(terms.emi, computeEmi(2000000, 14.5, 36), 0.01, "EMI");
  assert.notStrictEqual(terms.emi, 1);
});

check("money is rounded to 2dp, with no binary-float tails", () => {
  const terms = buildOfferTerms({ application: APPLICATION, product: REDUCING_PRODUCT });
  for (const v of [terms.amount, terms.emi, terms.totalRepayable]) {
    assert.strictEqual(v, Math.round(v * 100) / 100, `${v} is not 2dp`);
  }
});

check("total repayable is emi × tenure and exceeds the principal on an interest-bearing loan", () => {
  const terms = buildOfferTerms({ application: APPLICATION, product: REDUCING_PRODUCT });
  closeTo(terms.totalRepayable, terms.emi * terms.tenureMonths, 0.01, "total");
  assert(terms.totalRepayable > terms.amount);
});

console.log("buildOfferTerms — validity");

check("defaults to the standard validity window", () => {
  const terms = buildOfferTerms({ application: APPLICATION, product: REDUCING_PRODUCT });
  assert.strictEqual(terms.validityDays, DEFAULT_OFFER_VALIDITY_DAYS);
});

check("an out-of-range validity is refused", () => {
  for (const days of [0, -5, MAX_OFFER_VALIDITY_DAYS + 1]) {
    assert.throws(
      () =>
        buildOfferTerms({
          application: APPLICATION,
          product: REDUCING_PRODUCT,
          overrides: { validity_days: days },
        }),
      /validity/i,
      `validity_days=${days} should be rejected`
    );
  }
});

console.log("buildOfferTerms — product limits");

check("a counter-offer outside the product's amount range is refused", () => {
  assert.throws(
    () =>
      buildOfferTerms({
        application: APPLICATION,
        product: REDUCING_PRODUCT,
        overrides: { amount: 99999999 },
      }),
    /amount must be between/
  );
  assert.throws(
    () =>
      buildOfferTerms({
        application: APPLICATION,
        product: REDUCING_PRODUCT,
        overrides: { amount: 1 },
      }),
    /amount must be between/
  );
});

check("a counter-offer outside the product's tenure range is refused", () => {
  assert.throws(
    () =>
      buildOfferTerms({
        application: APPLICATION,
        product: REDUCING_PRODUCT,
        overrides: { tenure_months: 600 },
      }),
    /tenure must be between/
  );
});

check("offering LESS than requested is allowed — that's the counter-offer case", () => {
  const terms = buildOfferTerms({
    application: APPLICATION,
    product: REDUCING_PRODUCT,
    overrides: { amount: 500000 },
  });
  assert.strictEqual(terms.amount, 500000);
  assert(terms.amount < APPLICATION.requested_amount);
});

check("nonsense terms are refused rather than silently coerced", () => {
  assert.throws(
    () =>
      buildOfferTerms({
        application: APPLICATION,
        product: REDUCING_PRODUCT,
        overrides: { amount: -1 },
      }),
    /positive/
  );
  assert.throws(
    () =>
      buildOfferTerms({
        application: { requested_amount: 500000, tenure_months: 0 },
        product: REDUCING_PRODUCT,
      }),
    /tenure/
  );
});

console.log(`\n${passed} assertions passed.`);

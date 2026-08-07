"use strict";

/**
 * Runnable test script for risk-based interest pricing (D3).
 *   node src/services/__tests__/interestPricing.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const { priceInterestRate, isConfiguredRange, TIER_BY_RISK } = require("../interestPricing.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// A product with a configured range, mirroring the seeded catalogue after
// 031's illustrative backfill (base ± an asymmetric spread).
const RANGED = { baseRate: 14, minRate: 13, maxRate: 16.5 };
const FLAT = { baseRate: 14, minRate: null, maxRate: null };

console.log("configured range");

check("low risk prices to the minimum", () => {
  const r = priceInterestRate({ ...RANGED, riskLabel: 0 });
  assert.strictEqual(r.rate, 13);
  assert.strictEqual(r.tier, "preferential");
  assert.strictEqual(r.risk_based, true);
});

check("medium risk prices to the base rate", () => {
  const r = priceInterestRate({ ...RANGED, riskLabel: 1 });
  assert.strictEqual(r.rate, 14);
  assert.strictEqual(r.tier, "standard");
  assert.strictEqual(r.risk_based, true);
});

check("high risk prices to the maximum", () => {
  const r = priceInterestRate({ ...RANGED, riskLabel: 2 });
  assert.strictEqual(r.rate, 16.5);
  assert.strictEqual(r.tier, "premium");
  assert.strictEqual(r.risk_based, true);
});

check("an unrecognised risk label prices to the base rate, not a bound", () => {
  // Landing on a discount or a premium for an input the module doesn't
  // understand would be pricing risk it never actually assessed.
  for (const bad of [undefined, null, 3, -1, "high", NaN]) {
    const r = priceInterestRate({ ...RANGED, riskLabel: bad });
    assert.strictEqual(r.rate, 14, `riskLabel=${bad}`);
    assert.strictEqual(r.tier, "standard", `riskLabel=${bad}`);
  }
});

console.log("unconfigured / flat-rate products");

check("no range configured prices every risk band at the flat rate", () => {
  for (const riskLabel of [0, 1, 2]) {
    const r = priceInterestRate({ ...FLAT, riskLabel });
    assert.strictEqual(r.rate, 14, `riskLabel=${riskLabel}`);
    assert.strictEqual(r.tier, null, `riskLabel=${riskLabel}`);
    assert.strictEqual(r.risk_based, false, `riskLabel=${riskLabel}`);
  }
});

check("only one bound configured behaves as unconfigured", () => {
  // Both-or-neither is enforced at the validator, but this module must not
  // trust that and half-apply a range it was only given one edge of.
  assert.strictEqual(
    priceInterestRate({ baseRate: 14, minRate: 12, maxRate: null, riskLabel: 0 }).risk_based,
    false
  );
  assert.strictEqual(
    priceInterestRate({ baseRate: 14, minRate: null, maxRate: 16, riskLabel: 2 }).risk_based,
    false
  );
});

check("a nonsensical stored range (min > max, or base outside it) falls back to the base rate", () => {
  // Defends against a row written before the validator existed, or edited
  // directly — the pricing engine must not trust bounds it wasn't given a
  // chance to check.
  assert.strictEqual(
    priceInterestRate({ baseRate: 14, minRate: 16, maxRate: 13, riskLabel: 0 }).risk_based,
    false
  );
  assert.strictEqual(
    priceInterestRate({ baseRate: 14, minRate: 15, maxRate: 18, riskLabel: 0 }).risk_based,
    false,
    "base below the stated minimum"
  );
  assert.strictEqual(
    priceInterestRate({ baseRate: 14, minRate: 5, maxRate: 10, riskLabel: 2 }).risk_based,
    false,
    "base above the stated maximum"
  );
});

check("bounds exactly equal to the base rate are still a valid (zero-width) range", () => {
  const r = priceInterestRate({ baseRate: 14, minRate: 14, maxRate: 14, riskLabel: 0 });
  assert.strictEqual(r.risk_based, true);
  assert.strictEqual(r.rate, 14);
});

console.log("input handling");

check("a numeric-string baseRate/minRate/maxRate (as read back from SQL DECIMAL) still works", () => {
  const r = priceInterestRate({ baseRate: "14.00", minRate: "13.00", maxRate: "16.50", riskLabel: 0 });
  assert.strictEqual(r.rate, 13);
  assert.strictEqual(r.risk_based, true);
});

check("a risk label arriving as a string from SQL/JSON still resolves", () => {
  assert.strictEqual(priceInterestRate({ ...RANGED, riskLabel: "0" }).rate, 13);
  assert.strictEqual(priceInterestRate({ ...RANGED, riskLabel: "2" }).rate, 16.5);
});

check("a missing baseRate throws rather than silently pricing at zero", () => {
  assert.throws(() => priceInterestRate({ minRate: 1, maxRate: 2, riskLabel: 0 }));
  assert.throws(() => priceInterestRate({}));
});

check("results are deterministic", () => {
  const a = priceInterestRate({ ...RANGED, riskLabel: 0 });
  const b = priceInterestRate({ ...RANGED, riskLabel: 0 });
  assert.deepStrictEqual(a, b);
});

console.log("isConfiguredRange");

check("agrees with priceInterestRate's own risk_based flag in every case above", () => {
  assert.strictEqual(isConfiguredRange(14, 13, 16.5), true);
  assert.strictEqual(isConfiguredRange(14, null, 16.5), false);
  assert.strictEqual(isConfiguredRange(14, 13, null), false);
  assert.strictEqual(isConfiguredRange(14, 16, 13), false);
  assert.strictEqual(isConfiguredRange(14, 15, 18), false);
  assert.strictEqual(isConfiguredRange(14, 14, 14), true);
});

check("TIER_BY_RISK has exactly the three known labels", () => {
  assert.deepStrictEqual(Object.keys(TIER_BY_RISK).sort(), ["0", "1", "2"]);
  assert.strictEqual(TIER_BY_RISK[0], "preferential");
  assert.strictEqual(TIER_BY_RISK[1], "standard");
  assert.strictEqual(TIER_BY_RISK[2], "premium");
});

console.log(`\n${passed} assertions passed.`);

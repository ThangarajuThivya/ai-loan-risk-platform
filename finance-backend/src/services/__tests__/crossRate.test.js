"use strict";

/**
 * Runnable test script for the cross-rate helper (no test runner needed).
 *   node src/services/__tests__/crossRate.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const { toLkrPerUnit, applySpread } = require("../crossRate.service");

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

// Sample USD-per-unit rates from a real open.er-api.com pull (2026-07-26).
const SAMPLE_RATES = { LKR: 336.051764, EUR: 0.878778, GBP: 0.750671, JPY: 163.809686, INR: 96.61443 };

console.log("toLkrPerUnit");

check("USD -> LKR is the raw LKR-per-USD rate directly", () => {
  closeTo(toLkrPerUnit(SAMPLE_RATES, "USD"), 336.051764, 1e-6, "USD->LKR");
});

check("EUR -> LKR divides LKR-per-USD by EUR-per-USD", () => {
  // 336.051764 / 0.878778 ≈ 382.393 LKR per 1 EUR
  closeTo(toLkrPerUnit(SAMPLE_RATES, "EUR"), 336.051764 / 0.878778, 1e-6, "EUR->LKR");
});

check("GBP -> LKR divides LKR-per-USD by GBP-per-USD", () => {
  closeTo(toLkrPerUnit(SAMPLE_RATES, "GBP"), 336.051764 / 0.750671, 1e-6, "GBP->LKR");
});

check("JPY -> LKR divides LKR-per-USD by JPY-per-USD (low-value currency sanity check)", () => {
  const rate = toLkrPerUnit(SAMPLE_RATES, "JPY");
  closeTo(rate, 336.051764 / 163.809686, 1e-6, "JPY->LKR");
  // 1 JPY should be worth roughly 2 LKR, not ~336 (the USD rate) or ~0.02
  assert(rate > 1 && rate < 4, `JPY->LKR sanity range: got ${rate}`);
});

check("INR -> LKR divides LKR-per-USD by INR-per-USD", () => {
  closeTo(toLkrPerUnit(SAMPLE_RATES, "INR"), 336.051764 / 96.61443, 1e-6, "INR->LKR");
});

check("missing LKR rate throws", () => {
  assert.throws(() => toLkrPerUnit({ EUR: 0.88 }, "EUR"), /LKR/);
});

check("missing target-currency rate throws", () => {
  assert.throws(() => toLkrPerUnit({ LKR: 336.05 }, "AUD"), /AUD/);
});

check("zero/negative rates are rejected, not silently divided by", () => {
  assert.throws(() => toLkrPerUnit({ LKR: 336.05, EUR: 0 }, "EUR"), /EUR/);
  assert.throws(() => toLkrPerUnit({ LKR: -1, EUR: 0.88 }, "EUR"), /LKR/);
});

console.log("applySpread");

check("buy is below mid, sell is above mid, by the configured bps", () => {
  const { buy_rate, sell_rate } = applySpread(100, { buySpreadBps: 100, sellSpreadBps: 150 });
  closeTo(buy_rate, 99, 1e-9, "buy_rate");
  closeTo(sell_rate, 101.5, 1e-9, "sell_rate");
});

check("zero spread returns mid on both sides", () => {
  const { buy_rate, sell_rate } = applySpread(336.05, { buySpreadBps: 0, sellSpreadBps: 0 });
  closeTo(buy_rate, 336.05, 1e-9, "buy_rate");
  closeTo(sell_rate, 336.05, 1e-9, "sell_rate");
});

console.log(`\n${passed} checks passed.`);

"use strict";

/**
 * Runnable test script for the live-forecast trend projection (no test
 * runner needed). Tests the pure math (computeProjection/fitLinearTrend)
 * against a synthetic series with a known linear trend — no DB involved,
 * since currencyModel.findLiveRateHistory is a thin SQL read that isn't
 * where the risk is; the arithmetic is.
 *   node src/services/__tests__/liveForecast.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  MIN_POINTS_REQUIRED,
  MAX_HORIZON_DAYS,
  fitLinearTrend,
  computeProjection,
} = require("../liveForecast.service");

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

// Perfect synthetic trend: rate_date advances one day at a time, mid_rate
// rises exactly 2 units/day starting at 300 on 2026-07-01. Known-good
// answer: slope = 2, intercept = the value the line would take on the Unix
// epoch (irrelevant to check directly — the projected *dates* are what matter).
function syntheticSeries(n, { start = "2026-07-01", startRate = 300, dailyDelta = 2 } = {}) {
  const rows = [];
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  for (let i = 0; i < n; i++) {
    const d = new Date(startMs + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    rows.push({ rate_date: d, mid_rate: startRate + i * dailyDelta });
  }
  return rows;
}

console.log("fitLinearTrend");

check("recovers the exact slope of a perfectly linear series", () => {
  const xs = [0, 1, 2, 3, 4];
  const ys = [10, 12, 14, 16, 18]; // slope 2, intercept 10
  const { slope, intercept } = fitLinearTrend(xs, ys);
  closeTo(slope, 2, 1e-9, "slope");
  closeTo(intercept, 10, 1e-9, "intercept");
});

check("slope is ~0 for a flat series", () => {
  const xs = [0, 1, 2, 3];
  const ys = [50, 50, 50, 50];
  const { slope } = fitLinearTrend(xs, ys);
  closeTo(slope, 0, 1e-9, "slope");
});

console.log("computeProjection — insufficient data");

check(`fewer than ${MIN_POINTS_REQUIRED} points returns an insufficient-data response, not a guess`, () => {
  const rows = syntheticSeries(MIN_POINTS_REQUIRED - 1);
  const result = computeProjection("USD", rows, 7);
  assert.strictEqual(result.insufficient_data, true);
  assert.strictEqual(result.n_points_available, rows.length);
  assert.strictEqual(result.min_points_required, MIN_POINTS_REQUIRED);
  assert(!result.points, "must not also return points");
});

console.log("computeProjection — known linear trend");

check("projects the next day exactly one dailyDelta past the last observed rate", () => {
  const rows = syntheticSeries(10, { startRate: 300, dailyDelta: 2 });
  const result = computeProjection("EUR", rows, 5);

  assert.strictEqual(result.currency, "EUR");
  assert.strictEqual(result.horizon_days, 5);
  assert.strictEqual(result.points.length, 5);
  assert.strictEqual(result.basis.n_points_used, 10);
  assert.strictEqual(result.basis.from_date, rows[0].rate_date);
  assert.strictEqual(result.basis.to_date, rows[9].rate_date);
  assert(/not the trained ML model/.test(result.disclaimer));

  // Last observed point is day index 9 -> rate 318 on 2026-07-10.
  // Day +1 (2026-07-11) should project to 320, +5 (2026-07-15) to 328.
  closeTo(result.points[0].projected_rate, 320, 1e-6, "day+1");
  assert.strictEqual(result.points[0].date, "2026-07-11");
  closeTo(result.points[4].projected_rate, 328, 1e-6, "day+5");
  assert.strictEqual(result.points[4].date, "2026-07-15");
});

check("horizon is capped at MAX_HORIZON_DAYS even if a larger value is requested", () => {
  const rows = syntheticSeries(10);
  const result = computeProjection("GBP", rows, 999);
  assert.strictEqual(result.horizon_days, MAX_HORIZON_DAYS);
  assert.strictEqual(result.points.length, MAX_HORIZON_DAYS);
});

check("horizon defaults sensibly when omitted", () => {
  const rows = syntheticSeries(10);
  const result = computeProjection("JPY", rows);
  assert(result.horizon_days >= 1 && result.horizon_days <= MAX_HORIZON_DAYS);
  assert.strictEqual(result.points.length, result.horizon_days);
});

console.log(`\n${passed} passing`);

// liveForecast.service.js transitively requires currencyModel.js ->
// config/db.js, which opens a real MySQL connection pool as a side effect
// of require() (same issue noted in fxQuote.test.js) — explicit exit so the
// open pool doesn't hang this script or the npm test chain after it.
process.exit(0);

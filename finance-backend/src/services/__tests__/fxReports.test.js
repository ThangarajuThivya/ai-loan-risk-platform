"use strict";

/**
 * computeSpreadRevenueLkr (fxExchange.controller.js, Phase 31 admin
 * reports). It recovers the bank's spread margin on a settled request from
 * only the quoted LKR amount, the direction, and the spread bps snapshot —
 * the live mid-rate the quote was built from is never stored, so this has
 * to invert crossRate.service.js's applySpread rather than re-read it.
 *
 * Defined inside fxExchange.controller.js, which cannot be required here
 * without opening a DB pool (same constraint fxCompliance.test.js documents
 * for requiresDocumentsFor), so the function is restated below and checked
 * against the controller source for drift.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeSpreadRevenueLkr(row) {
  const bps = Number(row.spread_bps_applied);
  const lkr = Number(row.quoted_lkr_amount);
  if (!(bps > 0) || !(lkr > 0)) return 0;
  return row.direction === "buy"
    ? round2((lkr * bps) / (10000 + bps))
    : round2((lkr * bps) / (10000 - bps));
}

// applySpread from crossRate.service.js, restated to derive a ground-truth
// quoted_lkr_amount from a chosen mid rate — the same relationship
// computeSpreadRevenueLkr has to invert without seeing the mid rate.
function applySpread(midRate, { buySpreadBps, sellSpreadBps }) {
  return {
    buy_rate: midRate * (1 - buySpreadBps / 10000),
    sell_rate: midRate * (1 + sellSpreadBps / 10000),
  };
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name}\n      ${err.message}`]);
  }
}

console.log("computeSpreadRevenueLkr");

check("customer 'buy': revenue matches (quoted_lkr - mid_lkr) computed independently via applySpread", () => {
  const mid = 300; // LKR per USD
  const foreignAmount = 1000;
  const bps = 150; // 1.5%
  const { sell_rate } = applySpread(mid, { buySpreadBps: 0, sellSpreadBps: bps });
  const quotedLkr = round2(foreignAmount * sell_rate);
  const midLkr = round2(foreignAmount * mid);
  const expectedRevenue = round2(quotedLkr - midLkr);

  const got = computeSpreadRevenueLkr({ direction: "buy", quoted_lkr_amount: quotedLkr, spread_bps_applied: bps });
  // The two paths (direct subtraction vs. the inversion formula) can differ
  // by a rounding cent since quotedLkr was itself rounded before inversion;
  // assert they agree to within that.
  assert.ok(Math.abs(got - expectedRevenue) <= 0.02, `got ${got}, expected ~${expectedRevenue}`);
});

check("customer 'sell': revenue matches (mid_lkr - quoted_lkr) computed independently via applySpread", () => {
  const mid = 300;
  const foreignAmount = 1000;
  const bps = 150;
  const { buy_rate } = applySpread(mid, { buySpreadBps: bps, sellSpreadBps: 0 });
  const quotedLkr = round2(foreignAmount * buy_rate);
  const midLkr = round2(foreignAmount * mid);
  const expectedRevenue = round2(midLkr - quotedLkr);

  const got = computeSpreadRevenueLkr({ direction: "sell", quoted_lkr_amount: quotedLkr, spread_bps_applied: bps });
  assert.ok(Math.abs(got - expectedRevenue) <= 0.02, `got ${got}, expected ~${expectedRevenue}`);
});

check("zero spread yields zero revenue on both directions", () => {
  assert.strictEqual(computeSpreadRevenueLkr({ direction: "buy", quoted_lkr_amount: 500000, spread_bps_applied: 0 }), 0);
  assert.strictEqual(computeSpreadRevenueLkr({ direction: "sell", quoted_lkr_amount: 500000, spread_bps_applied: 0 }), 0);
});

check("revenue is always non-negative, whichever direction", () => {
  const buyRev = computeSpreadRevenueLkr({ direction: "buy", quoted_lkr_amount: 250000, spread_bps_applied: 200 });
  const sellRev = computeSpreadRevenueLkr({ direction: "sell", quoted_lkr_amount: 250000, spread_bps_applied: 200 });
  assert.ok(buyRev > 0);
  assert.ok(sellRev > 0);
});

check("a missing/zero quoted_lkr_amount yields zero revenue rather than NaN", () => {
  assert.strictEqual(computeSpreadRevenueLkr({ direction: "buy", quoted_lkr_amount: 0, spread_bps_applied: 150 }), 0);
  assert.strictEqual(
    computeSpreadRevenueLkr({ direction: "buy", quoted_lkr_amount: undefined, spread_bps_applied: 150 }),
    0
  );
});

check("mysql2's string-typed DECIMAL columns are handled numerically", () => {
  const got = computeSpreadRevenueLkr({ direction: "buy", quoted_lkr_amount: "304500.00", spread_bps_applied: "150" });
  assert.ok(got > 0 && Number.isFinite(got));
});

console.log("controller drift guard");

check("the rule under test still matches the controller's implementation", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "controllers", "fxExchange.controller.js"),
    "utf8"
  );
  const match = src.match(/function computeSpreadRevenueLkr\(row\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "computeSpreadRevenueLkr not found in fxExchange.controller.js");
  const body = match[1].replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const expected =
    'const bps = Number(row.spread_bps_applied); const lkr = Number(row.quoted_lkr_amount); if (!(bps > 0) || !(lkr > 0)) return 0; return row.direction === "buy" ? round2((lkr * bps) / (10000 + bps)) : round2((lkr * bps) / (10000 - bps));';
  assert.strictEqual(body, expected, "controller formula drifted from this test's copy");
});

check("volume_by_currency and spread_revenue are computed from settled requests only", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "controllers", "fxExchange.controller.js"),
    "utf8"
  );
  assert.ok(
    /if \(r\.status !== "settled"\) continue;/.test(src),
    'the settled-only filter is missing or has changed shape in getReports'
  );
});

check("'cancelled' requests are excluded from the rate denominator", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "controllers", "fxExchange.controller.js"),
    "utf8"
  );
  assert.ok(
    /const decidable = totalRequests - byStatus\.cancelled;/.test(src),
    "the decidable-denominator calculation is missing or has changed shape"
  );
});

const failed = results.filter(([ok]) => !ok);
for (const [ok, name] of results) console.log(`  ${ok ? "ok" : "NOT OK"} - ${name}`);
console.log(`\n${results.length - failed.length} passed${failed.length ? `, ${failed.length} FAILED` : ""}`);
if (failed.length) process.exit(1);

"use strict";

/**
 * Runnable test script for historical-simulation VaR (no test runner needed):
 *   node src/services/__tests__/fxVar.test.js
 * Exits non-zero on the first failed assertion.
 *
 * VaR's failure modes are sign errors and off-by-one quantiles, both of which
 * produce plausible-looking numbers — so this checks the arithmetic against a
 * hand-constructed scenario set with a known answer rather than eyeballing
 * output. A temp artifact directory is pointed at via
 * CURRENCY_MODEL_ARTIFACTS_DIR, so the real 350 KB scenario file is not
 * involved and the expected values can be computed by hand.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// --- synthetic scenario artifact, written before the service loads --------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fxvar-test-"));
process.env.CURRENCY_MODEL_ARTIFACTS_DIR = tmpDir;

// 100 days. AAA returns are a clean ramp from -1% to +1%; BBB is the exact
// negative of AAA, so an equal long/long book in the two is perfectly hedged
// and a long/short book is maximally exposed.
const N = 100;
const aaa = [];
for (let i = 0; i < N; i++) aaa.push((i - (N - 1) / 2) / ((N - 1) / 2) * 0.01);
const returns = aaa.map((r) => [r, -r]);

fs.writeFileSync(
  path.join(tmpDir, "fx_var_scenarios_v3.json"),
  JSON.stringify({
    version: "v1",
    method: "historical_simulation",
    quote_currency: "LKR",
    scenario_from: "2000-01-01",
    scenario_to: "2000-05-01",
    n_scenarios: N,
    currencies: ["AAA", "BBB"],
    caveats: ["synthetic"],
    dates: Array.from({ length: N }, (_, i) => `2000-01-${String((i % 28) + 1).padStart(2, "0")}`),
    returns,
  })
);

const { aggregate, riskFrom, computeVar } = require("../fxVar.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("fxVar.service");

check("aggregate(h=1) returns the column unchanged", () => {
  const out = aggregate(returns, 0, 1);
  assert.strictEqual(out.length, N);
  assert.strictEqual(out[0], returns[0][0]);
});

check("aggregate(h=5) sums log returns over overlapping windows", () => {
  const out = aggregate(returns, 0, 5);
  assert.strictEqual(out.length, N - 5 + 1);
  const expected = returns.slice(0, 5).reduce((a, r) => a + r[0], 0);
  assert.ok(Math.abs(out[0] - expected) < 1e-12);
});

check("riskFrom reports losses as positive magnitudes", () => {
  // P&L of -100..-1 : every outcome is a loss, so VaR must be positive.
  const pnl = Array.from({ length: 100 }, (_, i) => -(i + 1));
  const { var: v, expected_shortfall: es } = riskFrom(pnl, 0.95);
  assert.ok(v > 0, "VaR must be a positive loss magnitude");
  assert.ok(es >= v, "expected shortfall must be at least as large as VaR");
});

check("a profitable-only distribution yields zero VaR, never negative", () => {
  const { var: v, expected_shortfall: es } = riskFrom([10, 20, 30, 40], 0.99);
  assert.strictEqual(v, 0);
  assert.strictEqual(es, 0);
});

check("a long position loses when the currency falls", () => {
  const r = computeVar([{ currency_code: "AAA", net_lkr_amount: 1_000_000 }], {
    levels: [0.95],
    horizons: [1],
  });
  const L = r.horizons[0].levels[0];
  // Worst AAA day is -1%, so a 1M long loses ~10k at the extreme; the 95%
  // quantile sits inside that.
  assert.ok(L.value_at_risk_lkr > 8000 && L.value_at_risk_lkr < 10000, `got ${L.value_at_risk_lkr}`);
});

check("SIGN: a short position of the same size carries the same risk here", () => {
  // AAA's returns are symmetric about zero, so long and short are mirror
  // images — if the sign handling were wrong, one of these would be ~0.
  const long = computeVar([{ currency_code: "AAA", net_lkr_amount: 1_000_000 }], {
    levels: [0.95], horizons: [1],
  }).horizons[0].levels[0].value_at_risk_lkr;
  const short = computeVar([{ currency_code: "AAA", net_lkr_amount: -1_000_000 }], {
    levels: [0.95], horizons: [1],
  }).horizons[0].levels[0].value_at_risk_lkr;
  assert.ok(Math.abs(long - short) / long < 0.05, `long ${long} vs short ${short}`);
});

check("perfectly negatively correlated longs hedge to ~zero portfolio VaR", () => {
  // BBB = -AAA, so long both in equal size is a flat book. This is the test
  // that proves scenarios are applied JOINTLY (same day across currencies)
  // rather than per-currency independently — independent sampling would
  // leave substantial risk here.
  const r = computeVar(
    [
      { currency_code: "AAA", net_lkr_amount: 1_000_000 },
      { currency_code: "BBB", net_lkr_amount: 1_000_000 },
    ],
    { levels: [0.99], horizons: [1] }
  );
  const L = r.horizons[0].levels[0];
  assert.ok(L.value_at_risk_lkr < 200, `hedged book should be ~flat, got ${L.value_at_risk_lkr}`);
  assert.ok(
    L.diversification_benefit_lkr > 0.9 * L.sum_of_standalone_var_lkr,
    "nearly all standalone risk should be diversified away"
  );
});

check("portfolio VaR never exceeds the sum of standalone VaRs", () => {
  const r = computeVar(
    [
      { currency_code: "AAA", net_lkr_amount: 2_000_000 },
      { currency_code: "BBB", net_lkr_amount: -500_000 },
    ],
    { levels: [0.95, 0.99], horizons: [1, 10] }
  );
  for (const h of r.horizons) {
    for (const L of h.levels) {
      assert.ok(
        L.value_at_risk_lkr <= L.sum_of_standalone_var_lkr + 1e-6,
        `h=${h.horizon_days} ${L.level}: ${L.value_at_risk_lkr} > ${L.sum_of_standalone_var_lkr}`
      );
      assert.ok(L.diversification_benefit_lkr >= 0);
      assert.ok(L.expected_shortfall_lkr >= L.value_at_risk_lkr - 1e-6, "ES >= VaR");
    }
  }
});

check("a longer horizon carries more risk", () => {
  const r = computeVar([{ currency_code: "AAA", net_lkr_amount: 1_000_000 }], {
    levels: [0.99], horizons: [1, 10],
  });
  const one = r.horizons[0].levels[0].value_at_risk_lkr;
  const ten = r.horizons[1].levels[0].value_at_risk_lkr;
  assert.ok(ten > one, `10-day (${ten}) must exceed 1-day (${one})`);
});

check("positions with no scenario history are reported, not silently dropped", () => {
  const r = computeVar([
    { currency_code: "AAA", net_lkr_amount: 1_000_000 },
    { currency_code: "ZZZ", net_lkr_amount: 5_000_000 },
  ]);
  assert.deepStrictEqual(r.uncovered_currencies, ["ZZZ"]);
  // ZZZ must not inflate exposure either — it is excluded from every figure.
  assert.strictEqual(r.gross_exposure_lkr, 1_000_000);
});

check("zero net positions are ignored", () => {
  const r = computeVar([{ currency_code: "AAA", net_lkr_amount: 0 }], {
    levels: [0.95], horizons: [1],
  });
  assert.strictEqual(r.gross_exposure_lkr, 0);
  assert.strictEqual(r.horizons[0].levels[0].value_at_risk_lkr, 0);
});

check("a missing scenario artifact yields null rather than throwing", () => {
  const saved = process.env.CURRENCY_MODEL_ARTIFACTS_DIR;
  process.env.CURRENCY_MODEL_ARTIFACTS_DIR = path.join(tmpDir, "nope");
  delete require.cache[require.resolve("../fxVar.service")];
  const fresh = require("../fxVar.service");
  assert.strictEqual(fresh.computeVar([{ currency_code: "AAA", net_lkr_amount: 1 }]), null);
  process.env.CURRENCY_MODEL_ARTIFACTS_DIR = saved;
  delete require.cache[require.resolve("../fxVar.service")];
});

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`\n${passed} passed`);

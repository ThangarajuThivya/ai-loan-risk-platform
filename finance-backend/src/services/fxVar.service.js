"use strict";

/**
 * FX Value at Risk by historical simulation (Phase 32, CURRENCY_FEATURE.md
 * §33).
 *
 * Turns the admin position view's exposure figures into a risk figure. "We
 * are long 4.2M LKR of EUR" is an exposure; "a bad day costs ~180k LKR, and
 * 1 day in 100 costs more than 310k" is a decision input.
 *
 * Scenarios come from currency-forecast-model/models/fx_var_scenarios_v3.json,
 * built by training/build_var_scenarios.py: one row per real historical day,
 * holding that day's joint log return for every tradable currency against
 * LKR. Replaying real days is what makes this historical simulation rather
 * than variance-covariance — the correlation structure and the fat tails come
 * from the data, not from an assumption of joint normality that FX returns
 * famously violate.
 *
 * This is the one use of the 2017 dataset that its staleness does not
 * undermine (§26/§32 are the counterexamples). VaR needs the return
 * DISTRIBUTION and the CORRELATION structure, both far more stable across
 * time than any price level and both scale-invariant — applied to whatever
 * position the bank holds today.
 *
 * Sign convention: a scenario return is the gain on being LONG one LKR of
 * that currency, so a short position (net_lkr_amount < 0) loses when the
 * return is positive. Falls out of the multiplication; no special-casing.
 */

const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR =
  process.env.CURRENCY_MODEL_ARTIFACTS_DIR ||
  path.join(__dirname, "..", "..", "..", "currency-forecast-model", "models");

const SCENARIOS_FILE = "fx_var_scenarios_v3.json";

/** Confidence levels reported. 95% and 99% are the conventional pair. */
const DEFAULT_LEVELS = [0.95, 0.99];
/** 1-day and 10-day: 10 is the regulatory-standard holding period. */
const DEFAULT_HORIZONS = [1, 10];

// The artifact is ~350 KB — parsed once and reused, refreshed only when the
// file changes on disk, so re-running the builder takes effect without a
// restart but a normal request never re-parses.
let cache = { mtimeMs: 0, data: null };

function loadScenarios() {
  const full = path.join(ARTIFACTS_DIR, SCENARIOS_FILE);
  try {
    const { mtimeMs } = fs.statSync(full);
    if (cache.data && cache.mtimeMs === mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(full, "utf8"));
    cache = { mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

/**
 * Empirical quantile by linear interpolation on a pre-sorted ascending array.
 */
function quantileSorted(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Aggregate 1-day log returns into overlapping `horizon`-day log returns.
 * Summing logs is exact for multi-period compounding, which is why the
 * artifact stores log rather than simple returns. Overlapping windows are
 * used rather than the sqrt(h) scaling rule — that rule assumes i.i.d.
 * returns, and the volatility clustering §28 measured is exactly the reason
 * it does not hold here.
 */
function aggregate(returns, colIdx, horizon) {
  const out = [];
  if (horizon <= 1) {
    for (let i = 0; i < returns.length; i++) out.push(returns[i][colIdx]);
    return out;
  }
  for (let i = 0; i + horizon <= returns.length; i++) {
    let s = 0;
    for (let j = 0; j < horizon; j++) s += returns[i + j][colIdx];
    out.push(s);
  }
  return out;
}

/** VaR and Expected Shortfall (both positive = a loss) from a P&L sample. */
function riskFrom(pnl, level) {
  // An empty sample here means "no positions to risk", not "cannot compute" —
  // computeVar already returns null when scenarios are unavailable. A book
  // with nothing in it carries zero risk, and reporting 0 is both accurate
  // and more useful to an admin than a null.
  if (!pnl || pnl.length === 0) return { var: 0, expected_shortfall: 0 };
  const sorted = [...pnl].sort((a, b) => a - b);
  const cut = quantileSorted(sorted, 1 - level);
  if (cut === null) return { var: null, expected_shortfall: null };
  const tail = sorted.filter((v) => v <= cut);
  const es = tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : cut;
  // Reported as positive loss magnitudes: a VaR of 180000 means "lose 180k".
  return { var: Math.max(0, -cut), expected_shortfall: Math.max(0, -es) };
}

/**
 * Compute portfolio and per-currency VaR for a set of net positions.
 *
 * @param {Array<{currency_code: string, net_lkr_amount: number}>} positions
 * @param {object} [opts]
 * @returns {object|null} null when the scenario artifact is unavailable
 */
function computeVar(positions, { levels = DEFAULT_LEVELS, horizons = DEFAULT_HORIZONS } = {}) {
  const scen = loadScenarios();
  if (!scen || !Array.isArray(scen.returns) || scen.returns.length === 0) return null;

  const colOf = new Map(scen.currencies.map((c, i) => [c, i]));
  const held = (positions || [])
    .map((p) => ({ code: p.currency_code, amount: Number(p.net_lkr_amount) || 0 }))
    .filter((p) => p.amount !== 0);

  // A position in a currency with no scenario history cannot be risked, and
  // silently dropping it would understate the book. Reported explicitly.
  const uncovered = held.filter((p) => !colOf.has(p.code)).map((p) => p.code);
  const covered = held.filter((p) => colOf.has(p.code));

  const grossExposure = covered.reduce((a, p) => a + Math.abs(p.amount), 0);
  const netExposure = covered.reduce((a, p) => a + p.amount, 0);

  const byHorizon = horizons.map((h) => {
    // Per-currency aggregated return series, computed once per horizon.
    const series = new Map(
      covered.map((p) => [p.code, aggregate(scen.returns, colOf.get(p.code), h)])
    );
    // Guarded: with no covered positions `Math.min(...[])` is Infinity, and
    // the P&L loop below would run forever and throw. That is the DEFAULT
    // state of a fresh install — no committed FX requests yet — so this path
    // is the common one on day one, not an edge case.
    const n =
      covered.length === 0 ? 0 : Math.min(...Array.from(series.values(), (s) => s.length));

    // Portfolio P&L: each scenario applies the SAME day's move to every
    // currency at once, which is what carries the correlation structure.
    // expm1 converts the log return to an actual proportional gain — for a
    // 10-day tail move the difference from using the log directly is not
    // negligible.
    const portfolioPnl = [];
    for (let i = 0; i < n; i++) {
      let pnl = 0;
      for (const p of covered) pnl += p.amount * Math.expm1(series.get(p.code)[i]);
      portfolioPnl.push(pnl);
    }

    const perLevel = levels.map((level) => {
      const portfolio = riskFrom(portfolioPnl, level);
      const standalone = covered.map((p) => {
        const s = series.get(p.code);
        const pnl = [];
        for (let i = 0; i < n; i++) pnl.push(p.amount * Math.expm1(s[i]));
        return { currency_code: p.code, net_lkr_amount: p.amount, ...riskFrom(pnl, level) };
      });
      const sumStandalone = standalone.reduce((a, s) => a + (s.var || 0), 0);
      return {
        level,
        value_at_risk_lkr: portfolio.var,
        expected_shortfall_lkr: portfolio.expected_shortfall,
        per_currency: standalone,
        // The whole reason to use joint scenarios rather than per-currency
        // ones: imperfectly correlated positions partly offset, so the book
        // risks less than the sum of its parts.
        sum_of_standalone_var_lkr: sumStandalone,
        diversification_benefit_lkr: Math.max(0, sumStandalone - (portfolio.var || 0)),
      };
    });

    return { horizon_days: h, n_scenarios: n, levels: perLevel };
  });

  return {
    method: scen.method,
    quote_currency: scen.quote_currency,
    scenario_from: scen.scenario_from,
    scenario_to: scen.scenario_to,
    n_scenarios: scen.n_scenarios,
    source: scen.source,
    gross_exposure_lkr: grossExposure,
    net_exposure_lkr: netExposure,
    uncovered_currencies: uncovered,
    horizons: byHorizon,
    caveats: scen.caveats || [],
  };
}

module.exports = {
  ARTIFACTS_DIR,
  SCENARIOS_FILE,
  DEFAULT_LEVELS,
  DEFAULT_HORIZONS,
  aggregate,
  riskFrom,
  computeVar,
};

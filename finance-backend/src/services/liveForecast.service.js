"use strict";

/**
 * Live trend projection — a SEPARATE, deliberately much simpler signal from
 * the trained LSTM/XGBoost/GARCH/IsolationForest models in
 * currency-forecast-model/. Those models (and their scalers) were fitted on
 * Fed H.10 data ending 2017-08-25; feeding 2026 live rates through them
 * would not produce a meaningful forecast, it would produce noise
 * (CURRENCY_FEATURE.md §9.2 — a hard constraint, not a bug to fix).
 * Retraining on freshly scraped data was evaluated and rejected: no
 * reliable free LKR historical source exists, and scraping raises data-
 * quality/ToS concerns not worth taking on for this project (§16.1).
 *
 * Method: ordinary least-squares linear regression on the trailing live
 * points for a currency, extrapolated forward day by day. Chosen over
 * Holt/Holt-Winters exponential smoothing because it has no smoothing
 * hyperparameters (alpha/beta) to pick or justify, and the live series is
 * short and only refreshes ~daily upstream (rateFeed.service.js) — not
 * long or regular enough for a seasonal model to be defensible anyway. This
 * is a naive statistical extrapolation, not a market prediction, and must
 * never be described as an AI/ML forecast.
 *
 * Reads ONLY currency_rate_history rows with source LIKE 'live-%'
 * (currencyModel.findLiveRateHistory) — never h10-historical, never
 * demo-seed. Never imports or calls anything from currency-forecast-model/.
 *
 * Note on units: like GET /api/currency/rates/:code, points are reported in
 * the same convention as currency_rate_history — "<code> units per 1 USD" —
 * not the LKR-per-unit retail board convention used by GET /board.
 */

const currencyModel = require("../models/currencyModel");

const MIN_POINTS_REQUIRED = 5;
const MAX_HORIZON_DAYS = 30;
const DEFAULT_HORIZON_DAYS = 7;
const METHOD_LABEL = "linear_regression_ols";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateToOrdinal(dateStr) {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / MS_PER_DAY);
}

function ordinalToDateString(ordinal) {
  return new Date(ordinal * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Fit y = intercept + slope * x by ordinary least squares.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{slope: number, intercept: number}}
 */
function fitLinearTrend(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  // den === 0 (every point on the same day) can't happen here: the unique
  // (base, target, rate_date, source) key on currency_rate_history means
  // every row passed in is a distinct calendar day.
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

/**
 * Pure projection logic — no DB access, so it's directly unit-testable
 * against a synthetic series. Rows must be ascending by rate_date.
 * @param {string} code
 * @param {Array<{rate_date: string, mid_rate: number|string}>} rows
 * @param {number} [horizonDays]
 * @returns {object} insufficient-data response, or a projection response
 */
function computeProjection(code, rows, horizonDays = DEFAULT_HORIZON_DAYS) {
  const horizon = Math.min(Math.max(1, Math.trunc(horizonDays) || DEFAULT_HORIZON_DAYS), MAX_HORIZON_DAYS);

  if (rows.length < MIN_POINTS_REQUIRED) {
    return {
      currency: code,
      insufficient_data: true,
      message: `Only ${rows.length} live rate observation(s) available for ${code}; at least ${MIN_POINTS_REQUIRED} are required for a trend projection.`,
      n_points_available: rows.length,
      min_points_required: MIN_POINTS_REQUIRED,
    };
  }

  const xs = rows.map((r) => dateToOrdinal(r.rate_date));
  const ys = rows.map((r) => Number(r.mid_rate));
  const { slope, intercept } = fitLinearTrend(xs, ys);

  const lastOrdinal = xs[xs.length - 1];
  const points = [];
  for (let d = 1; d <= horizon; d++) {
    const x = lastOrdinal + d;
    points.push({
      date: ordinalToDateString(x),
      projected_rate: Math.round((intercept + slope * x) * 1e6) / 1e6,
    });
  }

  return {
    currency: code,
    method: METHOD_LABEL,
    horizon_days: horizon,
    points,
    basis: {
      from_date: rows[0].rate_date,
      to_date: rows[rows.length - 1].rate_date,
      n_points_used: rows.length,
    },
    disclaimer:
      "Naive statistical extrapolation from recent live rates. Not a market prediction and not the trained ML model.",
  };
}

/**
 * Project a short-term linear trend forward from a currency's recent live
 * (source LIKE 'live-%') rates.
 * @param {string} code 3-letter ISO currency code
 * @param {object} [opts]
 * @param {number} [opts.horizonDays] 1-30, default 7
 * @returns {Promise<object>}
 */
async function getLiveForecast(code, { horizonDays } = {}) {
  const rows = await currencyModel.findLiveRateHistory(code);
  return computeProjection(code, rows, horizonDays);
}

module.exports = {
  MIN_POINTS_REQUIRED,
  MAX_HORIZON_DAYS,
  DEFAULT_HORIZON_DAYS,
  METHOD_LABEL,
  fitLinearTrend,
  computeProjection,
  getLiveForecast,
};

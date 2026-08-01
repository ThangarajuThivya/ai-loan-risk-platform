"use strict";

/**
 * Live-rate anomaly detection (Phase 29, CURRENCY_FEATURE.md §30).
 *
 * The one trained model in currency-forecast-model/ that transfers to live
 * data unchanged. Everything else there is anchored to the 2017-08-25 Fed
 * H.10 cutoff and would produce noise on 2026 rates (§9.2) — the LSTM and
 * XGBoost learn PRICE LEVELS, and a model that expects ~152 LKR/USD has
 * nothing useful to say about ~300.
 *
 * The Isolation Forest is different, and the difference is structural rather
 * than lucky. Every feature it was trained on is SCALE-INVARIANT: log
 * returns, rolling z-scores of returns, rolling standard deviation of
 * returns, and `rate / MA20 - 1` — a ratio (see anomaly_features() in
 * currency-forecast-model/training/preprocessing_utils.py). A 2.5% one-day
 * move is equally unusual whether the rate is 152 or 300, so the decision
 * boundary learned on 1973-2017 returns applies directly to today's.
 *
 * It is also the only Python endpoint that scores a CALLER-SUPPLIED window
 * rather than the bundled historical series, so no change was needed on the
 * Python side at all — this module just hands it a different window.
 *
 * Two-plane discipline (§10.2). This never mixes live and model data:
 *   - reads ONLY currency_rate_history rows with source LIKE 'live-%'
 *     (currencyModel.findLiveRateHistory) — never h10-historical, never
 *     demo-seed;
 *   - writes its anomaly-log rows with data_plane = 'live-feed', so a live
 *     detection is never conflated with one from the model's own 2017
 *     series (migration 009);
 *   - reports its own basis dates, so a reader always knows which window
 *     produced the verdict.
 *
 * Note on units: like GET /api/currency/rates/:code, points are "<code>
 * units per 1 USD" — not the LKR-per-unit retail board convention.
 */

const currencyModel = require("../models/currencyModel");
const currencyClient = require("./currencyClient.service");

/**
 * Matches ISOFOREST_MIN_WINDOW in currency-forecast-model/src/config.py:
 * anomaly_features() needs a rolling(20) window over the return series, and
 * the return series itself costs one observation to a shift(1) — so 20 valid
 * returns requires 21 raw price points. Checked here as well as there so an
 * under-length window becomes an honest "not enough data yet" response
 * instead of a 400 from the Python service.
 */
const MIN_POINTS_REQUIRED = 21;

/**
 * Score the trailing live-rate window for one currency.
 *
 * @param {string} code trained currency code, already validated/uppercased
 * @param {object} [opts]
 * @param {number} [opts.detectedBy] user_id, recorded on any logged alert
 * @returns {Promise<object>} insufficient-data shape, or a detection result
 */
async function getLiveAnomaly(code, { detectedBy } = {}) {
  const rows = await currencyModel.findLiveRateHistory(code);
  // `Number(null)` is 0, not NaN, so a NULL mid_rate would otherwise sail
  // through as a zero rate and hand the detector a window containing a
  // ~-100% log return. Reject non-positive and non-finite values outright:
  // an exchange rate of zero or below is never a real observation, and the
  // feature pipeline takes log(rate[t]/rate[t-1]).
  const points = rows
    .filter((r) => r.mid_rate !== null && r.mid_rate !== undefined)
    .map((r) => ({ rate_date: r.rate_date, mid_rate: Number(r.mid_rate) }))
    .filter((p) => Number.isFinite(p.mid_rate) && p.mid_rate > 0);

  if (points.length < MIN_POINTS_REQUIRED) {
    // Deliberately a 200-with-a-shape, not an error: "the live feed hasn't
    // collected enough days yet" is a normal state of this endpoint, not a
    // failure. Mirrors liveForecast.service.js's contract so the two live
    // signals behave the same way for a caller.
    return {
      currency: code,
      data_plane: currencyModel.DATA_PLANE_LIVE_FEED,
      insufficient_data: true,
      n_points_available: points.length,
      min_points_required: MIN_POINTS_REQUIRED,
    };
  }

  const window = points.map((p) => p.mid_rate);
  const result = await currencyClient.getAnomaly(code, window);
  const asOfDate = points[points.length - 1].rate_date;

  // Log only real detections, and only ever onto the live plane. The
  // model_version recorded is the Isolation Forest's own version from the
  // Python response — the model is unchanged, it is the WINDOW that is live,
  // and conflating those two facts is exactly what §10.2 forbids.
  await currencyModel.logAnomaly({
    code,
    asOfDate,
    anomalyScore: result.anomaly_score,
    isAnomalous: result.is_anomalous,
    modelVersion: result.model_version || result.data_vintage?.model_version,
    detectedBy,
    dataPlane: currencyModel.DATA_PLANE_LIVE_FEED,
  });

  return {
    currency: code,
    data_plane: currencyModel.DATA_PLANE_LIVE_FEED,
    insufficient_data: false,
    is_anomalous: result.is_anomalous,
    anomaly_score: result.anomaly_score,
    as_of_date: asOfDate,
    basis: {
      n_points_used: points.length,
      from_date: points[0].rate_date,
      to_date: asOfDate,
      source_filter: "live-%",
    },
    // The detector's own provenance: trained on H.10 through 2017, applied
    // here to a live window. Both halves of that sentence matter, so the
    // response carries the model's data_vintage AND its own basis above —
    // never merged into one "as of" field.
    model_data_vintage: result.data_vintage || null,
    disclaimer:
      "Statistical outlier detection on recent live rates. The detector was trained on historical Fed H.10 returns; its features are scale-invariant, so it applies to current rates, but a flag is not a prediction, a valuation, or financial advice.",
  };
}

module.exports = {
  MIN_POINTS_REQUIRED,
  getLiveAnomaly,
};

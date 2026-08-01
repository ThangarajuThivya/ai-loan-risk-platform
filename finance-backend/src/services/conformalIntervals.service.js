"use strict";

/**
 * Conformal prediction intervals for the LSTM forecast (Phase 31,
 * CURRENCY_FEATURE.md §32).
 *
 * Reads lstm_conformal_v2.json — produced offline by
 * currency-forecast-model/training/calibrate_conformal_intervals.py — and
 * turns a point forecast into a range. Same artifact-reading pattern as
 * modelEvaluation.service.js: read at request time, never hardcode a number,
 * degrade to null if the file is absent (models/ may not be present at all).
 *
 * WHY THIS QUOTES MEASURED COVERAGE, NOT THE NOMINAL LEVEL
 *
 * The calibration report's own verdict is that these bands UNDER-COVER: a
 * nominally-90% interval contained the actual rate 71-86% of the time on the
 * held-out test period, averaging 6.5 points short. The cause is a volatility
 * regime shift between the calm 2012-2014 calibration window and the
 * turbulent 2015-2017 test window (Brexit, EUR turbulence, LKR
 * depreciation) — conformal's coverage guarantee assumes exchangeability,
 * which time series violate.
 *
 * So this service deliberately exposes `measured_coverage` (the empirical
 * figure from held-out data) and NOT the nominal level, and callers must
 * label the band with that. Showing "90% confidence" over a band that holds
 * 77% of the time would overstate the model in precisely the way §18 and §26
 * set out to stop — this feature would become another version of the problem
 * it was meant to solve.
 */

const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR =
  process.env.CURRENCY_MODEL_ARTIFACTS_DIR ||
  path.join(__dirname, "..", "..", "..", "currency-forecast-model", "models");

const CONFORMAL_FILE = "lstm_conformal_v2.json";

/**
 * Nominal level to serve. The artifact holds several; this picks which one's
 * offsets are used. It is NOT what gets shown to a user — `measured_coverage`
 * is (see the module header).
 */
const DEFAULT_LEVEL = "0.9";

/**
 * Attach intervals to a list of forecast points.
 *
 * @param {string} currency
 * @param {Array<{horizon_days: number, predicted_rate: number}>} forecasts
 * @param {object} [opts]
 * @param {string} [opts.level] nominal level key present in the artifact
 * @returns {Array} the same forecasts, each with an `interval` field
 *   ({ lower, upper, measured_coverage, ... }) or `interval: null` when no
 *   calibration exists for that (currency, horizon).
 */
function attachIntervals(currency, forecasts, { level = DEFAULT_LEVEL } = {}) {
  const artifact = read();
  return (forecasts || []).map((f) => ({
    ...f,
    interval: buildInterval(artifact, currency, f, level),
  }));
}

function buildInterval(artifact, currency, forecast, level) {
  if (!artifact) return null;
  const cell = artifact.results?.[currency]?.[String(forecast.horizon_days)];
  const band = cell?.levels?.[level];
  if (!band || typeof forecast.predicted_rate !== "number") return null;
  if (typeof band.lower_offset !== "number" || typeof band.upper_offset !== "number") return null;

  return {
    lower: forecast.predicted_rate + band.lower_offset,
    upper: forecast.predicted_rate + band.upper_offset,
    // The empirically measured hit rate on data used for neither training
    // nor calibration. This is the ONLY coverage figure a caller should
    // display — see the module header on why the nominal level is withheld.
    measured_coverage: band.empirical_coverage_test ?? null,
    // Present so a UI can say what the band was aiming for versus what it
    // achieved, if it chooses to show both. Never a substitute for the above.
    nominal_level: Number(level),
    method: artifact.method || null,
    calibrated_on: artifact.calibration_split || null,
    coverage_measured_on: artifact.coverage_measured_on || null,
  };
}

/**
 * Read fresh per call — the file is a few KB, and a cache would leave an
 * operator who just re-ran calibration staring at the previous numbers.
 * Returns null (never throws) if the artifact is missing or malformed, so a
 * forecast without a calibrated interval still serves.
 */
function read() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, CONFORMAL_FILE), "utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  ARTIFACTS_DIR,
  CONFORMAL_FILE,
  DEFAULT_LEVEL,
  attachIntervals,
};

"use strict";

/**
 * Currency controller — gateway orchestration for the currency-forecast
 * feature (CURRENCY_FEATURE.md Phase 5), following the same
 * routes → controller → service → mlClient shape as loan.controller.js.
 *
 * GET /api/currency/currencies    — supported currencies (any role)
 * GET /api/currency/rates/:code   — historical rate series for charts (any role)
 * GET /api/currency/board         — live buy/sell rate board (any role) [Phase 7]
 * GET /api/currency/live-forecast/:code — naive short-term trend from live
 *   rates only (any role) — NOT the trained ML model, see
 *   liveForecast.service.js and CURRENCY_FEATURE.md §16
 * GET /api/currency/analyze/:code — forecast+trend+volatility+anomaly, role-shaped
 * GET /api/currency/anomalies     — anomaly alert history (staff, admin)
 * GET /api/currency/admin/model-status              — model/cache status (admin)
 * PATCH /api/currency/admin/currencies/:code/status  — toggle active (admin)
 * POST /api/currency/admin/analyze/:code/refresh     — bypass cache (admin)
 * POST /api/currency/admin/rates/refresh             — force a live rate pull (admin) [Phase 7]
 *
 * The rate board and rate history (this file) are a SEPARATE data plane
 * from the /analyze forecast/trend/volatility/anomaly results above — see
 * CURRENCY_FEATURE.md §9.1 (design decision D1). Live rates are never
 * passed to the Python service and never presented as model output.
 */

const { validationResult } = require("express-validator");

const currencyClient = require("../services/currencyClient.service");
const currencyModel = require("../models/currencyModel");
const crossRate = require("../services/crossRate.service");
const rateFeed = require("../services/rateFeed.service");
const liveForecast = require("../services/liveForecast.service");
const liveAnomaly = require("../services/liveAnomaly.service");
const modelEvaluation = require("../services/modelEvaluation.service");
const conformalIntervals = require("../services/conformalIntervals.service");

// A board snapshot older than this is served but flagged `is_stale: true`
// rather than hidden — the live feed only polls hourly and the upstream
// provider itself only updates ~daily, so a few hours old is normal; this
// threshold is about catching a feed that's actually stopped working.
const RATE_BOARD_STALE_MS = 6 * 60 * 60 * 1000;

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

// Forecasts are anchored to a fixed "as of" date (the Python service has no
// live feed — see currency-forecast-model/README.md) so they don't change
// intraday; a day-long cache avoids hammering the Python service on every
// dashboard load without ever serving genuinely stale-vs-source data.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Bumped whenever the cached /analyze payload's shape changes in a way an
// older cached row can't satisfy. Introduced in Phase 8 (CURRENCY_FEATURE.md
// §10.2) when data_vintage was added — a row cached before that ships has no
// data_vintage at all, and must never be served as if it did. A stored
// payload whose stamp doesn't match (including pre-Phase-8 rows with no
// stamp at all) is treated as a miss and recomputed, never served as-is.
const CACHE_SCHEMA_VERSION = 1;

// The trained-currency list is effectively static config; re-checking Python's
// /health on every request would be wasted work, so it's cached briefly.
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
let healthCache = { trainedCurrencies: null, expiresAt: 0 };

/**
 * Map a CurrencyServiceError (or unexpected error) to an HTTP response.
 * Preserves the Python service's own 400 (unknown currency) / 404
 * (untrained) / 503 (not ready) distinctions; anything else (timeout,
 * connection refused) is a gateway-side problem, not the caller's — 502.
 */
function respondCurrencyError(res, err, fallbackMessage) {
  if (err instanceof currencyClient.CurrencyServiceError) {
    if (err.status === 400) {
      return res.status(400).json({ message: "Invalid currency code.", error: err.message });
    }
    if (err.status === 404) {
      return res
        .status(404)
        .json({ message: "No trained model for this currency yet.", error: err.message });
    }
    if (err.status === 503) {
      return res.status(503).json({
        message: "The currency model service is starting up. Please try again shortly.",
        error: err.message,
      });
    }
    return res.status(502).json({
      message: "The currency model service is unavailable. Please try again shortly.",
      error: err.message,
    });
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ message: fallbackMessage });
}

/** Trained-currency codes, from Python's /health with a short cache and a static fallback. */
async function getTrainedCurrencies() {
  if (healthCache.trainedCurrencies && Date.now() < healthCache.expiresAt) {
    return healthCache.trainedCurrencies;
  }
  try {
    const health = await currencyClient.getHealth();
    healthCache = {
      trainedCurrencies: health.trained_currencies,
      expiresAt: Date.now() + HEALTH_CACHE_TTL_MS,
    };
    return health.trained_currencies;
  } catch (err) {
    console.error("CURRENCY HEALTH CHECK FAILED, using static fallback list:", err.message);
    return currencyClient.TRAINED_CURRENCIES_FALLBACK;
  }
}

function parseRawCachedPayload(row) {
  return typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
}

function isCacheFresh(row) {
  if (!row) return false;
  if (parseRawCachedPayload(row)._cacheSchemaVersion !== CACHE_SCHEMA_VERSION) return false;
  return Date.now() - new Date(row.computed_at).getTime() < CACHE_TTL_MS;
}

/** The cached payload with the internal cache-versioning stamp stripped out. */
function parsePayload(row) {
  const { _cacheSchemaVersion, ...payload } = parseRawCachedPayload(row);
  return payload;
}

/**
 * Get a currency's combined analysis, from the DB cache when fresh, else
 * from the Python service (and persist the fresh result + log any anomaly).
 * @param {string} code
 * @param {object} [opts]
 * @param {boolean} [opts.forceRefresh] bypass the cache regardless of freshness
 * @param {number} [opts.userId] attributed on any newly-logged anomaly
 * @returns {Promise<{data:object, cached:boolean, computedAt:Date|string}>}
 */
async function getAnalysis(code, { forceRefresh = false, userId } = {}) {
  if (!forceRefresh) {
    const cached = await currencyModel.getCachedAnalysis(code);
    if (isCacheFresh(cached)) {
      return { data: parsePayload(cached), cached: true, computedAt: cached.computed_at };
    }
  }

  const data = await currencyClient.getAnalyze(code);
  await currencyModel.upsertCachedAnalysis(code, data.forecast.as_of_date, {
    ...data,
    _cacheSchemaVersion: CACHE_SCHEMA_VERSION,
  });
  if (data.anomaly && data.anomaly.is_anomalous) {
    await currencyModel.logAnomaly({
      code,
      asOfDate: data.forecast.as_of_date,
      anomalyScore: data.anomaly.anomaly_score,
      isAnomalous: true,
      modelVersion: data.anomaly.model_version,
      detectedBy: userId,
    });
  }
  return { data, cached: false, computedAt: new Date() };
}

/**
 * Attach calibrated conformal intervals to the staff/admin forecast points.
 *
 * These used to hang off the customer view; since v3 removed customer-facing
 * forecasts entirely, staff/admin are the only consumers left. The intervals
 * are worth keeping precisely here — this audience can read the caveat that
 * matters: each band reports its MEASURED coverage on held-out data, not its
 * nominal level. They under-cover by ~7.7 points on average after the v3
 * refresh (worse than v2's ~6.5, because the calibration and test windows sit
 * in different volatility regimes), so labelling a band "90%" would overstate
 * it. GARCH is the model in this stack that adapts to volatility; conformal
 * does not.
 */
function attachStaffIntervals(data) {
  if (!data.forecast?.forecasts?.length) return data;
  return {
    ...data,
    forecast: {
      ...data.forecast,
      forecasts: conformalIntervals.attachIntervals(data.currency, data.forecast.forecasts),
    },
  };
}

/**
 * Reduce the full analysis down to the customer-facing view (role matrix
 * §6: "simplified") — a volatility band label and the data-vintage badge,
 * and nothing else. No trend direction or probabilities, no anomaly detail,
 * and (since the v3 refresh) no LSTM point forecasts either.
 *
 * WHY NO FORECASTS. Two separate models were withdrawn from this view for
 * the same reason: measured performance did not justify showing a number to
 * a customer.
 *
 *   - XGBoost trend `outlook` (removed earlier). It carried a
 *     "weaken/strengthen" direction plus a confidence percentage read off the
 *     90-day trend classifier, which scores at or below its own
 *     majority-class baseline on 4 of 5 currencies — unchanged by the v3
 *     data refresh (models/xgb_evaluation_report_h90_v3.txt).
 *   - LSTM point forecasts (removed in v3). Retrained on data through
 *     2026-07-24, the 90-day model scored 15.2% directional accuracy for LKR
 *     with MAE 2.7x worse than a naive random walk — it extrapolates the
 *     training window's trend and inverts when that trend does. The 90-day
 *     horizon is no longer trained or served at all (see src/config.py's
 *     LSTM_HORIZONS); 1/7/30 are still served, but only to staff/admin, who
 *     get the baseline comparison alongside and the context to read it.
 *
 * GARCH volatility is the one model family with demonstrated out-of-sample
 * skill (13/15 cells beat a rolling-realized-variance baseline on QLIKE
 * after the refresh), which is why a band label survives here.
 */
function simplifyForCustomer(data) {
  const { currency, forecast, volatility } = data;

  return {
    currency,
    as_of_date: forecast.as_of_date,
    last_known_rate: forecast.last_known_rate,
    // The headline vintage badge — this is what tells a customer the rate
    // above is historical, not live. Volatility's vintage is reported
    // separately below because GARCH's own cutoff is genuinely earlier.
    data_vintage: forecast.data_vintage,
    volatility: volatility
      ? { band: volatility.band, horizon_days: volatility.horizon_days, data_vintage: volatility.data_vintage }
      : null,
  };
}

// GET /api/currency/currencies — supported currencies; customer/staff see
// only active ones, admin sees all with their active flag.
exports.listCurrencies = async (req, res) => {
  try {
    const trained = await getTrainedCurrencies();
    const settingsRows = await currencyModel.listCurrencySettings();
    const settingsMap = new Map(settingsRows.map((r) => [r.currency_code, !!r.is_active]));
    const isAdmin = req.user.role === "admin";

    let currencies = trained.map((code) => ({
      code,
      name: currencyClient.CURRENCY_DISPLAY_NAMES[code] || code,
      is_active: settingsMap.has(code) ? settingsMap.get(code) : true,
    }));

    if (!isAdmin) {
      currencies = currencies.filter((c) => c.is_active).map(({ code, name }) => ({ code, name }));
    }

    return res.status(200).json({ currencies });
  } catch (err) {
    console.error("LIST CURRENCIES ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch supported currencies." });
  }
};

// GET /api/currency/rates/:code?limit=&from=&to=&source= — historical rate
// series for charts, from the DB's currency_rate_history table (Phase 7;
// previously always [] — currency_rates had no writer, see CURRENCY_FEATURE.md
// §7.3). Not the Python service — it has no historical-series endpoint.
exports.getRateHistory = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();
  // express-validator's .toInt() sanitizer can't mutate req.query in place
  // under Express 5 (req.query has no setter there), so coerce explicitly
  // rather than trust the "sanitized" value — isInt() above still validates it.
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const from = req.query.from || undefined;
  const to = req.query.to || undefined;
  const source = req.query.source || undefined;

  try {
    const rows = await currencyModel.findRateHistory(code, { limit, from, to, source });
    return res.status(200).json({ currency: code, rates: rows });
  } catch (err) {
    console.error("GET RATE HISTORY ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch rate history." });
  }
};

// GET /api/currency/board — the live buy/sell rate board (LKR per unit of
// foreign currency), for every currency fx_rate_board_config marks
// tradable. All roles. This is genuinely live data, not a model output —
// see the file header note on the two data planes.
exports.getBoard = async (req, res) => {
  try {
    const [rawRows, configRows] = await Promise.all([
      currencyModel.getRawRateSnapshot(),
      currencyModel.listBoardConfig(),
    ]);

    const rawMap = {};
    let latestFetchedAt = null;
    let latestSource = null;
    for (const r of rawRows) {
      rawMap[r.target] = Number(r.mid_rate);
      if (!latestFetchedAt || new Date(r.fetched_at) > new Date(latestFetchedAt)) {
        latestFetchedAt = r.fetched_at;
        latestSource = r.source;
      }
    }

    if (!rawMap.LKR) {
      return res.status(503).json({
        message:
          "The rate board has not been populated yet. Ask an admin to trigger a refresh, or wait for the next scheduled pull.",
      });
    }

    const isStale =
      !latestFetchedAt || Date.now() - new Date(latestFetchedAt).getTime() > RATE_BOARD_STALE_MS;

    const rates = configRows
      .filter((c) => c.is_tradable)
      .map((c) => {
        try {
          const mid = crossRate.toLkrPerUnit(rawMap, c.currency_code);
          const { buy_rate, sell_rate } = crossRate.applySpread(mid, {
            buySpreadBps: c.buy_spread_bps,
            sellSpreadBps: c.sell_spread_bps,
          });
          return {
            currency: c.currency_code,
            name: currencyClient.CURRENCY_DISPLAY_NAMES[c.currency_code] || c.currency_code,
            mid_rate: round6(mid),
            buy_rate: round6(buy_rate),
            sell_rate: round6(sell_rate),
            buy_spread_bps: c.buy_spread_bps,
            sell_spread_bps: c.sell_spread_bps,
          };
        } catch (err) {
          // This cycle's provider pull was missing this currency — omit it
          // from the board rather than serving a broken/undefined rate.
          console.warn(`BOARD: skipping ${c.currency_code}: ${err.message}`);
          return null;
        }
      })
      .filter(Boolean);

    return res.status(200).json({
      quote_currency: "LKR",
      as_of: latestFetchedAt,
      source: latestSource,
      is_stale: isStale,
      rates,
    });
  } catch (err) {
    console.error("GET BOARD ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the rate board." });
  }
};

// GET /api/currency/live-forecast/:code?horizon= — naive short-term trend
// projection from live rates only (all roles). SEPARATE from /analyze — see
// liveForecast.service.js's file header and CURRENCY_FEATURE.md §16. Never
// calls the Python service and never reads h10-historical/demo-seed rows.
exports.liveForecast = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();
  // Same Express-5-can't-mutate-req.query pattern as getRateHistory above.
  const horizonDays = req.query.horizon ? Number(req.query.horizon) : undefined;

  try {
    const result = await liveForecast.getLiveForecast(code, { horizonDays });
    return res.status(200).json(result);
  } catch (err) {
    console.error("GET LIVE FORECAST ERROR:", err);
    return res.status(500).json({ message: "Failed to compute live forecast." });
  }
};

// GET /api/currency/analyze/:code — full analysis for staff/admin,
// simplified forecast-only view for customer.
exports.analyze = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();
  try {
    const { data, cached } = await getAnalysis(code, { userId: req.user.user_id });
    // Staff/admin get the full breakdown (each of forecast/trend/volatility/
    // anomaly already carries its own data_vintage from the Python service)
    // plus this same top-level convenience copy the customer shape gets, so
    // every role has one consistent place to read the headline vintage from.
    const payload =
      req.user.role === "customer"
        ? simplifyForCustomer(data)
        : { ...attachStaffIntervals(data), data_vintage: data.forecast?.data_vintage };
    return res.status(200).json({ ...payload, cached });
  } catch (err) {
    return respondCurrencyError(res, err, "Failed to analyze currency.");
  }
};

// GET /api/currency/anomalies — recent flagged anomalies (staff, admin).
exports.listAnomalies = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.query.currency ? String(req.query.currency).toUpperCase() : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  // Optional plane filter (Phase 29, §30). Omitted = both planes, which
  // keeps every existing caller's behaviour identical.
  const dataPlane = req.query.plane ? String(req.query.plane) : undefined;

  try {
    const rows = await currencyModel.findAnomalyLog({ code, dataPlane, limit });
    return res.status(200).json({ anomalies: rows });
  } catch (err) {
    console.error("LIST ANOMALIES ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch anomaly log." });
  }
};

// GET /api/currency/live-anomaly/:code — run the Isolation Forest over the
// trailing LIVE rate window (staff, admin). A separate endpoint from
// /analyze's anomaly block, which scores the model's own 2017 series — the
// two are never merged (CURRENCY_FEATURE.md §10.2/§30).
exports.liveAnomaly = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();

  try {
    const result = await liveAnomaly.getLiveAnomaly(code, { detectedBy: req.user?.user_id });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof currencyClient.CurrencyServiceError) {
      // Surface the Python service's own status (400 unknown currency, 404
      // untrained, 503 not ready); anything else is a gateway-side failure.
      return res.status(err.status || 502).json({ message: err.message });
    }
    console.error("GET LIVE ANOMALY ERROR:", err);
    return res.status(500).json({ message: "Failed to compute live anomaly check." });
  }
};

// GET /api/currency/admin/model-status — model versions + live health +
// per-currency cache freshness (admin).
exports.adminModelStatus = async (req, res) => {
  let health;
  try {
    health = await currencyClient.getHealth();
  } catch (err) {
    health = {
      status: "unreachable",
      models_loaded: false,
      trained_currencies: currencyClient.TRAINED_CURRENCIES_FALLBACK,
      error: err.message,
    };
  }

  try {
    const cacheRows = await currencyModel.listCachedAnalyses();
    return res.status(200).json({
      service: { url: currencyClient.CURRENCY_MODEL_URL, ...health },
      models: currencyClient.MODEL_VERSIONS,
      cache: cacheRows,
      // Per-model accuracy-vs-baseline figures read from the training
      // artifacts on disk (Phase 26, CURRENCY_FEATURE.md §27). Best-effort
      // and never throws: an absent artifact becomes an `available: false`
      // entry, because the model repo's models/ directory is gitignored and
      // legitimately may not be present.
      evaluation: modelEvaluation.getEvaluationSummary(),
    });
  } catch (err) {
    console.error("ADMIN MODEL STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch model status." });
  }
};

// PATCH /api/currency/admin/currencies/:code/status — toggle a currency
// active/inactive (admin).
exports.adminSetCurrencyActive = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();
  const { is_active } = req.body;

  try {
    await currencyModel.setCurrencyActive(code, is_active);
    return res.status(200).json({ currency: code, is_active });
  } catch (err) {
    console.error("ADMIN SET CURRENCY ACTIVE ERROR:", err);
    return res.status(500).json({ message: "Failed to update currency setting." });
  }
};

// POST /api/currency/admin/analyze/:code/refresh — force-bypass the cache
// and recompute immediately (admin).
exports.adminRefreshAnalysis = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();
  try {
    const { data } = await getAnalysis(code, { forceRefresh: true, userId: req.user.user_id });
    return res.status(200).json({ ...data, cached: false });
  } catch (err) {
    return respondCurrencyError(res, err, "Failed to refresh currency analysis.");
  }
};

// POST /api/currency/admin/rates/refresh — force an immediate pull from the
// live rate provider, bypassing the hourly schedule (admin). Unlike the
// scheduled background tick, a failure here is surfaced to the caller
// rather than silently logged — the admin explicitly asked for a fresh
// pull and deserves to know if it didn't happen.
exports.adminRefreshRates = async (req, res) => {
  try {
    const result = await rateFeed.refreshRateBoard({ force: true });
    return res.status(200).json({ message: "Rate board refreshed.", ...result });
  } catch (err) {
    console.error("ADMIN REFRESH RATES ERROR:", err);
    return res.status(502).json({
      message: "Failed to refresh rates from the live provider.",
      error: err.message,
    });
  }
};

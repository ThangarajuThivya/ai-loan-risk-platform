"use strict";

/**
 * Live exchange-rate ingestion — the ONE place that talks to the external
 * FX rate provider. Fetches latest USD-per-unit rates, upserts the
 * currency_rates board snapshot, and appends currency_rate_history
 * (source='live-er-api'). See migration 007 and CURRENCY_FEATURE.md §9.1
 * for the provider evaluation and why this one was picked.
 *
 * This is a SEPARATE data plane from the Python currency-forecast-model
 * service (CURRENCY_FEATURE.md §9.1, design decision D1). The trained LSTM/XGBoost/GARCH/
 * IsolationForest artifacts were fitted on Fed H.10 data ending
 * 2017-08-25; live rates are never sent to that service and never
 * re-anchor its forecasts. They exist purely for display (the rate board,
 * the chart's "live" series) and, from Phase 10 onward, for quoting FX
 * exchange requests.
 */

const axios = require("axios");
const currencyModel = require("../models/currencyModel");

const PROVIDER_URL = (
  process.env.CURRENCY_RATE_PROVIDER_URL || "https://open.er-api.com/v6/latest/USD"
).trim();

// Tag stored in currency_rates.source / currency_rate_history.source so
// every row's provenance is traceable (CURRENCY_FEATURE.md §9.1, D1).
const SOURCE_TAG = "live-er-api";

// Kept in sync with currency-forecast-model/src/config.py's
// TRAINED_CURRENCIES — the live feed only tracks currencies the app
// actually shows analysis for.
const TRAINED_CURRENCIES = ["LKR", "INR", "EUR", "GBP", "JPY"];

const REQUEST_TIMEOUT_MS = 10000;

// The provider (open.er-api.com, backed by exchangerate-api.com's free
// tier) only updates once every ~24h upstream; polling hourly is a
// generous safety margin, not an attempt to catch every change.
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

let intervalHandle = null;
let lastRunAt = null;
let lastError = null;

function todayUtcDateString(unixSeconds) {
  const d = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * One raw call to the provider. Throws on any network/shape failure —
 * callers decide whether that's fatal (an explicit admin refresh) or
 * something to log and shrug off (a scheduled background tick).
 * @returns {Promise<{rates: Record<string, number>, asOfUnix: number|undefined}>}
 */
async function fetchLiveRates() {
  let response;
  try {
    response = await axios.get(PROVIDER_URL, { timeout: REQUEST_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`Could not reach the FX rate provider at ${PROVIDER_URL}: ${err.message}`);
  }
  const body = response.data;
  if (!body || body.result !== "success" || !body.rates) {
    throw new Error(
      `FX rate provider returned an unexpected response: ${JSON.stringify(body).slice(0, 200)}`
    );
  }
  return { rates: body.rates, asOfUnix: body.time_last_update_unix };
}

/**
 * Pull the latest rates and persist them (currency_rates + currency_rate_history).
 *
 * On provider failure: a scheduled background tick logs the error and
 * leaves the last known board in place (GET /board still serves it, marked
 * stale via its own fetched_at check) rather than throwing into an
 * unattended setInterval. An explicit admin-triggered refresh (`force:
 * true`) rethrows so the caller can surface a real error to the admin.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{ok: boolean, as_of?: string, rate_date?: string, currencies_updated?: number, error?: string}>}
 */
async function refreshRateBoard({ force = false } = {}) {
  lastRunAt = new Date();
  let live;
  try {
    live = await fetchLiveRates();
  } catch (err) {
    lastError = err.message;
    console.error("[rateFeed] refresh failed:", err.message);
    if (force) throw err;
    return { ok: false, error: err.message };
  }

  const rateDate = todayUtcDateString(live.asOfUnix);
  const fetchedAt = new Date();
  const historyRows = [];

  for (const code of TRAINED_CURRENCIES) {
    const midRate = live.rates[code];
    if (typeof midRate !== "number" || !(midRate > 0)) {
      console.warn(`[rateFeed] provider response missing/invalid ${code} this cycle, skipping`);
      continue;
    }
    await currencyModel.upsertRawRate({ target: code, midRate, source: SOURCE_TAG, fetchedAt });
    historyRows.push({ target: code, rateDate, midRate, source: SOURCE_TAG });
  }
  await currencyModel.insertRateHistoryRows(historyRows);

  lastError = null;
  return {
    ok: true,
    as_of: fetchedAt.toISOString(),
    rate_date: rateDate,
    currencies_updated: historyRows.length,
  };
}

/**
 * Start the background refresh loop. Safe to call once at server boot.
 * Fires an initial (non-blocking) refresh immediately, then on an interval.
 * @param {number} [intervalMs]
 */
function scheduleRateFeed(intervalMs = DEFAULT_INTERVAL_MS) {
  if (intervalHandle) return intervalHandle;

  refreshRateBoard().catch((err) => console.error("[rateFeed] initial refresh failed:", err.message));

  intervalHandle = setInterval(() => {
    refreshRateBoard().catch((err) => console.error("[rateFeed] scheduled refresh failed:", err.message));
  }, intervalMs);
  // Don't let this timer alone keep the Node process alive (relevant for
  // scripts/tests that import this module without running a real server).
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();

  return intervalHandle;
}

function stopRateFeed() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

/** For the admin model-status view. */
function getStatus() {
  return { providerUrl: PROVIDER_URL, lastRunAt, lastError, intervalActive: !!intervalHandle };
}

module.exports = {
  PROVIDER_URL,
  SOURCE_TAG,
  TRAINED_CURRENCIES,
  fetchLiveRates,
  refreshRateBoard,
  scheduleRateFeed,
  stopRateFeed,
  getStatus,
};

"use strict";

/**
 * Currency ML client — the gateway's bridge to the Python currency-forecast
 * service (mirrors mlClient.service.js's relationship to the loan-risk model).
 *
 * The Python service is stateless (no DB, no business logic — ARCHITECTURE.md
 * P2) and validates `currency` itself (400 unknown H.10 currency, 404 known
 * but untrained, 503 not ready yet — see currency-forecast-model/api/main.py).
 * This module just calls it and normalizes failures into CurrencyServiceError
 * so currency.controller.js can map them to the right HTTP status.
 */

const axios = require("axios");

const CURRENCY_MODEL_URL = (
  process.env.CURRENCY_MODEL_URL || "http://localhost:8100"
).replace(/\/+$/, "");

// How long to wait on the model before giving up (ms).
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Fallback list used only if the Python service is unreachable when the
 * gateway needs to answer "what currencies are supported" (e.g. GET
 * /api/currency/currencies) — kept in sync with currency-forecast-model/
 * src/config.py's TRAINED_CURRENCIES. The live /health call is always
 * preferred; this is a degrade-gracefully fallback, not the source of truth.
 */
const TRAINED_CURRENCIES_FALLBACK = ["LKR", "INR", "EUR", "GBP", "JPY"];

/**
 * Display names for the trained currencies, for UI labels. USD is included
 * too — it isn't a trained/forecast currency (the model quotes everything
 * *against* USD), but it is a tradable currency on the Phase 7 rate board.
 */
const CURRENCY_DISPLAY_NAMES = {
  LKR: "Sri Lankan Rupee",
  INR: "Indian Rupee",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  USD: "US Dollar",
};

/**
 * Model versions currently served, kept in sync with currency-forecast-model/
 * src/config.py — surfaced via GET /api/currency/admin/model-status.
 */
const MODEL_VERSIONS = {
  lstm_forecast: "v2",
  xgboost_trend: "v2 (90-trading-day horizon, binary up/down)",
  garch_volatility: "v1",
  isolation_forest: "v1",
};

/**
 * Error raised on any failure calling the Python currency service. `status`
 * carries the Python HTTPException status code when the service actually
 * responded (400 unknown currency, 404 untrained, 503 not ready); it is
 * undefined for network/timeout failures, which callers should treat as a
 * gateway-side (502) problem, not a client error.
 */
class CurrencyServiceError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "CurrencyServiceError";
    this.status = status;
  }
}

/**
 * POST/GET the Python currency service and normalize failures.
 * @param {"get"|"post"} method
 * @param {string} path e.g. "/analyze"
 * @param {object} [body]
 * @returns {Promise<object>} response body
 * @throws {CurrencyServiceError}
 */
async function callCurrencyService(method, path, body) {
  const url = `${CURRENCY_MODEL_URL}${path}`;
  let response;
  try {
    response = await axios({
      method,
      url,
      data: body,
      timeout: REQUEST_TIMEOUT_MS,
      headers: body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (err) {
    if (err.response) {
      const detail =
        err.response.data && err.response.data.detail
          ? typeof err.response.data.detail === "string"
            ? err.response.data.detail
            : JSON.stringify(err.response.data.detail)
          : `HTTP ${err.response.status}`;
      throw new CurrencyServiceError(
        `Currency model error: ${detail}`,
        err.response.status
      );
    }
    if (err.code === "ECONNABORTED") {
      throw new CurrencyServiceError(
        `Currency model timed out after ${REQUEST_TIMEOUT_MS}ms at ${url}.`
      );
    }
    throw new CurrencyServiceError(
      `Could not reach the currency model at ${url}: ${err.message}. ` +
        `Is the Python service running (uvicorn api.main:app --port 8100)?`
    );
  }
  return response.data;
}

/** GET /health */
async function getHealth() {
  return callCurrencyService("get", "/health");
}

/**
 * POST /forecast
 * @param {string} currency
 * @param {number[]} [horizons] subset of [1,7,30,90]; omit for all four
 */
async function getForecast(currency, horizons) {
  return callCurrencyService("post", "/forecast", { currency, horizons });
}

/** POST /trend */
async function getTrend(currency) {
  return callCurrencyService("post", "/trend", { currency });
}

/**
 * POST /volatility
 * @param {string} currency
 * @param {number} [horizonDays] default 30, max 90
 */
async function getVolatility(currency, horizonDays) {
  return callCurrencyService("post", "/volatility", {
    currency,
    horizon_days: horizonDays,
  });
}

/**
 * POST /anomaly
 * @param {string} currency
 * @param {number[]} recentWindow >= 21 contiguous daily rates, oldest first
 */
async function getAnomaly(currency, recentWindow) {
  return callCurrencyService("post", "/anomaly", {
    currency,
    recent_window: recentWindow,
  });
}

/**
 * POST /analyze — forecast + trend + volatility + anomaly in one call. The
 * gateway prefers this over the four individual endpoints above for every
 * currency view, per CURRENCY_FEATURE.md §4.1.
 */
async function getAnalyze(currency) {
  return callCurrencyService("post", "/analyze", { currency });
}

module.exports = {
  CURRENCY_MODEL_URL,
  CurrencyServiceError,
  TRAINED_CURRENCIES_FALLBACK,
  CURRENCY_DISPLAY_NAMES,
  MODEL_VERSIONS,
  getHealth,
  getForecast,
  getTrend,
  getVolatility,
  getAnomaly,
  getAnalyze,
};

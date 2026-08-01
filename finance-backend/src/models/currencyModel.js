"use strict";

/**
 * Currency data-access layer — SQL for the gateway's currency feature.
 *
 * Three concerns, three tables (see db/migrations/006_currency_analysis_tables.sql):
 *   - currency_analysis_cache: upserted per-currency cache of the Python
 *     service's /analyze response, so currency.controller.js doesn't have to
 *     call the model on every request (they don't change intraday).
 *   - currency_anomaly_log: append-only history of flagged anomalies.
 *   - currency_settings: admin-managed active/inactive flag per currency.
 *
 * Phase 7 (migration 007) adds the live-rate plane, kept deliberately
 * separate from the model-cache plane above (CURRENCY_FEATURE.md §9.1, D1):
 *   - currency_rate_history: date-keyed rate series (chart data source),
 *     both the backfilled 1973-2017 H.10 series and the live feed going
 *     forward, distinguished by `source`.
 *   - currency_rates (from 002_loan_tables.sql, extended by 007): the
 *     current live-board snapshot, one row per (base, target).
 *   - fx_rate_board_config: admin-managed buy/sell spread per tradable
 *     currency, read by currency.controller.js's board endpoint together
 *     with src/services/crossRate.service.js.
 */

const db = require("../config/db");
const pool = db.promise();

// currency_anomaly_log.data_plane values (migration 009). Named constants
// rather than bare strings so the two planes can never drift apart between
// the writer, the reader and the filter (CURRENCY_FEATURE.md §10.2).
const DATA_PLANE_MODEL_SERIES = "model-series";
const DATA_PLANE_LIVE_FEED = "live-feed";

const DEFAULT_HISTORY_LIMIT = 90;
// Generous cap for from/to range queries — one currency's full 1973-2017
// H.10 history is ~11,000 rows; this comfortably covers MAX range requests
// without an unbounded query.
const MAX_RANGE_ROWS = 20000;

/**
 * Rate-history rows for one currency's USD/target series (the H.10/model
 * quote convention — "target units per 1 USD"), ascending by date. This is
 * what GET /api/currency/rates/:code reads for charts.
 *
 * Two modes:
 *   - `from`/`to` given: every row in that date range (optionally further
 *     filtered by `source`), no default row cap (capped at MAX_RANGE_ROWS).
 *   - neither given: the most recent `limit` rows (default 90) — the
 *     original no-filter behavior this endpoint always had.
 *
 * @param {string} code 3-letter ISO currency code (target side of USD/code)
 * @param {object} [opts]
 * @param {number} [opts.limit] max rows when no from/to given (default 90)
 * @param {string} [opts.from] YYYY-MM-DD inclusive
 * @param {string} [opts.to] YYYY-MM-DD inclusive
 * @param {string} [opts.source] 'h10-historical' | 'live-er-api' | 'demo-seed'
 * @returns {Promise<object[]>} rows ascending by rate_date
 */
async function findRateHistory(code, { limit, from, to, source } = {}) {
  const params = [code];
  let where = "base = 'USD' AND target = ?";
  if (from) {
    where += " AND rate_date >= ?";
    params.push(from);
  }
  if (to) {
    where += " AND rate_date <= ?";
    params.push(to);
  }
  if (source) {
    where += " AND source = ?";
    params.push(source);
  }

  // DATE_FORMAT, not a bare `rate_date` column: mysql2 returns DATE columns
  // as JS Date objects by default (no `dateStrings` on the shared pool —
  // see src/config/db.js — and that pool is used app-wide, so this isn't
  // changed globally). Serializing a Date to JSON re-renders it in UTC,
  // which on an IST host shifts a plain calendar date like 2017-08-25
  // backward to "2017-08-24T18:30:00.000Z" — wrong day for a chart. A plain
  // formatted string sidesteps the whole Date/timezone conversion.
  if (from || to) {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(rate_date, '%Y-%m-%d') AS rate_date, mid_rate, source
         FROM currency_rate_history
        WHERE ${where}
        ORDER BY rate_date ASC
        LIMIT ?`,
      [...params, MAX_RANGE_ROWS]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(rate_date, '%Y-%m-%d') AS rate_date, mid_rate, source
       FROM currency_rate_history
      WHERE ${where}
      ORDER BY rate_date DESC
      LIMIT ?`,
    [...params, limit || DEFAULT_HISTORY_LIMIT]
  );
  return rows.reverse();
}

// Trailing window cap for liveForecast.service.js's trend projection. The
// live feed only appends ~daily (rateFeed.service.js), so this is a
// generous ceiling unlikely to ever actually bind.
const LIVE_FORECAST_TRAILING_LIMIT = 90;

/**
 * Trailing live-only rate history for one currency — feeds
 * liveForecast.service.js's trend projection. Reads ONLY rows whose source
 * starts with 'live-' (currently just 'live-er-api'); never h10-historical
 * or demo-seed. This is a deliberately separate, much simpler signal from
 * the trained models' /analyze output (CURRENCY_FEATURE.md §16).
 * @param {string} code 3-letter ISO currency code
 * @returns {Promise<object[]>} rows ascending by rate_date, { rate_date, mid_rate, source }[]
 */
async function findLiveRateHistory(code) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(rate_date, '%Y-%m-%d') AS rate_date, mid_rate, source
       FROM currency_rate_history
      WHERE base = 'USD' AND target = ? AND source LIKE 'live-%'
      ORDER BY rate_date DESC
      LIMIT ?`,
    [code, LIVE_FORECAST_TRAILING_LIMIT]
  );
  return rows.reverse();
}

/**
 * Bulk-insert rate-history rows, ignoring any that already exist (the
 * unique key on base/target/rate_date/source makes this idempotent — safe
 * to re-run the backfill script or a scheduled live-feed tick that refetches
 * a date already stored).
 * @param {Array<{target: string, rateDate: string, midRate: number, source: string}>} rows
 */
async function insertRateHistoryRows(rows) {
  if (!rows || rows.length === 0) return;
  const values = rows.map((r) => ["USD", r.target, r.rateDate, r.midRate, r.source]);
  await pool.query(
    `INSERT IGNORE INTO currency_rate_history (base, target, rate_date, mid_rate, source)
     VALUES ?`,
    [values]
  );
}

/**
 * The current live-board snapshot — all rows in currency_rates (one per
 * trained currency's target). Raw USD-per-unit convention; the board
 * endpoint derives LKR-per-unit cross rates from these via
 * crossRate.service.js.
 * @returns {Promise<object[]>} { target, mid_rate, fetched_at, source }[]
 */
async function getRawRateSnapshot() {
  const [rows] = await pool.query(
    `SELECT target, mid_rate, fetched_at, source
       FROM currency_rates
      WHERE base = 'USD'`
  );
  return rows;
}

/**
 * Upsert one currency's raw live rate into the board snapshot. buy_rate/
 * sell_rate are set equal to mid_rate here — this table stores the raw
 * provider mid only; the customer-facing spread-adjusted buy/sell is
 * computed at read time from fx_rate_board_config, not stored here (see
 * crossRate.service.js).
 * @param {object} p
 * @param {string} p.target 3-letter ISO currency code
 * @param {number} p.midRate target units per 1 USD
 * @param {string} p.source e.g. 'live-er-api'
 * @param {Date} p.fetchedAt
 */
async function upsertRawRate({ target, midRate, source, fetchedAt }) {
  await pool.query(
    `INSERT INTO currency_rates (base, target, mid_rate, buy_rate, sell_rate, source, fetched_at)
     VALUES ('USD', ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mid_rate = VALUES(mid_rate),
       buy_rate = VALUES(buy_rate),
       sell_rate = VALUES(sell_rate),
       source = VALUES(source),
       fetched_at = VALUES(fetched_at)`,
    [target, midRate, midRate, midRate, source, fetchedAt]
  );
}

/**
 * Admin-configured spread + tradability per foreign currency
 * (fx_rate_board_config, migration 007).
 * @returns {Promise<object[]>} { currency_code, buy_spread_bps, sell_spread_bps, is_tradable, updated_at }[]
 */
async function listBoardConfig() {
  const [rows] = await pool.query(
    `SELECT currency_code, buy_spread_bps, sell_spread_bps, is_tradable, updated_at
       FROM fx_rate_board_config
      ORDER BY currency_code`
  );
  return rows;
}

/**
 * Update a tradable currency's admin-configured spread/tradability
 * (fx_rate_board_config, migration 007) — backs the Phase 10 exchange
 * feature's PATCH /admin/spreads/:code. Missing fields keep their existing
 * value; a code with no existing row is not created here (the 5 foreign
 * currencies are seeded by migration 007, see §9.3's LKR-exclusion note).
 * @param {string} code
 * @param {object} p
 * @param {number} [p.buySpreadBps]
 * @param {number} [p.sellSpreadBps]
 * @param {boolean} [p.isTradable]
 * @returns {Promise<object|null>} the updated row, or null if `code` isn't configured
 */
async function updateBoardConfig(code, { buySpreadBps, sellSpreadBps, isTradable }) {
  const [existingRows] = await pool.query(
    `SELECT * FROM fx_rate_board_config WHERE currency_code = ?`,
    [code]
  );
  const existing = existingRows[0];
  if (!existing) return null;

  await pool.query(
    `UPDATE fx_rate_board_config
        SET buy_spread_bps = ?, sell_spread_bps = ?, is_tradable = ?
      WHERE currency_code = ?`,
    [
      buySpreadBps ?? existing.buy_spread_bps,
      sellSpreadBps ?? existing.sell_spread_bps,
      isTradable ?? existing.is_tradable,
      code,
    ]
  );

  const [rows] = await pool.query(`SELECT * FROM fx_rate_board_config WHERE currency_code = ?`, [
    code,
  ]);
  return rows[0];
}

/**
 * The cached /analyze payload for one currency, if any.
 * @param {string} code
 * @returns {Promise<object|null>} { currency_code, as_of_date, payload, computed_at } or null
 */
async function getCachedAnalysis(code) {
  const [rows] = await pool.query(
    `SELECT currency_code, as_of_date, payload, computed_at
       FROM currency_analysis_cache
      WHERE currency_code = ?`,
    [code]
  );
  return rows[0] || null;
}

/**
 * All cached analyses (admin model-status view), one row per currency.
 * @returns {Promise<object[]>}
 */
async function listCachedAnalyses() {
  const [rows] = await pool.query(
    `SELECT currency_code, as_of_date, computed_at
       FROM currency_analysis_cache
      ORDER BY currency_code`
  );
  return rows;
}

/**
 * Upsert the cached /analyze payload for a currency.
 * @param {string} code
 * @param {string} asOfDate the Python response's as_of_date (YYYY-MM-DD)
 * @param {object} payload the full /analyze response
 */
async function upsertCachedAnalysis(code, asOfDate, payload) {
  await pool.query(
    `INSERT INTO currency_analysis_cache (currency_code, as_of_date, payload)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       as_of_date = VALUES(as_of_date),
       payload = VALUES(payload),
       computed_at = CURRENT_TIMESTAMP`,
    [code, asOfDate, JSON.stringify(payload)]
  );
}

/**
 * Append one row to the anomaly log. No-op if the result wasn't actually
 * anomalous — this table is a log of alerts, not every check performed.
 * @param {object} p
 * @param {string} p.code
 * @param {string} p.asOfDate
 * @param {number} p.anomalyScore
 * @param {boolean} p.isAnomalous
 * @param {string} [p.modelVersion]
 * @param {number} [p.detectedBy] user_id of whoever triggered the check
 * @param {string} [p.dataPlane] DATA_PLANE_MODEL_SERIES (default) or
 *   DATA_PLANE_LIVE_FEED — which plane the scored window came from. Never
 *   inferred from the other fields: the two populations must stay
 *   distinguishable in the log (CURRENCY_FEATURE.md §10.2, migration 009).
 */
async function logAnomaly({
  code,
  asOfDate,
  anomalyScore,
  isAnomalous,
  modelVersion,
  detectedBy,
  dataPlane = DATA_PLANE_MODEL_SERIES,
}) {
  if (!isAnomalous) return;
  await pool.query(
    `INSERT INTO currency_anomaly_log
       (currency_code, as_of_date, anomaly_score, model_version, data_plane, detected_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [code, asOfDate, anomalyScore, modelVersion || null, dataPlane, detectedBy || null]
  );
}

/**
 * Recent anomaly-log entries, optionally filtered to one currency and/or
 * one data plane.
 * @param {object} p
 * @param {string} [p.code]
 * @param {string} [p.dataPlane] omit for both planes
 * @param {number} p.limit
 * @returns {Promise<object[]>}
 */
async function findAnomalyLog({ code, dataPlane, limit }) {
  const params = [];
  const clauses = [];
  if (code) {
    clauses.push("currency_code = ?");
    params.push(code);
  }
  if (dataPlane) {
    clauses.push("data_plane = ?");
    params.push(dataPlane);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT id, currency_code, as_of_date, anomaly_score, model_version, data_plane,
            detected_at, detected_by
       FROM currency_anomaly_log
       ${where}
       ORDER BY detected_at DESC
       LIMIT ?`,
    params
  );
  return rows;
}

/**
 * All admin-configured currency settings (active/inactive overrides).
 * @returns {Promise<object[]>} { currency_code, is_active, updated_at }[]
 */
async function listCurrencySettings() {
  const [rows] = await pool.query(
    `SELECT currency_code, is_active, updated_at FROM currency_settings`
  );
  return rows;
}

/**
 * Set (upsert) a currency's active flag.
 * @param {string} code
 * @param {boolean} isActive
 */
async function setCurrencyActive(code, isActive) {
  await pool.query(
    `INSERT INTO currency_settings (currency_code, is_active)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       is_active = VALUES(is_active),
       updated_at = CURRENT_TIMESTAMP`,
    [code, isActive ? 1 : 0]
  );
}

module.exports = {
  findRateHistory,
  findLiveRateHistory,
  insertRateHistoryRows,
  getRawRateSnapshot,
  upsertRawRate,
  listBoardConfig,
  updateBoardConfig,
  getCachedAnalysis,
  listCachedAnalyses,
  upsertCachedAnalysis,
  DATA_PLANE_MODEL_SERIES,
  DATA_PLANE_LIVE_FEED,
  logAnomaly,
  findAnomalyLog,
  listCurrencySettings,
  setCurrencyActive,
};

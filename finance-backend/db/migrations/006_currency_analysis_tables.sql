-- Migration 006: currency-forecasting gateway integration tables (Phase 5).
-- Adds: currency_analysis_cache, currency_anomaly_log, currency_settings.
-- Idempotent — safe to re-run. Does not touch any table from migrations
-- 001-005, including the existing (still separately-owned) currency_rates
-- table from 002_loan_tables.sql, which this migration also does not modify.
-- See ../../../CURRENCY_FEATURE.md §5 (database plan) for the original
-- draft this supersedes with what Phase 5 actually needed — a leaner set
-- than the original 006-011 draft. No currency_pairs/currency_forecasts/
-- currency_trend_signals/currency_volatility/currency_anomalies split; one
-- combined analysis cache plus a small anomaly log and a settings table
-- cover everything src/routes/currency.routes.js needs.

USE ai_loan;

-- One row per trained currency, upserted on every fresh /analyze call —
-- caches the Python service's combined forecast+trend+volatility+anomaly
-- response so repeat requests within the controller's cache TTL don't hit
-- the Python service (see src/controllers/currency.controller.js). Since the
-- model has no live data feed, `as_of_date` (and therefore the whole
-- payload) stays constant across calls until the model is retrained on
-- fresher data — this table naturally ends up with ~5 rows (one per trained
-- currency), not one row per request.
CREATE TABLE IF NOT EXISTS currency_analysis_cache (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  currency_code VARCHAR(3) NOT NULL,
  as_of_date    DATE NOT NULL,
  payload       JSON NOT NULL,
  computed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_currency_analysis_cache_code (currency_code)
);

-- Append-only history of anomaly detections (is_anomalous = true) surfaced
-- via GET /api/currency/analyze/:code — lets staff/admin see a running list
-- of flagged currencies (CURRENCY_FEATURE.md §6 role matrix: staff "advise
-- customers", admin "system-wide") instead of only the latest cached result.
CREATE TABLE IF NOT EXISTS currency_anomaly_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  currency_code VARCHAR(3) NOT NULL,
  as_of_date    DATE NOT NULL,
  anomaly_score DECIMAL(10,6) NOT NULL,
  model_version VARCHAR(20),
  detected_by   INT NULL,
  detected_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (detected_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Admin-managed active/inactive flag per currency (role matrix §6: "Toggle
-- tracked pairs" is admin-only). Absence of a row means active (the default
-- for every currency TRAINED_CURRENCIES already covers) — a row is only
-- inserted the first time an admin actually toggles a currency off.
CREATE TABLE IF NOT EXISTS currency_settings (
  currency_code VARCHAR(3) PRIMARY KEY,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

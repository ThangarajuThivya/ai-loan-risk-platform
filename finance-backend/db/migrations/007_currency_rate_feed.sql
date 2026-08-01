-- Migration 007: live exchange-rate feed (Phase 7 of the currency feature).
-- Adds: currency_rate_history, fx_rate_board_config; extends currency_rates
-- (002_loan_tables.sql) with a `source` column and a uniqueness guarantee.
-- Idempotent — safe to re-run. Does not touch 001-006.
--
-- Two data planes, kept deliberately separate (see CURRENCY_PHASE_7_PLUS.md
-- D1): the trained LSTM/XGBoost/GARCH/IsolationForest models were fitted on
-- Fed H.10 data ending 2017-08-25 and are never re-anchored to live rates.
-- Everything in this migration is the LIVE plane — real, current, no model
-- involved — used for the rate board and (from Phase 10) FX exchange quotes.
--
-- Quote convention: both new/extended tables here store rates in the SAME
-- convention as the H.10 data and the Python service — "<target> units per
-- 1 USD" (base is always 'USD'). Conversion to the retail "LKR per 1 unit of
-- foreign currency" board convention happens at READ time, in one place
-- (src/services/crossRate.service.js), not at storage time — see that file
-- for why (CURRENCY_FEATURE.md §7.3 already recorded one bug from this
-- convention being handled ad hoc in more than one place).

USE ai_loan;

-- Date-keyed rate history — one row per (base, target, rate_date, source).
-- This is what GET /api/currency/rates/:code reads for charts. Two sources
-- populate it: the Phase 1 H.10 series (source='h10-historical', via
-- scripts/backfillCurrencyHistory.js, covering 1973-08-25 through
-- 2017-08-25) and the live feed (source='live-er-api', via
-- src/services/rateFeed.service.js, appending going forward from whenever
-- this migration is first applied). The gap between those two ranges is
-- real and is deliberately NOT interpolated — see CURRENCY_PHASE_7_PLUS.md
-- Phase 8 for how the UI is expected to present that gap honestly.
CREATE TABLE IF NOT EXISTS currency_rate_history (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  base        VARCHAR(10) NOT NULL,
  target      VARCHAR(10) NOT NULL,
  rate_date   DATE NOT NULL,
  mid_rate    DECIMAL(18,6) NOT NULL,
  source      VARCHAR(30) NOT NULL,
  ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_currency_rate_history (base, target, rate_date, source),
  KEY idx_currency_rate_history_range (base, target, rate_date)
);

-- currency_rates (from 002_loan_tables.sql) becomes the LIVE BOARD SNAPSHOT:
-- one current row per (base, target) pair, upserted on every rateFeed tick.
-- It had no unique key and no `source` column before this migration — add
-- both, guarded, so the migration stays re-runnable on a fresh or an
-- already-migrated database. MySQL 8.0 has no `ADD COLUMN/KEY IF NOT
-- EXISTS`, so this uses the same guarded PREPARE/EXECUTE pattern as
-- 005_application_declared_fields.sql.
SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'currency_rates' AND column_name = 'source') > 0,
  'SELECT 1',
  'ALTER TABLE currency_rates ADD COLUMN source VARCHAR(30) NULL AFTER sell_rate'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'currency_rates' AND index_name = 'uq_currency_rates_pair') > 0,
  'SELECT 1',
  'ALTER TABLE currency_rates ADD UNIQUE KEY uq_currency_rates_pair (base, target)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Admin-managed spread (in basis points) applied on top of the raw mid rate
-- to produce the customer-facing buy/sell board (rateFeed/crossRate compute
-- this at read time; nothing here stores a spread-adjusted value). Rows are
-- foreign currencies tradable against LKR at the branch. LKR itself is
-- deliberately NOT a row here — it's the settlement currency, not something
-- a Sri Lankan bank buys/sells against itself.
CREATE TABLE IF NOT EXISTS fx_rate_board_config (
  currency_code   VARCHAR(3) PRIMARY KEY,
  buy_spread_bps  INT NOT NULL DEFAULT 150,
  sell_spread_bps INT NOT NULL DEFAULT 150,
  is_tradable     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO fx_rate_board_config (currency_code, buy_spread_bps, sell_spread_bps, is_tradable) VALUES
  ('USD', 100, 100, TRUE),
  ('EUR', 150, 150, TRUE),
  ('GBP', 150, 150, TRUE),
  ('JPY', 175, 175, TRUE),
  ('INR', 200, 200, TRUE);

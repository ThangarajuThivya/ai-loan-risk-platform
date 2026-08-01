-- 009_live_anomaly_plane.sql — Phase 29 (CURRENCY_FEATURE.md §30).
--
-- Adds `data_plane` to currency_anomaly_log so an anomaly detected on the
-- LIVE rate feed is never conflated with one detected on the model's own
-- 2017-anchored H.10 series.
--
-- This is §10.2's rule applied to the anomaly log: a live value and a model
-- value are never merged into one flat field. Before this column the log had
-- no way to say which plane a row came from — every row was implicitly
-- model-series, because that was the only writer. Adding a live writer
-- (liveAnomaly.service.js) without this column would silently mix two
-- populations in one table, and a staff member reading "LKR anomaly, score
-- 0.42" would have no way to tell whether it described 2017 history or last
-- Tuesday.
--
-- Existing rows are backfilled to 'model-series' by the column DEFAULT,
-- which is correct: every row written before this migration came from
-- currency.controller.js's /analyze path, which scores the bundled
-- historical series.
--
-- Idempotent — safe to re-run. MySQL 8.0 has no `ADD COLUMN IF NOT EXISTS`,
-- so this uses the same guarded PREPARE/EXECUTE pattern as
-- 005_application_declared_fields.sql and 007_currency_rate_feed.sql.
-- Touches no other table and drops nothing.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'currency_anomaly_log' AND column_name = 'data_plane') > 0,
  'SELECT 1',
  'ALTER TABLE currency_anomaly_log ADD COLUMN data_plane VARCHAR(20) NOT NULL DEFAULT ''model-series'' AFTER model_version'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The log is read filtered-by-plane on the staff/admin anomaly views, and
-- ordered by detected_at. Guarded the same way.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'currency_anomaly_log' AND index_name = 'idx_anomaly_plane_detected') > 0,
  'SELECT 1',
  'ALTER TABLE currency_anomaly_log ADD INDEX idx_anomaly_plane_detected (data_plane, detected_at)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

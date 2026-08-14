-- Migration 055: system_settings — a small key/value table for admin
-- toggles that actually control backend behaviour. Idempotent — guarded
-- CREATE TABLE IF NOT EXISTS, matching every migration in this series.
-- Additive only. Does not touch 001-054.
--
-- AdminSettings.jsx has carried several toggles since it was first built,
-- all of them local useState with a comment admitting none of it is wired
-- up ("No system_settings table exists in the backend yet... Saving
-- confirms locally but doesn't change live system behavior"). This
-- migration exists to make exactly ONE of those toggles — automatic
-- document extraction — real. The rest stay mocked; this table is not a
-- blanket settings backend for the whole page, just a place for the
-- settings that graduate out of "preview only" one at a time.
--
-- Plain key/value rather than one column per setting: a screen of admin
-- toggles is exactly the shape that grows over time, and a new setting
-- should not require a schema migration to add — just a new row.
--
-- ocr_auto_extraction seeded to 'true': this is the CURRENT behaviour
-- (documentPipeline.service.js has always run unconditionally after an
-- upload, per Step 6), so turning the setting on by default preserves
-- existing behaviour rather than silently disabling extraction the moment
-- this migration runs. INSERT IGNORE so re-running never clobbers a value
-- an admin has since changed.

USE ai_loan;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key    VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value  VARCHAR(255) NOT NULL,
  updated_by     INT NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO system_settings (setting_key, setting_value)
VALUES ('ocr_auto_extraction', 'true');

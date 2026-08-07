-- Migration 030: the decision policy matrix (D2) — what the system decided,
-- and every time a human decided otherwise.
--
-- 029 stored the deterministic policy verdict; risk_assessments (002) stores
-- the model's. Neither is a decision. This migration adds the artifact that
-- combines them (decision_matrix_evaluations) and the columns that record
-- who acted on it and why they deviated.
--
-- WHY A SEPARATE TABLE rather than more columns on credit_policy_evaluations:
-- the matrix is a THIRD judgement with its own version and its own reasons
-- to change. Re-tuning which cell auto-approves must not require rewriting
-- policy rows, and a policy evaluation must stay meaningful on its own — it
-- is the adverse-action record D4 builds on. Same snapshot argument as 029
-- and loan_offers (023): matrix_version + the inputs that were fed in make a
-- past recommendation reproducible after the table moves.
--
-- ACTIONS mirror decisionMatrix.service.js exactly:
--   auto_approve   recommended for approval; staff still click, because
--                  approving issues a binding offer (023)
--   manual_review  no recommendation; normal review
--   auto_reject    the system ACTS — the application is written straight to
--                  'rejected' inside the assess transaction
--
-- `acted` records whether the system actually moved the application on the
-- back of this evaluation, so "the matrix said reject" and "the matrix DID
-- reject" are never conflated when reading history. Only auto_reject ever
-- sets it.
--
-- OVERRIDE COLUMNS on loan_applications and loan_application_events:
--
-- A reviewer may always decide against the matrix — they are the authority.
-- What they may not do is leave no trace. Any decision that deviates from
-- the recommendation, in either direction, carries a standardized code from
-- decisionMatrix.service.js OVERRIDE_REASONS. The code lands in two places
-- on purpose:
--   * loan_applications.override_reason_code — the CURRENT decision's
--     justification, alongside decided_by/decision_note from 019;
--   * loan_application_events.override_reason_code — the historical one, so
--     a later reopen-and-redecide leaves both justifications legible, which
--     the single current-value column on the application cannot do.
--
-- decision_source distinguishes a decision the matrix took from one a person
-- took. decided_by is NULL for an automatic rejection (no user made it), and
-- without this column that is indistinguishable from a deleted staff account
-- — 019 made decided_by ON DELETE SET NULL precisely so history survives an
-- account deletion.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS plus the same
-- PREPARE/EXECUTE column guards as 005/019/029. Additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS decision_matrix_evaluations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  application_id  INT NOT NULL,
  matrix_version  VARCHAR(20) NOT NULL,
  action          ENUM('auto_approve','manual_review','auto_reject') NOT NULL,
  -- The two inputs, snapshotted. They are also readable via
  -- credit_policy_evaluations and risk_assessments, but a recommendation
  -- that cannot show what it was computed from is not auditable.
  policy_outcome  ENUM('pass','refer','decline') NULL,
  risk_label      INT NULL,
  risk_category   VARCHAR(20) NULL,
  rationale       TEXT NULL,
  -- Did the system actually move the application on this evaluation?
  acted           TINYINT(1) NOT NULL DEFAULT 0,
  evaluated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  KEY idx_decision_matrix_application (application_id, id),
  KEY idx_decision_matrix_action (action)
);

SET @schema := DATABASE();

-- loan_applications.override_reason_code
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'override_reason_code') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN override_reason_code VARCHAR(40) NULL AFTER decision_note'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_applications.decision_source
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'decision_source') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN decision_source ENUM(''system'',''manual'') NULL AFTER override_reason_code'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_application_events.override_reason_code
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_application_events' AND column_name = 'override_reason_code') > 0,
  'SELECT 1',
  'ALTER TABLE loan_application_events ADD COLUMN override_reason_code VARCHAR(40) NULL AFTER note'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_application_events.actor_role already exists (022) as VARCHAR(20) and
-- needs no change to hold 'system' — the machine in
-- applicationStatus.service.js is what constrains the value, not the column.

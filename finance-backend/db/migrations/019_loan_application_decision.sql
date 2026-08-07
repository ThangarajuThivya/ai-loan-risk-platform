-- Migration 019: who decided a loan application, and why.
--
-- Before this, updateApplicationStatus (loanModel.js) only flipped
-- loan_applications.status and interpolated the staff's `note` into a
-- one-off notification string — the note itself was never stored anywhere,
-- and nothing recorded which admin/staff user made the call or when. That
-- makes "who approved this and why" unanswerable after the fact.
--
-- Mirrors the fx_exchange_requests.reviewed_by / review_note pattern from
-- 008_fx_exchange_requests.sql: decided_by is nullable + ON DELETE SET NULL
-- so a later staff-account deletion doesn't cascade-delete decision history
-- off a loan application, and decided_at is set explicitly by the app (not
-- DEFAULT CURRENT_TIMESTAMP) so it stays NULL for still-pending rows rather
-- than defaulting to the row's creation time.
--
-- Idempotent via the same guarded PREPARE/EXECUTE pattern as 005/007/009/014
-- (MySQL 8.0 has no ADD COLUMN IF NOT EXISTS). Drops nothing.

USE ai_loan;

SET @schema := DATABASE();

-- decided_by
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'decided_by') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN decided_by INT NULL AFTER status'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- decision_note
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'decision_note') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN decision_note TEXT NULL AFTER decided_by'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- decided_at
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'decided_at') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN decided_at TIMESTAMP NULL AFTER decision_note'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK — added separately since information_schema.COLUMNS guard above can't
-- also guard a constraint name; information_schema.TABLE_CONSTRAINTS does that.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE table_schema = @schema AND table_name = 'loan_applications'
      AND constraint_name = 'fk_loan_applications_decided_by') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications
     ADD CONSTRAINT fk_loan_applications_decided_by
     FOREIGN KEY (decided_by) REFERENCES users(user_id) ON DELETE SET NULL'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

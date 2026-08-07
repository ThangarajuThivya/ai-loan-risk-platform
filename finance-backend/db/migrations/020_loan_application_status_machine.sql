-- Migration 020: expand loan_applications.status into a real lifecycle.
--
-- 002 created ENUM('pending','approved','rejected'), and the only rule
-- anywhere was "the current status must be 'pending'". That models a
-- one-shot decision, not a loan application: there was no way to say
-- "staff has picked this up", "we asked the applicant for documents",
-- "the applicant pulled out", or "the money has actually gone out".
--
-- The lifecycle this adds (transitions + which role may make each move are
-- defined in src/services/applicationStatus.service.js, which is the single
-- source of truth — this ENUM only constrains the *set* of legal values):
--
--   pending ──────────► under_review ──────► more_info_required
--      │                   │    ▲                    │
--      │                   │    └────────────────────┘
--      ├───────────────────┼──► approved ──► disbursed ──► closed
--      ├───────────────────┼──► rejected
--      └───────────────────┴──► withdrawn
--
-- Two states from the obvious "full" lifecycle are deliberately NOT here:
--
--   'draft'  — nothing in this system persists an unsubmitted application.
--              POST /api/loans/assess scores and inserts in one call, so a
--              draft state would be unreachable by construction. It belongs
--              with a "save and continue later" feature, not with this one.
--
--   'active' — would be indistinguishable from 'disbursed' until there is a
--              repayment ledger to make "active" mean something. When
--              loan_accounts arrives, servicing state (active/settled/
--              written_off) belongs on the ACCOUNT; the application's own
--              lifecycle correctly ends at disbursed/closed.
--
-- Data safety: the three original values are kept with identical spelling
-- and 'pending' remains the DEFAULT, so every existing row stays valid and
-- no backfill is needed. This migration only widens the ENUM.
--
-- Idempotent: guarded on whether COLUMN_TYPE already mentions 'under_review'
-- (re-running MODIFY COLUMN would be harmless but needlessly rewrites the
-- table). Same PREPARE/EXECUTE approach as 005/014/019.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema
      AND table_name = 'loan_applications'
      AND column_name = 'status'
      AND COLUMN_TYPE LIKE '%under_review%') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications MODIFY COLUMN status ENUM(
     ''pending'',
     ''under_review'',
     ''more_info_required'',
     ''approved'',
     ''rejected'',
     ''withdrawn'',
     ''disbursed'',
     ''closed''
   ) NOT NULL DEFAULT ''pending'''
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The admin/staff queue filters by status and the customer dashboard lists
-- by user; neither had a supporting index.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'loan_applications'
      AND index_name = 'idx_loan_applications_status_created') > 0,
  'SELECT 1',
  'CREATE INDEX idx_loan_applications_status_created
     ON loan_applications (status, created_at)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'loan_applications'
      AND index_name = 'idx_loan_applications_user_status') > 0,
  'SELECT 1',
  'CREATE INDEX idx_loan_applications_user_status
     ON loan_applications (user_id, status)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

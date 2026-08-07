-- Migration 021: the "more information required" request/response loop.
--
-- 020 added the more_info_required status itself, but nothing persisted
-- WHAT staff asked for or WHAT the applicant answered — only a one-off
-- notification string carried that text, which the applicant dashboard
-- doesn't render as an ongoing conversation and which staff can't see again
-- once the notification is sent. That made the loop staff can start but
-- nobody can actually see through to resolution.
--
-- Four columns, mirroring the decided_by/decision_note/decided_at shape
-- from 019 (see applicationStatus.service.js isInfoRequest/isInfoResponse
-- for exactly when each is written):
--
--   info_request_note   — staff's "what we need", set when status moves TO
--                          more_info_required.
--   info_requested_at   — when that request was made.
--   info_response       — the applicant's reply, set when the APPLICANT
--                          (not staff) moves the status from
--                          more_info_required back to under_review via
--                          POST /api/loans/:id/respond.
--   info_responded_at   — when that reply was submitted.
--
-- Only the LATEST cycle is kept (response columns are cleared when a new
-- request is made — see loanModel.updateApplicationStatus) — same
-- "latest decision, not full history" scope as 019. A full per-transition
-- audit trail covering every field is B4, not this migration.
--
-- Idempotent via the same guarded PREPARE/EXECUTE pattern as 005/014/019.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'info_request_note') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN info_request_note TEXT NULL AFTER decided_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'info_requested_at') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN info_requested_at TIMESTAMP NULL AFTER info_request_note'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'info_response') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN info_response TEXT NULL AFTER info_requested_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'info_responded_at') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN info_responded_at TIMESTAMP NULL AFTER info_response'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

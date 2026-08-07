-- Migration 024: add the 'accepted' application status.
--
-- Companion to 023 (loan_offers). With offers in play, "approved" and
-- "the applicant agreed to the terms" are two different facts and need two
-- different states:
--
--   approved  — credit decision made, offer issued, awaiting the applicant.
--   accepted  — applicant accepted the offer; ready for drawdown.
--
-- The transition table in src/services/applicationStatus.service.js changes
-- accordingly, and one existing edge is REMOVED:
--
--   approved → disbursed   is deleted. Releasing funds against terms nobody
--                          accepted is precisely the hole 023/024 close.
--   approved → accepted    [customer]  accepts the offer
--   accepted → disbursed   [staff/admin]
--   accepted → withdrawn   [customer]  declines before drawdown
--
-- MIGRATING EXISTING DATA: rows already sitting in 'approved' keep that
-- status and are NOT auto-advanced. They have no loan_offers row (offers
-- did not exist when they were approved), so staff must issue an offer for
-- them — re-approving an already-approved application is not a legal move,
-- so POST /api/loans/:id/offer exists precisely to (re-)issue an offer
-- against an application already in 'approved'. Auto-fabricating an
-- "accepted" state for them would invent an agreement that never happened.
--
-- The ENUM only widens: every existing value keeps its spelling and
-- 'pending' remains the DEFAULT, so no backfill is required.
--
-- Idempotent: guarded on whether COLUMN_TYPE already mentions 'accepted'.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema
      AND table_name = 'loan_applications'
      AND column_name = 'status'
      AND COLUMN_TYPE LIKE '%accepted%') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications MODIFY COLUMN status ENUM(
     ''pending'',
     ''under_review'',
     ''more_info_required'',
     ''approved'',
     ''accepted'',
     ''rejected'',
     ''withdrawn'',
     ''disbursed'',
     ''closed''
   ) NOT NULL DEFAULT ''pending'''
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

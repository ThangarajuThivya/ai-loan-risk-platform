-- Migration 022: loan_application_events — the full transition audit trail.
--
-- 019/020/021 each added "latest value" columns to loan_applications itself
-- (decided_by/decision_note/decided_at; info_request_note/info_response;
-- etc.) — deliberately scoped to "the current cycle only", not history, as
-- their own comments say. That answers "what's the current decision" but
-- not "who touched this application, in what order, and when" — the
-- question an auditor or a curious applicant actually asks.
--
-- This is the fx_request_events pattern (008_fx_exchange_requests.sql)
-- applied to loans: one APPEND-ONLY row per transition, including the
-- application's own creation (from_status NULL, to_status 'pending'), never
-- updated or deleted by application code. See
-- src/services/applicationStatus.service.js for the machine these rows are
-- a trace of, and loanModel.js (runAssessmentTransaction /
-- updateApplicationStatus) for the two places that write here — both
-- inside the same transaction as the state change itself, so the audit
-- trail can never disagree with loan_applications.status.
--
-- actor_role is stored alongside actor_user_id (fx_request_events has no
-- equivalent) because for this feature the ROLE making a move is part of
-- what's being audited — the whole point of applicationStatus.service.js's
-- TRANSITIONS table is which role may do what, so a history that only named
-- the user and not the role they were acting as would lose that context.
--
-- Idempotent: guarded CREATE TABLE IF NOT EXISTS, matching every other
-- migration in this series. Additive only — nothing is dropped or altered.

USE ai_loan;

CREATE TABLE IF NOT EXISTS loan_application_events (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  from_status    VARCHAR(30) NULL,
  to_status      VARCHAR(30) NOT NULL,
  actor_user_id  INT NULL,
  actor_role     VARCHAR(20) NULL,
  note           TEXT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_loan_application_events_application (application_id, created_at)
);

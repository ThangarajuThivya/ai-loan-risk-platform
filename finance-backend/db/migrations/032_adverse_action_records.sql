-- Migration 032: adverse_action_records — the standardized, immutable
-- record of WHY an application was rejected (D4).
--
-- Before this, the only structured reason a rejection carried was:
--   - an auto-reject's credit_policy_evaluations.reason_codes (029) — real,
--     but written in rule-engineer language (PREVIOUS_DEFAULTS, DTI_LIMIT),
--     never meant to be handed to the applicant it describes;
--   - a manual reject's loan_applications.override_reason_code (030) — but
--     ONLY when that rejection deviated from the decision matrix's own
--     recommendation. A manual reject that follows the matrix's own
--     'manual_review' verdict — the single most common way a human actually
--     rejects someone — needed no code at all.
--
-- This table is the closed gap: EVERY rejection, automatic or manual,
-- writes exactly one row here, carrying standardized applicant-facing
-- reason codes (src/services/adverseAction.service.js REASONS) and a full
-- immutable snapshot of every judgement that fed the decision.
--
-- WHY A SEPARATE, APPEND-ONLY TABLE rather than more columns on
-- loan_applications:
--
--   * loan_applications.decided_by/decision_note/decision_source/
--     override_reason_code describe the CURRENT decision only, and D2's
--     reopen flow (rejected -> under_review) deliberately NULLs all four —
--     "the file is open again, it has no decision right now" is correct for
--     a live application, but wrong for an audit trail. A reject -> reopen
--     -> reject-again cycle must leave TWO adverse-action records behind,
--     not one that got overwritten and one that vanished.
--   * The technical snapshot — risk_label/probabilities/model_version,
--     policy_version/policy_outcome, matrix_version/matrix_action, and the
--     rate the applicant was priced at (031) — is frozen at the MOMENT OF
--     REJECTION, independent of whatever risk_assessments/
--     credit_policy_evaluations/decision_matrix_evaluations rows exist at
--     query time. Those upstream tables are never deleted, but a manual
--     rejection can happen long after the original assess() call (after a
--     reopen, or simply after sitting in review), and denormalizing the
--     snapshot here means a reader never has to reconstruct "what did we
--     know at the moment we said no" via a fragile join across four tables
--     keyed only by application_id.
--   * `reason_codes` (denormalized VARCHAR) mirrors credit_policy_evaluations
--     and decision_matrix_evaluations' own denormalization for the same
--     reason: it is what a work queue or an export filters on, and neither
--     should have to parse JSON to answer "why was this person declined."
--     `reasons` (JSON) is the full catalog entries actually used — code,
--     label, applicant-facing description — the authoritative long-form
--     record an adverse-action letter (future F3) would render verbatim.
--
-- decision_source/decided_by mirror loan_applications' own columns (030):
-- decided_by is nullable + ON DELETE SET NULL so a later staff-account
-- deletion doesn't cascade-delete adverse-action history, and NULL with
-- decision_source='system' means the decision matrix decided by itself —
-- never confused with an unknown or deleted reviewer.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, matching every migration
-- in this series. Additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS adverse_action_records (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  application_id        INT NOT NULL,
  reason_codes          VARCHAR(500) NOT NULL,
  reasons               JSON NOT NULL,
  decision_source       ENUM('system','manual') NOT NULL,
  decided_by            INT NULL,
  note                  TEXT NULL,
  -- Immutable snapshot, frozen at the moment of rejection — see the note
  -- above. Every field nullable: an application can be rejected before a
  -- risk assessment/policy/matrix evaluation exists to snapshot (e.g. a
  -- data-entry-only rejection), and this must record that honestly rather
  -- than fabricate a value.
  risk_label            INT NULL,
  risk_category         VARCHAR(20) NULL,
  prob_low              DECIMAL(5,4) NULL,
  prob_medium           DECIMAL(5,4) NULL,
  prob_high             DECIMAL(5,4) NULL,
  model_version         VARCHAR(64) NULL,
  policy_version        VARCHAR(20) NULL,
  policy_outcome        ENUM('pass','refer','decline') NULL,
  matrix_version        VARCHAR(20) NULL,
  matrix_action         ENUM('auto_approve','manual_review','auto_reject') NULL,
  priced_interest_rate  DECIMAL(5,2) NULL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_adverse_action_records_application (application_id, id)
);

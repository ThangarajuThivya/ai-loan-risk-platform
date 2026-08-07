-- Migration 029: credit_policy_evaluations — the deterministic policy verdict
-- recorded against each application (D1).
--
-- Until now the ONLY judgement stored against an application was the ML
-- model's (risk_assessments) and the affordability figure derived from it
-- (recommendations). Both are opinions of a model trained on synthetic data.
-- Neither can answer "did this application meet the institution's mandatory
-- lending criteria, and which one did it breach" — the question a regulator,
-- an auditor, or a declined applicant actually asks.
--
-- This table is that answer, produced by src/services/creditPolicy.service.js
-- with no input from the risk model whatsoever.
--
-- WHY THE FULL RULE SET IS SNAPSHOTTED, not just the outcome:
--
--   * policy_version + rules together make a past decision REPRODUCIBLE.
--     Thresholds will move (that is what POLICY in creditPolicy.service.js
--     is for); when they do, an evaluation holding only 'decline' becomes
--     unexplainable, because today's code would no longer reach the same
--     verdict from the same application row. This is the same snapshot
--     reasoning as loan_offers (023), applied to a decision rather than a
--     price.
--   * reason_codes is denormalised out of `rules` deliberately. It is what
--     D4's adverse-action letter enumerates and what a staff work-queue
--     filters on, and neither should have to open a JSON document to read a
--     verdict. `rules` stays the authoritative long-form record.
--   * The computed metrics (dti, age_at_maturity, residual_income) are
--     stored as real columns, not left inside `rules`, so portfolio
--     reporting (F1) can aggregate them in SQL.
--
-- OUTCOMES mirror the service's three verdicts exactly:
--   pass     every mandatory criterion met, nothing flagged
--   refer    within all mandatory floors but a human should look
--   decline  at least one mandatory criterion breached
--
-- 'decline' here does NOT by itself set loan_applications.status. D1 records
-- and surfaces the verdict; combining it with the ML risk score into an
-- automated approve/review/reject is D2's decision matrix. Keeping the
-- record separate from the action is what lets D2 be built (and tuned)
-- without rewriting history.
--
-- One row per application in practice (assess writes exactly one, inside the
-- same transaction as the application itself), but no UNIQUE constraint:
-- re-evaluating an application under a newer policy_version should append,
-- not overwrite, and loanModel reads the latest row by id.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS credit_policy_evaluations (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  application_id   INT NOT NULL,
  policy_version   VARCHAR(20) NOT NULL,
  outcome          ENUM('pass','refer','decline') NOT NULL,
  -- Denormalised from `rules` for querying — see the note above. Empty for a
  -- clean pass.
  reason_codes     VARCHAR(500) NULL,
  -- Computed metrics the rules were measured against. Nullable because a
  -- ratio over unknown income is genuinely undefined, and storing 0 there
  -- would read as a flawless one.
  dti              DECIMAL(6,4) NULL,
  loan_to_income   DECIMAL(8,4) NULL,
  residual_income  DECIMAL(14,2) NULL,
  age_at_maturity  INT NULL,
  -- Full per-rule detail: code, label, status, threshold, value, wording.
  rules            JSON NOT NULL,
  evaluated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  KEY idx_credit_policy_evaluations_application (application_id, id),
  KEY idx_credit_policy_evaluations_outcome (outcome)
);

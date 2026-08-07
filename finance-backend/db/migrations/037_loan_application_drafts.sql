-- Migration 037: save-and-continue-later drafts for the loan wizard (H3).
--
-- Migration 020 deliberately left 'draft' out of the loan_applications status
-- ENUM, noting it "belongs with a 'save and continue later' feature, not with
-- this one" (020_loan_application_status_machine.sql:20-25). This is that
-- feature — and it deliberately does NOT revisit that decision. A draft is
-- kept in its OWN table rather than as a loan_applications row because:
--
--   1. loan_applications.product_id / requested_amount / tenure_months are all
--      NOT NULL (002_loan_tables.sql:23-35), and product_id carries an FK. An
--      application abandoned on step 1 of 7 has none of those values yet.
--   2. loanModel.getActiveExposure() sums requested_amount for every status
--      NOT IN ('rejected','withdrawn','closed'), so an abandoned draft would
--      silently inflate the customer's exposure and could wrongly 409 their
--      next real application.
--   3. Every read path over loan_applications is unfiltered by default
--      (findApplicationsByUserId, findAllApplications, getPortfolioApplications),
--      so drafts would leak into the customer's own list, the staff queue's
--      "All" view, and the F1 portfolio aggregates.
--   4. applicationStatus.service.js TRANSITIONS has no 'draft' key, making it
--      a dead state that checkTransition() rejects outright.
--
-- Structurally this mirrors currency_analysis_cache (006): a JSON payload
-- blob with a UNIQUE key so writes are a plain upsert.
--
-- Idempotent — safe to re-run.

USE ai_loan;

-- One in-progress, unsubmitted wizard per customer. UNIQUE(user_id) enforces
-- the one-draft-per-customer rule at the schema level and is the key the
-- upsert in loanModel.upsertDraft() collides on.
--
-- `payload` holds only the wizard's own form state, whitelisted server-side by
-- loanDraft.service.js#sanitizeDraftPayload — it is replayed into form fields
-- on resume and NEVER used as a submission path. Submitting still goes through
-- POST /api/loans/assess and its full express-validator chain, so a tampered
-- draft cannot bypass validation.
--
-- `step` is which of the 7 wizard steps (0-6) the applicant had reached, so
-- resuming returns them to where they left off rather than to step 0.
--
-- ON DELETE CASCADE (matching customer_profiles): deleting a user takes their
-- unsubmitted draft with them. Submitted applications are unaffected — they
-- live in loan_applications and are never represented here.
CREATE TABLE IF NOT EXISTS loan_application_drafts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  step       INT NOT NULL DEFAULT 0,
  payload    JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loan_application_drafts_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

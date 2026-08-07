-- Migration 025: loan_accounts — the live loan created at drawdown.
--
-- 023/024 gave an application an OFFER and a way for the applicant to accept
-- it. What still didn't exist was the loan itself: 'disbursed' was a status
-- flag on the application and nothing more. Nothing recorded the principal
-- actually released, when repayment starts, when the loan matures, or
-- whether it is still running. An application is a request; an account is
-- the resulting facility, and they are different objects with different
-- lifetimes.
--
-- TERMS COME FROM THE ACCEPTED OFFER, not from the application and not from
-- loan_products. That is the entire point of the C1 → C2 chain: the account
-- must carry what the borrower actually agreed to, not what they originally
-- asked for and not what the product costs today. loanModel.createAccountWithin
-- reads the offer row with status='accepted' and copies it; if there isn't
-- one, drawdown fails rather than inventing terms.
--
-- STATUS lives here, not on the application. Migration 020 already called
-- this: the application's own lifecycle correctly ends at disbursed/closed,
-- while servicing state belongs to the account. 'written_off' is declared
-- now because it is the third real outcome of a loan and adding ENUM values
-- later means rewriting the table; nothing transitions into it yet — that
-- needs the arrears tracking a repayment ledger provides.
--
-- account_no follows the fx_exchange_requests.reference_no pattern: NULL
-- immediately after INSERT, then set to LN-<zero-padded id> inside the same
-- transaction, so the human-facing reference is derived from the real key
-- rather than from a separate counter that could drift.
--
-- UNIQUE(application_id) enforces one account per application at the schema
-- level. The application status machine already forbids disbursing twice
-- (disbursed is not reachable from disbursed), but that is application
-- logic; this makes a double-drawdown impossible even if that logic were
-- bypassed or raced.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS loan_accounts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_no      VARCHAR(20) NULL,
  application_id  INT NOT NULL,
  -- Denormalised borrower. Safe because an application's owner never
  -- changes, and it keeps "this customer's loans" a single-table read
  -- instead of a join back through loan_applications.
  user_id         INT NOT NULL,
  -- Snapshotted from the ACCEPTED offer (see header note).
  principal       DECIMAL(14,2) NOT NULL,
  interest_rate   DECIMAL(5,2) NOT NULL,
  rate_type       ENUM('reducing','flat') NOT NULL DEFAULT 'reducing',
  tenure_months   INT NOT NULL,
  emi             DECIMAL(14,2) NOT NULL,
  -- Dates are derived once at drawdown by loanSchedule.service.js and
  -- stored, not recomputed on read: the repayment calendar must not shift
  -- because someone changed how dates are calculated later.
  disbursed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_due_date  DATE NOT NULL,
  maturity_date   DATE NOT NULL,
  disbursed_by    INT NULL,
  status          ENUM('active','closed','written_off') NOT NULL DEFAULT 'active',
  closed_at       TIMESTAMP NULL,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (disbursed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uq_loan_accounts_application (application_id),
  UNIQUE KEY uq_loan_accounts_account_no (account_no),
  KEY idx_loan_accounts_user_status (user_id, status)
);

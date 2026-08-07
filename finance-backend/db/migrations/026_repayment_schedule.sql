-- Migration 026: repayment_schedule — the amortization table for a loan_account.
--
-- 025 created the account but stopped at a single emi figure. That answers
-- "what does the borrower pay per month" but not "what happens to the
-- balance over 24 months, what's due on 5 October 2027, or how much of that
-- payment is interest vs principal" — the actual repayment calendar a
-- borrower or a collections officer needs.
--
-- Generated ONCE, at drawdown, by loanModel.createAccountWithin (via
-- amortization.service.js buildAmortizationSchedule) inside the same
-- transaction that opens the account — the schedule and the account it
-- belongs to can never disagree about principal/rate/tenure, because they
-- are written together from the same accepted-offer terms. Never
-- regenerated afterward: a schedule that could silently recalculate would
-- let a formula change reshuffle a borrower's already-agreed due dates.
--
-- Every row is a full snapshot (opening/closing balance, principal/interest
-- split) rather than something recomputed from installment_no on read,
-- for the same reason recommendations/loan_offers snapshot their figures —
-- the schedule must survive changes to the EMI code that produced it.
--
-- rate_type is duplicated from loan_accounts rather than looked up, purely
-- so a row is self-describing for reporting/export without a join back.
--
-- status exists now (not deferred to C4) for the same reason 025 declared
-- 'written_off' up front: adding it later means an ALTER on a table that
-- will have real rows by then. Nothing except this migration's own default
-- writes it yet — recording an actual payment against a row is C4's job,
-- not this one's.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS repayment_schedule (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  account_id          INT NOT NULL,
  installment_no      INT NOT NULL,
  due_date            DATE NOT NULL,
  opening_balance     DECIMAL(14,2) NOT NULL,
  principal_component DECIMAL(14,2) NOT NULL,
  interest_component  DECIMAL(14,2) NOT NULL,
  emi                 DECIMAL(14,2) NOT NULL,
  closing_balance     DECIMAL(14,2) NOT NULL,
  rate_type           ENUM('reducing','flat') NOT NULL DEFAULT 'reducing',
  status              ENUM('due','paid') NOT NULL DEFAULT 'due',
  FOREIGN KEY (account_id) REFERENCES loan_accounts(id) ON DELETE CASCADE,
  UNIQUE KEY uq_repayment_schedule_installment (account_id, installment_no),
  KEY idx_repayment_schedule_account_due (account_id, due_date)
);

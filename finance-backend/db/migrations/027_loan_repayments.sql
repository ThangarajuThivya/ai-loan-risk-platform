-- Migration 027: loan repayments — money actually coming back in.
--
-- 026 laid out what the borrower OWES and when. Nothing recorded what they
-- have PAID, so an account could run to maturity with every installment
-- still reading 'due', outstanding balance unknowable, and arrears
-- invisible. This migration closes the loop.
--
-- Three parts, mirroring the fx_inventory design already in this codebase
-- (015-018): denormalised running totals for fast reads, plus an
-- append-only ledger that can reconstruct them exactly.
--
--   loan_payments             one row per payment received.
--   loan_payment_allocations  THE LEDGER: how each payment was split across
--                             installments, principal vs interest. Never
--                             updated or deleted.
--   repayment_schedule.*_paid running totals per installment, derivable from
--                             the ledger at any time. They exist so "what is
--                             outstanding" is a plain read instead of an
--                             aggregate over every payment ever made.
--
-- WHY A LEDGER AND NOT JUST TOTALS: a repayment is the one place in this
-- system where money is split between two buckets by a rule. "This customer
-- paid 75,015.72 and it became 10,500 interest + 64,515.72 principal against
-- installment 3" must be reconstructable years later, and must be provable
-- against the totals. src/services/__tests__/repayment.test.js asserts the
-- ledger and the running totals agree.
--
-- WHAT IS NOT STORED: days-past-due and arrears. Both change every day with
-- no transaction occurring, so storing them would need a nightly job merely
-- to stay true, and a stale row would be worse than no row. They are derived
-- on read by repayment.service.js computeArrears from due dates and the
-- paid totals below.
--
-- ALLOCATION ORDER is fixed at oldest-installment-first, interest before
-- principal within each installment — see repayment.service.js
-- allocatePayment. It is deliberately NOT configurable: a payment whose
-- split depends on a setting nobody can see later is unauditable.
--
-- Idempotent — guarded CREATE TABLE / PREPARE-EXECUTE column adds, additive
-- only. Drops nothing.

USE ai_loan;

SET @schema := DATABASE();

CREATE TABLE IF NOT EXISTS loan_payments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  account_id     INT NOT NULL,
  -- Human-facing receipt reference, set to PMT-<zero-padded id> in the same
  -- transaction as the insert (same approach as loan_accounts.account_no).
  reference_no   VARCHAR(20) NULL,
  amount         DECIMAL(14,2) NOT NULL,
  -- Value date of the payment, which is not necessarily when it was keyed
  -- in: a branch deposit made on Friday and recorded on Monday is still a
  -- Friday payment, and arrears must be judged on the former.
  paid_on        DATE NOT NULL,
  method         ENUM('cash','bank_transfer','cheque','standing_order','other')
                   NOT NULL DEFAULT 'cash',
  -- 'settlement' marks an early-payoff rather than a scheduled instalment,
  -- so a closed-early loan is distinguishable from one that simply ran its
  -- course.
  payment_type   ENUM('installment','settlement') NOT NULL DEFAULT 'installment',
  external_ref   VARCHAR(100) NULL,
  note           TEXT NULL,
  recorded_by    INT NULL,
  recorded_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES loan_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uq_loan_payments_reference_no (reference_no),
  KEY idx_loan_payments_account_paid (account_id, paid_on)
);

-- Append-only. One row per (payment, installment) pair the payment touched.
CREATE TABLE IF NOT EXISTS loan_payment_allocations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  payment_id      INT NOT NULL,
  schedule_id     INT NOT NULL,
  interest_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  principal_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES loan_payments(id) ON DELETE CASCADE,
  FOREIGN KEY (schedule_id) REFERENCES repayment_schedule(id) ON DELETE CASCADE,
  KEY idx_loan_payment_allocations_payment (payment_id),
  KEY idx_loan_payment_allocations_schedule (schedule_id)
);

-- Running totals on the schedule row itself (see header note).
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'principal_paid') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN principal_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER closing_balance'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'interest_paid') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN interest_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER principal_paid'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Interest the lender gave up rather than collected. Early settlement
-- waives interest on installments that had not yet fallen due (see
-- repayment.service.js computeSettlement) — the borrower did not have the
-- money for that period, so charging for it would be charging for nothing.
--
-- It is a THIRD bucket, deliberately not folded into interest_paid: that
-- column means "money received", and recording waived interest there would
-- overstate income and make the ledger disagree with the totals. Outstanding
-- is component − paid − waived.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'interest_waived') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN interest_waived DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER interest_paid'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'settled_at') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN settled_at TIMESTAMP NULL AFTER interest_waived'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 026 declared status ENUM('due','paid'); a payment can legitimately cover
-- only part of an installment, which is neither.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'status' AND COLUMN_TYPE LIKE '%partial%') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule MODIFY COLUMN status ENUM(''due'',''partial'',''paid'') NOT NULL DEFAULT ''due'''
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

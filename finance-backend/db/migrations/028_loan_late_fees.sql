-- Migration 028: late fees on overdue installments.
--
-- C4 gave arrears a NUMBER (repayment.service.js computeArrears) but no
-- consequence — an installment sitting unpaid for 90 days cost the borrower
-- exactly what it cost on day one. This adds a one-time penalty per
-- installment once it has been overdue past a grace period.
--
-- Columns land on repayment_schedule itself, alongside principal/interest/
-- paid, rather than a separate fees table: a late fee is a property of ONE
-- installment (same as principal_component or interest_paid), not an
-- independent transaction. This keeps repayment.service.js's outstandingOn
-- the single place that answers "what does this installment still owe" —
-- it grows a `fee` bucket alongside `principal`/`interest`, and every
-- caller (allocatePayment, computeArrears, computeSettlement) inherits fee
-- awareness for free because they all go through that one function.
--
-- late_fee_charged_at gates re-charging: the sweep
-- (lateFeeSweep.service.js) only assesses a fee once per installment, ever.
-- This is a deliberate, simple policy — no daily-compounding penalty, no
-- second fee if the same installment is still unpaid next month. A harsher
-- policy is a business decision for later, not something this migration
-- should quietly default into by omission.
--
-- late_fee_waived is a THIRD bucket on the fee (paid / waived / still
-- owed), same reasoning as interest_waived from 027: a staff waiver is not
-- income received, and must not be recorded as if it were.
--
-- The ledger (loan_payment_allocations, 027) also needs a fee_amount column
-- alongside interest_amount/principal_amount — the reconciliation invariant
-- from 027 ("the ledger reconstructs the running totals exactly") must hold
-- for the fee bucket too, not just interest and principal.
--
-- Idempotent — guarded PREPARE/EXECUTE column adds, matching 027's pattern
-- for extending this same table. Drops nothing.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_payment_allocations'
      AND column_name = 'fee_amount') > 0,
  'SELECT 1',
  'ALTER TABLE loan_payment_allocations ADD COLUMN fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER schedule_id'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_amount') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER interest_waived'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_paid') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER late_fee_amount'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_waived') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_waived DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER late_fee_paid'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_charged_at') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_charged_at TIMESTAMP NULL AFTER late_fee_waived'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_waived_by') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_waived_by INT NULL AFTER late_fee_charged_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_waived_at') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_waived_at TIMESTAMP NULL AFTER late_fee_waived_by'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND column_name = 'late_fee_waived_note') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule ADD COLUMN late_fee_waived_note TEXT NULL AFTER late_fee_waived_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK for the waiver's actor, added separately (information_schema.COLUMNS
-- can't guard a constraint name — see 019's identical two-step pattern).
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE table_schema = @schema AND table_name = 'repayment_schedule'
      AND constraint_name = 'fk_repayment_schedule_late_fee_waived_by') > 0,
  'SELECT 1',
  'ALTER TABLE repayment_schedule
     ADD CONSTRAINT fk_repayment_schedule_late_fee_waived_by
     FOREIGN KEY (late_fee_waived_by) REFERENCES users(user_id) ON DELETE SET NULL'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Migration 038: beneficiary bank account for loan disbursement (H4).
--
-- Verified gap: the accepted -> disbursed transition (loan.controller.js
-- updateApplicationStatus, loanModel.createAccountWithin) opens a
-- loan_accounts row and generates the full repayment schedule, but captures
-- ZERO information about where the disbursed funds actually go. Staff's
-- "Mark Disbursed" action collects only one optional free-text note. No
-- table anywhere in this schema has a branch, account number, or
-- account-holder column.
--
-- This system is a SINGLE bank's own digital loan platform (see
-- AdminSettings.jsx's bank identity fields) — every customer's beneficiary
-- account is necessarily an account AT that same bank. There is deliberately
-- no "which bank" field: unlike a general payments platform, "which bank" has
-- exactly one answer here, so asking for it would be dead, unvalidatable
-- input. Only branch (this bank has many) + account number + account holder
-- name are needed to route an internal disbursement.
--
-- Two copies of the same three columns, same reasoning as migration 036
-- (customer_profiles + loan_applications both getting the same fields):
--
--   customer_profiles — the DURABLE, reusable account a customer sets once
--   on their profile and reuses across every application (like H2's stable
--   attributes), rather than re-entering it per loan.
--
--   loan_accounts — a SNAPSHOT of that account taken at the exact moment
--   funds are disbursed (loanModel.createAccountWithin), the same way
--   principal/interest_rate are already snapshotted from the accepted offer
--   rather than read live. If the customer later changes their account
--   details, an already-disbursed loan's record of where ITS money went must
--   never change retroactively.
--
-- All columns nullable and additive — existing rows unaffected. Idempotent
-- via the guarded PREPARE/EXECUTE-per-column pattern used since migration 005.

USE ai_loan;

SET @schema := DATABASE();

-- customer_profiles.beneficiary_branch
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'beneficiary_branch') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN beneficiary_branch VARCHAR(100) NULL AFTER years_employed'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- customer_profiles.beneficiary_account_number
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'beneficiary_account_number') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN beneficiary_account_number VARCHAR(20) NULL AFTER beneficiary_branch'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- customer_profiles.beneficiary_account_holder
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'beneficiary_account_holder') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN beneficiary_account_holder VARCHAR(150) NULL AFTER beneficiary_account_number'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_accounts.beneficiary_branch
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_accounts' AND column_name = 'beneficiary_branch') > 0,
  'SELECT 1',
  'ALTER TABLE loan_accounts ADD COLUMN beneficiary_branch VARCHAR(100) NULL AFTER disbursed_by'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_accounts.beneficiary_account_number
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_accounts' AND column_name = 'beneficiary_account_number') > 0,
  'SELECT 1',
  'ALTER TABLE loan_accounts ADD COLUMN beneficiary_account_number VARCHAR(20) NULL AFTER beneficiary_branch'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_accounts.beneficiary_account_holder
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_accounts' AND column_name = 'beneficiary_account_holder') > 0,
  'SELECT 1',
  'ALTER TABLE loan_accounts ADD COLUMN beneficiary_account_holder VARCHAR(150) NULL AFTER beneficiary_account_number'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

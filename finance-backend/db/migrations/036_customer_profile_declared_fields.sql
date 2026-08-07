-- Migration 036: promote stable declared attributes to customer_profiles (H2).
--
-- marital_status/education_level/occupation/employer_category/years_employed
-- have lived only on loan_applications since migration 005 (005 header:
-- "self-reportable at application time"), re-entered/re-declared on every
-- application. Of those, these 5 are genuinely stable CUSTOMER attributes,
-- not per-application facts (unlike additional_income/existing_loans/
-- previous_defaults/crib_score/guarantor_exposure/guarantor_defaults, which
-- stay loan_applications-only). This migration adds the same 5 columns here
-- so they become durable customer data: editable from the profile page,
-- prefilled into new applications from here, and refreshed whenever an
-- application confirms or changes them (see loan.controller.js#assess and
-- user.controller.js#updateProfile).
--
-- loan_applications keeps its own columns/snapshot unchanged — each
-- application still records the value actually used for ITS OWN risk
-- assessment (these feed the ML model, and years_employed feeds a real
-- credit-policy rule), so a later profile edit never rewrites what an
-- existing application's decision was computed against.
--
-- All columns nullable and additive — existing rows unaffected. Idempotent
-- via the same guarded PREPARE/EXECUTE-per-column pattern as migration 005
-- (plain ADD COLUMN IF NOT EXISTS is MariaDB-only; vanilla MySQL 8.0 rejects it).

USE ai_loan;

SET @schema := DATABASE();

-- marital_status
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'marital_status') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN marital_status VARCHAR(20) NULL AFTER monthly_expense'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- education_level
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'education_level') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN education_level VARCHAR(30) NULL AFTER marital_status'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- occupation
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'occupation') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN occupation VARCHAR(30) NULL AFTER education_level'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employer_category
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'employer_category') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN employer_category VARCHAR(30) NULL AFTER occupation'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- years_employed
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'years_employed') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN years_employed INT NULL AFTER employer_category'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

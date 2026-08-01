-- Migration 005: applicant-declared fields on loan_applications.
--
-- Previously, mlClient.service.js hardcoded ~25 of the 35 model inputs
-- (marital status, employment detail, existing-loan/default history, and the
-- entire CRIB/guarantor block) to fixed neutral constants for every
-- applicant, because none of that data had a source. This migration adds
-- nullable columns so a customer can optionally self-declare the fields that
-- are realistically self-reportable at application time; anything left NULL
-- still falls back to the existing neutral defaults in mlClient.service.js.
--
-- All columns are nullable and additive — existing rows are unaffected.
--
-- Idempotent via a guarded dynamic ALTER per column (checks
-- information_schema.COLUMNS first). Plain `ADD COLUMN IF NOT EXISTS` is a
-- MariaDB-only extension — vanilla MySQL 8.0 rejects that syntax — so this
-- uses PREPARE/EXECUTE instead, which works on both.

USE ai_loan;

SET @schema := DATABASE();

-- marital_status
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'marital_status') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN marital_status VARCHAR(20) NULL AFTER purpose'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- education_level
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'education_level') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN education_level VARCHAR(30) NULL AFTER marital_status'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- occupation
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'occupation') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN occupation VARCHAR(30) NULL AFTER education_level'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employer_category
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'employer_category') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN employer_category VARCHAR(30) NULL AFTER occupation'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- years_employed
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'years_employed') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN years_employed INT NULL AFTER employer_category'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- additional_income
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'additional_income') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN additional_income DECIMAL(12,2) NULL AFTER years_employed'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- existing_loans
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'existing_loans') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN existing_loans INT NULL AFTER additional_income'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- previous_defaults
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'previous_defaults') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN previous_defaults INT NULL AFTER existing_loans'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- crib_score
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'crib_score') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN crib_score INT NULL AFTER previous_defaults'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- guarantor_exposure
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'guarantor_exposure') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN guarantor_exposure DECIMAL(14,2) NULL AFTER crib_score'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- guarantor_defaults
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'guarantor_defaults') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN guarantor_defaults INT NULL AFTER guarantor_exposure'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

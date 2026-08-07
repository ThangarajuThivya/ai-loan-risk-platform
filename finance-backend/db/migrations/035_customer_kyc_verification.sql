-- Migration 035: customer KYC verification (E2).
--
-- customer_profiles has no identity-number column today. This adds one
-- (national_id) plus a small verification trail — same
-- pending/verified/rejected + verified_by/verified_at/notes shape already
-- used by collateral_items (033) and loan_application_documents (034).
--
-- kyc_status stays NULL until a customer actually provides an NIC (see
-- user.controller.js#updateProfile) — there's nothing to review before
-- that, so a distinct "unverified" enum value would be redundant with NULL.
--
-- E2 is advisory only, same as E1: kyc_status is visible context for staff
-- and the customer, but nothing in applicationStatus.service.js or
-- creditPolicy.service.js reads it.
--
-- Idempotent via a guarded dynamic ALTER per column (checks
-- information_schema.COLUMNS first), same pattern as
-- 005_application_declared_fields.sql. All columns nullable and additive —
-- existing rows are unaffected.

USE ai_loan;

SET @schema := DATABASE();

-- national_id
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'national_id') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN national_id VARCHAR(20) NULL AFTER gender'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- kyc_status
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'kyc_status') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN kyc_status ENUM(''pending'',''verified'',''rejected'') NULL DEFAULT NULL AFTER national_id'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- kyc_verified_by
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'kyc_verified_by') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN kyc_verified_by INT NULL AFTER kyc_status'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- kyc_verified_at
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'kyc_verified_at') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN kyc_verified_at TIMESTAMP NULL AFTER kyc_verified_by'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- kyc_notes
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'customer_profiles' AND column_name = 'kyc_notes') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD COLUMN kyc_notes VARCHAR(500) NULL AFTER kyc_verified_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK for kyc_verified_by, guarded the same way information_schema-checked
-- guards handle columns — checked via information_schema.KEY_COLUMN_USAGE so
-- re-running this file never tries to add the same constraint twice.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
    WHERE table_schema = @schema AND table_name = 'customer_profiles'
      AND column_name = 'kyc_verified_by' AND referenced_table_name = 'users') > 0,
  'SELECT 1',
  'ALTER TABLE customer_profiles ADD CONSTRAINT fk_customer_profiles_kyc_verified_by FOREIGN KEY (kyc_verified_by) REFERENCES users(user_id) ON DELETE SET NULL'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

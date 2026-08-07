-- Migration 039: bank_accounts — the customer's account AT THIS BANK.
--
-- Supersedes the customer-typed beneficiary fields added in 038.
--
-- 038 modelled "where does a disbursement go" as three free-text columns on
-- customer_profiles that the CUSTOMER types. On a single-bank platform that
-- is backwards, and it dead-ended the product: an approved, accepted loan
-- could not be disbursed because the applicant had never been told to fill
-- in a profile form nothing links to. Worse, a typed account number is
-- unverifiable by construction — beneficiaryAccount.service.js says so in
-- its own header (validation is format-only, Sri Lanka has no IBAN and no
-- universal checksum).
--
-- The account number is issued BY THE BANK, not declared by the customer.
-- This system IS that bank, so it must own the account. Two situations, and
-- bankAccountModel.findOrOpenWithin resolves both inside the same
-- transaction as the offer acceptance, so there is no third outcome:
--
--   customer already has an account here  -> reused, nothing created
--   customer has no account               -> one is opened, number issued
--
-- A person who banks at a branch but is unknown to this platform would look
-- like the second case and get a duplicate. Staff close that gap by
-- registering the real account (opened_via='staff_registered') from the
-- admin customer record — they are the ones who can check it against core
-- banking, so nothing unverified ever becomes a disbursement destination.
--
-- account_number follows the loan_accounts.account_no / fx_exchange_requests
-- .reference_no pattern: NULL immediately after INSERT, then set inside the
-- same transaction to <4-digit branch code><6-digit zero-padded id>. Deriving
-- the sequence from the real key makes collisions structurally impossible,
-- with no separate counter to drift. MySQL allows multiple NULLs under a
-- UNIQUE key, so uk_bank_accounts_number still holds during that window.
-- Ten digits also keeps the existing ACCOUNT_NUMBER_PATTERN (^[0-9]{6,20}$)
-- valid, so every current validator keeps working unchanged.
--
-- No branch dimension is introduced. Branch is free text everywhere else in
-- this schema (fx_exchange_requests.branch, 008 line 59) and migration 015
-- explicitly ruled normalizing it out of scope; a branches table is not
-- arriving as a side effect of this change.
--
-- customer_profiles.beneficiary_* stays in the schema (no data loss — it is
-- backfilled below) but stops being read or written. loan_accounts
-- .beneficiary_* is unchanged: still the disbursement-time snapshot, just
-- sourced from here now.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS plus an INSERT IGNORE
-- ... WHERE NOT EXISTS backfill, safe to re-run.

USE ai_loan;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  -- NULL only between INSERT and the follow-up UPDATE in one transaction
  -- (see header). Never NULL once findOrOpenWithin returns.
  account_number  VARCHAR(20) NULL,
  branch          VARCHAR(100) NOT NULL,
  -- Snapshotted from users.first_name/last_name at opening. A later name
  -- change does not retroactively rewrite whose account this was opened as.
  account_holder  VARCHAR(150) NOT NULL,
  account_type    ENUM('savings','loan_disbursement') NOT NULL DEFAULT 'loan_disbursement',
  status          ENUM('active','closed') NOT NULL DEFAULT 'active',
  -- How this row came to exist. 'staff_registered' covers both an account
  -- opened at a branch before this platform knew about it and the 038
  -- backfill below.
  opened_via      ENUM('auto_offer_acceptance','staff_registered') NOT NULL,
  opened_by       INT NULL,
  opened_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (opened_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uk_bank_accounts_number (account_number),
  KEY idx_bank_accounts_user_status (user_id, status)
);

-- Backfill from 038. Any customer who already typed a COMPLETE beneficiary
-- account keeps it — it becomes a staff_registered row rather than being
-- discarded, so nobody who filled that form in gets a surprise second
-- account issued to them at their next offer acceptance.
--
-- The completeness test mirrors beneficiaryAccount.isCompleteBeneficiaryAccount
-- (all three present, account number 6-20 digits). Re-runnability comes from
-- uk_bank_accounts_number + INSERT IGNORE: a second run tries to insert the
-- exact same account_number and is silently skipped. The same IGNORE absorbs
-- the (pathological) case of two customers having typed one number.
INSERT IGNORE INTO bank_accounts
  (user_id, account_number, branch, account_holder, account_type, status, opened_via)
SELECT cp.user_id,
       TRIM(cp.beneficiary_account_number),
       TRIM(cp.beneficiary_branch),
       TRIM(cp.beneficiary_account_holder),
       'savings',
       'active',
       'staff_registered'
  FROM customer_profiles cp
 WHERE TRIM(COALESCE(cp.beneficiary_branch, '')) <> ''
   AND TRIM(COALESCE(cp.beneficiary_account_holder, '')) <> ''
   AND TRIM(COALESCE(cp.beneficiary_account_number, '')) REGEXP '^[0-9]{6,20}$';

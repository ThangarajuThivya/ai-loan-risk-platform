-- Migration 044: leasing reference data — the approved dealer and valuer
-- registers.
--
-- These two are standing counterparties, not per-application facts: they
-- exist independently of any lease the way loan_products exist independently
-- of any loan. They are therefore the one part of the leasing module with no
-- dependency on the lease entity spine (045), and are kept in their own
-- migration for that reason.
--
-- NEITHER REGISTER SUPPORTS DELETION, only suspension. A dealer is referenced
-- by the vehicles they supplied and a valuer by the valuations they signed,
-- and both have to stay answerable years after the commercial relationship
-- ends — the same reasoning that makes guarantors (033) undeletable.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS. Additive only.

USE ai_loan;

-- ---------------------------------------------------------------------------
-- Approved dealers.
--
-- Curated by admin rather than typed free-hand per application: this is the
-- counterparty the institution wires real money to when it buys the vehicle,
-- so the bank account below has to be a vetted record, not something an
-- applicant can influence. Same reasoning as bank_accounts (039) being
-- issued rather than declared.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_suppliers (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(150) NOT NULL,
  business_reg_no  VARCHAR(50) NULL,
  contact_person   VARCHAR(150) NULL,
  phone            VARCHAR(20) NULL,
  email            VARCHAR(150) NULL,
  address          TEXT NULL,
  -- Where the purchase payment goes. Nullable because a dealer can be
  -- registered before their banking details are collected, but the payout
  -- step must refuse to pay one that still has them missing.
  bank_name        VARCHAR(100) NULL,
  bank_branch      VARCHAR(100) NULL,
  bank_account_no  VARCHAR(30) NULL,
  account_holder   VARCHAR(150) NULL,
  status           ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_by       INT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lease_suppliers_name (name),
  KEY idx_lease_suppliers_status (status),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Approved valuers.
--
-- A valuation is only worth anything if the valuer is independent and
-- accountable, so they are a registered party with a licence number rather
-- than a name typed into the valuation row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_valuers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  license_no  VARCHAR(50) NULL,
  phone       VARCHAR(20) NULL,
  email       VARCHAR(150) NULL,
  status      ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_by  INT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lease_valuers_name_license (name, license_no),
  KEY idx_lease_valuers_status (status),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

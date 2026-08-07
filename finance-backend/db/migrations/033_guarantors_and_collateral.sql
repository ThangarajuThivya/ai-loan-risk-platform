-- Migration 033: guarantors and collateral_items — dedicated relational
-- entities for who is backing a loan and with what (D5), replacing free-text
-- self-declaration with structured, queryable records.
--
-- WHAT THIS IS NOT: the existing loan_applications.guarantor_exposure /
-- guarantor_defaults columns (005) describe a DIFFERENT fact — whether the
-- APPLICANT is themselves acting as guarantor for someone ELSE's loan
-- (outside this system, genuinely only self-declarable, same as CRIB
-- score). This migration is the opposite direction: WHO is backing THIS
-- applicant's OWN loan, and with what security. The two columns from 005
-- are untouched and keep their existing meaning.
--
-- WHY A SEPARATE guarantors TABLE, KEYED BY NIC, RATHER THAN A users FK:
-- a guarantor is very often not a registered customer of this institution
-- at all — a relative or employer vouching for the applicant. Keying by
-- National Identity Card number (nic, UNIQUE) is what makes "exposure
-- tracking" a real, computable fact rather than a per-application number:
-- the SAME person guaranteeing three different applications is recognised
-- as one row here, so their combined outstanding exposure and the
-- reliability of their other guarantees can be summed and checked — see
-- loanModel.findGuarantorExposureByNic and creditPolicy.service.js's new
-- GUARANTOR_RELIABILITY rule, which reads exactly that.
--
-- loan_guarantors is the junction: one guarantor can back many applications,
-- one application can have more than one guarantor (the customer-facing
-- apply form currently offers one; the schema does not restrict it, so
-- staff can add more later without a migration). guaranteed_amount is
-- capped at the requested amount by application-layer validation, not by a
-- DB constraint — a partial guarantee (backing less than the full loan) is
-- legitimate and common.
--
-- collateral_items is application-scoped (not account-scoped): the
-- disclosure happens at application time, and a loan_accounts row doesn't
-- exist until drawdown, well after underwriting needs to see it.
-- verification_status starts 'self_declared' and only becomes 'verified'
-- when staff confirm it — mirrors the self-declared/neutral-default
-- distinction D1 already draws for CRIB score: unverified collateral must
-- never be trusted at face value by the credit policy engine (see
-- COLLATERAL_COVERAGE). ownership_reference is a free-text pointer (deed
-- number, vehicle registration, FD account number) — NOT a document upload;
-- actual file evidence is E1's scope (secure document management), not D5's.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, matching every migration
-- in this series. Additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS guarantors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nic         VARCHAR(20) NOT NULL,
  full_name   VARCHAR(150) NOT NULL,
  phone       VARCHAR(20) NULL,
  address     TEXT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_guarantors_nic (nic)
);

CREATE TABLE IF NOT EXISTS loan_guarantors (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  application_id            INT NOT NULL,
  guarantor_id              INT NOT NULL,
  -- Free text ("Spouse", "Employer", "Friend"...) — not an enum. Real
  -- relationships in this context don't cluster into a short fixed list the
  -- way, say, employment_type does, and forcing one would just push
  -- everything atypical into an "Other" bucket that says nothing.
  relationship_to_applicant VARCHAR(50) NULL,
  guaranteed_amount         DECIMAL(14,2) NOT NULL,
  status                    ENUM('active','released') NOT NULL DEFAULT 'active',
  added_by                  INT NULL,
  added_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  released_at               TIMESTAMP NULL,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  -- No CASCADE on guarantor_id: a guarantor row is a shared person record,
  -- reused across applications, and is never deleted by application code —
  -- there is deliberately no delete-guarantor endpoint.
  FOREIGN KEY (guarantor_id) REFERENCES guarantors(id),
  FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE SET NULL,
  -- One row per (application, guarantor) — re-adding the same person edits
  -- their existing row (e.g. the guaranteed amount) rather than duplicating.
  UNIQUE KEY uq_loan_guarantors_application_guarantor (application_id, guarantor_id),
  KEY idx_loan_guarantors_guarantor (guarantor_id, status)
);

CREATE TABLE IF NOT EXISTS collateral_items (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  application_id      INT NOT NULL,
  collateral_type     ENUM('property','vehicle','gold_jewellery','fixed_deposit','other') NOT NULL,
  description         TEXT NULL,
  estimated_value     DECIMAL(14,2) NOT NULL,
  valuation_date      DATE NULL,
  ownership_reference VARCHAR(255) NULL,
  verification_status ENUM('self_declared','verified','rejected') NOT NULL DEFAULT 'self_declared',
  verified_by         INT NULL,
  verified_at         TIMESTAMP NULL,
  status              ENUM('pledged','released') NOT NULL DEFAULT 'pledged',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_collateral_items_application (application_id)
);

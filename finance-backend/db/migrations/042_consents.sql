-- Migration 042: consent management (J1).
--
-- Two things this system does to a customer's personal data require their
-- explicit, provable agreement first: pulling their CRIB/credit bureau
-- record, and processing their personal data at all (KYC documents, income,
-- employment, guarantor details, everything the application wizard and
-- profile collect). Regulators and auditors don't accept "the UI had a
-- checkbox" as proof — they want WHO agreed, to WHAT (which policy text, by
-- version), and WHEN.
--
-- user_consents is append-only and immutable — a policy accepted on
-- 2026-08-07 must still read exactly that way in 2027 even if the policy
-- text changes tomorrow and the customer re-consents. That is why this is
-- an audit log (INSERT only, never UPDATE), not a single row per user that
-- gets overwritten, and why policy_version is copied onto every row rather
-- than looked up live: "what did they agree to AT THE TIME" must survive
-- the policy being edited later.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS user_consents (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  -- Kept open-ended (not a hardcoded pair) so a future consent requirement
  -- (e.g. marketing communications) is a new enum value, not a new table.
  consent_type   ENUM('data_processing','credit_bureau_check') NOT NULL,
  -- The policy text version the user actually saw and agreed to — see
  -- consent.service.js CONSENT_POLICIES. Never recomputed from "current".
  policy_version VARCHAR(20) NOT NULL,
  -- Always 1 today (this is a grant log, not a withdrawal log), but kept as
  -- a real column rather than assumed, since "consent was revoked" is a
  -- fact this table should be able to represent without a schema change.
  granted        TINYINT(1) NOT NULL DEFAULT 1,
  ip_address     VARCHAR(45) NULL,
  user_agent     VARCHAR(255) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  KEY idx_user_consents_lookup (user_id, consent_type, created_at)
);

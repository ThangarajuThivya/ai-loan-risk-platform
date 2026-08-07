-- Migration 023: loan_offers — approval terms the applicant can accept or decline.
--
-- Until now, "approved" meant a status flag and nothing else. The system
-- computed a recommended_amount/recommended_emi that could differ from what
-- the customer asked for (see recommendation.service.js buildRecommendation),
-- but there was no record of what terms were actually approved, and no way
-- for the applicant to agree to them. Staff clicked Approve and the next
-- legal move was straight to disbursed — money out the door on terms nobody
-- had signed off.
--
-- A real facility works: credit decision → offer letter with final terms and
-- an expiry → applicant accepts or declines → drawdown. This table is the
-- offer letter.
--
-- EVERY commercial term is SNAPSHOTTED here rather than read back through
-- loan_products at display time — the same reasoning as
-- fx_exchange_requests.spread_bps_applied / rate_source (008): re-pricing a
-- product next month must not silently rewrite the terms of an offer already
-- sitting in someone's inbox, and must not change what an accepted loan
-- costs. rate_type is snapshotted for the same reason and because it selects
-- the EMI formula itself (recommendation.service.js computeEmiForRateType) —
-- a flat-rate offer re-rendered as reducing-balance would understate the
-- instalment.
--
-- offered_emi is likewise stored, not derived on read: it is the number the
-- applicant agreed to pay, so it must survive any future change to the EMI
-- code. It is always computed server-side on issue and never accepted from
-- a client.
--
-- STATUS lifecycle (independent of, but coupled to, loan_applications.status
-- — see src/services/applicationStatus.service.js):
--
--   pending ──► accepted     applicant accepts; application → 'accepted'
--           ├─► declined     applicant declines; application → 'withdrawn'
--           ├─► expired      passed expires_at un-actioned (offerExpiry sweep)
--           └─► superseded   staff issued a replacement offer
--
-- Only ONE offer per application may be 'pending' at a time; issuing a new
-- one supersedes the incumbent inside the same transaction (see
-- loanModel.createOffer). That invariant is enforced in application code
-- rather than by a partial unique index because MySQL 8.0 has no filtered
-- indexes, and a plain UNIQUE(application_id, status) would also forbid two
-- 'superseded' rows, which is a legitimate history.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS loan_offers (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  application_id        INT NOT NULL,
  -- Snapshotted commercial terms (see header note).
  offered_amount        DECIMAL(14,2) NOT NULL,
  offered_tenure_months INT NOT NULL,
  offered_interest_rate DECIMAL(5,2) NOT NULL,
  rate_type             ENUM('reducing','flat') NOT NULL DEFAULT 'reducing',
  offered_emi           DECIMAL(14,2) NOT NULL,
  -- Staff's covering note on the offer, shown to the applicant. Distinct
  -- from loan_applications.decision_note (019), which is the internal
  -- credit-decision rationale.
  offer_note            TEXT NULL,
  status                ENUM('pending','accepted','declined','expired','superseded')
                          NOT NULL DEFAULT 'pending',
  offered_by            INT NULL,
  offered_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at            TIMESTAMP NOT NULL,
  -- Set when the applicant accepts or declines.
  responded_at          TIMESTAMP NULL,
  response_note         TEXT NULL,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (offered_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_loan_offers_application (application_id, offered_at),
  -- Drives the background expiry sweep (offerExpiry.service.js).
  KEY idx_loan_offers_status_expires (status, expires_at)
);

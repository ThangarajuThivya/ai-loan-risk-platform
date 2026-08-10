-- Migration 049: card payment of monthly rentals by the lessee.
--
-- 046 gave the lessee a way to pay their DOWN PAYMENT by card, but rentals
-- could only be keyed in by staff. That left the lessee unable to pay the
-- thing they owe every month for five years, which is the payment that
-- actually matters — a down payment happens once, a rental happens sixty
-- times.
--
-- This is the rental counterpart of `lease_down_payment_intents`, and is a
-- SEPARATE table rather than a `kind` column on that one, for the same
-- reason the two ledgers are separate: a down payment settles into
-- `lease_down_payments` against an APPLICATION, a rental settles into
-- `lease_rentals` against an AGREEMENT. One table would need two nullable
-- foreign keys and a check constraint to say "exactly one of these", which
-- is a worse description of the world than two tables that each mean one
-- thing.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS. Additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS lease_rental_intents (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  agreement_id         INT NOT NULL,
  lessee_id            INT NOT NULL,

  -- What the SERVER decided to charge, fixed at the moment the session was
  -- opened. Settlement re-reads this rather than recomputing, so a schedule
  -- that moves while the lessee is on the gateway's page cannot silently
  -- change what they agreed to pay.
  amount               DECIMAL(14,2) NOT NULL,
  currency             VARCHAR(3) NOT NULL DEFAULT 'LKR',

  -- Which kind of payment this was a request for. Recorded because
  -- "settle the lease" and "pay one rental" are different acts with
  -- different consequences, and the intent is the only place that
  -- distinction survives if the amounts happen to coincide.
  payment_kind         ENUM('rental','arrears','settlement','custom') NOT NULL DEFAULT 'rental',

  provider             ENUM('stripe') NOT NULL DEFAULT 'stripe',
  provider_session_id  VARCHAR(255) NULL,
  provider_payment_ref VARCHAR(255) NULL,

  status               ENUM('created','succeeded','failed','expired','cancelled')
                         NOT NULL DEFAULT 'created',

  -- The rental row this became, once the money was posted. NULL until then,
  -- and permanently NULL on a payment that arrived but could not be applied
  -- — which is how a refund owed is discovered.
  rental_id            INT NULL,
  failure_reason       VARCHAR(255) NULL,

  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at         TIMESTAMP NULL,

  -- THE EXACTLY-ONCE GATE, in the schema rather than only in code. A
  -- retried webhook racing the return page cannot produce two rentals from
  -- one session even if both transactions somehow pass the status check.
  UNIQUE KEY uk_lri_session (provider_session_id),
  UNIQUE KEY uk_lri_rental (rental_id),
  KEY idx_lri_agreement_status (agreement_id, status),
  KEY idx_lri_lessee (lessee_id),

  CONSTRAINT fk_lri_agreement FOREIGN KEY (agreement_id)
    REFERENCES lease_agreements(id) ON DELETE CASCADE,
  CONSTRAINT fk_lri_lessee FOREIGN KEY (lessee_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_lri_rental FOREIGN KEY (rental_id)
    REFERENCES lease_rentals(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

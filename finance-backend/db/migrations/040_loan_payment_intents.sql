-- Migration 040: customer-initiated repayments through a payment gateway.
--
-- 027 built the repayment ledger and 026 the schedule, but every payment in
-- this system is keyed in by STAFF (loan.controller.js recordPayment, whose
-- header states the rule: "a repayment is a fact the bank observes, not one
-- the borrower asserts"). Borrowers can see what they owe and nothing more.
--
-- That rule is kept, not broken. A card payment confirmed by the gateway is
-- still the bank observing money arrive — via a signed webhook — rather than
-- the customer asserting they paid. What changes is only WHO can start the
-- payment, never who confirms it.
--
-- loan_payment_intents is the lifecycle of one payment ATTEMPT: created when
-- the customer is sent to the gateway, settled when the gateway confirms.
-- It exists to solve exactly one hard problem — recording the payment
-- EXACTLY ONCE:
--
--   TWICE is the real danger. Gateways retry webhooks for days, and the
--   return-to-site redirect can also arrive first. Both paths call the same
--   settle function, which locks the intent row and refuses to act unless
--   status is still 'created'. uk_lpi_payment then makes a second payment
--   from one intent impossible at the SCHEMA level too, the same way
--   uq_loan_accounts_application (025) makes double-drawdown impossible
--   regardless of what the application code does.
--
--   ZERO is the other failure. A lost webhook would strand a paid customer
--   with an unpaid loan, so the return page can also reconcile: it asks the
--   gateway directly whether the session was paid and settles it through the
--   same gate. Belt and braces, one code path.
--
-- amount is stored because the SERVER decides it (from the schedule, via
-- repaymentQuote.service.js) and the client never supplies it. Keeping the
-- quoted figure here means the webhook can confirm the gateway charged what
-- we actually asked for, instead of trusting whatever comes back.
--
-- Failed/expired/cancelled attempts are kept rather than deleted: "this
-- customer tried three times and the card kept declining" is support-desk
-- context, and an abandoned checkout is not an error to be hidden.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS plus a guarded ENUM widen,
-- additive only. Drops nothing.

USE ai_loan;

SET @schema := DATABASE();

CREATE TABLE IF NOT EXISTS loan_payment_intents (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  account_id           INT NOT NULL,
  -- Denormalised borrower, same reasoning as loan_accounts.user_id (025):
  -- an account's owner never changes, and it lets the ownership check on the
  -- polling endpoint be a single-table read.
  user_id              INT NOT NULL,
  -- What the SERVER quoted. Never supplied by the client — see header.
  amount               DECIMAL(14,2) NOT NULL,
  -- The currency actually charged, which is not necessarily LKR: a test
  -- gateway account may not support LKR presentment, so it is configurable
  -- (STRIPE_CURRENCY). Recorded per intent so a historical payment always
  -- says what it was really charged in.
  currency             VARCHAR(3) NOT NULL,
  -- Mirrors loan_payments.payment_type — a settlement must stay
  -- distinguishable from an instalment all the way through the gateway,
  -- because the interest waiver depends on it.
  payment_type         ENUM('installment','settlement') NOT NULL DEFAULT 'installment',
  provider             ENUM('stripe') NOT NULL DEFAULT 'stripe',
  -- The gateway's checkout session id. UNIQUE: this is the idempotency key
  -- that a retried webhook collides on.
  provider_session_id  VARCHAR(255) NULL,
  -- The gateway's own payment id, for reconciling against their dashboard.
  provider_payment_ref VARCHAR(255) NULL,
  status               ENUM('created','succeeded','failed','expired','cancelled')
                         NOT NULL DEFAULT 'created',
  -- Set only once real money has been recorded. NULL means nothing was ever
  -- posted to the ledger for this attempt.
  payment_id           INT NULL,
  failure_reason       VARCHAR(255) NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at         TIMESTAMP NULL,
  UNIQUE KEY uk_lpi_session (provider_session_id),
  -- One attempt can produce at most one payment. Enforced here so it holds
  -- even if the settle gate were bypassed or raced.
  UNIQUE KEY uk_lpi_payment (payment_id),
  KEY idx_lpi_account_status (account_id, status),
  KEY idx_lpi_user (user_id),
  FOREIGN KEY (account_id) REFERENCES loan_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(user_id)    ON DELETE CASCADE,
  -- SET NULL rather than CASCADE: deleting a payment must not erase the
  -- record that an attempt was made.
  FOREIGN KEY (payment_id) REFERENCES loan_payments(id) ON DELETE SET NULL
);

-- loan_payments.method gains 'card'. A gateway payment is none of the five
-- existing values, and calling it 'other' would make self-service payments
-- indistinguishable from miscellaneous branch receipts in every report.
--
-- Widening an ENUM is additive — existing rows keep their value and meaning.
-- Guarded on the current column definition so a re-run is a no-op.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_payments'
      AND column_name = 'method' AND COLUMN_TYPE LIKE '%card%') > 0,
  'SELECT 1',
  'ALTER TABLE loan_payments MODIFY COLUMN method
     ENUM(''cash'',''bank_transfer'',''cheque'',''standing_order'',''card'',''other'')
     NOT NULL DEFAULT ''cash'''
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

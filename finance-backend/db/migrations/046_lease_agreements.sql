-- Migration 046: the lease entity spine, part 2 — quotation, agreement,
-- rentals, money and title.
--
-- 045 covers everything up to a credit decision. This covers what happens
-- after one, and it is where a lease diverges from a loan most sharply:
--
--   * The lessee pays a DOWN PAYMENT before anything is bought, so the
--     money moves in two directions before the asset even exists on our
--     books. A loan has no equivalent step.
--   * The institution PAYS THE DEALER, not the lessee. A loan credits the
--     borrower's own account (039); a lease buys a vehicle.
--   * The institution then OWNS that vehicle. The CR names it as absolute
--     owner and the lessee only as registered user, until the final rental
--     is paid and a letter of release is issued.
--
-- Sequence, and each step's precondition:
--
--   quotation issued
--     -> lessee accepts          (quotation.status = accepted)
--     -> agreement signed        (requires an accepted quotation)
--     -> down payment settled    (requires a signed agreement)
--     -> dealer paid             (requires the down payment settled)
--     -> CR registered           (requires the dealer paid)
--     -> rentals collected       (agreement active)
--     -> final rental
--     -> release letter issued
--     -> title transferred at the DMT; the lease ends
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS. Additive only.

USE ai_loan;

-- ---------------------------------------------------------------------------
-- 1. Quotation — the offer of lease terms.
--
-- The lease counterpart of loan_offers (023), and reissuable for the same
-- reason: terms get renegotiated, and each round is a fresh quote with its
-- own figures rather than an edit that erases what was previously offered.
--
-- Everything here is SNAPSHOTTED, including vehicle_price. A later
-- correction to lease_vehicles.invoice_price must not silently rewrite what
-- was quoted, or the down payment the lessee agreed to stops reconciling
-- against the price it was a percentage of.
--
-- down_payment_percent is kept alongside the amount because the percentage
-- is the thing that was actually decided (policy is written in percentages),
-- and re-deriving it from a rounded amount would not reproduce it exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_quotations (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  application_id        INT NOT NULL,
  -- The price this quote was built against.
  vehicle_price         DECIMAL(14,2) NOT NULL,
  down_payment_amount   DECIMAL(14,2) NOT NULL,
  down_payment_percent  DECIMAL(5,2) NOT NULL,
  -- vehicle_price − down_payment_amount. What the lease finances and what
  -- the rental is calculated on.
  financed_amount       DECIMAL(14,2) NOT NULL,
  term_months           INT NOT NULL,
  interest_rate         DECIMAL(5,2) NOT NULL,
  rate_type             ENUM('flat','reducing') NOT NULL DEFAULT 'flat',
  monthly_rental        DECIMAL(14,2) NOT NULL,
  -- monthly_rental × term_months. The total the lessee pays in rentals,
  -- which is NOT their total cost — that also includes the down payment.
  total_rentals         DECIMAL(14,2) NOT NULL,
  quotation_note        TEXT NULL,
  status                ENUM('pending','accepted','declined','expired','superseded')
                          NOT NULL DEFAULT 'pending',
  quoted_by             INT NULL,
  quoted_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at            TIMESTAMP NOT NULL,
  responded_at          TIMESTAMP NULL,
  response_note         TEXT NULL,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (quoted_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_lease_quotations_application (application_id, quoted_at),
  -- Drives the background expiry sweep.
  KEY idx_lease_quotations_status_expires (status, expires_at)
);

-- ---------------------------------------------------------------------------
-- 2. Quotation fees.
--
-- Documentation, inspection and government stamp duty. Follows the split
-- loan_offer_fees (041) established: the quotation stays the commercial
-- quote and each fee line hangs off it, resolved and snapshotted at quote
-- time so a later change to the fee schedule cannot rewrite history.
--
-- Fees are DEDUCTED FROM THE DOWN PAYMENT SETTLEMENT, not capitalised into
-- the financed amount — so they change what the lessee hands over up front,
-- never the rental or the amount owed. That containment is deliberate and
-- keeps the rental schedule a pure function of the financed amount.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_quotation_fees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id   INT NOT NULL,
  fee_type       ENUM('documentation','vehicle_inspection','stamp_duty',
                      'credit_life_insurance','other') NOT NULL,
  label          VARCHAR(100) NOT NULL,
  calc_method    ENUM('percentage','fixed') NOT NULL,
  -- The configuration as it stood, for audit.
  rate_or_amount DECIMAL(12,2) NOT NULL,
  -- The resolved LKR charge.
  amount         DECIMAL(12,2) NOT NULL,
  waived         TINYINT(1) NOT NULL DEFAULT 0,
  waived_by      INT NULL,
  waived_reason  VARCHAR(500) NULL,
  FOREIGN KEY (quotation_id) REFERENCES lease_quotations(id) ON DELETE CASCADE,
  FOREIGN KEY (waived_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uq_lease_quotation_fees_type (quotation_id, fee_type)
);

-- ---------------------------------------------------------------------------
-- 3. The lease agreement.
--
-- The counterpart of loan_accounts (025), and the point at which the
-- institution becomes the OWNER of an asset rather than the creditor of a
-- person. Named `agreement` rather than `account` because that is what it
-- is: a contract under the Finance Leasing Act, signed by both parties.
--
-- Terms are snapshotted from the ACCEPTED quotation and never recomputed —
-- the rental calendar must not shift because a formula changed later.
--
-- status distinguishes the two ways a lease can end badly. `terminated` is
-- an agreement wound up by consent or default without the asset coming
-- back; `repossessed` is the lessor exercising its ownership. A loan has no
-- equivalent of the second, which is precisely the difference this whole
-- module exists to model.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_agreements (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  agreement_no         VARCHAR(20) NULL,
  application_id       INT NOT NULL,
  -- Denormalised lessee. Safe because an application's owner never changes,
  -- and it makes "this customer's leases" a single-table read.
  lessee_id            INT NOT NULL,
  vehicle_id           INT NOT NULL,
  -- Snapshotted from the accepted quotation.
  vehicle_price        DECIMAL(14,2) NOT NULL,
  down_payment_amount  DECIMAL(14,2) NOT NULL,
  financed_amount      DECIMAL(14,2) NOT NULL,
  interest_rate        DECIMAL(5,2) NOT NULL,
  rate_type            ENUM('flat','reducing') NOT NULL DEFAULT 'flat',
  term_months          INT NOT NULL,
  monthly_rental       DECIMAL(14,2) NOT NULL,
  total_rentals        DECIMAL(14,2) NOT NULL,
  signed_at            TIMESTAMP NULL,
  -- Set when the schedule starts running, which is NOT signing: rentals
  -- begin once the vehicle has been bought and registered.
  activated_at         TIMESTAMP NULL,
  first_rental_date    DATE NULL,
  maturity_date        DATE NULL,
  status               ENUM('pending_activation','active','completed',
                            'terminated','repossessed')
                         NOT NULL DEFAULT 'pending_activation',
  closed_at            TIMESTAMP NULL,
  created_by           INT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (lessee_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES lease_vehicles(id),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  -- One agreement per application, enforced at the schema level so a
  -- double-signing is impossible regardless of what application code does
  -- (same guarantee uq_loan_accounts_application gives a loan).
  UNIQUE KEY uq_lease_agreements_application (application_id),
  UNIQUE KEY uq_lease_agreements_no (agreement_no),
  KEY idx_lease_agreements_lessee_status (lessee_id, status)
);

-- ---------------------------------------------------------------------------
-- 4. Rental schedule.
--
-- Counterpart of repayment_schedule (026). The columns are named for what
-- they are in a lease: a rental is not an instalment, and the split below is
-- capital recovery versus finance charge, not principal versus interest.
-- The arithmetic is the same; the words are not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_rental_schedule (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  agreement_id      INT NOT NULL,
  rental_no         INT NOT NULL,
  due_date          DATE NOT NULL,
  opening_balance   DECIMAL(14,2) NOT NULL,
  capital_component DECIMAL(14,2) NOT NULL,
  finance_component DECIMAL(14,2) NOT NULL,
  rental_amount     DECIMAL(14,2) NOT NULL,
  closing_balance   DECIMAL(14,2) NOT NULL,
  rate_type         ENUM('flat','reducing') NOT NULL DEFAULT 'flat',
  status            ENUM('due','partial','paid') NOT NULL DEFAULT 'due',
  late_fee_amount   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  late_fee_paid     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  late_fee_waived   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  FOREIGN KEY (agreement_id) REFERENCES lease_agreements(id) ON DELETE CASCADE,
  UNIQUE KEY uq_lease_rental_schedule_no (agreement_id, rental_no),
  KEY idx_lease_rental_schedule_due (agreement_id, due_date)
);

-- ---------------------------------------------------------------------------
-- 5. Rentals received.
--
-- Counterpart of loan_payments (027). 'settlement' marks an early payoff, so
-- a lease closed early stays distinguishable from one that ran its course —
-- which matters more here than for a loan, because settling a flat-rate
-- lease early triggers a rebate of unearned finance charges
-- (leasing.service.js computeEarlySettlement).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_rentals (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  agreement_id  INT NOT NULL,
  reference_no  VARCHAR(20) NULL,
  amount        DECIMAL(14,2) NOT NULL,
  -- Value date, which is not necessarily when it was keyed in: a Friday
  -- branch deposit recorded on Monday is still a Friday payment, and
  -- arrears must be judged on the former.
  paid_on       DATE NOT NULL,
  method        ENUM('cash','bank_transfer','cheque','standing_order','card','other')
                  NOT NULL DEFAULT 'cash',
  rental_type   ENUM('rental','settlement') NOT NULL DEFAULT 'rental',
  external_ref  VARCHAR(100) NULL,
  note          TEXT NULL,
  recorded_by   INT NULL,
  recorded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agreement_id) REFERENCES lease_agreements(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uq_lease_rentals_reference_no (reference_no),
  KEY idx_lease_rentals_agreement_paid (agreement_id, paid_on)
);

-- ---------------------------------------------------------------------------
-- 6. Down payment received — the ledger.
--
-- APPLICATION-scoped, not agreement-scoped, and that is the whole point: the
-- down payment is a PRECONDITION of the institution buying the vehicle, so
-- it is paid before the dealer is paid, which is before the agreement can be
-- activated.
--
-- One row per receipt, so a down payment settled in two parts (some by card,
-- the rest in cash at a branch) is two rows. What is OWED lives on
-- lease_quotations.down_payment_amount; what has ARRIVED is SUM(amount)
-- here. Settled means the sum has reached the amount.
--
-- recorded_by is NULL for card payments: those are confirmed by the gateway
-- webhook with no member of staff involved. That NULL is the audit trail
-- saying "the institution observed this", not "somebody asserted it".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_down_payments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  lessee_id      INT NOT NULL,
  amount         DECIMAL(14,2) NOT NULL,
  method         ENUM('card','cash','bank_transfer','cheque','other') NOT NULL,
  -- Gateway payment ref, branch receipt number, or bank slip reference.
  reference_no   VARCHAR(100) NULL,
  paid_on        DATE NOT NULL,
  recorded_by    INT NULL,
  notes          VARCHAR(500) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (lessee_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_lease_down_payments_application (application_id),
  KEY idx_lease_down_payments_lessee (lessee_id)
);

-- ---------------------------------------------------------------------------
-- 7. Down payment paid online — the attempt lifecycle.
--
-- A deliberate near-copy of loan_payment_intents (040) rather than a reuse
-- of it. That table is account_id NOT NULL -> loan_accounts, and a down
-- payment is paid before any agreement is active. Widening 040 to make its
-- account nullable would weaken the guarantee that every repayment intent
-- belongs to a real drawn-down loan, in order to serve a payment that is not
-- a repayment and not even a loan.
--
-- The exactly-once design is carried over verbatim, because the failure
-- modes are identical — gateways retry webhooks for days and the return
-- redirect can beat them:
--   TWICE is prevented by uk_ldpi_down_payment at the schema level, on top
--   of a locked status gate in the settle path.
--   ZERO is prevented by the return page reconciling against the gateway
--   through that same gate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_down_payment_intents (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  application_id       INT NOT NULL,
  lessee_id            INT NOT NULL,
  -- What the SERVER quoted, from lease_quotations. Never client-supplied.
  amount               DECIMAL(14,2) NOT NULL,
  currency             VARCHAR(3) NOT NULL,
  provider             ENUM('stripe') NOT NULL DEFAULT 'stripe',
  provider_session_id  VARCHAR(255) NULL,
  provider_payment_ref VARCHAR(255) NULL,
  status               ENUM('created','succeeded','failed','expired','cancelled')
                         NOT NULL DEFAULT 'created',
  -- Set only once money has been posted to the ledger above.
  down_payment_id      INT NULL,
  failure_reason       VARCHAR(255) NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at         TIMESTAMP NULL,
  UNIQUE KEY uk_ldpi_session (provider_session_id),
  UNIQUE KEY uk_ldpi_down_payment (down_payment_id),
  KEY idx_ldpi_application_status (application_id, status),
  KEY idx_ldpi_lessee (lessee_id),
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (lessee_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (down_payment_id) REFERENCES lease_down_payments(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 8. Payment to the dealer.
--
-- The sharpest divergence from lending. An approved loan is credited to the
-- borrower's own bank_accounts row (039); a lease pays the SUPPLIER, because
-- the institution is buying the vehicle. The lessee never touches this money
-- and it never passes through their account.
--
-- The dealer's banking details are snapshotted rather than joined on read,
-- for the same reason quotations snapshot their terms: a dealer changing
-- bank next year must not rewrite where last year's payment went.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_supplier_payouts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  application_id  INT NOT NULL,
  supplier_id     INT NULL,
  amount          DECIMAL(14,2) NOT NULL,
  method          ENUM('bank_transfer','cheque','other') NOT NULL DEFAULT 'bank_transfer',
  reference_no    VARCHAR(100) NULL,
  -- Snapshot of where it was actually sent.
  paid_to_account VARCHAR(30) NULL,
  paid_to_bank    VARCHAR(100) NULL,
  paid_to_holder  VARCHAR(150) NULL,
  paid_on         DATE NOT NULL,
  paid_by         INT NULL,
  notes           VARCHAR(500) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- One payout per application: the vehicle is bought once.
  UNIQUE KEY uq_lease_supplier_payouts_application (application_id),
  KEY idx_lease_supplier_payouts_supplier (supplier_id),
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES lease_suppliers(id),
  FOREIGN KEY (paid_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 9. Registration, hypothecation and release at the DMT.
--
-- The ownership spine, and the reason a lease is not a loan: between
-- registration and release the institution is the ABSOLUTE OWNER of the
-- vehicle and the lessee is merely its registered user.
--
-- A tracked workflow with a reference and a date at each stage, not a single
-- status flag, because every stage is a real interaction with the Department
-- of Motor Traffic that someone will eventually have to evidence:
--
--   not_started    -> nothing lodged yet
--   submitted      -> papers lodged with the DMT (reference + date)
--   registered     -> CR issued naming the lessor as absolute owner
--   release_issued -> final rental paid, letter of release issued
--   transferred    -> lessee is the legal owner; the lease is over
--
-- One row per vehicle, advanced in place: this is the current state of one
-- asset's title, not a log. The per-stage dates are what make the history
-- readable without a separate events table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_registrations (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id          INT NOT NULL,
  status              ENUM('not_started','submitted','registered',
                           'release_issued','transferred')
                        NOT NULL DEFAULT 'not_started',
  cr_number           VARCHAR(50) NULL,
  -- Snapshotted as they appear on the CR. The lessor's registered name can
  -- change over a five-year lease; what was printed must not.
  absolute_owner      VARCHAR(150) NULL,
  registered_user     VARCHAR(150) NULL,
  submitted_at        DATE NULL,
  submitted_reference VARCHAR(100) NULL,
  registered_at       DATE NULL,
  -- The lessee's authority to transfer title into their own name.
  release_letter_no   VARCHAR(50) NULL,
  release_issued_at   DATE NULL,
  transferred_at      DATE NULL,
  transfer_reference  VARCHAR(100) NULL,
  notes               VARCHAR(500) NULL,
  updated_by          INT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vehicle_registrations_vehicle (vehicle_id),
  KEY idx_vehicle_registrations_status (status),
  FOREIGN KEY (vehicle_id) REFERENCES lease_vehicles(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
);

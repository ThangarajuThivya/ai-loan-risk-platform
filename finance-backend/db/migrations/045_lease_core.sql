-- Migration 045: the lease entity spine, part 1 — intake and assessment.
--
-- A FINANCE LEASE IS NOT A LOAN. Under the Finance Leasing Act there is no
-- borrower and no principal: there is a LESSOR who buys and owns the asset,
-- and a LESSEE who pays rentals for its use, with ownership transferring
-- only after the final rental and a letter of release. Leases and loans are
-- separately regulated and separately accounted for.
--
-- This is why leasing gets its own tables rather than a product type on
-- loan_applications. The vocabulary here is deliberate and load-bearing:
--
--     loan word          lease word
--     ---------          ----------
--     borrower           lessee
--     principal          financed_amount
--     instalment         rental
--     tenure             term
--     loan account       lease agreement
--
-- If a column in this spine uses a loan word, that is a bug.
--
-- WHAT IS *NOT* DUPLICATED: the decisioning SERVICES. mlClient.service,
-- creditPolicy.service, gemini.service, stripe.service and consent.service
-- all take arguments rather than reading loan_applications, so a lease is
-- scored and policy-checked by exactly the same code a loan is. Only the
-- tables that RECORD those results are parallel — because those are keyed
-- to loan_applications, and making them polymorphic would mean editing
-- tables the working loan pipeline depends on.
--
-- Part 2 (046) covers quotation, agreement, rentals, money and title.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS. Additive only.

USE ai_loan;

-- ---------------------------------------------------------------------------
-- 1. Lease product catalogue.
--
-- Separate from loan_products for the same reason the whole spine is: these
-- are lease facilities, not credit facilities, and a report of "our lending
-- book" must not silently include them.
--
-- Note there is NO minimum-down-payment column. That policy lives in
-- leasing.service.js keyed to VEHICLE CONDITION (new/reconditioned/used),
-- because it is the age and resale risk of the asset that determines it, not
-- the product. Putting a second copy on the product would create two sources
-- of truth for one rule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_products (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(150) NOT NULL,
  -- Vehicle class this facility is for; drives nothing in code yet, but is
  -- how a real lessor segments its book and its pricing.
  vehicle_class         ENUM('car','van','suv','motorcycle','three_wheeler','commercial','other')
                          NOT NULL DEFAULT 'car',
  min_financed_amount   DECIMAL(14,2) NOT NULL,
  max_financed_amount   DECIMAL(14,2) NOT NULL,
  min_term_months       INT NOT NULL,
  max_term_months       INT NOT NULL,
  -- Leasing is conventionally quoted flat, which is why this defaults the
  -- opposite way to loan_products.
  interest_rate         DECIMAL(5,2) NOT NULL,
  rate_type             ENUM('flat','reducing') NOT NULL DEFAULT 'flat',
  -- Risk-based pricing band, mirroring what 031 added for loans. NULL means
  -- every lessee is quoted the headline rate.
  min_interest_rate     DECIMAL(5,2) NULL,
  max_interest_rate     DECIMAL(5,2) NULL,
  description           TEXT NULL,
  active                TINYINT(1) NOT NULL DEFAULT 1,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lease_products_name (name)
);

-- ---------------------------------------------------------------------------
-- 2. Lease application.
--
-- financed_amount is what the lessee wants financed — the vehicle price
-- MINUS their down payment. It is deliberately not called requested_amount:
-- for a lease the price and the financed amount are two different numbers,
-- and the gap between them IS the down payment. Storing the down payment as
-- a third column would create a way for the three to disagree, so it is
-- derived (lease_vehicles.invoice_price − financed_amount) until a quotation
-- snapshots the agreed figure in 046.
--
-- The declared_* columns mirror loan_applications: the SAME ML model scores
-- a lease, so it needs the same inputs, and they are snapshotted here for
-- the same audit reason — what the model was shown at the time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_applications (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  lessee_id           INT NOT NULL,
  product_id          INT NOT NULL,
  financed_amount     DECIMAL(14,2) NOT NULL,
  term_months         INT NOT NULL,
  -- The application's own lifecycle, which ENDS at accepted/rejected/
  -- withdrawn. What happens afterwards belongs to the agreement (046) and
  -- has its own status — conflating the two is how a "closed" application
  -- ends up meaning three different things.
  status              ENUM('pending','under_review','info_requested','approved',
                           'quoted','accepted','declined','rejected','withdrawn')
                        NOT NULL DEFAULT 'pending',
  -- Snapshotted model inputs (see header).
  marital_status      VARCHAR(30) NULL,
  education_level     VARCHAR(50) NULL,
  occupation          VARCHAR(50) NULL,
  employer_category   VARCHAR(50) NULL,
  years_employed      INT NULL,
  additional_income   DECIMAL(14,2) NULL,
  existing_loans      INT NULL,
  previous_defaults   INT NULL,
  crib_score          INT NULL,
  guarantor_exposure  DECIMAL(14,2) NULL,
  guarantor_defaults  INT NULL,
  -- The rate this application was assessed and quoted at, snapshotted so a
  -- later product re-price cannot rewrite what the verdict was computed
  -- against (same reasoning as loan_applications.priced_interest_rate).
  priced_interest_rate DECIMAL(5,2) NULL,
  decision_note       TEXT NULL,
  decided_by          INT NULL,
  decided_at          TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (lessee_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES lease_products(id),
  FOREIGN KEY (decided_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_lease_applications_lessee (lessee_id, created_at),
  KEY idx_lease_applications_status (status, created_at)
);

-- ---------------------------------------------------------------------------
-- 3. The vehicle.
--
-- One per application: the lessee picks a vehicle and applies to lease THAT
-- vehicle. Changing their mind before approval edits this row rather than
-- adding a second — hence the UNIQUE key.
--
-- condition_type is not a label, it drives behaviour. brand_new skips
-- valuation (a franchise invoice IS the market value); reconditioned and
-- used both require one before approval, and each carries a different
-- minimum down payment and LTV cap in leasing.service.js.
--
-- registration_no is nullable because a brand-new vehicle has not been
-- registered yet — it gets its number at the same DMT visit that records the
-- lessor as absolute owner. Chassis and engine numbers exist from the
-- factory and are the durable identity of the asset.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_vehicles (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  application_id       INT NOT NULL,
  -- NULL means a private seller rather than a registered dealer, which is
  -- legitimate for a used vehicle and handled as a manual payout in 046.
  supplier_id          INT NULL,
  condition_type       ENUM('brand_new','reconditioned','used') NOT NULL,
  make                 VARCHAR(60) NOT NULL,
  model                VARCHAR(80) NOT NULL,
  year_of_manufacture  SMALLINT NOT NULL,
  registration_no      VARCHAR(20) NULL,
  chassis_no           VARCHAR(50) NULL,
  engine_no            VARCHAR(50) NULL,
  fuel_type            ENUM('petrol','diesel','hybrid','electric','other') NULL,
  transmission         ENUM('manual','automatic') NULL,
  mileage_km           INT NULL,
  -- The seller's asking price, from the invoice or quotation. This is what
  -- the lessee wants financed against; it is NOT automatically what the
  -- asset is worth. See vehicle_valuations.
  invoice_price        DECIMAL(14,2) NOT NULL,
  invoice_no           VARCHAR(50) NULL,
  invoice_date         DATE NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lease_vehicles_application (application_id),
  KEY idx_lease_vehicles_supplier (supplier_id),
  KEY idx_lease_vehicles_registration (registration_no),
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES lease_suppliers(id)
);

-- ---------------------------------------------------------------------------
-- 4. Independent valuation.
--
-- Its own table rather than columns on lease_vehicles because a valuation is
-- an EVENT performed by a third party, and a rejected or superseded one is
-- still evidence — a second opinion after a disputed first is exactly what
-- this must record rather than overwrite.
--
-- valuation_amount is what the LEASE_LTV rule tests against, and
-- leasing.service.js deliberately takes the LOWER of it and the invoice
-- price: that single min() catches both an inflated invoice and an inflated
-- valuation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_valuations (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id       INT NOT NULL,
  valuer_id        INT NULL,
  status           ENUM('requested','completed','rejected') NOT NULL DEFAULT 'requested',
  -- NULL until the valuer reports back. A requested-but-unreturned valuation
  -- must never present itself as a value.
  valuation_amount DECIMAL(14,2) NULL,
  valuation_date   DATE NULL,
  report_reference VARCHAR(100) NULL,
  condition_notes  TEXT NULL,
  requested_by     INT NULL,
  requested_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     TIMESTAMP NULL,
  KEY idx_vehicle_valuations_vehicle_status (vehicle_id, status),
  FOREIGN KEY (vehicle_id) REFERENCES lease_vehicles(id) ON DELETE CASCADE,
  FOREIGN KEY (valuer_id) REFERENCES lease_valuers(id),
  FOREIGN KEY (requested_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- 5. Supporting documents.
--
-- Parallel to loan_application_documents rather than shared, because that
-- table is application_id -> loan_applications. The type list is the loan
-- set plus the five artefacts a lease produces, each a distinct legal
-- document: filing them all as 'other' would make "has the valuation report
-- arrived?" unanswerable, and that question gates approval.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_application_documents (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  application_id       INT NOT NULL,
  document_type        ENUM('national_id','payslip','bank_statement',
                            'vehicle_invoice','valuation_report','cr_copy',
                            'lease_agreement','release_letter','other') NOT NULL,
  uploaded_by          INT NULL,
  original_name        VARCHAR(255) NOT NULL,
  storage_path         VARCHAR(500) NOT NULL,
  mime_type            VARCHAR(100) NOT NULL,
  size_bytes           INT NOT NULL,
  verification_status  ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verified_by          INT NULL,
  verified_at          TIMESTAMP NULL,
  verification_notes   VARCHAR(500) NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_lease_application_documents_application (application_id, created_at)
);

-- ---------------------------------------------------------------------------
-- 6. Risk assessment result.
--
-- The SCORE comes from the same model and the same mlClient.service a loan
-- uses — this table only records where it landed. Shape mirrors
-- risk_assessments (002) plus the behavioural snapshot 043 added, so the two
-- books stay comparable in reporting.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_risk_assessments (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  application_id        INT NOT NULL,
  risk_label            INT NOT NULL,
  risk_category         VARCHAR(20) NOT NULL,
  prob_low              DECIMAL(5,4) NOT NULL,
  prob_medium           DECIMAL(5,4) NOT NULL,
  prob_high             DECIMAL(5,4) NOT NULL,
  model_version         VARCHAR(50) NULL,
  -- Frozen alongside the score: what the model was actually shown about this
  -- customer's repayment record at this moment.
  behavioural_snapshot  JSON NULL,
  assessed_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  KEY idx_lease_risk_assessments_application (application_id, id)
);

-- ---------------------------------------------------------------------------
-- 7. Credit-policy verdict.
--
-- Mirrors credit_policy_evaluations (029), plus the two metrics that only
-- exist for a lease: loan-to-value and which figure it was measured against.
--
-- ltv_base_source records whether the LTV denominator came from the invoice
-- or from an independent valuation. Without it, "this lease passed at 70%"
-- is not a reproducible statement — the same percentage means something very
-- different measured against a dealer's paperwork than against a valuer's
-- report.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_policy_evaluations (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  application_id   INT NOT NULL,
  policy_version   VARCHAR(20) NOT NULL,
  outcome          ENUM('pass','refer','decline') NOT NULL,
  reason_codes     VARCHAR(500) NULL,
  dti              DECIMAL(6,4) NULL,
  residual_income  DECIMAL(14,2) NULL,
  age_at_maturity  INT NULL,
  -- Lease-specific.
  ltv              DECIMAL(6,2) NULL,
  ltv_base         DECIMAL(14,2) NULL,
  ltv_base_source  ENUM('invoice','valuation') NULL,
  down_payment_percent DECIMAL(5,2) NULL,
  rules            JSON NOT NULL,
  evaluated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  KEY idx_lease_policy_evaluations_application (application_id, id),
  KEY idx_lease_policy_evaluations_outcome (outcome)
);

-- ---------------------------------------------------------------------------
-- 8. Status audit trail.
--
-- from_status NULL marks the application coming into existence, not a
-- transition between two real statuses — same convention as 022.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lease_application_events (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  from_status    VARCHAR(30) NULL,
  to_status      VARCHAR(30) NOT NULL,
  actor_user_id  INT NULL,
  actor_role     VARCHAR(20) NULL,
  note           TEXT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES lease_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_lease_application_events_application (application_id, created_at)
);

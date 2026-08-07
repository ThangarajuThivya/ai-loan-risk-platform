-- Migration 041: fees & charges, net disbursement (I1).
--
-- Until now a loan cost the borrower principal + interest and nothing else.
-- No processing fee, documentation fee, or credit-life insurance premium
-- existed anywhere — not in the product catalog, not on the offer, not at
-- drawdown. Real lending has all three, and their absence made two numbers
-- quietly wrong:
--
--   * the "total repayable" on every offer/decision letter, derived purely
--     from emi × tenure;
--   * loan_accounts.principal, which doubled as BOTH "what is owed" and
--     "what was handed over" — two different numbers the moment fees exist.
--
-- FEES ARE DEDUCTED FROM THE DISBURSEMENT, NOT CAPITALISED. The borrower is
-- approved for X, repays against X, and receives X minus fees. This is the
-- standard Sri Lankan personal-loan structure, and it is the reason this
-- migration does NOT touch principal, the repayment schedule, the EMI, or
-- the affordability check: fees change what is PAID OUT and what the loan
-- truly COSTS, never what is OWED BACK. Capitalising instead (adding fees
-- to principal) would have rippled through amortization.service.js,
-- repayment.service.js and creditPolicy.service.js and every test around
-- them; that containment was the deciding factor.
--
-- TWO TABLES, config vs snapshot — the same split this schema already uses
-- for loan_products → loan_offers → loan_accounts:
--
--   loan_product_fees — CONFIG. What a product charges. Admin-editable, and
--                       changing it must never alter an offer already made.
--   loan_offer_fees   — SNAPSHOT. What THIS offer actually charged, incl.
--                       the config values as they stood, so a fee quoted in
--                       January is still explainable in June after the
--                       product was re-priced. Same reasoning as
--                       loan_offers snapshotting rate/EMI rather than
--                       reading loan_products live.
--
-- WAIVERS live on the snapshot, not the config: waiving a fee is a decision
-- about ONE customer's offer, not a change to the product. Mirrors the
-- late-fee waiver already on repayment_schedule (028) — waived flag, who
-- did it, and a mandatory reason.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, guarded PREPARE/EXECUTE
-- column adds, and an INSERT ... SELECT ... WHERE NOT EXISTS seed. Additive
-- only; drops nothing.

USE ai_loan;

SET @schema := DATABASE();

CREATE TABLE IF NOT EXISTS loan_product_fees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  product_id     INT NOT NULL,
  fee_type       ENUM('processing','documentation','credit_life_insurance','other') NOT NULL,
  -- Shown to the customer. Held per-fee rather than derived from fee_type so
  -- an admin can word it for their own market ("Documentation & legal") without
  -- a code change or a new enum value.
  label          VARCHAR(100) NOT NULL,
  calc_method    ENUM('percentage','fixed') NOT NULL,
  -- A percent of the approved amount when calc_method='percentage', an
  -- absolute LKR figure when 'fixed'. One column, because a fee is one or
  -- the other and two nullable columns would allow the meaningless state of
  -- both set (or neither).
  rate_or_amount DECIMAL(12,2) NOT NULL,
  -- Floor/ceiling on a PERCENTAGE fee only (a fixed fee is already its own
  -- answer). NULL = uncapped. Real fee schedules almost always cap a
  -- percentage fee at both ends.
  min_amount     DECIMAL(12,2) NULL,
  max_amount     DECIMAL(12,2) NULL,
  -- Deactivate rather than delete: a fee no longer charged still has to be
  -- explainable on the offers that DID charge it.
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- One fee of each type per product. Two "processing" fees on one product
  -- is a data-entry mistake, not a business case.
  UNIQUE KEY uk_product_fee_type (product_id, fee_type),
  KEY idx_product_fees_product (product_id, active),
  FOREIGN KEY (product_id) REFERENCES loan_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS loan_offer_fees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  offer_id       INT NOT NULL,
  fee_type       ENUM('processing','documentation','credit_life_insurance','other') NOT NULL,
  label          VARCHAR(100) NOT NULL,
  -- The config AS IT STOOD when this offer was made (see header). Kept
  -- alongside the resolved `amount` so "2% of 500,000" is still readable
  -- later, not just "10,000".
  calc_method    ENUM('percentage','fixed') NOT NULL,
  rate_or_amount DECIMAL(12,2) NOT NULL,
  -- The resolved LKR charge. ZERO when waived — the row is kept rather than
  -- deleted so the offer still shows what was waived and why.
  amount         DECIMAL(12,2) NOT NULL,
  waived         TINYINT(1) NOT NULL DEFAULT 0,
  waived_by      INT NULL,
  waived_reason  VARCHAR(500) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_offer_fees_offer (offer_id),
  FOREIGN KEY (offer_id) REFERENCES loan_offers(id) ON DELETE CASCADE,
  FOREIGN KEY (waived_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- loan_accounts gains the drawdown snapshot, mirroring how 039 snapshotted
-- the beneficiary account here.
--
-- principal KEEPS ITS EXACT CURRENT MEANING — what is owed and amortised —
-- and net_disbursed_amount carries what was actually paid out. Deliberately
-- two columns rather than overloading one: the repayment schedule is built
-- from principal, and any code that quietly started reading a net figure
-- there would under-amortise the loan.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_accounts'
      AND column_name = 'total_fees_charged') > 0,
  'SELECT 1',
  'ALTER TABLE loan_accounts ADD COLUMN total_fees_charged DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER emi'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- NULL for loans disbursed before this migration — those genuinely have no
-- recorded net figure, and defaulting them to principal would assert a zero
-- fee that was never actually evaluated.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_accounts'
      AND column_name = 'net_disbursed_amount') > 0,
  'SELECT 1',
  'ALTER TABLE loan_accounts ADD COLUMN net_disbursed_amount DECIMAL(14,2) NULL AFTER total_fees_charged'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Seed a realistic default fee schedule for the seeded products (003).
--
-- Without this the feature is invisible until an admin configures six
-- products by hand, which makes it untestable and undemoable on a fresh
-- clone. Figures are typical Sri Lankan retail-lending levels; every one is
-- admin-editable afterwards.
--
-- Matched on product TYPE rather than id so a re-seeded or renumbered
-- catalog still lands correctly. WHERE NOT EXISTS (not INSERT IGNORE) so a
-- re-run is a no-op WITHOUT relying on a unique-key collision — an admin who
-- deliberately deleted a fee should not have it silently restored... and
-- one who never had it gets it once.
-- ---------------------------------------------------------------------------

-- Processing fee — a percentage of the approved amount, capped at both ends.
INSERT INTO loan_product_fees
  (product_id, fee_type, label, calc_method, rate_or_amount, min_amount, max_amount)
SELECT p.id, 'processing', 'Processing fee', 'percentage', f.pct, f.min_amt, f.max_amt
  FROM loan_products p
  JOIN (
    SELECT 'Personal'  AS ptype, 2.00 AS pct,  2500.00 AS min_amt,  50000.00 AS max_amt
    UNION ALL SELECT 'Housing',  1.00,         10000.00,            150000.00
    UNION ALL SELECT 'Leasing',  1.50,          5000.00,            100000.00
    UNION ALL SELECT 'Education',1.00,          2000.00,             25000.00
    UNION ALL SELECT 'Business', 2.00,          5000.00,            100000.00
    UNION ALL SELECT 'Pawning',  1.00,           500.00,             10000.00
  ) f ON f.ptype = p.type
 WHERE NOT EXISTS (
   SELECT 1 FROM loan_product_fees e
    WHERE e.product_id = p.id AND e.fee_type = 'processing'
 );

-- Documentation fee — a flat charge; the paperwork costs the same whatever
-- the loan is worth.
INSERT INTO loan_product_fees
  (product_id, fee_type, label, calc_method, rate_or_amount)
SELECT p.id, 'documentation', 'Documentation fee', 'fixed', f.amt
  FROM loan_products p
  JOIN (
    SELECT 'Personal'  AS ptype, 2000.00 AS amt
    UNION ALL SELECT 'Housing',  7500.00
    UNION ALL SELECT 'Leasing',  5000.00
    UNION ALL SELECT 'Education',1500.00
    UNION ALL SELECT 'Business', 3500.00
  ) f ON f.ptype = p.type
 WHERE NOT EXISTS (
   SELECT 1 FROM loan_product_fees e
    WHERE e.product_id = p.id AND e.fee_type = 'documentation'
 );
-- Pawning deliberately has no documentation fee: it is settled against gold
-- held at the counter, with no documentation pack to prepare.

-- Credit-life insurance — a percentage premium, on the unsecured/long-tenure
-- products where a lender actually requires cover. Not charged on Pawning
-- (secured by the pledged item itself) or Education (typically guarantor-backed).
INSERT INTO loan_product_fees
  (product_id, fee_type, label, calc_method, rate_or_amount, min_amount, max_amount)
SELECT p.id, 'credit_life_insurance', 'Credit life insurance', 'percentage', f.pct, NULL, f.max_amt
  FROM loan_products p
  JOIN (
    SELECT 'Personal' AS ptype, 0.50 AS pct, 25000.00 AS max_amt
    UNION ALL SELECT 'Housing',  0.75,       75000.00
    UNION ALL SELECT 'Leasing',  0.60,       40000.00
    UNION ALL SELECT 'Business', 0.50,       50000.00
  ) f ON f.ptype = p.type
 WHERE NOT EXISTS (
   SELECT 1 FROM loan_product_fees e
    WHERE e.product_id = p.id AND e.fee_type = 'credit_life_insurance'
 );

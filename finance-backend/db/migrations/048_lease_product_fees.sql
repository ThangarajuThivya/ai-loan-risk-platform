-- Migration 048: lease fee configuration.
--
-- 046 created lease_quotation_fees, which SNAPSHOTS what a given quotation
-- actually charged. This is the other half: what a product charges by
-- default, admin-editable, before any quotation exists. Same config-vs-
-- snapshot split 041 established for loans.
--
-- WHAT A PERCENTAGE FEE IS A PERCENTAGE OF: the FINANCED AMOUNT, not the
-- vehicle price. The lessee is being charged for the facility being extended
-- to them, and a bigger down payment means a smaller facility. Charging
-- against the price would mean someone putting 50% down pays the same
-- documentation fee as someone putting 20% down on the same car, which is
-- not what the fee is for.
--
-- HOW LEASE FEES DIFFER FROM LOAN FEES: a loan's fees are deducted from the
-- disbursement, so the borrower receives less than they owe (041's "net
-- disbursed"). A lease has no disbursement to the lessee at all — the money
-- goes to the dealer. So lease fees are simply payable UP FRONT, alongside
-- the down payment. The consequence is that they change the lessee's cash
-- outlay at signing and nothing else: the financed amount, the rental and
-- the rental schedule are all untouched.
--
-- Idempotent — guarded CREATE TABLE, guarded INSERTs. Additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS lease_product_fees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  product_id     INT NOT NULL,
  fee_type       ENUM('documentation','vehicle_inspection','stamp_duty',
                      'credit_life_insurance','other') NOT NULL,
  label          VARCHAR(100) NOT NULL,
  calc_method    ENUM('percentage','fixed') NOT NULL,
  -- Percent of the financed amount when calc_method='percentage', else an
  -- absolute LKR figure. One column, because a fee is one or the other.
  rate_or_amount DECIMAL(12,2) NOT NULL,
  -- Only meaningful for percentage fees; NULL means uncapped.
  min_amount     DECIMAL(12,2) NULL,
  max_amount     DECIMAL(12,2) NULL,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lease_product_fees_type (product_id, fee_type),
  FOREIGN KEY (product_id) REFERENCES lease_products(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Seed a realistic default schedule for every lease product, so the feature
-- is visible immediately rather than requiring an admin to configure five
-- products before a quotation shows anything.
--
--   documentation      1.00% of the facility, floor 7,500, cap 50,000
--   vehicle_inspection flat 6,500 — only charged where a physical
--                      inspection actually happens, so it is waived on
--                      brand-new vehicles at quotation time, not here
--   stamp_duty         0.15% of the facility, uncapped (a statutory charge
--                      the institution collects and remits, not revenue)
-- ---------------------------------------------------------------------------
INSERT INTO lease_product_fees (product_id, fee_type, label, calc_method, rate_or_amount, min_amount, max_amount)
SELECT p.id, 'documentation', 'Documentation Fee', 'percentage', 1.00, 7500.00, 50000.00
  FROM lease_products p
 WHERE NOT EXISTS (
   SELECT 1 FROM lease_product_fees f WHERE f.product_id = p.id AND f.fee_type = 'documentation'
 );

INSERT INTO lease_product_fees (product_id, fee_type, label, calc_method, rate_or_amount, min_amount, max_amount)
SELECT p.id, 'vehicle_inspection', 'Vehicle Inspection Fee', 'fixed', 6500.00, NULL, NULL
  FROM lease_products p
 WHERE NOT EXISTS (
   SELECT 1 FROM lease_product_fees f WHERE f.product_id = p.id AND f.fee_type = 'vehicle_inspection'
 );

INSERT INTO lease_product_fees (product_id, fee_type, label, calc_method, rate_or_amount, min_amount, max_amount)
SELECT p.id, 'stamp_duty', 'Government Stamp Duty', 'percentage', 0.15, NULL, NULL
  FROM lease_products p
 WHERE NOT EXISTS (
   SELECT 1 FROM lease_product_fees f WHERE f.product_id = p.id AND f.fee_type = 'stamp_duty'
 );

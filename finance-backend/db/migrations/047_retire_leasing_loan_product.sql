-- Migration 047: retire 'Vehicle Leasing' from the loan catalogue, and seed
-- the real one.
--
-- 003 seeded a 'Vehicle Leasing' row into loan_products, which is the same
-- misclassification this whole module exists to correct: a finance lease is
-- not a loan product, and leaving it there means a customer can still apply
-- for a "lease" through the loan wizard and receive a flat-rate personal
-- loan with no vehicle, no down payment and no ownership attached.
--
-- WHY DEACTIVATE RATHER THAN DELETE. Two reasons, and the second is the one
-- that actually decides it:
--   1. 041 hung fee rows off that product and 031 a risk-pricing band.
--      Deleting the row cascades those away; deactivating leaves the history
--      intact and harmless.
--   2. 003 is an idempotent seed guarded on `WHERE NOT EXISTS (... name =
--      'Vehicle Leasing')`. A DELETE here would be undone by 003 on the very
--      next `npm run migrate`, then re-applied by this file, forever. Leaving
--      the row present but inactive means 003's guard keeps matching and
--      nothing churns.
--
-- The `active` column is new and defaults to 1, so every other product is
-- unaffected. getProducts filters on it.
--
-- Idempotent — guarded column add, guarded UPDATE, guarded INSERTs.
-- Additive only. Drops nothing.

USE ai_loan;

SET @schema := DATABASE();

-- ---------------------------------------------------------------------------
-- 1. loan_products gains `active`.
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_products'
      AND column_name = 'active') > 0,
  'SELECT 1',
  'ALTER TABLE loan_products ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Retire the misclassified product. Safe to re-run.
-- ---------------------------------------------------------------------------
UPDATE loan_products
   SET active = 0
 WHERE type = 'Leasing';

-- ---------------------------------------------------------------------------
-- 3. Seed the lease catalogue.
--
-- Rates are flat, which is the leasing convention and the opposite default
-- to loan_products. The min/max band drives risk-based pricing the same way
-- 031 does for loans: the headline `interest_rate` is what an average-risk
-- lessee is quoted, and the band is what the assessment can move them within.
--
-- No minimum-down-payment column here by design — that policy is keyed to
-- vehicle CONDITION in leasing.service.js, not to the product.
-- ---------------------------------------------------------------------------
INSERT INTO lease_products
  (name, vehicle_class, min_financed_amount, max_financed_amount,
   min_term_months, max_term_months, interest_rate, rate_type,
   min_interest_rate, max_interest_rate, description)
SELECT * FROM (
  SELECT 'Car Lease' AS name, 'car' AS vehicle_class,
         500000.00 AS min_financed_amount, 15000000.00 AS max_financed_amount,
         12 AS min_term_months, 60 AS max_term_months,
         8.50 AS interest_rate, 'flat' AS rate_type,
         7.50 AS min_interest_rate, 11.00 AS max_interest_rate,
         'Finance lease for cars, new or reconditioned.' AS description
) t WHERE NOT EXISTS (SELECT 1 FROM lease_products WHERE name = 'Car Lease');

INSERT INTO lease_products
  (name, vehicle_class, min_financed_amount, max_financed_amount,
   min_term_months, max_term_months, interest_rate, rate_type,
   min_interest_rate, max_interest_rate, description)
SELECT * FROM (
  SELECT 'Van & SUV Lease', 'suv',
         750000.00, 20000000.00, 12, 60,
         9.00, 'flat', 8.00, 11.50,
         'Finance lease for vans, SUVs and crew cabs.'
) t WHERE NOT EXISTS (SELECT 1 FROM lease_products WHERE name = 'Van & SUV Lease');

INSERT INTO lease_products
  (name, vehicle_class, min_financed_amount, max_financed_amount,
   min_term_months, max_term_months, interest_rate, rate_type,
   min_interest_rate, max_interest_rate, description)
SELECT * FROM (
  SELECT 'Motorcycle Lease', 'motorcycle',
         100000.00, 1500000.00, 12, 36,
         12.00, 'flat', 11.00, 15.00,
         'Finance lease for motorcycles and scooters.'
) t WHERE NOT EXISTS (SELECT 1 FROM lease_products WHERE name = 'Motorcycle Lease');

INSERT INTO lease_products
  (name, vehicle_class, min_financed_amount, max_financed_amount,
   min_term_months, max_term_months, interest_rate, rate_type,
   min_interest_rate, max_interest_rate, description)
SELECT * FROM (
  SELECT 'Three-Wheeler Lease', 'three_wheeler',
         150000.00, 1500000.00, 12, 36,
         11.50, 'flat', 10.50, 14.50,
         'Finance lease for three-wheelers.'
) t WHERE NOT EXISTS (SELECT 1 FROM lease_products WHERE name = 'Three-Wheeler Lease');

INSERT INTO lease_products
  (name, vehicle_class, min_financed_amount, max_financed_amount,
   min_term_months, max_term_months, interest_rate, rate_type,
   min_interest_rate, max_interest_rate, description)
SELECT * FROM (
  SELECT 'Commercial Vehicle Lease', 'commercial',
         1000000.00, 30000000.00, 12, 60,
         9.50, 'flat', 8.50, 12.50,
         'Finance lease for lorries, buses and other commercial vehicles.'
) t WHERE NOT EXISTS (SELECT 1 FROM lease_products WHERE name = 'Commercial Vehicle Lease');

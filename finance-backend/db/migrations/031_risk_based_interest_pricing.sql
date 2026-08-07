-- Migration 031: risk-based interest pricing (D3).
--
-- Every loan_products row has always carried exactly one interest_rate,
-- applied to every applicant regardless of how risky they are. This
-- migration lets a product optionally carry a PRICING RANGE either side of
-- that rate, so the rate an applicant is actually assessed and offered at
-- depends on the risk band the ML model placed them in — the same
-- risk-based pricing a real lender uses instead of one flat headline rate.
--
-- DESIGN: min_interest_rate / max_interest_rate are NULLABLE and additive,
-- deliberately mirroring how D1's applicant-declared fields (005) and D2's
-- override columns (030) were added — a product that hasn't been given a
-- range keeps behaving EXACTLY as before (flat rate for every applicant).
-- Configuring both is opt-in per product, done in the admin catalog UI.
-- `interest_rate` itself keeps its existing meaning: the STANDARD/medium-risk
-- rate. Low risk prices to min_interest_rate, high risk to max_interest_rate,
-- medium risk (and any risk label the pricing engine doesn't recognise)
-- stays at the base rate. See interestPricing.service.js.
--
-- `loan_applications.priced_interest_rate` snapshots the rate an
-- application was ACTUALLY assessed and quoted at, the same reasoning as
-- loan_offers.offered_interest_rate (023): a later change to the product's
-- rate or range must not silently rewrite what an existing application's
-- recommendation or credit-policy verdict was computed against. It is set
-- once, inside the assess transaction, and read back by
-- loanOffer.service.js buildOfferTerms as the fallback rate for an offer —
-- so approving an application quotes the applicant the rate their own
-- assessment priced, not a fresh read of the product's base rate.
--
-- Nullable because applications assessed before D3 (and applications on
-- products with no configured range) have nothing risk-based to record;
-- callers fall back to the product's base rate exactly as before.
--
-- Idempotent — guarded PREPARE/EXECUTE column adds, matching every
-- migration in this series since 005. Additive only.

USE ai_loan;

SET @schema := DATABASE();

-- loan_products.min_interest_rate
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_products' AND column_name = 'min_interest_rate') > 0,
  'SELECT 1',
  'ALTER TABLE loan_products ADD COLUMN min_interest_rate DECIMAL(5,2) NULL AFTER interest_rate'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_products.max_interest_rate
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_products' AND column_name = 'max_interest_rate') > 0,
  'SELECT 1',
  'ALTER TABLE loan_products ADD COLUMN max_interest_rate DECIMAL(5,2) NULL AFTER min_interest_rate'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- loan_applications.priced_interest_rate
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'loan_applications' AND column_name = 'priced_interest_rate') > 0,
  'SELECT 1',
  'ALTER TABLE loan_applications ADD COLUMN priced_interest_rate DECIMAL(5,2) NULL AFTER guarantor_defaults'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Illustrative seed spreads for the demo catalogue (003_seed_loan_products.sql)
-- so the feature is visible without an admin configuring it by hand. -1.0pp
-- discount for low risk, +2.5pp premium for high risk — asymmetric because a
-- lender's downside from an underpriced risky loan is larger than the upside
-- from a small discount to a safe one. Illustrative only, not a real pricing
-- policy; admins can edit or clear these via the product catalog UI. Applied
-- by name so it only touches the six products this migration series seeded,
-- and only when a row hasn't already been given a range (idempotent).
UPDATE loan_products
   SET min_interest_rate = ROUND(interest_rate - 1.0, 2),
       max_interest_rate = ROUND(interest_rate + 2.5, 2)
 WHERE name IN (
   'Personal Loan', 'Housing Loan', 'Vehicle Leasing',
   'Education Loan', 'Business Loan', 'Pawning'
 )
 AND min_interest_rate IS NULL
 AND max_interest_rate IS NULL;

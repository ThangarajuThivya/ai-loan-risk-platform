-- Migration 003: seed data for loan_products (Sri Lankan retail loan products).
-- Idempotent — each row is only inserted if a product with the same name
-- doesn't already exist, so this file can be re-run safely.
-- Applied by npm run migrate, or run after 001 and 002.

USE ai_loan;

INSERT INTO loan_products (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, interest_rate, rate_type, description)
SELECT
  'Personal Loan', 'Personal',
  50000.00, 2000000.00,
  6, 60,
  14.00, 'reducing',
  'Unsecured personal loan for general purposes.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM loan_products WHERE name = 'Personal Loan');

INSERT INTO loan_products (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, interest_rate, rate_type, description)
SELECT
  'Housing Loan', 'Housing',
  1000000.00, 25000000.00,
  60, 300,
  11.50, 'reducing',
  'Long-term loan for purchasing, building, or renovating a home.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM loan_products WHERE name = 'Housing Loan');

INSERT INTO loan_products (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, interest_rate, rate_type, description)
SELECT
  'Vehicle Leasing', 'Leasing',
  500000.00, 15000000.00,
  12, 60,
  8.50, 'flat',
  'Vehicle finance lease with a down payment and flat-rate EMI.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM loan_products WHERE name = 'Vehicle Leasing');

INSERT INTO loan_products (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, interest_rate, rate_type, description)
SELECT
  'Education Loan', 'Education',
  100000.00, 5000000.00,
  12, 84,
  10.00, 'reducing',
  'Loan for local or foreign higher-education fees and expenses.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM loan_products WHERE name = 'Education Loan');

INSERT INTO loan_products (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, interest_rate, rate_type, description)
SELECT
  'Business Loan', 'Business',
  200000.00, 10000000.00,
  12, 84,
  13.50, 'reducing',
  'Working capital or expansion loan for registered SMEs.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM loan_products WHERE name = 'Business Loan');

INSERT INTO loan_products (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months, interest_rate, rate_type, description)
SELECT
  'Pawning', 'Pawning',
  10000.00, 3000000.00,
  3, 12,
  16.00, 'flat',
  'Short-term loan secured against gold jewellery.'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM loan_products WHERE name = 'Pawning');

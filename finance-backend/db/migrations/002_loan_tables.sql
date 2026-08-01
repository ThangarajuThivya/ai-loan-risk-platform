-- Migration 002: loan feature tables for ai_loan.
-- Adds: loan_products, loan_applications, risk_assessments, recommendations, currency_rates.
-- Idempotent — safe to re-run. Does not touch users, customer_profiles, notifications.
-- See ../../../ARCHITECTURE.md §8 (data model) and ../../../GUIDANCE.md §4 (schema to add).
-- Applied by npm run migrate, or run 001_create_database.sql first if the
-- database/base tables don't exist yet.

USE ai_loan;

CREATE TABLE IF NOT EXISTS loan_products (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(150) NOT NULL,
  type              VARCHAR(50) NOT NULL,
  min_amount        DECIMAL(14,2) NOT NULL,
  max_amount        DECIMAL(14,2) NOT NULL,
  min_tenure_months INT NOT NULL,
  max_tenure_months INT NOT NULL,
  interest_rate     DECIMAL(5,2) NOT NULL,
  rate_type         ENUM('reducing','flat') NOT NULL DEFAULT 'reducing',
  description       TEXT
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  product_id       INT NOT NULL,
  requested_amount DECIMAL(14,2) NOT NULL,
  tenure_months    INT NOT NULL,
  purpose          VARCHAR(150),
  status           ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES loan_products(id)
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  application_id INT NOT NULL,
  risk_label     INT NOT NULL,
  risk_category  VARCHAR(20) NOT NULL,
  prob_low       DECIMAL(5,4) NOT NULL,
  prob_medium    DECIMAL(5,4) NOT NULL,
  prob_high      DECIMAL(5,4) NOT NULL,
  model_version  VARCHAR(50),
  assessed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendations (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  application_id         INT NOT NULL,
  recommended_amount     DECIMAL(14,2) NOT NULL,
  recommended_emi        DECIMAL(14,2) NOT NULL,
  recommended_product_id INT,
  gemini_explanation     TEXT,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (recommended_product_id) REFERENCES loan_products(id)
);

CREATE TABLE IF NOT EXISTS currency_rates (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  base       VARCHAR(10) NOT NULL,
  target     VARCHAR(10) NOT NULL,
  mid_rate   DECIMAL(14,6) NOT NULL,
  buy_rate   DECIMAL(14,6) NOT NULL,
  sell_rate  DECIMAL(14,6) NOT NULL,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

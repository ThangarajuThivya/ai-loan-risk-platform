-- Migration 011: FAQ feature. Adds: faqs (one row per question, read by the
-- public /faq page, managed by staff/admin with identical CRUD permissions).
-- Idempotent — safe to re-run. Does not touch 001-010.
--
-- No FK — FAQs aren't owned by a user. Sorted by category then created_at
-- (no display_order column: only useful with a reorder UI, which this
-- iteration doesn't need).

USE ai_loan;

CREATE TABLE IF NOT EXISTS faqs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  category     VARCHAR(50) NOT NULL,
  question     VARCHAR(500) NOT NULL,
  answer       TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_faqs_category (category)
);

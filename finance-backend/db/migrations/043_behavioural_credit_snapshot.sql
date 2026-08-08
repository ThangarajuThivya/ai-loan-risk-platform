-- Migration 043: snapshot the behavioural credit evidence behind an assessment.
--
-- The v2 risk model sources its strongest inputs — number_of_defaults,
-- overdue_installments, credit_utilization, avg_repayment_behaviour — from the
-- customer's OWN repayment record with this institution
-- (behaviouralFeatures.service.js), instead of the fixed constants the gateway
-- previously sent for every applicant. Measured against the trained model
-- those three carry roughly 46% of its total gain, so what the model was shown
-- is now a genuine, per-customer fact rather than a hardcode.
--
-- WHY SNAPSHOT IT RATHER THAN RECOMPUTE ON READ:
-- The evidence changes continuously. A customer with a clean file at
-- assessment time may miss three instalments next month; recomputing when a
-- reviewer later opens the application would show the CURRENT history beside a
-- decision that never saw it, and a reviewer auditing "why was this approved"
-- would be reading numbers the model was never given. That is the same
-- reasoning loan_offers (023) and adverse_action_records (032) already follow:
-- a record of a past decision must freeze its own inputs.
--
-- WHY IT SITS ON risk_assessments:
-- It describes what the MODEL was shown, and risk_assessments is already the
-- per-assessment row carrying risk_label / probabilities / model_version. A
-- reopened-and-rescored application writes a new risk_assessments row and
-- therefore gets its own snapshot, automatically.
--
-- WHY JSON RATHER THAN COLUMNS:
-- This is diagnostic provenance read as a whole and never filtered or joined
-- on. Spreading eight counters across eight columns would need a fresh
-- migration every time the evidence summary gains a field, for no query
-- benefit. Nothing in the application logic branches on its contents — it is
-- displayed, and that is all.
--
-- NULLable, so every pre-existing assessment stays valid and simply reports
-- no behavioural provenance, which is accurate: those were scored before this
-- existed.
--
-- Idempotent — guarded PREPARE/EXECUTE column add, additive only. Drops
-- nothing.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'risk_assessments'
      AND column_name = 'behavioural_snapshot') > 0,
  'SELECT 1',
  'ALTER TABLE risk_assessments ADD COLUMN behavioural_snapshot JSON NULL AFTER model_version'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

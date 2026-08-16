-- Migration 056: front/back side for two-sided documents.
--
-- Some document types are physically two-sided (a National ID card; a CR
-- copy's data is only on the front, but a customer photographing a card
-- rather than uploading a print may reasonably want to attach the back too
-- for completeness). Rather than invent a combined-image concept, a
-- front/back photo is modelled as two ordinary rows of the same
-- document_type on the same application — `side` just labels which one a
-- given row is. This needs no change to document_extractions (054): each
-- row still gets exactly one extraction, run independently, exactly as
-- before.
--
-- NULL is the default and stays correct for every existing row and for
-- every document type that isn't two-sided (a PDF upload, a payslip, a bank
-- statement) — side is only ever set by the two-sided upload path.
--
-- Idempotent — guarded via information_schema, matching the pattern used
-- elsewhere in this series for additive ALTERs (e.g. 053).

USE ai_loan;

SET @col_exists_loan := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'loan_application_documents'
    AND COLUMN_NAME = 'side'
);

SET @ddl_loan := IF(
  @col_exists_loan = 0,
  'ALTER TABLE loan_application_documents ADD COLUMN side ENUM(''front'',''back'') NULL DEFAULT NULL AFTER document_type',
  'SELECT 1'
);

PREPARE stmt_loan FROM @ddl_loan;
EXECUTE stmt_loan;
DEALLOCATE PREPARE stmt_loan;

SET @col_exists_lease := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'lease_application_documents'
    AND COLUMN_NAME = 'side'
);

SET @ddl_lease := IF(
  @col_exists_lease = 0,
  'ALTER TABLE lease_application_documents ADD COLUMN side ENUM(''front'',''back'') NULL DEFAULT NULL AFTER document_type',
  'SELECT 1'
);

PREPARE stmt_lease FROM @ddl_lease;
EXECUTE stmt_lease;
DEALLOCATE PREPARE stmt_lease;

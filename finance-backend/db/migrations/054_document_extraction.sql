-- Migration 054: document_extractions — rule-based OCR field extraction and
-- cross-document validation results, per uploaded document.
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, matching every migration
-- in this series. Additive only. Does not touch 001-053.
--
-- One table serves both loan_application_documents (034) and
-- lease_application_documents (045) rather than two near-identical tables:
-- extraction output has the same shape (status, engine, raw text, fields,
-- findings, confidence) regardless of which application type the source
-- document belongs to, and documentExtraction.service.js /
-- documentValidation.service.js (the pure services that produce this data)
-- know nothing about loan vs. lease either. document_source distinguishes
-- which parent table document_id points into, since the two document
-- tables' id sequences are independent and can collide.
--
-- CRITICAL — advisory only, same design as the KYC verification_status on
-- both document tables (see 034's SECURITY NOTE and loanDocument.service.js):
-- this table has no foreign key or trigger that touches
-- loan_application_documents.verification_status or
-- lease_application_documents.verification_status, and no application code
-- path may make it do so. Extraction can be pending/succeeded/failed/skipped
-- entirely independently of a document being verification_status
-- pending/verified/rejected. Staff sign-off is the sole authority on
-- verification_status; extraction only ever informs the human making that
-- call, never substitutes for it.
--
-- One row per (document_source, document_id): a document is re-extracted in
-- place (status flips back to 'pending' and the row is updated) rather than
-- accumulating a new row per attempt, since only the latest extraction is
-- ever actionable — same one-current-state reasoning as verification_status
-- itself. No FOREIGN KEY to either document table: which table document_id
-- belongs to is data (document_source), not something a single FK
-- constraint can express, so referential integrity here is enforced at the
-- application layer, same as `_by` custody columns in 053.

USE ai_loan;

CREATE TABLE IF NOT EXISTS document_extractions (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  document_source      ENUM('loan','lease') NOT NULL,
  document_id          INT NOT NULL,
  extraction_status    ENUM('pending','succeeded','failed','skipped') NOT NULL DEFAULT 'pending',
  -- e.g. 'tesseract', 'gemini-ocr' — whatever produced raw_text, if anything
  -- did (a purely rule-based re-run of an already-extracted document has no
  -- engine of its own). NULL when extraction_status is 'pending' or has
  -- never actually run an engine (e.g. 'skipped').
  engine               VARCHAR(100) NULL,
  raw_text             MEDIUMTEXT NULL,
  -- documentExtraction.service.js's extractFields() output: field name ->
  -- { value, snippet, confidence } | null.
  extracted_fields     JSON NULL,
  -- documentValidation.service.js's validateApplication() output: an array
  -- of { code, severity, message, fields }.
  validation_findings  JSON NULL,
  -- 0..1, this extraction run's own confidence in its output as a whole
  -- (distinct from the per-field confidence inside extracted_fields) —
  -- NULL when extraction_status isn't 'succeeded'.
  confidence_score     DECIMAL(4,3) NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_document_extractions_document (document_source, document_id)
);

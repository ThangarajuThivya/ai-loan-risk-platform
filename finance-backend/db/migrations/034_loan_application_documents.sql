-- Migration 034: loan_application_documents (E1 — secure loan document
-- management).
--
-- Same shape and same SECURITY NOTE as fx_request_documents (014): this
-- table stores metadata only. storage_path is a server-side filesystem path
-- under finance-backend/secure-uploads/loan-documents/ (see
-- src/config/multer.js loanDocumentUpload) and is NEVER returned to a
-- client — the only way to read a file back is the authenticated,
-- ownership-checked GET /api/loans/:id/documents/:docId/download route.
-- That directory is deliberately never mounted under src/app.js's
-- express.static, unlike uploads/ (profile pictures).
--
-- verification_status mirrors collateral_items (033): staff sign off on
-- what a customer uploaded, or reject it, with the decision independent of
-- the application's own status-machine state (E1 is advisory only — it does
-- not gate B1's transitions in applicationStatus.service.js).
--
-- document_type is a fixed set rather than free text, same reasoning as
-- collateral_type in 033: a small closed list is what lets the UI offer a
-- clean picker and lets staff see at a glance which of the expected
-- documents (NIC, payslip, bank statement) are still missing.
--
-- Idempotent — guarded CREATE TABLE IF NOT EXISTS, matching every migration
-- in this series. Additive only.

USE ai_loan;

CREATE TABLE IF NOT EXISTS loan_application_documents (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  application_id       INT NOT NULL,
  document_type        ENUM('national_id','payslip','bank_statement','other') NOT NULL,
  -- Always the owning customer today (staff upload no evidence, same as FX),
  -- but recorded rather than assumed — mirrors fx_request_documents.
  uploaded_by          INT NULL,
  -- The customer's own filename, shown in the UI. Never used to build a
  -- filesystem path — see storage_path.
  original_name        VARCHAR(255) NOT NULL,
  storage_path         VARCHAR(500) NOT NULL,
  mime_type            VARCHAR(100) NOT NULL,
  size_bytes           INT NOT NULL,
  verification_status  ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verified_by          INT NULL,
  verified_at          TIMESTAMP NULL,
  verification_notes   VARCHAR(500) NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_loan_application_documents_application (application_id, created_at)
);

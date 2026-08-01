-- 014_fx_compliance_documents.sql — FX compliance documentation.
--
-- Extends the Phase 10 exchange-request workflow (008) from "we record why
-- the customer wants the currency" to "above a configurable value, we
-- require them to evidence it". Three changes:
--
--   1. fx_limits.document_threshold_lkr — the admin-configurable LKR value
--      at or above which a request must be evidenced. Resolved with the
--      same per-currency-else-'ALL' fallback as the existing caps (see
--      fxExchangeModel.getEffectiveLimits). NULL means "no documentation
--      requirement for this currency", which is why it is nullable rather
--      than defaulted to 0 — 0 would mean "every request needs documents".
--
--   2. fx_exchange_requests.requires_documents — a per-request SNAPSHOT of
--      whether the threshold applied at submission time, not a value
--      re-derived on read. This is deliberate and matches how the same
--      table already snapshots spread_bps_applied and rate_source: an
--      admin lowering the threshold next month must not retroactively make
--      last month's approved requests look non-compliant, and raising it
--      must not erase the fact that a document was demanded and supplied.
--      Existing rows backfill to 0 via the DEFAULT, which is correct —
--      there was no requirement in force when they were submitted.
--
--   3. fx_request_documents — one row per uploaded file.
--
-- SECURITY NOTE on storage_path. These files are identity/purpose evidence
-- (invoices, admission letters, medical referrals) and MUST NOT be written
-- under finance-backend/uploads/, which src/app.js serves as unauthenticated
-- express.static — anything there is readable by anyone who can guess a URL.
-- The upload middleware writes to finance-backend/secure-uploads/fx-documents/
-- instead, and the only way back out is the authenticated, ownership-checked
-- GET .../documents/:id/download route. storage_path is therefore a server-
-- side path that is never returned to a client.
--
-- Idempotent — safe to re-run. Uses the same guarded PREPARE/EXECUTE pattern
-- as 007 and 009 (MySQL 8.0 has no ADD COLUMN IF NOT EXISTS). Drops nothing.

USE ai_loan;

SET @schema := DATABASE();

-- 1. Admin-configurable documentation threshold, alongside the existing caps.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'fx_limits' AND column_name = 'document_threshold_lkr') > 0,
  'SELECT 1',
  'ALTER TABLE fx_limits ADD COLUMN document_threshold_lkr DECIMAL(14,2) NULL AFTER max_per_customer_per_day_lkr'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed the global default only if it has never been set. 1,000,000 LKR sits
-- deliberately below the seeded 2,000,000 per-transaction cap from 008, so
-- the requirement is reachable in a demo without hitting the cap first.
UPDATE fx_limits
   SET document_threshold_lkr = 1000000.00
 WHERE currency_code = 'ALL' AND document_threshold_lkr IS NULL;

-- 2. Per-request snapshot of whether documentation was required.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'fx_exchange_requests' AND column_name = 'requires_documents') > 0,
  'SELECT 1',
  'ALTER TABLE fx_exchange_requests ADD COLUMN requires_documents TINYINT(1) NOT NULL DEFAULT 0 AFTER purpose_code'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Uploaded supporting documents. ON DELETE CASCADE matches
-- fx_request_events: a request's evidence has no meaning without the request.
CREATE TABLE IF NOT EXISTS fx_request_documents (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  request_id     INT NOT NULL,
  -- Who uploaded it. Always the owning customer today (staff upload no
  -- evidence), but recorded rather than assumed so a future branch-side
  -- upload path doesn't need a schema change to stay auditable.
  uploaded_by    INT NULL,
  -- The customer's own filename, shown in the UI. Never used to build a
  -- filesystem path — see storage_path.
  original_name  VARCHAR(255) NOT NULL,
  -- Server-side path under secure-uploads/. Never sent to a client; see the
  -- security note in this file's header.
  storage_path   VARCHAR(500) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  size_bytes     INT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES fx_exchange_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_fx_request_documents_request (request_id, created_at)
);

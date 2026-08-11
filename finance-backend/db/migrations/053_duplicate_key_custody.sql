-- Migration 053: track custody of the vehicle's duplicate (spare) key.
-- Idempotent — safe to re-run. Does not touch 001-052.
--
-- Sri Lankan finance-lease practice requires the lessee to hand over the
-- vehicle's duplicate key alongside the CR, valuation report and supplier
-- invoice at processing, and for the leasing institution to hold it in
-- safe custody for the whole tenure — an extra physical control against
-- unauthorised use or resale of an asset the institution owns until the
-- final rental clears. Nothing in the schema recorded this at all before
-- now, even though the equivalent facts for the CR itself (submitted_at,
-- registered_at, release_issued_at) already live on this exact table.
--
-- Deliberately a SOFT FACT, not a gate: unlike the CR (which blocks
-- approval/activation — see leaseStatus.service.js#checkValuationGate and
-- the CR-before-rentals ordering in leaseRegistration.service.js), nothing
-- in the lease workflow refuses to proceed because the key hasn't been
-- logged. The key secures the asset DURING the lease; it has no bearing on
-- whether the lessee has EARNED release, which is a pure function of
-- rentals paid. Gating the release letter on it would risk withholding
-- paperwork a fully-paid lessee is legally owed over an internal custody
-- step (a key still in transit between branches, a clerk who forgot to log
-- it) — exactly the kind of implied condition the release letter is
-- written to avoid.
--
-- `_by` columns are plain nullable INTs, not foreign keys, matching
-- 050_notification_routing.sql's `reference_id` precedent: a custody
-- record is a historical statement about who did what, and must survive
-- the deletion of the staff account that logged it.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'vehicle_registrations'
      AND column_name = 'duplicate_key_received') > 0,
  'SELECT 1',
  'ALTER TABLE vehicle_registrations ADD COLUMN duplicate_key_received TINYINT(1) NOT NULL DEFAULT 0 AFTER notes'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'vehicle_registrations'
      AND column_name = 'duplicate_key_received_at') > 0,
  'SELECT 1',
  'ALTER TABLE vehicle_registrations ADD COLUMN duplicate_key_received_at DATE NULL AFTER duplicate_key_received'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'vehicle_registrations'
      AND column_name = 'duplicate_key_received_by') > 0,
  'SELECT 1',
  'ALTER TABLE vehicle_registrations ADD COLUMN duplicate_key_received_by INT NULL AFTER duplicate_key_received_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'vehicle_registrations'
      AND column_name = 'duplicate_key_returned') > 0,
  'SELECT 1',
  'ALTER TABLE vehicle_registrations ADD COLUMN duplicate_key_returned TINYINT(1) NOT NULL DEFAULT 0 AFTER duplicate_key_received_by'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'vehicle_registrations'
      AND column_name = 'duplicate_key_returned_at') > 0,
  'SELECT 1',
  'ALTER TABLE vehicle_registrations ADD COLUMN duplicate_key_returned_at DATE NULL AFTER duplicate_key_returned'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'vehicle_registrations'
      AND column_name = 'duplicate_key_returned_by') > 0,
  'SELECT 1',
  'ALTER TABLE vehicle_registrations ADD COLUMN duplicate_key_returned_by INT NULL AFTER duplicate_key_returned_at'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

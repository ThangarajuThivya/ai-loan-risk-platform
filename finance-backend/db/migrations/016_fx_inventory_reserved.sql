-- 016_fx_inventory_reserved.sql — materializes reserved stock on fx_inventory.
--
-- 015 deliberately left reservations undeserved-derived: stock committed to
-- open 'buy' requests was meant to be computed at read time from
-- fx_exchange_requests, to avoid a second source of truth that could drift
-- when fxExpirySweep.service.js expires a request without a matching write
-- here. Task 2 (fxInventoryModel.applyMovement) needs a reserved balance it
-- can move transactionally alongside on_hand_units, so that design is
-- revised: reserved_units is now a real column, kept in sync exclusively by
-- applyMovement — the same single-writer discipline on_hand_units already
-- has. Reserve/settle logic itself is still out of scope here (later
-- tasks); this migration only adds the column applyMovement writes to.
--
-- Idempotent — safe to re-run, same guarded PREPARE/EXECUTE pattern as
-- 007/009/014.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'fx_inventory' AND column_name = 'reserved_units') > 0,
  'SELECT 1',
  'ALTER TABLE fx_inventory ADD COLUMN reserved_units DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER on_hand_units'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The ledger gains matching columns so every movement records BOTH deltas
-- and both resulting balances, even on rows where one of the two is zero —
-- an applyMovement call that only reserves stock still shows what on_hand
-- was at that moment, and vice versa. Keeps balance_after/delta_units as the
-- on-hand pair (unchanged, existing rows stay valid) and adds the reserved
-- pair alongside.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'fx_inventory_movements' AND column_name = 'delta_reserved_units') > 0,
  'SELECT 1',
  'ALTER TABLE fx_inventory_movements ADD COLUMN delta_reserved_units DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER delta_units'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'fx_inventory_movements' AND column_name = 'reserved_after') > 0,
  'SELECT 1',
  'ALTER TABLE fx_inventory_movements ADD COLUMN reserved_after DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER balance_after'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

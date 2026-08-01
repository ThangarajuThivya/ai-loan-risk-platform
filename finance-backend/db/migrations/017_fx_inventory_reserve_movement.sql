-- 017_fx_inventory_reserve_movement.sql — adds the 'reserve' movement type.
--
-- Task 4 makes APPROVAL the point at which the bank commits stock: approving
-- a customer 'buy' request promises them the foreign currency, so the
-- reservation must be taken there, atomically, or the approval must fail.
-- That reservation is a genuinely new kind of ledger event — it is not a
-- restock (no notes arrived), not a settlement (nothing has physically
-- changed hands yet), and not an adjustment (it is not a correction). It
-- moves reserved_units only, leaving on_hand_units untouched, and it always
-- carries the request_id it was taken for.
--
-- 015 chose the original three values before reservations were materialized;
-- 016 added the reserved_units column they act on. Folding 'reserve' into
-- one of the existing three would make the ledger unable to answer "why is
-- this stock committed?" — which is the one question a reservation exists to
-- answer — and would collide with the settle logic a later task adds, since
-- settlement must be distinguishable from the reservation that preceded it.
--
-- ENUM values are only ever APPENDED here. Existing rows keep their type
-- verbatim and nothing is rewritten; MySQL stores ENUMs by ordinal, so
-- adding a value at the end leaves every stored ordinal pointing at the same
-- string it always did.
--
-- Idempotent — safe to re-run, same guarded PREPARE/EXECUTE pattern as
-- 007/009/014/016.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema
      AND table_name = 'fx_inventory_movements'
      AND column_name = 'movement_type'
      AND COLUMN_TYPE LIKE '%''reserve''%') > 0,
  'SELECT 1',
  'ALTER TABLE fx_inventory_movements
     MODIFY COLUMN movement_type
     ENUM(''restock'',''settlement'',''adjustment'',''reserve'') NOT NULL'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

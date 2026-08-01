-- 018_fx_inventory_settle_movements.sql — settlement and release movements.
--
-- Task 5 closes the lifecycle 017 opened. A 'reserve' row commits stock at
-- approval; every reserved unit must eventually leave via exactly one of two
-- exits, and the ledger has to say which:
--
--   'settle_out' — a customer 'buy' settled at the branch. The notes are
--                  handed over, so BOTH reserved_units and on_hand_units
--                  fall by the same amount. The reservation is consumed, not
--                  released: the stock left the vault.
--
--   'settle_in'  — a customer 'sell' settled. The customer hands foreign
--                  currency TO the bank, so on_hand_units rises and
--                  reserved_units is untouched (a sell never reserved —
--                  see the direction rule in fxExchange.controller.js).
--
--   'release'    — an approved 'buy' ended in a terminal state that is NOT
--                  'settled' (rejected/cancelled/expired after approval).
--                  reserved_units falls; on_hand_units does not move,
--                  because nothing ever physically left. This is the exit
--                  that, if ever missed, silently and permanently leaks
--                  stock: reserved would only ever grow, available would
--                  drift to zero, and approvals would stop working bank-wide
--                  with no error anywhere to explain why.
--
-- The legacy 'settlement' value from 015 is deliberately KEPT but is now
-- superseded and written by nothing: it predates the reserve/settle split
-- and could not distinguish an in from an out. It is retained rather than
-- dropped because removing an ENUM value would silently rewrite any row
-- still holding it, which no migration here is allowed to do.
--
-- ENUM values are only ever APPENDED (see 017): MySQL stores ENUMs by
-- ordinal, so every existing row keeps pointing at the same string.
--
-- Idempotent — safe to re-run, same guarded PREPARE/EXECUTE pattern as
-- 007/009/014/016/017.

USE ai_loan;

SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema
      AND table_name = 'fx_inventory_movements'
      AND column_name = 'movement_type'
      AND COLUMN_TYPE LIKE '%''release''%') > 0,
  'SELECT 1',
  'ALTER TABLE fx_inventory_movements
     MODIFY COLUMN movement_type
     ENUM(''restock'',''settlement'',''adjustment'',''reserve'',
          ''settle_out'',''settle_in'',''release'') NOT NULL'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 015_fx_inventory.sql — bank-wide FX currency inventory.
--
-- The 008 workflow tracks what customers ASK for; it says nothing about
-- whether the bank actually holds the notes to settle those requests. This
-- migration adds that missing half: how much of each currency is on hand,
-- and an append-only ledger of every movement in and out.
--
-- SCOPE — the inventory is BANK-WIDE. There is exactly one notional vault,
-- keyed by currency_code alone. This is deliberate:
--
--   * fx_exchange_requests.branch is free text (008 line 59) — a customer
--     types where they intend to settle. Keying stock by that string would
--     silently create a separate vault for "Colombo", "colombo" and
--     "Colombo 07", and every balance would be wrong in a way nothing in the
--     system could detect.
--   * Normalizing branch into a real dimension is explicitly OUT OF SCOPE,
--     so branch stays free text and inventory stays bank-wide. If per-branch
--     stock is ever wanted, it arrives with a branches table and a
--     branch_id column here — not by reinterpreting the existing string.
--
-- UNITS, not LKR. Balances are in units of the foreign currency (10,000 USD),
-- because that is what physically sits in the vault. The LKR value of that
-- stock moves with the rate board every minute and is a READ-time derivation
-- (crossRate.service.js), never a stored number — the same separation 007
-- makes for rate conventions.
--
-- RESERVATIONS are deliberately NOT stored here. Stock committed to
-- not-yet-settled 'buy' requests is derivable at read time from
-- fx_exchange_requests (status IN pending_review/approved/ready_for_settlement),
-- and a stored reserved_units column would be a second source of truth that
-- drifts the first time a request expires via fxExpirySweep.service.js
-- without a matching decrement. Available = on_hand_units - SUM(open buys).
--
-- Idempotent — safe to re-run. Uses the same guarded PREPARE/EXECUTE pattern
-- as 007/009/014 where a column is added. Drops nothing.

USE ai_loan;

-- Current holdings — one row per currency, no branch dimension (see header).
CREATE TABLE IF NOT EXISTS fx_inventory (
  currency_code     VARCHAR(3) NOT NULL PRIMARY KEY,
  -- Units of this currency physically held, e.g. 10000.00 USD. Always equal
  -- to SUM(fx_inventory_movements.delta_units) for the currency; the column
  -- exists so the common read (the stock board) is a single-row lookup
  -- rather than a full ledger scan. Both are written in one transaction —
  -- see fxInventoryModel.
  on_hand_units     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  -- Admin-set restock trigger. At or below this, the currency is reported
  -- 'low' on the admin stock board. NULL = no alerting configured for this
  -- currency, which is why it is nullable rather than defaulted to 0 — 0
  -- would mean "only alert once we are completely out".
  reorder_level_units DECIMAL(18,2) NULL,
  -- FALSE parks a currency without deleting its history: it stops being
  -- offered for new requests but its ledger and balance stay intact. Mirrors
  -- fx_rate_board_config.is_tradable rather than overloading it — a currency
  -- can be quotable but out of stock, and vice versa.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Append-only movement ledger. One row per change to on_hand_units. Rows are
-- never updated or deleted by application code — a mistaken movement is
-- corrected by posting an offsetting 'adjustment', the same append-only
-- discipline fx_request_events already follows.
CREATE TABLE IF NOT EXISTS fx_inventory_movements (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  currency_code  VARCHAR(3) NOT NULL,
  -- What caused the movement:
  --   'restock'    — notes received into the vault (treasury/central bank).
  --   'settlement' — an FX request settled. Sign follows the customer's
  --                  direction: a customer 'buy' takes notes OUT (negative),
  --                  a customer 'sell' puts them IN (positive).
  --   'adjustment' — manual correction, stock count, or write-off.
  movement_type  ENUM('restock','settlement','adjustment') NOT NULL,
  -- SIGNED delta in currency units: positive adds to the vault, negative
  -- removes. Stored signed rather than as an unsigned amount plus a
  -- direction flag so that the invariant is a plain SUM() — no CASE
  -- expression can be forgotten in a later query.
  delta_units    DECIMAL(18,2) NOT NULL,
  -- Balance immediately after this movement, captured inside the same
  -- transaction that updated fx_inventory. A snapshot, exactly like 008's
  -- spread_bps_applied: it lets the ledger be replayed and reconciled even
  -- if a later bug corrupts the running balance.
  balance_after  DECIMAL(18,2) NOT NULL,
  -- The settling request, for 'settlement' rows; NULL for restocks and
  -- adjustments. ON DELETE SET NULL, NOT cascade: 008 cascades requests away
  -- when a user is deleted, and the vault movement must survive that — the
  -- notes really did leave the building.
  request_id     INT NULL,
  -- Staff member who posted it. NULL for movements posted by the settlement
  -- path on behalf of the system, or if the account is later removed.
  created_by     INT NULL,
  note           TEXT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES fx_exchange_requests(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_fx_inventory_movements_currency (currency_code, created_at),
  KEY idx_fx_inventory_movements_request (request_id)
);

-- Seed a zero-balance row for each currency the rate board already trades,
-- so the admin stock board is populated on a fresh install instead of empty.
-- Zero (not a fictional opening balance) is the honest starting point: stock
-- arrives through a 'restock' movement, which is also what the demo seed
-- does. INSERT IGNORE keeps a re-run from resetting a live balance.
INSERT IGNORE INTO fx_inventory (currency_code, on_hand_units, reorder_level_units) VALUES
  ('USD', 0.00, 5000.00),
  ('EUR', 0.00, 3000.00),
  ('GBP', 0.00, 3000.00),
  ('JPY', 0.00, 500000.00),
  ('INR', 0.00, 200000.00);
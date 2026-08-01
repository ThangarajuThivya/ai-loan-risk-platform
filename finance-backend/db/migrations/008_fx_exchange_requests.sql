-- Migration 008: FX exchange-request workflow (Phase 10 of the currency
-- feature). Adds: fx_exchange_requests, fx_request_events, fx_limits.
-- Idempotent — safe to re-run. Does not touch 001-007.
--
-- Domain model (see CURRENCY_FEATURE.md §12 for the full writeup): a retail
-- bank does not let customers execute instant FX trades. A customer submits
-- an EXCHANGE REQUEST against a short-lived rate quote; staff review it;
-- settlement happens physically at a branch. No money moves inside this
-- system — there is no balance ledger and no payment gateway here. The
-- quote itself is NOT persisted before submission (see
-- src/services/fxQuote.service.js) — it's a signed, short-TTL token the
-- customer redeems at POST /requests, so the only row this schema needs is
-- the submitted request itself.
--
-- Rate convention: quoted_rate/quoted_lkr_amount are already in the retail
-- board convention (LKR per 1 unit of currency_code), derived via
-- src/services/crossRate.service.js — NOT the H.10/model "units per 1 USD"
-- convention used by currency_rate_history/fx_rate_board_config's raw feed.

USE ai_loan;

-- One row per submitted exchange request. Never inserted at quote time —
-- only once a customer redeems a still-valid quote (POST /requests).
CREATE TABLE IF NOT EXISTS fx_exchange_requests (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  -- Human-readable counter reference shown to the customer/branch staff,
  -- e.g. "FX-000123". NULL immediately after INSERT, then set to
  -- FX-<zero-padded id> in the same transaction — see fxExchangeModel.js.
  reference_no       VARCHAR(20) NULL,
  user_id            INT NOT NULL,
  -- Customer's side of the trade: 'buy' = customer buys foreign currency
  -- (bank sells, quoted at the board's sell_rate); 'sell' = customer sells
  -- foreign currency to the bank (quoted at the board's buy_rate).
  direction          ENUM('buy','sell') NOT NULL,
  currency_code      VARCHAR(3) NOT NULL,
  foreign_amount     DECIMAL(18,2) NOT NULL,
  -- Rate/amount locked in at quote time, in the retail LKR-per-unit
  -- convention — see the file header note above.
  quoted_rate        DECIMAL(18,6) NOT NULL,
  quoted_lkr_amount  DECIMAL(18,2) NOT NULL,
  spread_bps_applied INT NOT NULL,
  -- Provenance of the raw rate the quote was derived from, e.g.
  -- 'live-er-api' (currency_rates.source at quote time) — an audit trail
  -- back to the live data plane, same spirit as CURRENCY_FEATURE.md §10.2's
  -- data_vintage policy for the model plane.
  rate_source        VARCHAR(30) NOT NULL,
  quote_locked_at    TIMESTAMP NOT NULL,
  quote_expires_at   TIMESTAMP NOT NULL,
  -- The signed quote token's `jti` claim. Its uniqueness is what makes
  -- submission idempotent: redeeming the same quote twice (a double-click)
  -- collides on this key instead of creating a second request — see
  -- fxExchange.controller.js's submitRequest.
  quote_jti          VARCHAR(36) NOT NULL,
  -- Why the customer is exchanging currency (a closed set — see
  -- fxExchange.routes.js PURPOSE_CODES) and where they'll physically
  -- settle it — both required, matching the "no money moves here, this is
  -- a request to be handled at a branch" domain model.
  purpose_code       VARCHAR(50) NOT NULL,
  branch             VARCHAR(100) NOT NULL,
  settlement_date    DATE NOT NULL,
  status ENUM(
    'pending_review',
    'approved',
    'ready_for_settlement',
    'settled',
    'rejected',
    'cancelled',
    'expired'
  ) NOT NULL DEFAULT 'pending_review',
  reviewed_by        INT NULL,
  review_note        TEXT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uq_fx_exchange_requests_reference_no (reference_no),
  UNIQUE KEY uq_fx_exchange_requests_quote_jti (quote_jti),
  KEY idx_fx_exchange_requests_user_status (user_id, status),
  KEY idx_fx_exchange_requests_status_created (status, created_at)
);

-- Append-only audit trail. One row per status transition, plus one row for
-- a staff counter-quote (which revises terms but keeps status at
-- 'pending_review' — see CURRENCY_FEATURE.md §12 state-machine note), so
-- from_status/to_status can legitimately be equal. Rows here are never
-- updated or deleted by application code.
CREATE TABLE IF NOT EXISTS fx_request_events (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  request_id     INT NOT NULL,
  from_status    VARCHAR(30) NULL,
  to_status      VARCHAR(30) NOT NULL,
  actor_user_id  INT NULL,
  note           TEXT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES fx_exchange_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_fx_request_events_request (request_id, created_at)
);

-- Admin-configured caps, in LKR. currency_code = 'ALL' is the global
-- fallback row (seeded below); a real 3-letter code overrides it for that
-- currency only. Looked up as "per-currency row if present, else ALL" —
-- see fxExchangeModel.js's getEffectiveLimits.
CREATE TABLE IF NOT EXISTS fx_limits (
  currency_code                VARCHAR(3) NOT NULL DEFAULT 'ALL' PRIMARY KEY,
  max_per_transaction_lkr      DECIMAL(14,2) NOT NULL,
  max_per_customer_per_day_lkr DECIMAL(14,2) NOT NULL,
  updated_at                   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO fx_limits (currency_code, max_per_transaction_lkr, max_per_customer_per_day_lkr) VALUES
  ('ALL', 2000000.00, 5000000.00);

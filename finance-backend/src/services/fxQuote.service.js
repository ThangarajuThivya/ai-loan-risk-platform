"use strict";

/**
 * FX exchange-request quoting (Phase 10 of the currency feature —
 * CURRENCY_FEATURE.md §12). Derives an indicative buy/sell rate from the
 * live rate board (currency_rates + fx_rate_board_config, the same inputs
 * GET /api/currency/board reads) via crossRate.service.js — no
 * reimplementation of that conversion, per the file's own warning about
 * this convention already causing one bug (CURRENCY_FEATURE.md §7.3).
 *
 * The quote itself is NOT written to the database. It's a signed,
 * short-TTL JWT (the "quote_id") carrying the locked rate/amount/spread —
 * redeeming it at POST /requests is what finally persists a row, and the
 * token's own `jti` is what makes that redemption idempotent (a unique key
 * on fx_exchange_requests.quote_jti — see fxExchangeModel.js). This keeps
 * the DB schema free of a throwaway "unsubmitted quote" table: an
 * unredeemed quote simply expires and is never seen again.
 *
 * Forecasts (the Python currency-forecast-model service) are never
 * consulted here — a quote is priced off the live board only, matching the
 * task's "forecast output must NOT gate or auto-decide any request" rule.
 */

const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const currencyModel = require("../models/currencyModel");
const crossRate = require("./crossRate.service");

// Falls back to the JWT auth secret rather than requiring a brand-new env
// var in every environment that's already running this app; set
// FX_QUOTE_SECRET explicitly if quote tokens should be rotated independently
// of access tokens.
const QUOTE_SECRET = process.env.FX_QUOTE_SECRET || process.env.ACCESS_TOKEN_SECRET;

// How long a locked quote is valid for. The task calls for "a short TTL
// (e.g. 15 minutes)" — the bank only bears rate-movement risk for this
// window, since submission after expiry is refused outright (re-quote,
// don't extend).
const QUOTE_TTL_SECONDS = Number(process.env.FX_QUOTE_TTL_SECONDS) || 15 * 60;

// A board snapshot older than this refuses to quote at all, rather than
// silently pricing off a stale rate — same threshold currency.controller.js
// uses to flag (not hide) a stale /board response, reused here because a
// stale board is more dangerous for an actual money-quote than for a
// read-only display.
const MAX_BOARD_AGE_MS = Number(process.env.FX_QUOTE_MAX_BOARD_AGE_MS) || 6 * 60 * 60 * 1000;

class QuoteError extends Error {
  /**
   * @param {string} message
   * @param {number} status HTTP status the controller should respond with
   */
  constructor(message, status) {
    super(message);
    this.name = "QuoteError";
    this.status = status;
  }
}

/**
 * Which side of the board a customer's direction prices against.
 * Customer 'buy' (customer buys FX) <- bank SELLS -> sell_rate.
 * Customer 'sell' (customer sells FX) <- bank BUYS -> buy_rate.
 */
function rateForDirection(direction, spread) {
  return direction === "buy" ? spread.sell_rate : spread.buy_rate;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Read the live board (raw USD-per-unit snapshot + admin spread config) for
 * one currency, applying the same staleness/tradability guards
 * GET /api/currency/board and the exchange-request flow both need.
 * @param {string} currencyCode
 * @returns {Promise<{mid:number, spread:{buy_rate:number, sell_rate:number}, config:object, source:string}>}
 */
async function readBoardFor(currencyCode) {
  const [rawRows, configRows] = await Promise.all([
    currencyModel.getRawRateSnapshot(),
    currencyModel.listBoardConfig(),
  ]);

  const config = configRows.find((c) => c.currency_code === currencyCode);
  if (!config || !config.is_tradable) {
    throw new QuoteError(`${currencyCode} is not currently tradable against LKR.`, 400);
  }

  const rawMap = {};
  let latestFetchedAt = null;
  let latestSource = null;
  for (const r of rawRows) {
    rawMap[r.target] = Number(r.mid_rate);
    if (!latestFetchedAt || new Date(r.fetched_at) > new Date(latestFetchedAt)) {
      latestFetchedAt = r.fetched_at;
      latestSource = r.source;
    }
  }

  if (!rawMap.LKR) {
    throw new QuoteError(
      "The rate board has not been populated yet. Ask an admin to trigger a refresh, or wait for the next scheduled pull.",
      503
    );
  }

  const boardAgeMs = Date.now() - new Date(latestFetchedAt).getTime();
  if (boardAgeMs > MAX_BOARD_AGE_MS) {
    throw new QuoteError(
      "The live rate board is too stale to quote from right now. Please try again shortly.",
      503
    );
  }

  let mid;
  try {
    mid = crossRate.toLkrPerUnit(rawMap, currencyCode);
  } catch (err) {
    throw new QuoteError(err.message, 503);
  }
  const spread = crossRate.applySpread(mid, {
    buySpreadBps: config.buy_spread_bps,
    sellSpreadBps: config.sell_spread_bps,
  });

  return { mid, spread, config, source: latestSource };
}

/**
 * Build and sign a new indicative quote, locked for QUOTE_TTL_SECONDS.
 * Exactly one of `foreignAmount`/`lkrAmount` must be given — a customer
 * either knows how much foreign currency they need, or how much LKR they
 * have to spend. When `lkrAmount` drives the quote, the foreign amount is
 * derived from it and rounded to 2dp first (the precision the request is
 * actually submitted/settled at), then the LKR amount is recomputed from
 * that rounded foreign amount so the two figures on the quote are always
 * mutually consistent — never off by a rounding remainder.
 * @param {object} p
 * @param {number} p.userId
 * @param {'buy'|'sell'} p.direction customer's side of the trade
 * @param {string} p.currencyCode 3-letter ISO code
 * @param {number} [p.foreignAmount] amount of foreign currency
 * @param {number} [p.lkrAmount] amount of LKR to spend/receive
 * @returns {Promise<object>} the quote, including the signed `quote_id`
 * @throws {QuoteError}
 */
async function buildQuote({ userId, direction, currencyCode, foreignAmount, lkrAmount }) {
  if ((foreignAmount == null) === (lkrAmount == null)) {
    throw new QuoteError("Provide exactly one of foreign_amount or lkr_amount.", 400);
  }

  const { spread, config, source } = await readBoardFor(currencyCode);

  const rate = rateForDirection(direction, spread);
  const resolvedForeignAmount = foreignAmount != null ? foreignAmount : round2(lkrAmount / rate);
  const resolvedLkrAmount = round2(resolvedForeignAmount * rate);
  const spreadBpsApplied = direction === "buy" ? config.sell_spread_bps : config.buy_spread_bps;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000);
  const jti = crypto.randomUUID();

  const claims = {
    jti,
    sub: userId,
    direction,
    currency_code: currencyCode,
    foreign_amount: resolvedForeignAmount,
    rate,
    lkr_amount: resolvedLkrAmount,
    spread_bps_applied: spreadBpsApplied,
    rate_source: source,
    locked_at: now.toISOString(),
  };
  const quoteId = jwt.sign(claims, QUOTE_SECRET, { expiresIn: QUOTE_TTL_SECONDS });

  return {
    quote_id: quoteId,
    direction,
    currency_code: currencyCode,
    foreign_amount: resolvedForeignAmount,
    quoted_rate: rate,
    quoted_lkr_amount: resolvedLkrAmount,
    spread_bps_applied: spreadBpsApplied,
    rate_source: source,
    quote_locked_at: now.toISOString(),
    quote_expires_at: expiresAt.toISOString(),
    ttl_seconds: QUOTE_TTL_SECONDS,
  };
}

/**
 * Verify a quote token belongs to `userId` and hasn't expired.
 * @param {string} quoteId
 * @param {number} userId
 * @returns {object} decoded claims (see buildQuote)
 * @throws {QuoteError} 410 if expired, 400 if malformed, 403 if another user's
 */
function verifyQuote(quoteId, userId) {
  let decoded;
  try {
    decoded = jwt.verify(quoteId, QUOTE_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new QuoteError("This quote has expired. Please request a new quote.", 410);
    }
    throw new QuoteError("Invalid quote id.", 400);
  }
  if (decoded.sub !== userId) {
    throw new QuoteError("This quote does not belong to you.", 403);
  }
  return decoded;
}

module.exports = {
  QuoteError,
  buildQuote,
  verifyQuote,
  rateForDirection,
  QUOTE_TTL_SECONDS,
  MAX_BOARD_AGE_MS,
};

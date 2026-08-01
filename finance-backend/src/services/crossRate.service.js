"use strict";

/**
 * Cross-rate conversion — the ONE place that converts between the H.10/
 * model quote convention ("<currency> units per 1 USD") and the retail
 * board convention ("LKR per 1 unit of foreign currency"). Every other
 * module (rateFeed.service.js, currency.controller.js, and the Phase 10
 * exchange quote service) must call through here rather than re-deriving
 * the math — this exact inversion already caused one bug in this codebase
 * (CURRENCY_FEATURE.md §7.3: an XGBoost "up" trend means the currency is
 * *weakening*, not strengthening, because of this same units-per-USD
 * convention being easy to get backwards).
 */

/**
 * Convert a USD-per-unit rate map into LKR per 1 unit of `code`.
 *
 * @param {Record<string, number>} usdPerUnitRates rates keyed by ISO code,
 *   each value being "<code> units per 1 USD" (the H.10/model convention).
 *   Must include an LKR entry.
 * @param {string} code the currency to price in LKR (e.g. "USD", "EUR").
 * @returns {number} LKR per 1 unit of `code`.
 * @throws {Error} if the LKR rate or the `code` rate is missing/invalid.
 */
function toLkrPerUnit(usdPerUnitRates, code) {
  const lkrPerUsd = usdPerUnitRates && usdPerUnitRates.LKR;
  if (!(lkrPerUsd > 0)) {
    throw new Error("Missing or invalid LKR rate; cannot derive a cross-rate.");
  }
  if (code === "USD") {
    return lkrPerUsd;
  }
  const codePerUsd = usdPerUnitRates[code];
  if (!(codePerUsd > 0)) {
    throw new Error(`Missing or invalid ${code} rate; cannot derive a cross-rate.`);
  }
  // (LKR / USD) / (code / USD) = LKR / code
  return lkrPerUsd / codePerUsd;
}

/**
 * Apply an admin-configured buy/sell spread (basis points) to a mid rate.
 * The bank buys foreign currency from a customer BELOW mid and sells it
 * ABOVE mid — the spread is the bank's margin either direction.
 *
 * @param {number} midRate
 * @param {{buySpreadBps: number, sellSpreadBps: number}} spread
 * @returns {{buy_rate: number, sell_rate: number}}
 */
function applySpread(midRate, { buySpreadBps, sellSpreadBps }) {
  return {
    buy_rate: midRate * (1 - buySpreadBps / 10000),
    sell_rate: midRate * (1 + sellSpreadBps / 10000),
  };
}

module.exports = { toLkrPerUnit, applySpread };

"use strict";

/**
 * Risk-based interest pricing (D3) — pure, deterministic. No DB, no I/O.
 *
 * Every loan_products row carries one `interest_rate` — the STANDARD rate,
 * applied to a medium-risk applicant. A product MAY also carry
 * `min_interest_rate`/`max_interest_rate` (migration 031); when it does,
 * this module resolves which of the three an applicant is actually priced
 * at, from the risk band the ML model placed them in:
 *
 *   Low risk (0)    → min_interest_rate  (preferential)
 *   Medium risk (1) → interest_rate      (standard — unchanged from today)
 *   High risk (2)   → max_interest_rate  (premium)
 *
 * A product with no configured range prices every applicant at
 * interest_rate, exactly as the system behaved before D3 — the range is
 * opt-in per product, not a forced repricing of the whole catalogue.
 *
 * WHY THIS RUNS AFTER THE ML CALL, AND WHY THAT MATTERS DOWNSTREAM:
 * the risk band this module needs is the ML model's output, so pricing can
 * only happen once predictRisk() has returned — see loan.controller.js
 * assess(). Everything that depends on the applicant's actual instalment
 * (credit policy's DTI/residual-income rules, and the recommended EMI shown
 * to the applicant) must be computed from the PRICED rate, not the base
 * product rate, or they would be judging a number nobody was actually
 * offered. D1's creditPolicy.service.js was already built to take a
 * precomputed EMI rather than a rate, precisely so this could slot in ahead
 * of it without changing that module at all.
 *
 * The rate fed to the ML model ITSELF is unaffected by any of this — the
 * model receives the product's base rate as one of its 35 raw input
 * features, the same way a real underwriter assesses an application against
 * the product's headline terms before a risk-based price is set. This
 * module produces an OUTPUT of that assessment, not an input to it.
 */

/** Risk label → which bound of the product's range it prices to. */
const TIER_BY_RISK = { 0: "preferential", 1: "standard", 2: "premium" };

/** Coerce to a finite number, or null when the value isn't usable. */
function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a product's min/max form a genuine, sane range around its base
 * rate. Both bounds must be present and satisfy min ≤ base ≤ max —
 * admin.routes.js PRODUCT_VALIDATORS enforces this at write time, but a row
 * written before that validator existed (or edited directly in the
 * database) must not silently misprice an applicant, so this is checked
 * again here rather than trusted.
 * @param {number|null} base
 * @param {number|null} min
 * @param {number|null} max
 * @returns {boolean}
 */
function isConfiguredRange(base, min, max) {
  return (
    min !== null &&
    max !== null &&
    base !== null &&
    min <= base &&
    base <= max
  );
}

/**
 * Resolve the interest rate an application is actually priced at.
 *
 * @param {object} p
 * @param {number} p.baseRate   the product's interest_rate (standard rate)
 * @param {number|null} [p.minRate] the product's min_interest_rate, if configured
 * @param {number|null} [p.maxRate] the product's max_interest_rate, if configured
 * @param {number} p.riskLabel  0 (Low) / 1 (Medium) / 2 (High), from the ML model
 * @returns {{rate:number, tier:string|null, risk_based:boolean}}
 *   `tier` is one of TIER_BY_RISK's values when risk_based is true, else null
 *   — a flat-rate product has no tier to name, only a rate.
 */
function priceInterestRate({ baseRate, minRate, maxRate, riskLabel } = {}) {
  const base = toNumber(baseRate);
  const min = toNumber(minRate);
  const max = toNumber(maxRate);

  if (base === null) {
    throw new Error("priceInterestRate requires a numeric baseRate.");
  }

  if (!isConfiguredRange(base, min, max)) {
    return { rate: base, tier: null, risk_based: false };
  }

  // Normalised so a risk label arriving as a string (SQL/JSON round-trips
  // it that way) still matches — but compared numerically, never loosely,
  // so it stays exact.
  const label = toNumber(riskLabel);

  // Medium risk and any risk label this module doesn't recognise both land
  // on the base rate — an unrecognised input must never resolve to a
  // discount or a premium it wasn't shown to have earned.
  if (label === 0) return { rate: min, tier: TIER_BY_RISK[0], risk_based: true };
  if (label === 2) return { rate: max, tier: TIER_BY_RISK[2], risk_based: true };
  return { rate: base, tier: TIER_BY_RISK[1], risk_based: true };
}

module.exports = {
  priceInterestRate,
  isConfiguredRange,
  TIER_BY_RISK,
};

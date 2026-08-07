"use strict";

/**
 * Loan-offer terms — pure, deterministic rules. No DB, no I/O.
 *
 * Turns "staff approved this application, optionally with counter-offered
 * terms" into the exact numbers that go on the offer (migration 023). The
 * EMI is ALWAYS computed here from the resolved terms and never taken from
 * the request body: it is the figure the applicant contractually agrees to
 * pay, so a client must not be able to state it.
 *
 * See recommendation.service.js for the EMI formulas themselves and
 * applicationStatus.service.js for the status machine the offer plugs into.
 */

const { computeEmiForRateType } = require("./recommendation.service");

/** How long an offer stands before it lapses, unless staff override it. */
const DEFAULT_OFFER_VALIDITY_DAYS = 14;
const MIN_OFFER_VALIDITY_DAYS = 1;
const MAX_OFFER_VALIDITY_DAYS = 90;

/** Round money to 2dp without accumulating binary-float drift. */
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve the terms of an offer.
 *
 * Each term falls back through: what staff explicitly offered → what the
 * engine recommended → what the applicant asked for. That ordering is the
 * point of the feature: staff can counter-offer, but if they just click
 * Approve the applicant gets the recommended terms rather than silently
 * getting exactly what they asked for regardless of affordability.
 *
 * The interest rate defaults to whatever this application was actually
 * ASSESSED at — application.priced_interest_rate (D3's risk-based pricing,
 * migration 031) when the application has one, else the product's flat
 * interest_rate for applications assessed before D3 or on a product with no
 * configured range. Approving an application must quote the applicant the
 * rate their own assessment priced them at, not a fresh read of the
 * product's base rate, which could differ if the product was re-priced
 * since. rate_type always comes from the PRODUCT — the recommendation
 * engine never re-prices it, and rate_type additionally selects the EMI
 * formula.
 *
 * @param {object} p
 * @param {object} p.application  { requested_amount, tenure_months,
 *                                  recommended_amount, priced_interest_rate }
 * @param {object} p.product      { interest_rate, rate_type, min_amount,
 *                                  max_amount, min_tenure_months,
 *                                  max_tenure_months }
 * @param {object} [p.overrides]  { amount, tenure_months, interest_rate,
 *                                  validity_days } — staff's counter-offer
 * @returns {{amount:number, tenureMonths:number, interestRate:number,
 *            rateType:string, emi:number, totalRepayable:number,
 *            validityDays:number}}
 * @throws {Error} when the resolved terms fall outside the product's own
 *   advertised limits — an offer the product could never honour is a bug,
 *   not a business decision.
 */
function buildOfferTerms({ application, product, overrides = {} }) {
  const firstNumber = (...candidates) => {
    for (const c of candidates) {
      const n = Number(c);
      if (c !== null && c !== undefined && c !== "" && Number.isFinite(n)) return n;
    }
    return NaN;
  };

  const amount = firstNumber(
    overrides.amount,
    application.recommended_amount,
    application.requested_amount
  );
  const tenureMonths = firstNumber(overrides.tenure_months, application.tenure_months);
  const interestRate = firstNumber(
    overrides.interest_rate,
    application.priced_interest_rate,
    product.interest_rate
  );
  const rateType = product.rate_type === "flat" ? "flat" : "reducing";
  const validityDays = Number.isFinite(Number(overrides.validity_days))
    ? Number(overrides.validity_days)
    : DEFAULT_OFFER_VALIDITY_DAYS;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Offer amount must be a positive number.");
  }
  if (!Number.isFinite(tenureMonths) || tenureMonths <= 0) {
    throw new Error("Offer tenure must be a positive number of months.");
  }
  if (!Number.isFinite(interestRate) || interestRate < 0) {
    throw new Error("Offer interest rate must be zero or greater.");
  }
  if (validityDays < MIN_OFFER_VALIDITY_DAYS || validityDays > MAX_OFFER_VALIDITY_DAYS) {
    throw new Error(
      `Offer validity must be between ${MIN_OFFER_VALIDITY_DAYS} and ${MAX_OFFER_VALIDITY_DAYS} days.`
    );
  }

  // The product's own limits bound a counter-offer exactly as they bound the
  // original request (see loan.controller.js assess) — staff may offer the
  // applicant less than they asked for, but not something the product
  // doesn't sell.
  const minAmount = Number(product.min_amount);
  const maxAmount = Number(product.max_amount);
  if (Number.isFinite(minAmount) && Number.isFinite(maxAmount)) {
    if (amount < minAmount || amount > maxAmount) {
      throw new Error(
        `Offer amount must be between ${minAmount} and ${maxAmount} for this product.`
      );
    }
  }
  const minTenure = Number(product.min_tenure_months);
  const maxTenure = Number(product.max_tenure_months);
  if (Number.isFinite(minTenure) && Number.isFinite(maxTenure)) {
    if (tenureMonths < minTenure || tenureMonths > maxTenure) {
      throw new Error(
        `Offer tenure must be between ${minTenure} and ${maxTenure} months for this product.`
      );
    }
  }

  const emi = round2(computeEmiForRateType(amount, interestRate, tenureMonths, rateType));

  return {
    amount: round2(amount),
    tenureMonths: Math.round(tenureMonths),
    interestRate,
    rateType,
    emi,
    // Headline "what this loan costs you in total" for the offer letter.
    // Derived, not stored — see migration 023.
    totalRepayable: round2(emi * Math.round(tenureMonths)),
    validityDays,
  };
}

module.exports = {
  buildOfferTerms,
  DEFAULT_OFFER_VALIDITY_DAYS,
  MIN_OFFER_VALIDITY_DAYS,
  MAX_OFFER_VALIDITY_DAYS,
};

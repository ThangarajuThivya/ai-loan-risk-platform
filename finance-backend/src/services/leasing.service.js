"use strict";

/**
 * Vehicle leasing maths (L0.2) — pure, no DB and no I/O, like
 * loanFees.service.js and amortization.service.js. Everything here is a
 * function of its arguments so it can be unit-tested in isolation.
 *
 * The rental itself is NOT calculated here. A lease is priced with the same
 * flat/reducing convention as every other product, so this delegates to
 * recommendation.service.js's computeEmiForRateType rather than writing a
 * second EMI formula that could drift from the first. What IS here is
 * everything a lease has that a loan does not: a down payment, a financed
 * amount that differs from the requested one, loan-to-value against an
 * independent valuation, and an early-settlement rebate on a flat-rate
 * contract.
 */

const { computeEmiForRateType } = require("./recommendation.service");

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const VEHICLE_CONDITIONS = ["brand_new", "reconditioned", "used"];

/**
 * Minimum the customer must put in, as a percentage of the PRICE THEY PAY.
 *
 * Older metal is worth less the moment it leaves the forecourt and is
 * harder to sell on repossession, so the institution's exposure has to be
 * smaller from day one. These are house policy, not statute — they are the
 * one knob to turn if the lender wants to be more or less aggressive.
 */
const MIN_DOWN_PAYMENT_PERCENT = {
  brand_new: 20,
  reconditioned: 25,
  used: 30,
};

/**
 * Maximum the institution will finance, as a percentage of what the asset
 * is actually WORTH.
 *
 * These look like the mirror image of the minimum down payment, and for a
 * brand-new vehicle they are: invoice and value are the same number, so
 * either test gives the same answer. They stop being the same test the
 * moment the two figures diverge — a used vehicle invoiced at 5,000,000 but
 * valued at 4,000,000 clears a 30% down payment easily while still leaving
 * the lender financing 87.5% of what the asset would actually fetch. That
 * gap is the whole reason both checks exist.
 */
const MAX_LTV_PERCENT = {
  brand_new: 80,
  reconditioned: 75,
  used: 70,
};

function isPositiveFinite(n) {
  return Number.isFinite(n) && n > 0;
}

/**
 * Brand-new vehicles are bought from a franchise dealer against a printed
 * invoice, so that invoice IS the market value and a valuation would be
 * theatre. Everything else needs an independent opinion before approval.
 *
 * @param {string} condition
 * @returns {boolean}
 */
function requiresValuation(condition) {
  return condition !== "brand_new";
}

/**
 * @param {string} condition
 * @returns {number} minimum down payment percentage
 */
function minimumDownPaymentPercent(condition) {
  return MIN_DOWN_PAYMENT_PERCENT[condition] ?? MIN_DOWN_PAYMENT_PERCENT.used;
}

/**
 * @param {string} condition
 * @returns {number} maximum loan-to-value percentage
 */
function maxLtvPercent(condition) {
  return MAX_LTV_PERCENT[condition] ?? MAX_LTV_PERCENT.used;
}

/**
 * Turn whatever the caller supplied — an absolute amount or a percentage —
 * into both, and say whether it clears policy.
 *
 * Deliberately does NOT silently raise a short down payment to the minimum.
 * A quote that quietly changed the customer's money would be a worse bug
 * than one that reports it is short, and staff may legitimately approve an
 * exception (the same stance decisionMatrix.service.js takes on overrides).
 *
 * @param {object} input
 * @param {number} input.vehiclePrice
 * @param {string} input.condition
 * @param {number} [input.downPaymentAmount] absolute LKR, takes precedence
 * @param {number} [input.downPaymentPercent] percentage of vehiclePrice
 * @returns {{amount:number, percent:number, minimumPercent:number,
 *            meetsMinimum:boolean, shortfall:number}|null}
 */
function resolveDownPayment({
  vehiclePrice,
  condition,
  downPaymentAmount,
  downPaymentPercent,
}) {
  const price = Number(vehiclePrice);
  if (!isPositiveFinite(price)) return null;

  const minimumPercent = minimumDownPaymentPercent(condition);

  let amount;
  if (downPaymentAmount !== undefined && downPaymentAmount !== null && downPaymentAmount !== "") {
    amount = Number(downPaymentAmount);
  } else if (
    downPaymentPercent !== undefined &&
    downPaymentPercent !== null &&
    downPaymentPercent !== ""
  ) {
    amount = (price * Number(downPaymentPercent)) / 100;
  } else {
    // Nothing supplied: quote the policy minimum, which is what the
    // customer would be asked for anyway.
    amount = (price * minimumPercent) / 100;
  }

  if (!Number.isFinite(amount) || amount < 0) return null;
  // A down payment at or above the price is not a lease.
  if (amount >= price) return null;

  amount = round2(amount);
  const percent = round2((amount / price) * 100);
  const requiredAmount = round2((price * minimumPercent) / 100);

  return {
    amount,
    percent,
    minimumPercent,
    meetsMinimum: amount >= requiredAmount,
    shortfall: amount >= requiredAmount ? 0 : round2(requiredAmount - amount),
  };
}

/**
 * @param {number} vehiclePrice
 * @param {number} downPaymentAmount
 * @returns {number|null} what the lease actually finances
 */
function computeFinancedAmount(vehiclePrice, downPaymentAmount) {
  const price = Number(vehiclePrice);
  const down = Number(downPaymentAmount);
  if (!isPositiveFinite(price)) return null;
  if (!Number.isFinite(down) || down < 0 || down >= price) return null;
  return round2(price - down);
}

/**
 * The figure loan-to-value is measured against.
 *
 * For anything needing a valuation this is the LOWER of the invoice and the
 * valuation, never simply the valuation. Two different frauds are being
 * defended against and taking the lower catches both: an inflated invoice
 * (customer and dealer agree a paper price above the real one, so the
 * customer finances their own down payment) and an inflated valuation (a
 * friendly valuer writes a number that lets the lender over-advance). The
 * honest case is unaffected, because when both figures are truthful they
 * are close and the lower is barely different.
 *
 * @param {object} input
 * @param {string} input.condition
 * @param {number} input.invoicePrice
 * @param {number} [input.valuationAmount]
 * @returns {{base:number, source:string}|null} null when a required
 *          valuation is missing — the caller must not guess
 */
function valuationBase({ condition, invoicePrice, valuationAmount }) {
  const invoice = Number(invoicePrice);
  if (!isPositiveFinite(invoice)) return null;

  if (!requiresValuation(condition)) {
    return { base: round2(invoice), source: "invoice" };
  }

  const valuation = Number(valuationAmount);
  if (!isPositiveFinite(valuation)) return null;

  return valuation < invoice
    ? { base: round2(valuation), source: "valuation" }
    : { base: round2(invoice), source: "invoice" };
}

/**
 * @param {number} financedAmount
 * @param {number} base
 * @returns {number|null} loan-to-value as a percentage
 */
function computeLtv(financedAmount, base) {
  const financed = Number(financedAmount);
  const b = Number(base);
  if (!Number.isFinite(financed) || financed < 0) return null;
  if (!isPositiveFinite(b)) return null;
  return round2((financed / b) * 100);
}

/**
 * The full LTV verdict, ready for the LEASE_LTV credit-policy rule (L2.2).
 *
 * Returns a `decidable: false` result rather than a pass or a fail when a
 * required valuation has not come back yet. A missing valuation is not a
 * reason to decline and it is certainly not a reason to approve — it means
 * the question cannot be answered, and the application is simply not ready.
 *
 * @returns {{decidable:boolean, reason?:string, ltv?:number, maxLtv?:number,
 *            withinPolicy?:boolean, base?:number, baseSource?:string}}
 */
function assessLtv({ condition, invoicePrice, valuationAmount, financedAmount }) {
  const basis = valuationBase({ condition, invoicePrice, valuationAmount });
  if (!basis) {
    return {
      decidable: false,
      reason: requiresValuation(condition)
        ? "valuation_required"
        : "invalid_invoice_price",
    };
  }

  const ltv = computeLtv(financedAmount, basis.base);
  if (ltv === null) return { decidable: false, reason: "invalid_financed_amount" };

  const maxLtv = maxLtvPercent(condition);
  return {
    decidable: true,
    ltv,
    maxLtv,
    withinPolicy: ltv <= maxLtv,
    base: basis.base,
    baseSource: basis.source,
  };
}

/**
 * A complete lease quote: what goes in up front, what is financed, and what
 * the monthly rental is.
 *
 * @param {object} input
 * @param {number} input.vehiclePrice
 * @param {string} input.condition
 * @param {number} input.annualRatePct
 * @param {number} input.tenureMonths
 * @param {string} [input.rateType] 'flat' (the leasing default) | 'reducing'
 * @param {number} [input.downPaymentAmount]
 * @param {number} [input.downPaymentPercent]
 * @returns {object|null}
 */
function buildLeaseQuote({
  vehiclePrice,
  condition,
  annualRatePct,
  tenureMonths,
  rateType = "flat",
  downPaymentAmount,
  downPaymentPercent,
}) {
  const price = Number(vehiclePrice);
  const rate = Number(annualRatePct);
  const tenure = Number(tenureMonths);

  if (!isPositiveFinite(price)) return null;
  if (!Number.isFinite(rate) || rate < 0) return null;
  if (!Number.isInteger(tenure) || tenure <= 0) return null;

  const down = resolveDownPayment({
    vehiclePrice: price,
    condition,
    downPaymentAmount,
    downPaymentPercent,
  });
  if (!down) return null;

  const financedAmount = computeFinancedAmount(price, down.amount);
  if (financedAmount === null) return null;

  const rental = round2(computeEmiForRateType(financedAmount, rate, tenure, rateType));
  const totalRentals = round2(rental * tenure);
  const totalInterest = round2(totalRentals - financedAmount);

  return {
    vehiclePrice: round2(price),
    condition,
    downPaymentAmount: down.amount,
    downPaymentPercent: down.percent,
    minimumDownPaymentPercent: down.minimumPercent,
    meetsMinimumDownPayment: down.meetsMinimum,
    downPaymentShortfall: down.shortfall,
    financedAmount,
    annualRatePct: rate,
    rateType,
    tenureMonths: tenure,
    rental,
    totalRentals,
    totalInterest,
    // What the customer parts with in total across the whole lease.
    totalCost: round2(down.amount + totalRentals),
  };
}

/**
 * Rebate of unearned interest when a flat-rate lease is settled early,
 * by the sum-of-digits method (the "Rule of 78" for a 12-month term).
 *
 *   rebate = totalInterest × [n(n+1)] / [N(N+1)]
 *   where N = full term, n = instalments still outstanding
 *
 * WHY THIS METHOD AND NOT A SIMPLE PRO-RATA: flat-rate interest is charged
 * on the original amount for the whole term, but the lender's money is
 * actually outstanding for less and less of it as rentals come in. Sum-of-
 * digits weights the rebate to reflect that, so a customer settling in
 * month 6 of 60 gets most of the interest back, not 90% of it.
 *
 * This is a POLICY CHOICE, not a law being encoded. The actuarial method
 * (rebate = the true present value of remaining interest) is fairer to the
 * customer and increasingly preferred; sum-of-digits is the traditional
 * approach and is what a flat-rate contract is usually written around.
 * Swapping methods means changing this function and nothing else.
 *
 * @param {object} input
 * @param {number} input.totalInterest  interest over the full term
 * @param {number} input.tenureMonths   full term (N)
 * @param {number} input.instalmentsPaid
 * @returns {number|null}
 */
function unearnedInterestRebate({ totalInterest, tenureMonths, instalmentsPaid }) {
  const interest = Number(totalInterest);
  const N = Number(tenureMonths);
  const paid = Number(instalmentsPaid);

  if (!Number.isFinite(interest) || interest < 0) return null;
  if (!Number.isInteger(N) || N <= 0) return null;
  if (!Number.isInteger(paid) || paid < 0 || paid > N) return null;

  const remaining = N - paid;
  if (remaining === 0) return 0;

  return round2((interest * (remaining * (remaining + 1))) / (N * (N + 1)));
}

/**
 * What it costs to end a flat-rate lease today.
 *
 *   gross outstanding = rental × instalments not yet paid
 *   settlement        = gross − rebate of unearned interest
 *
 * Note this is the ASSET-FINANCE settlement figure and is separate from
 * repaymentQuote.service.js, which quotes settlement for reducing-balance
 * loans where outstanding principal is already the answer. Applying that
 * logic to a flat-rate lease would overcharge, because a flat contract's
 * remaining rentals still carry interest the lender has not earned.
 *
 * @returns {{instalmentsRemaining:number, grossOutstanding:number,
 *            interestRebate:number, settlementAmount:number}|null}
 */
function computeEarlySettlement({
  rental,
  totalInterest,
  tenureMonths,
  instalmentsPaid,
}) {
  const r = Number(rental);
  const N = Number(tenureMonths);
  const paid = Number(instalmentsPaid);

  if (!isPositiveFinite(r)) return null;
  if (!Number.isInteger(N) || N <= 0) return null;
  if (!Number.isInteger(paid) || paid < 0 || paid > N) return null;

  const rebate = unearnedInterestRebate({ totalInterest, tenureMonths: N, instalmentsPaid: paid });
  if (rebate === null) return null;

  const instalmentsRemaining = N - paid;
  const grossOutstanding = round2(r * instalmentsRemaining);

  return {
    instalmentsRemaining,
    grossOutstanding,
    interestRebate: rebate,
    settlementAmount: round2(grossOutstanding - rebate),
  };
}

module.exports = {
  VEHICLE_CONDITIONS,
  MIN_DOWN_PAYMENT_PERCENT,
  MAX_LTV_PERCENT,
  requiresValuation,
  minimumDownPaymentPercent,
  maxLtvPercent,
  resolveDownPayment,
  computeFinancedAmount,
  valuationBase,
  computeLtv,
  assessLtv,
  buildLeaseQuote,
  unearnedInterestRebate,
  computeEarlySettlement,
};

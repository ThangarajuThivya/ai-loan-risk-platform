"use strict";

/**
 * Recommendation engine — pure, deterministic business rules.
 *
 * No DB, no ML service, no I/O. Risk *scoring* happens in the Python ML
 * service; this module turns a risk result + applicant figures into a loan
 * recommendation (loan type, affordable amount, EMI).
 *
 * See GUIDANCE.md §3 and ARCHITECTURE.md §9.2 for the formulas.
 */

// Share of net income that may go to loan repayment, by risk label.
//   0 = Low Risk, 1 = Medium Risk, 2 = High Risk
const AFFORDABILITY_BY_RISK = {
  0: 0.5,
  1: 0.35,
  2: 0.2,
};

/**
 * Flat-rate EMI. Interest is charged on the ORIGINAL principal for the whole
 * term, not on the reducing balance:
 *   totalInterest = P · (annualRatePct/100) · (n/12)
 *   EMI           = (P + totalInterest) / n
 *
 * Two of the six seeded loan_products carry rate_type='flat' (see
 * db/migrations/003_seed_loan_products.sql), so quoting them with the
 * reducing-balance formula would understate the instalment — for the same
 * headline rate a flat loan always costs more per month. Use
 * computeEmiForRateType rather than picking a formula by hand.
 *
 * @param {number} principal      loan principal (P)
 * @param {number} annualRatePct  annual interest rate as a percentage
 * @param {number} tenureMonths   number of monthly instalments (n)
 * @returns {number} monthly instalment
 */
function computeFlatEmi(principal, annualRatePct, tenureMonths) {
  if (tenureMonths <= 0) {
    throw new Error("tenureMonths must be greater than 0");
  }
  if (principal <= 0) {
    return 0;
  }
  const totalInterest = principal * (annualRatePct / 100) * (tenureMonths / 12);
  return (principal + totalInterest) / tenureMonths;
}

/**
 * EMI for a product's actual rate convention. `rate_type` is a column on
 * loan_products and is snapshotted onto every issued offer, so the offer's
 * instalment never silently changes if the product is later re-priced.
 * Anything other than 'flat' is treated as reducing-balance, which is the
 * loan_products default.
 *
 * @param {number} principal
 * @param {number} annualRatePct
 * @param {number} tenureMonths
 * @param {string} [rateType] 'flat' | 'reducing'
 * @returns {number} monthly instalment
 */
function computeEmiForRateType(principal, annualRatePct, tenureMonths, rateType) {
  return rateType === "flat"
    ? computeFlatEmi(principal, annualRatePct, tenureMonths)
    : computeEmi(principal, annualRatePct, tenureMonths);
}

/**
 * Reducing-balance EMI.
 *   EMI = P·r·(1+r)^n / ((1+r)^n − 1),  r = annualRatePct / 12 / 100
 *
 * @param {number} principal      loan principal (P)
 * @param {number} annualRatePct  annual interest rate as a percentage (e.g. 14.5)
 * @param {number} tenureMonths   number of monthly instalments (n)
 * @returns {number} monthly instalment
 */
function computeEmi(principal, annualRatePct, tenureMonths) {
  if (tenureMonths <= 0) {
    throw new Error("tenureMonths must be greater than 0");
  }
  if (principal <= 0) {
    return 0;
  }

  const r = annualRatePct / 12 / 100;

  // Zero-interest edge case: straight-line repayment.
  if (r === 0) {
    return principal / tenureMonths;
  }

  const growth = Math.pow(1 + r, tenureMonths);
  return (principal * r * growth) / (growth - 1);
}

/**
 * Largest principal whose EMI fits the affordable monthly repayment.
 *
 *   maxEMI = netIncome × affordability(riskLabel)
 * then invert the EMI formula to solve for principal P:
 *   P = EMI · ((1+r)^n − 1) / (r·(1+r)^n)
 *
 * @param {number} netIncome      net monthly income
 * @param {number} riskLabel      0 (Low) / 1 (Medium) / 2 (High)
 * @param {number} annualRatePct  annual interest rate as a percentage
 * @param {number} tenureMonths   number of monthly instalments
 * @returns {number} maximum affordable principal
 */
function maxAffordableAmount(netIncome, riskLabel, annualRatePct, tenureMonths) {
  if (tenureMonths <= 0) {
    throw new Error("tenureMonths must be greater than 0");
  }

  const affordability = affordabilityFactor(riskLabel);
  const maxEmi = Math.max(0, netIncome) * affordability;
  if (maxEmi <= 0) {
    return 0;
  }

  const r = annualRatePct / 12 / 100;

  // Zero-interest edge case: invert the straight-line formula.
  if (r === 0) {
    return maxEmi * tenureMonths;
  }

  const growth = Math.pow(1 + r, tenureMonths);
  return (maxEmi * (growth - 1)) / (r * growth);
}

/**
 * Affordability factor for a risk label. Unknown labels fall back to the
 * most conservative (High-risk) factor.
 * @param {number} riskLabel 0 / 1 / 2
 * @returns {number}
 */
function affordabilityFactor(riskLabel) {
  const factor = AFFORDABILITY_BY_RISK[riskLabel];
  return factor === undefined ? AFFORDABILITY_BY_RISK[2] : factor;
}

/**
 * Map an application to a Sri Lankan loan product via deterministic rules.
 *
 * Products: Personal, Housing, Vehicle / Leasing, Education, Business, Pawning.
 * Purpose is the primary signal; amount/income/risk refine borderline cases.
 *
 * @param {object} p
 * @param {string} [p.purpose]   applicant-stated purpose (free text)
 * @param {number} [p.amount]    requested amount (LKR)
 * @param {number} [p.income]    net monthly income (LKR)
 * @param {number} [p.riskLabel] 0 / 1 / 2
 * @returns {string} loan type
 */
function pickLoanType({ purpose, amount, income, riskLabel } = {}) {
  const text = String(purpose || "").toLowerCase();

  const has = (...words) => words.some((w) => text.includes(w));

  // Explicit, purpose-driven products first.
  if (has("house", "housing", "home", "property", "construction", "renovat", "mortgage")) {
    return "Housing";
  }
  if (has("vehicle", "car", "van", "bike", "motor", "lease", "leasing", "auto")) {
    return "Vehicle / Leasing";
  }
  if (has("education", "study", "student", "tuition", "university", "school", "course")) {
    return "Education";
  }
  if (has("business", "shop", "trade", "working capital", "startup", "commercial", "sme")) {
    return "Business";
  }
  if (has("gold", "pawn", "jewel", "jewellery", "jewelry")) {
    return "Pawning";
  }

  // Fallback: choose between Personal and Pawning for small, higher-risk asks.
  // A small loan with a weak profile maps well to gold-backed Pawning in SL.
  const smallAmount = typeof amount === "number" && amount > 0 && amount <= 200000;
  const lowIncome = typeof income === "number" && income > 0 && income < 50000;
  if (smallAmount && (riskLabel === 2 || lowIncome)) {
    return "Pawning";
  }

  return "Personal";
}

/**
 * Combine loan-type selection, affordability, and EMI into a recommendation.
 *
 * The recommended amount is capped at what the applicant can afford; if they
 * requested less, we honour the smaller requested amount.
 *
 * @param {object} input
 * @param {number} input.netIncome      net monthly income (LKR)
 * @param {number} input.riskLabel      0 / 1 / 2
 * @param {number} input.annualRatePct  annual interest rate as a percentage
 * @param {number} input.tenureMonths   number of monthly instalments
 * @param {number} [input.requestedAmount] amount the applicant asked for (LKR)
 * @param {string} [input.purpose]      applicant-stated purpose
 * @returns {{ loan_type: string, recommended_amount: number,
 *             recommended_emi: number, affordability_factor: number }}
 */
function buildRecommendation({
  netIncome,
  riskLabel,
  annualRatePct,
  tenureMonths,
  requestedAmount,
  purpose,
} = {}) {
  const affordability = affordabilityFactor(riskLabel);
  const affordable = maxAffordableAmount(
    netIncome,
    riskLabel,
    annualRatePct,
    tenureMonths
  );

  let recommendedAmount = affordable;
  if (typeof requestedAmount === "number" && requestedAmount > 0) {
    recommendedAmount = Math.min(requestedAmount, affordable);
  }

  // Round to whole rupees — loans aren't disbursed in fractions of a rupee.
  recommendedAmount = Math.floor(recommendedAmount);

  const recommendedEmi = computeEmi(
    recommendedAmount,
    annualRatePct,
    tenureMonths
  );

  const loanType = pickLoanType({
    purpose,
    amount: recommendedAmount,
    income: netIncome,
    riskLabel,
  });

  return {
    loan_type: loanType,
    recommended_amount: recommendedAmount,
    recommended_emi: Math.round(recommendedEmi * 100) / 100,
    affordability_factor: affordability,
  };
}

module.exports = {
  computeEmi,
  computeFlatEmi,
  computeEmiForRateType,
  maxAffordableAmount,
  affordabilityFactor,
  pickLoanType,
  buildRecommendation,
  AFFORDABILITY_BY_RISK,
};

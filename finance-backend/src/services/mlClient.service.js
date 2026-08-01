"use strict";

/**
 * ML client — the gateway's bridge to the Python risk model.
 *
 * Two responsibilities, kept separate:
 *   1. mapProfileToModelFields() — turn a stored customer profile + a loan
 *      request into the exact 35 raw fields the model's POST /predict expects.
 *   2. predictRisk() — POST those fields to the model and return the risk result.
 *
 * The Python service computes the 6 derived features itself (debt_to_income,
 * guarantor_risk_score, etc.) — we must NOT send them. See
 * loan-risk-model/README.md "How Derived Features Work" and ARCHITECTURE.md §9.1.
 *
 * Many model fields (CRIB history, guarantor liability, banking behaviour) have
 * no source in the current DB yet. Those use documented, deliberately *neutral*
 * defaults below — never silently-risky or silently-flattering values — each
 * marked `TODO source from CRIB` so it is obvious what still needs wiring up.
 */

const axios = require("axios");

const MODEL_URL = (process.env.MODEL_URL || "http://localhost:8000").replace(
  /\/+$/,
  ""
);

// How long to wait on the model before giving up (ms).
const PREDICT_TIMEOUT_MS = 10000;

const RISK_LABELS = { 0: "Low Risk", 1: "Medium Risk", 2: "High Risk" };

/**
 * Neutral defaults for fields with no data source yet. Chosen to sit in the
 * middle of the model's training distribution (see loan-risk-model's
 * data_generator.py) so they neither inflate nor understate risk. Replace each
 * as a real source becomes available.
 */
const NEUTRAL_DEFAULTS = {
  // --- Personal (no column in customer_profiles) ---
  marital_status: "Married", // most common in SL data (~55%) — used only if not declared
  province: "Western", // TODO source from profile — most populous province
  education_level: "A/L", // modal education level — used only if not declared
  occupation: "Private Sector", // used only if not declared
  years_employed: 5, // used only if not declared

  // --- Income ---
  additional_income: 0, // used only if not declared
  income_stability: 0.7, // TODO source from profile
  employer_category: "SME", // used only if not declared

  // --- Expenses & Banking ---
  rent: 0, // TODO source from profile — not separated from monthly_expense
  digital_payment_ratio: 0.5, // TODO source from CRIB/banking

  // --- Loan / CRIB history (no CRIB integration yet) ---
  existing_loans: 0, // used only if not declared
  previous_defaults: 0, // used only if not declared
  crib_score: 700, // moderate, mid-range score — used only if not self-declared
  active_facilities: 1, // TODO source from CRIB
  credit_utilization: 30, // TODO source from CRIB
  number_of_defaults: 0, // TODO source from CRIB
  overdue_installments: 0, // TODO source from CRIB
  settled_loans: 1, // TODO source from CRIB
  historical_delinquencies: 0, // TODO source from CRIB
  credit_inquiry_count: 1, // TODO source from CRIB
  guarantor_exposure: 0, // used only if not declared
  guarantor_defaults: 0, // used only if not declared
  loan_restructuring_history: 0, // TODO source from CRIB
  highest_outstanding_balance: 0, // TODO source from CRIB
  avg_repayment_behaviour: 0.85, // TODO source from CRIB — decent, neutral history
};

/**
 * Allowed categorical values for the applicant-declarable fields, copied
 * verbatim from loan-risk-model/src/data_generator.py so the values the
 * gateway accepts always match a category the model was actually trained on.
 * Exported so loan.routes.js can validate against the same source of truth.
 */
const CATEGORY_VALUES = {
  marital_status: ["Single", "Married", "Divorced"],
  education_level: ["Below O/L", "O/L", "A/L", "Bachelor", "Master or Higher"],
  occupation: [
    "Private Sector",
    "Government",
    "Business Owner",
    "Teacher",
    "Driver",
    "IT/Tech",
    "Garment",
    "Other",
  ],
  employer_category: [
    "Large Corporate",
    "SME",
    "Government",
    "Startup",
    "Other",
  ],
};

/**
 * The subset of model fields a customer can optionally self-declare on the
 * loan application form, replacing a hardcoded NEUTRAL_DEFAULTS constant with
 * a real (if unverified) value. Anything not declared keeps using the
 * existing neutral default.
 */
const DECLARABLE_FIELDS = [
  "marital_status",
  "education_level",
  "occupation",
  "employer_category",
  "years_employed",
  "additional_income",
  "existing_loans",
  "previous_defaults",
  "crib_score",
  "guarantor_exposure",
  "guarantor_defaults",
];

/**
 * Whether a declared-field value was actually supplied (vs. omitted/blank).
 * @param {*} value
 * @returns {boolean}
 */
function isProvided(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Whole years between a date of birth and now. Returns a documented neutral
 * default (30) when the DOB is missing or unparseable.
 * @param {string|Date} dob date_of_birth (e.g. "1990-04-12")
 * @returns {number} age in years
 */
function ageFromDob(dob) {
  const DEFAULT_AGE = 30; // TODO source from profile — used only when DOB missing
  if (!dob) return DEFAULT_AGE;

  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return DEFAULT_AGE;

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Coerce a value to a finite number, or fall back.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build the exact 35 raw model fields from a stored profile + a loan request.
 *
 * Real sources today: age (from date_of_birth), gender, employment_type,
 * monthly_salary/monthly_expenses (from profile income/expense), and
 * loan_amount/loan_tenure_months/interest_rate (from the loan request), plus
 * whichever DECLARABLE_FIELDS the applicant chose to self-declare on the
 * application form (see `declared`). savings_ratio is derived from income vs.
 * expense. Everything else — and any declarable field left blank — uses the
 * documented NEUTRAL_DEFAULTS above.
 *
 * The 6 derived features are intentionally NOT included — the model computes
 * them. Returns exactly the 35 raw fields, in schema order.
 *
 * @param {object} profile      a customer_profiles row (date_of_birth, gender,
 *                              employment_type, monthly_income, monthly_expense…),
 *                              OR a manually-entered profile carrying `age`
 *                              directly instead of `date_of_birth` (see
 *                              loan.controller.js#manualAssess) — `age` wins
 *                              over `date_of_birth` when both are present
 * @param {object} loanRequest  { requested_amount, tenure_months, interest_rate }
 * @param {object} [declared]   applicant-declared overrides for DECLARABLE_FIELDS
 *                              (see loan.controller.js#assess) — any field left
 *                              undefined/null/"" falls back to NEUTRAL_DEFAULTS
 * @returns {object} the 35 raw fields for POST /predict
 */
function mapProfileToModelFields(profile = {}, loanRequest = {}, declared = {}) {
  const D = NEUTRAL_DEFAULTS;

  // Use the declared value when the applicant provided one, else the neutral
  // default — never let an unrelated 0/"" fall through as "not provided".
  const pick = (value, fallback) => (isProvided(value) ? value : fallback);
  const pickNum = (value, fallback) =>
    isProvided(value) ? num(value, fallback) : fallback;

  const monthlySalary = num(profile.monthly_income, 0);
  const monthlyExpenses = num(profile.monthly_expense, 0);
  const additionalIncome = pickNum(declared.additional_income, D.additional_income);
  const totalIncome = monthlySalary + additionalIncome;

  // savings_ratio is genuinely derivable: the share of income not spent.
  // Clamp to [0, 1]; fall back to a neutral 0.15 when income is unknown.
  let savingsRatio = 0.15; // TODO source from profile — neutral when income unknown
  if (totalIncome > 0) {
    savingsRatio = (totalIncome - monthlyExpenses) / totalIncome;
    savingsRatio = Math.min(1, Math.max(0, savingsRatio));
  }

  // avg_bank_balance has no source; approximate as one month's income (a
  // neutral, non-risky proxy) rather than inventing a figure.
  const avgBankBalance = monthlySalary; // TODO source from banking — 1-month-income proxy

  return {
    // --- Personal ---
    age: isProvided(profile.age) ? num(profile.age, 30) : ageFromDob(profile.date_of_birth),
    gender: profile.gender || "Male", // TODO confirm profile.gender is always set
    marital_status: pick(declared.marital_status, D.marital_status),
    province: D.province,
    education_level: pick(declared.education_level, D.education_level),
    occupation: pick(declared.occupation, D.occupation),
    employment_type: profile.employment_type || "Permanent",
    years_employed: pickNum(declared.years_employed, D.years_employed),

    // --- Income ---
    monthly_salary: monthlySalary,
    additional_income: additionalIncome,
    income_stability: D.income_stability,
    employer_category: pick(declared.employer_category, D.employer_category),

    // --- Expenses & Banking ---
    monthly_expenses: monthlyExpenses,
    rent: D.rent,
    savings_ratio: savingsRatio,
    avg_bank_balance: avgBankBalance,
    digital_payment_ratio: D.digital_payment_ratio,

    // --- Loan (from the request) ---
    existing_loans: pickNum(declared.existing_loans, D.existing_loans),
    loan_amount: num(loanRequest.requested_amount, 0),
    loan_tenure_months: num(loanRequest.tenure_months, 0),
    interest_rate: num(loanRequest.interest_rate, 0),
    previous_defaults: pickNum(declared.previous_defaults, D.previous_defaults),

    // --- CRIB (no bureau integration yet — self-declared or neutral default) ---
    crib_score: pickNum(declared.crib_score, D.crib_score),
    active_facilities: D.active_facilities,
    credit_utilization: D.credit_utilization,
    number_of_defaults: D.number_of_defaults,
    overdue_installments: D.overdue_installments,
    settled_loans: D.settled_loans,
    historical_delinquencies: D.historical_delinquencies,
    credit_inquiry_count: D.credit_inquiry_count,
    guarantor_exposure: pickNum(declared.guarantor_exposure, D.guarantor_exposure),
    guarantor_defaults: pickNum(declared.guarantor_defaults, D.guarantor_defaults),
    loan_restructuring_history: D.loan_restructuring_history,
    highest_outstanding_balance: D.highest_outstanding_balance,
    avg_repayment_behaviour: D.avg_repayment_behaviour,
  };
}

/**
 * Call the Python model's POST /predict with the 35 raw fields.
 *
 * @param {object} fields the output of mapProfileToModelFields()
 * @returns {Promise<{risk_label:number, risk_category:string, probabilities:object}>}
 * @throws {Error} on timeout, connection failure, or non-2xx response — with a
 *                  message that identifies the model service as the cause.
 */
async function predictRisk(fields) {
  const url = `${MODEL_URL}/predict`;

  let response;
  try {
    response = await axios.post(url, fields, {
      timeout: PREDICT_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.response) {
      // The model replied, but with an error status (e.g. 422 validation).
      const detail =
        err.response.data && err.response.data.detail
          ? JSON.stringify(err.response.data.detail)
          : `HTTP ${err.response.status}`;
      throw new Error(`Risk model rejected the request (${detail}).`);
    }
    if (err.code === "ECONNABORTED") {
      throw new Error(
        `Risk model timed out after ${PREDICT_TIMEOUT_MS}ms at ${url}.`
      );
    }
    throw new Error(
      `Could not reach the risk model at ${url}: ${err.message}. ` +
        `Is the Python service running (uvicorn api.main:app --port 8000)?`
    );
  }

  const data = response.data || {};
  if (typeof data.risk_label !== "number" || !data.probabilities) {
    throw new Error(
      `Risk model returned an unexpected payload: ${JSON.stringify(data)}`
    );
  }

  return {
    risk_label: data.risk_label,
    risk_category: data.risk_category || RISK_LABELS[data.risk_label],
    probabilities: data.probabilities,
  };
}

module.exports = {
  mapProfileToModelFields,
  predictRisk,
  ageFromDob,
  isProvided,
  NEUTRAL_DEFAULTS,
  CATEGORY_VALUES,
  DECLARABLE_FIELDS,
  MODEL_URL,
};

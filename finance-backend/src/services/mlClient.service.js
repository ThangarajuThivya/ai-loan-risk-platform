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
const {
  reconcileDeclaredCribScore,
} = require("./behaviouralFeatures.service");

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

  // --- Loan / credit history ---
  // EVERY field below is `null` when unknown, deliberately, and that is a
  // change of principle rather than of value.
  //
  // These used to hold "neutral" population averages — crib_score 700,
  // credit_utilization 30, avg_repayment_behaviour 0.85, defaults 0. An
  // average is not neutral in effect: 0.85 asserts the applicant pays
  // reliably, and 0 overdue asserts they are never late. Together this block
  // carries a large share of the model's gain, so a first-time applicant was
  // credited with exemplary conduct nobody had ever observed. Measured, an
  // applicant declaring three defaults still scored "Low Risk".
  //
  // The model is trained with these fields absent at the rate production
  // actually lacks them, and XGBoost learns a default branch per split for
  // missing values, so `null` is a value it knows how to read: "unknown", not
  // "fine". Anything genuinely known still overrides — behavioural
  // observations from the customer's own accounts
  // (behaviouralFeatures.service.js), or their own declaration.
  existing_loans: null, // behavioural; also declarable
  crib_score: null, // no CRIB feed — known only if self-declared
  active_facilities: null, // behavioural
  credit_utilization: null, // behavioural
  number_of_defaults: null, // behavioural; also declarable
  overdue_installments: null, // behavioural
  settled_loans: null, // behavioural
  historical_delinquencies: null, // behavioural
  credit_inquiry_count: null, // behavioural
  guarantor_exposure: 0, // declared; absent genuinely means none pledged
  guarantor_defaults: 0, // declared; absent genuinely means none called up
  loan_restructuring_history: null, // behavioural (no restructure flow exists yet)
  highest_outstanding_balance: null, // behavioural
  avg_repayment_behaviour: null, // behavioural
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
 * The subset of DECLARABLE_FIELDS that are ALSO durable customer_profiles
 * columns (H2/036) — stable attributes (marital status, education,
 * occupation, employer category, years employed) rather than per-application
 * facts. Shared by loan.controller.js (profile fallback + write-back) and
 * user.controller.js (profile page get/update) so both agree on the set.
 */
const PROFILE_BACKED_FIELDS = [
  "marital_status",
  "education_level",
  "occupation",
  "employer_category",
  "years_employed",
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
 * Build the raw model fields from a stored profile + a loan request.
 *
 * PRECEDENCE, weakest to strongest:
 *   1. NEUTRAL_DEFAULTS      a documented mid-distribution assumption
 *   2. behavioural           derived from the customer's own record with us
 *   3. declared              what the applicant stated on the form
 *   4. profile / request     hard facts we hold
 *
 * Behavioural beats a default because an observation beats an assumption.
 * A declaration beats a behavioural value because the applicant can see
 * facilities held at OTHER institutions that our own record cannot — our
 * history is a lower bound on theirs, never the whole picture.
 *
 * `gender` is deliberately NOT sent. It is a protected attribute and must not
 * influence a credit decision; the v2 model does not accept it (see
 * loan-risk-model/src/config.py EXCLUDED_PROTECTED_ATTRIBUTES).
 *
 * The derived features (emi, debt_to_income_ratio, disposable_income,
 * guarantor_risk_score, financial_stability_score, ...) are intentionally NOT
 * included — the model computes them from these raw fields, so a caller
 * cannot hand it a flattering stability score and train/serve logic cannot
 * drift apart.
 *
 * @param {object} profile      a customer_profiles row (date_of_birth,
 *                              employment_type, monthly_income, monthly_expense…),
 *                              OR a manually-entered profile carrying `age`
 *                              directly instead of `date_of_birth` (see
 *                              loan.controller.js#manualAssess) — `age` wins
 *                              over `date_of_birth` when both are present
 * @param {object} loanRequest  { requested_amount, tenure_months, interest_rate }
 * @param {object} [declared]   applicant-declared overrides for DECLARABLE_FIELDS
 *                              (see loan.controller.js#assess) — any field left
 *                              undefined/null/"" falls back to the layers below
 * @param {object} [behavioural] the `fields` half of
 *                              behaviouralFeatures.service.js
 *                              deriveBehaviouralFeatures() — omit for an
 *                              applicant with no record with us
 * @returns {object} the raw fields for POST /predict
 */
function mapProfileToModelFields(
  profile = {},
  loanRequest = {},
  declared = {},
  behavioural = {}
) {
  // Behavioural observations sit on top of the neutral assumptions; both are
  // still overridable by an explicit declaration below.
  //
  // A behavioural value of `null` is MEANINGFUL and is preserved, not treated
  // as absent: it says "this institution has no record of that", which the
  // model understands natively (it is trained with the same fields missing at
  // the same rate, and XGBoost learns a default branch for them). Overwriting
  // it with a population average would assert good conduct about a customer
  // nobody has observed — the exact defect this replaced.
  const D = { ...NEUTRAL_DEFAULTS, ...(behavioural || {}) };

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

  // The applicant's own default history. They may have defaulted at other
  // institutions we cannot see, so their declaration is a floor, not a
  // correction — and our own written-off facilities are a floor too. Taking
  // the worse of the two avoids both under-counting (trusting only what they
  // admit) and double-counting (adding a default we already recorded to the
  // same one they declared).
  //
  // This also repairs a real defect: v1 sent the declared value as
  // `previous_defaults`, a field the model measurably ignored (0.00009 swing
  // across its full range), while `number_of_defaults` — ~38% of the model's
  // total gain — was hardcoded to 0. The customer was declaring into a field
  // that did nothing.
  // `null` means "we have no record", and must survive to the model as null.
  const orNull = (value) =>
    value === null || value === undefined ? null : num(value, null);

  const declaredDefaults = isProvided(declared.previous_defaults)
    ? num(declared.previous_defaults, 0)
    : null;
  const observedDefaults = orNull(D.number_of_defaults);
  // Unknown ONLY when neither side says anything. A declaration on its own is
  // still a fact, and so is an observation on its own.
  const numberOfDefaults =
    declaredDefaults === null && observedDefaults === null
      ? null
      : Math.max(declaredDefaults ?? 0, observedDefaults ?? 0);
  const overdueInstallments = orNull(D.overdue_installments);

  // A bureau score summarises exactly the adverse history declared above, so
  // "three defaults AND a score of 900" is self-contradictory rather than
  // merely unlikely. With no CRIB feed to check the claim against, cap it at
  // what that history could plausibly support and record that we did — the
  // contradiction is a signal a reviewer should see, not one to absorb
  // silently. Only binds when the other credit inputs are themselves adverse.
  const cribReconciliation = reconcileDeclaredCribScore(
    isProvided(declared.crib_score) ? num(declared.crib_score, null) : null,
    { number_of_defaults: numberOfDefaults, overdue_installments: overdueInstallments }
  );

  return {
    // --- Personal ---
    age: isProvided(profile.age) ? num(profile.age, 30) : ageFromDob(profile.date_of_birth),
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
    // The PRODUCT'S BASE RATE. The risk-based rate is an OUTPUT of this
    // assessment (interestPricing.service.js runs after predictRisk), so
    // feeding it back in would be circular — and the model was trained on the
    // base rate precisely because that is what it receives here.
    interest_rate: num(loanRequest.interest_rate, 0),

    // --- Credit history: behavioural where we have it, declared where the
    //     applicant knows better, neutral default otherwise ---
    // null where neither the applicant nor our own records can say — see the
    // note on `D` above. The model reads null as "unknown", not as "fine".
    crib_score: cribReconciliation.score,
    active_facilities: orNull(D.active_facilities),
    credit_utilization: orNull(D.credit_utilization),
    number_of_defaults: numberOfDefaults,
    overdue_installments: overdueInstallments,
    settled_loans: orNull(D.settled_loans),
    historical_delinquencies: orNull(D.historical_delinquencies),
    credit_inquiry_count: orNull(D.credit_inquiry_count),
    guarantor_exposure: pickNum(declared.guarantor_exposure, D.guarantor_exposure),
    guarantor_defaults: pickNum(declared.guarantor_defaults, D.guarantor_defaults),
    loan_restructuring_history: orNull(D.loan_restructuring_history),
    highest_outstanding_balance: orNull(D.highest_outstanding_balance),
    avg_repayment_behaviour: orNull(D.avg_repayment_behaviour),
  };
}

/**
 * Call the Python model's POST /predict with the 35 raw fields.
 *
 * @param {object} fields the output of mapProfileToModelFields()
 * @returns {Promise<{risk_label:number, risk_category:string, probabilities:object,
 *                    model_version:string|null}>}
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
    // v2: the calibrated probability of default, and the number the band was
    // derived from. Falls back to the High-Risk class probability so a v1
    // model service (which has no such field) still yields a sensible value
    // rather than null.
    probability_of_default:
      typeof data.probability_of_default === "number"
        ? data.probability_of_default
        : Number(data.probabilities?.["High Risk"]) || 0,
    // Which trained model produced this prediction — a content hash of the
    // loaded .joblib artifact (see loan-risk-model/api/main.py), stored
    // immutably on risk_assessments.model_version for D4's audit trail.
    // null on an older model service that predates this field, so a
    // temporarily mismatched deploy degrades gracefully rather than
    // rejecting an otherwise-valid prediction.
    model_version: data.model_version || null,
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
  PROFILE_BACKED_FIELDS,
  MODEL_URL,
};

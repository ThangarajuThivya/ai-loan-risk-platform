"use strict";

/**
 * Credit policy engine (D1) — pure, deterministic lending rules. No DB, no ML
 * service, no I/O.
 *
 * This is the deliberate counterweight to the ML risk model. The model in
 * loan-risk-model/ produces a probabilistic *opinion* trained on synthetic
 * data; it can be retrained, it can drift, and it can never be pointed at as
 * the reason a specific applicant was declined. The rules here are the
 * opposite on every count: fixed thresholds, hand-checkable arithmetic, and a
 * stable reason code per rule that survives into the adverse-action record
 * (D4). A lender needs both — the score ranks applicants, the policy says
 * which ones the institution will not lend to regardless of rank.
 *
 * Nothing in this module reads a risk label or probability, and that is a
 * design constraint rather than an oversight: the moment policy consumes the
 * score, "independent of the ML model" stops being true and a model change
 * can silently move a hard lending limit. Combining the two verdicts into a
 * single approve/review/reject call is D2's decision matrix, which sits
 * ABOVE both this module and the model.
 *
 * Every rule resolves to one of four statuses:
 *   pass    — the rule was evaluated and satisfied
 *   refer   — satisfied the mandatory floor but warrants a human look
 *   fail    — mandatory criterion breached; the institution does not lend
 *   skipped — the input the rule needs was never supplied (see below)
 *
 * `skipped` matters. Most of the credit-history inputs (CRIB score, prior
 * defaults, guarantor liability) have no bureau integration yet and are
 * self-declared on the application form — mlClient.service.js substitutes a
 * neutral default when the applicant leaves them blank. Policy must never
 * treat one of those neutral defaults as a finding: declining someone for a
 * CRIB score of 700 they never claimed, or clearing them on the same
 * fabricated number, are both wrong. So rules over declarable fields run
 * only when the applicant actually declared, and record `skipped` otherwise,
 * which also leaves an honest trail of how much of the policy could truly be
 * assessed.
 *
 * See recommendation.service.js for the EMI formulas this consumes, and
 * ARCHITECTURE.md §9.1.1 for where policy sits in the assess flow.
 */

const { computeCoverageRatio } = require("./collateralGuarantor.service");

/**
 * The policy thresholds, in one place so a rule's number is never buried in
 * the branch that reads it. Exported because the tests assert against these
 * rather than hardcoding a second copy, and because D2/D3 need to quote the
 * same figures back to staff.
 *
 * Values reflect mainstream Sri Lankan retail lending practice: a retirement
 * age of 60 for the salaried with a 65 ceiling on loan maturity, the ~40%
 * debt-service ratio most local banks underwrite to, and a CRIB score floor
 * in the low 500s.
 */
const POLICY = {
  MIN_AGE: 18,
  MAX_AGE_AT_MATURITY: 65,

  // Gross monthly income (salary + declared additional income), LKR.
  MIN_MONTHLY_INCOME: 30000,

  // Debt-service ratio: the proposed instalment as a share of gross income.
  DTI_REFER_ABOVE: 0.4,
  DTI_MAX: 0.55,

  // What must be left of net (post-expense) income once the instalment is
  // paid, LKR. A DTI inside the limit can still leave a high-expense
  // household with nothing to live on, which is why this runs alongside it.
  MIN_RESIDUAL_INCOME: 15000,

  // Principal as a multiple of ANNUAL gross income.
  LTI_REFER_ABOVE: 5,
  LTI_MAX: 8,

  // Minimum time in current employment, in years. Non-permanent employment
  // carries the longer requirement — a 6-month contract is not 6 months of
  // demonstrated income stability.
  MIN_YEARS_EMPLOYED: 1,
  MIN_YEARS_EMPLOYED_NON_PERMANENT: 2,
  NON_PERMANENT_EMPLOYMENT: ["Contract", "Self-Employed"],

  // Concurrent credit facilities already held.
  MAX_EXISTING_FACILITIES: 4,

  // Prior defaults on the applicant's own borrowing.
  PREVIOUS_DEFAULTS_REFER_AT: 1,
  PREVIOUS_DEFAULTS_MAX: 2,

  // CRIB bureau score (self-declared today — see the `skipped` note above).
  CRIB_SCORE_MIN: 500,
  CRIB_SCORE_REFER_BELOW: 600,

  // Defaults on facilities the applicant guaranteed for someone else.
  GUARANTOR_DEFAULTS_REFER_AT: 1,

  // D5 — verified collateral value as a share of the requested amount,
  // below which pledged security refers for a closer look. Unverified
  // collateral (every item, until staff confirm it) always refers
  // regardless of this ratio — see COLLATERAL_COVERAGE.
  COLLATERAL_COVERAGE_REFER_BELOW: 0.8,
};

/**
 * Bumped whenever a threshold or rule changes, and stored on every
 * evaluation (migration 029). Without it, a decision taken under the old
 * policy is indistinguishable from one taken under the new one, and the
 * adverse-action record D4 builds on becomes unreproducible.
 */
const POLICY_VERSION = "cp-1.0";

/** Outcome ranking — the overall verdict is the worst status any rule returned. */
const OUTCOME_RANK = { pass: 0, refer: 1, decline: 2 };

/** Rule status → the overall outcome that status forces. */
const STATUS_TO_OUTCOME = {
  pass: "pass",
  skipped: "pass",
  refer: "refer",
  fail: "decline",
};

/**
 * Round a ratio to 4dp. The rules compare the ROUNDED value, deliberately:
 * an instalment one rupee over a threshold is rounding dust, not a policy
 * breach, and a borderline case must reach the same verdict as the figure a
 * reviewer sees on screen.
 */
function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

/** Round money to 2dp. */
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Money as it appears in a rule's `detail` sentence: grouped, whole rupees.
 * The stored metric keeps its 2dp — this is presentation only, and a
 * reviewer reading "LKR 62,657.9 would remain" is being shown precision the
 * decision never turned on.
 */
function money(value) {
  return Number(value).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

/**
 * Whether a value was actually supplied. Mirrors mlClient.service.js
 * isProvided — a declarable field left blank arrives as undefined/null/"",
 * and 0 is a real declaration ("no existing loans"), not an absence.
 */
function provided(value) {
  return value !== undefined && value !== null && value !== "";
}

/** Coerce to a finite number, or null when the value isn't usable. */
function toNumber(value) {
  if (!provided(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The applicant's age when the loan's final instalment falls due.
 *
 * Rounds the term UP to whole years: a 30-month loan taken at 63 matures
 * when the borrower is 65, and rounding down would quietly clear a case the
 * rule exists to catch.
 */
function ageAtMaturity(age, tenureMonths) {
  if (age === null || tenureMonths === null) return null;
  return age + Math.ceil(tenureMonths / 12);
}

/**
 * Derive the figures every rule is measured against, so no rule recomputes
 * (and no two rules can disagree about) the applicant's income.
 *
 * `dti` here is the debt-SERVICE ratio — the proposed monthly instalment over
 * gross monthly income. That is deliberately not the `debt_to_income` feature
 * the Python model derives internally; policy is judged on the instalment the
 * applicant would actually have to find each month.
 */
function computeMetrics({ applicant = {}, loan = {} }) {
  const age = toNumber(applicant.age);
  const tenureMonths = toNumber(loan.tenureMonths);
  const salary = toNumber(applicant.monthlyIncome) || 0;
  const additional = toNumber(applicant.additionalIncome) || 0;
  const expenses = toNumber(applicant.monthlyExpense) || 0;
  const emi = toNumber(loan.emi) || 0;
  const amount = toNumber(loan.amount) || 0;

  const grossIncome = salary + additional;
  const netIncome = grossIncome - expenses;

  return {
    age,
    age_at_maturity: ageAtMaturity(age, tenureMonths),
    tenure_months: tenureMonths,
    gross_monthly_income: round2(grossIncome),
    net_monthly_income: round2(netIncome),
    monthly_expense: round2(expenses),
    emi: round2(emi),
    // Ratios are null rather than 0 or Infinity when income is unknown —
    // an undefined ratio must not read as a flawless one.
    dti: grossIncome > 0 ? round4(emi / grossIncome) : null,
    residual_income: round2(netIncome - emi),
    loan_to_income: grossIncome > 0 ? round4(amount / (grossIncome * 12)) : null,
  };
}

/**
 * Build one rule result. `value`/`threshold` are carried alongside the
 * human-readable detail so a UI (or D4's adverse-action letter) can render
 * the finding without re-deriving the arithmetic.
 */
function rule(code, label, status, detail, extra = {}) {
  return { code, label, status, detail, ...extra };
}

/** A rule whose input the applicant never supplied. */
function skipped(code, label, reason) {
  return rule(code, label, "skipped", reason, { value: null, threshold: null });
}

/**
 * Evaluate the full policy against one application.
 *
 * @param {object} p
 * @param {object} p.applicant
 * @param {number} p.applicant.age                  years (from date_of_birth)
 * @param {number} p.applicant.monthlyIncome        gross salary, LKR
 * @param {number} p.applicant.monthlyExpense       declared monthly outgoings, LKR
 * @param {string} [p.applicant.employmentType]     Permanent | Contract | Self-Employed | Government
 * @param {number} [p.applicant.additionalIncome]   declared, LKR
 * @param {number} [p.applicant.yearsEmployed]      declared
 * @param {number} [p.applicant.existingLoans]      declared count
 * @param {number} [p.applicant.previousDefaults]   declared count
 * @param {number} [p.applicant.cribScore]          declared bureau score
 * @param {number} [p.applicant.guarantorDefaults]  declared count — the
 *                                      APPLICANT's OWN liability as
 *                                      guarantor for someone else's loan;
 *                                      see GUARANTOR_RELIABILITY below for
 *                                      the opposite direction
 * @param {object[]} [p.applicant.guarantors]  real guarantors linked to
 *                                      THIS application (D5,
 *                                      collateralGuarantor.service.js
 *                                      summarizeGuarantorFindings output) —
 *                                      each { fullName, otherActiveGuaranteeCount,
 *                                      otherActiveExposure, isDistressedElsewhere }
 * @param {object} p.loan
 * @param {number} p.loan.amount        requested principal, LKR
 * @param {number} p.loan.tenureMonths  requested term
 * @param {number} p.loan.emi           instalment for those terms at the
 *                                      product's rate (compute with
 *                                      recommendation.service computeEmiForRateType)
 * @param {object} [p.loan.collateral]  collateralGuarantor.service.js
 *                                      summarizeCollateral() output for
 *                                      THIS application (D5) — omit or leave
 *                                      itemCount 0 for an unsecured request
 * @returns {{policy_version:string, outcome:'pass'|'refer'|'decline',
 *            metrics:object, rules:object[], reason_codes:string[]}}
 */
function evaluateCreditPolicy({ applicant = {}, loan = {} } = {}) {
  const m = computeMetrics({ applicant, loan });
  const rules = [];

  // --- Eligibility: age ---------------------------------------------------
  if (m.age === null) {
    rules.push(
      skipped("AGE_MIN", "Minimum age", "Date of birth missing from the profile.")
    );
    rules.push(
      skipped(
        "AGE_AT_MATURITY",
        "Age at loan maturity",
        "Date of birth missing from the profile."
      )
    );
  } else {
    rules.push(
      rule(
        "AGE_MIN",
        "Minimum age",
        m.age >= POLICY.MIN_AGE ? "pass" : "fail",
        `Applicant is ${m.age}; the minimum lending age is ${POLICY.MIN_AGE}.`,
        { value: m.age, threshold: POLICY.MIN_AGE }
      )
    );
    rules.push(
      rule(
        "AGE_AT_MATURITY",
        "Age at loan maturity",
        m.age_at_maturity <= POLICY.MAX_AGE_AT_MATURITY ? "pass" : "fail",
        `Applicant would be ${m.age_at_maturity} at the final instalment; the ceiling is ${POLICY.MAX_AGE_AT_MATURITY}.`,
        { value: m.age_at_maturity, threshold: POLICY.MAX_AGE_AT_MATURITY }
      )
    );
  }

  // --- Capacity: income ---------------------------------------------------
  rules.push(
    rule(
      "MIN_MONTHLY_INCOME",
      "Minimum monthly income",
      m.gross_monthly_income >= POLICY.MIN_MONTHLY_INCOME ? "pass" : "fail",
      `Gross monthly income is LKR ${money(m.gross_monthly_income)}; the minimum is LKR ${money(POLICY.MIN_MONTHLY_INCOME)}.`,
      { value: m.gross_monthly_income, threshold: POLICY.MIN_MONTHLY_INCOME }
    )
  );

  rules.push(
    rule(
      "NET_INCOME_POSITIVE",
      "Positive disposable income",
      m.net_monthly_income > 0 ? "pass" : "fail",
      `Declared expenses of LKR ${money(m.monthly_expense)} leave LKR ${money(m.net_monthly_income)} of disposable income.`,
      { value: m.net_monthly_income, threshold: 0 }
    )
  );

  // --- Capacity: debt service --------------------------------------------
  if (m.dti === null) {
    rules.push(
      skipped(
        "DTI_LIMIT",
        "Debt-to-income ratio",
        "No income on record, so the ratio cannot be computed."
      )
    );
  } else {
    let dtiStatus = "pass";
    if (m.dti > POLICY.DTI_MAX) dtiStatus = "fail";
    else if (m.dti > POLICY.DTI_REFER_ABOVE) dtiStatus = "refer";
    rules.push(
      rule(
        "DTI_LIMIT",
        "Debt-to-income ratio",
        dtiStatus,
        `The instalment is ${(m.dti * 100).toFixed(1)}% of gross income (refer above ${(POLICY.DTI_REFER_ABOVE * 100).toFixed(0)}%, decline above ${(POLICY.DTI_MAX * 100).toFixed(0)}%).`,
        { value: m.dti, threshold: POLICY.DTI_MAX }
      )
    );
  }

  let residualStatus = "pass";
  if (m.residual_income < 0) residualStatus = "fail";
  else if (m.residual_income < POLICY.MIN_RESIDUAL_INCOME) residualStatus = "refer";
  rules.push(
    rule(
      "RESIDUAL_INCOME",
      "Residual income after instalment",
      residualStatus,
      `LKR ${money(m.residual_income)} would remain each month after the instalment; the comfort floor is LKR ${money(POLICY.MIN_RESIDUAL_INCOME)}.`,
      { value: m.residual_income, threshold: POLICY.MIN_RESIDUAL_INCOME }
    )
  );

  // --- Capacity: loan size relative to income -----------------------------
  if (m.loan_to_income === null) {
    rules.push(
      skipped(
        "LOAN_TO_INCOME",
        "Loan-to-income multiple",
        "No income on record, so the multiple cannot be computed."
      )
    );
  } else {
    let ltiStatus = "pass";
    if (m.loan_to_income > POLICY.LTI_MAX) ltiStatus = "fail";
    else if (m.loan_to_income > POLICY.LTI_REFER_ABOVE) ltiStatus = "refer";
    rules.push(
      rule(
        "LOAN_TO_INCOME",
        "Loan-to-income multiple",
        ltiStatus,
        `The principal is ${m.loan_to_income.toFixed(1)}× annual gross income (refer above ${POLICY.LTI_REFER_ABOVE}×, decline above ${POLICY.LTI_MAX}×).`,
        { value: m.loan_to_income, threshold: POLICY.LTI_MAX }
      )
    );
  }

  // --- Stability: employment ---------------------------------------------
  const yearsEmployed = toNumber(applicant.yearsEmployed);
  const employmentType = applicant.employmentType || null;
  if (yearsEmployed === null) {
    rules.push(
      skipped(
        "EMPLOYMENT_TENURE",
        "Time in current employment",
        "Not declared on the application."
      )
    );
  } else {
    const requiredYears = POLICY.NON_PERMANENT_EMPLOYMENT.includes(employmentType)
      ? POLICY.MIN_YEARS_EMPLOYED_NON_PERMANENT
      : POLICY.MIN_YEARS_EMPLOYED;
    rules.push(
      rule(
        "EMPLOYMENT_TENURE",
        "Time in current employment",
        yearsEmployed >= requiredYears ? "pass" : "refer",
        `${yearsEmployed} year(s) in current employment${employmentType ? ` (${employmentType})` : ""}; ${requiredYears} expected.`,
        { value: yearsEmployed, threshold: requiredYears }
      )
    );
  }

  // --- Credit history (self-declared — see the module note on `skipped`) ---
  const existingLoans = toNumber(applicant.existingLoans);
  if (existingLoans === null) {
    rules.push(
      skipped(
        "EXISTING_FACILITIES",
        "Existing credit facilities",
        "Not declared on the application."
      )
    );
  } else {
    rules.push(
      rule(
        "EXISTING_FACILITIES",
        "Existing credit facilities",
        existingLoans >= POLICY.MAX_EXISTING_FACILITIES ? "refer" : "pass",
        `${existingLoans} facility/facilities already held; ${POLICY.MAX_EXISTING_FACILITIES} or more warrants review.`,
        { value: existingLoans, threshold: POLICY.MAX_EXISTING_FACILITIES }
      )
    );
  }

  const previousDefaults = toNumber(applicant.previousDefaults);
  if (previousDefaults === null) {
    rules.push(
      skipped("PREVIOUS_DEFAULTS", "Previous defaults", "Not declared on the application.")
    );
  } else {
    let defaultStatus = "pass";
    if (previousDefaults >= POLICY.PREVIOUS_DEFAULTS_MAX) defaultStatus = "fail";
    else if (previousDefaults >= POLICY.PREVIOUS_DEFAULTS_REFER_AT) defaultStatus = "refer";
    rules.push(
      rule(
        "PREVIOUS_DEFAULTS",
        "Previous defaults",
        defaultStatus,
        `${previousDefaults} prior default(s) declared; ${POLICY.PREVIOUS_DEFAULTS_MAX} or more is a mandatory decline.`,
        { value: previousDefaults, threshold: POLICY.PREVIOUS_DEFAULTS_MAX }
      )
    );
  }

  const cribScore = toNumber(applicant.cribScore);
  if (cribScore === null) {
    rules.push(
      skipped(
        "CRIB_SCORE",
        "CRIB score",
        "Not declared, and no credit-bureau integration is available."
      )
    );
  } else {
    let cribStatus = "pass";
    if (cribScore < POLICY.CRIB_SCORE_MIN) cribStatus = "fail";
    else if (cribScore < POLICY.CRIB_SCORE_REFER_BELOW) cribStatus = "refer";
    rules.push(
      rule(
        "CRIB_SCORE",
        "CRIB score",
        cribStatus,
        `Declared score of ${cribScore} (refer below ${POLICY.CRIB_SCORE_REFER_BELOW}, decline below ${POLICY.CRIB_SCORE_MIN}).`,
        { value: cribScore, threshold: POLICY.CRIB_SCORE_MIN }
      )
    );
  }

  const guarantorDefaults = toNumber(applicant.guarantorDefaults);
  if (guarantorDefaults === null) {
    rules.push(
      skipped(
        "GUARANTOR_DEFAULTS",
        "Defaults on guaranteed facilities",
        "Not declared on the application."
      )
    );
  } else {
    rules.push(
      rule(
        "GUARANTOR_DEFAULTS",
        "Defaults on guaranteed facilities",
        guarantorDefaults >= POLICY.GUARANTOR_DEFAULTS_REFER_AT ? "refer" : "pass",
        `${guarantorDefaults} default(s) on facilities the applicant guaranteed.`,
        { value: guarantorDefaults, threshold: POLICY.GUARANTOR_DEFAULTS_REFER_AT }
      )
    );
  }

  // --- Backing: guarantor reliability (D5) ---------------------------------
  // NOT the same input as GUARANTOR_DEFAULTS above. That rule is the
  // applicant's own self-declared liability as guarantor for someone ELSE's
  // loan (unverifiable, hence `skipped` when blank). This rule is about the
  // real person(s) THIS applicant has nominated to back THEIR OWN loan
  // (migration 033) — a queried fact, not self-declared, so there is no
  // `skipped` tier here at all: zero linked guarantors is a confirmed
  // "nothing to check", not missing data.
  const guarantors = Array.isArray(applicant.guarantors) ? applicant.guarantors : [];
  const distressedGuarantors = guarantors.filter((g) => g.isDistressedElsewhere);
  rules.push(
    rule(
      "GUARANTOR_RELIABILITY",
      "Guarantor's other commitments",
      distressedGuarantors.length > 0 ? "refer" : "pass",
      guarantors.length === 0
        ? "No guarantor was nominated for this application."
        : distressedGuarantors.length > 0
          ? `${distressedGuarantors.map((g) => g.fullName).join(", ")} — currently overdue on another facility guaranteed elsewhere.`
          : `${guarantors.length} guarantor(s) nominated; none is overdue on a facility guaranteed elsewhere.`,
      { value: distressedGuarantors.length, threshold: 0 }
    )
  );

  // --- Backing: collateral coverage (D5) -----------------------------------
  // Every collateral item is 'self_declared' until a human confirms it
  // (033) — a stated value proves nothing on its own, the same reasoning
  // D1 already applies to a self-declared CRIB score. Pledged-but-unverified
  // collateral therefore ALWAYS refers, regardless of how large the claimed
  // value is; only once verified does the coverage RATIO start to matter.
  // No collateral pledged is a confirmed "nothing offered", not missing
  // data — pass, not skipped.
  const collateral =
    loan.collateral && typeof loan.collateral === "object"
      ? loan.collateral
      : { itemCount: 0, totalDeclaredValue: 0, totalVerifiedValue: 0, hasUnverified: false };
  const coverageRatio = computeCoverageRatio(collateral.totalVerifiedValue, loan.amount);
  let collateralStatus = "pass";
  let collateralDetail = "No collateral was pledged for this application.";
  if (collateral.itemCount > 0) {
    const ratioText = coverageRatio === null ? "unknown" : `${(coverageRatio * 100).toFixed(0)}%`;
    if (collateral.hasUnverified) {
      collateralStatus = "refer";
      collateralDetail = `${collateral.itemCount} item(s) pledged (declared value LKR ${money(collateral.totalDeclaredValue)}), awaiting staff verification.`;
    } else if (
      coverageRatio !== null &&
      coverageRatio < POLICY.COLLATERAL_COVERAGE_REFER_BELOW
    ) {
      collateralStatus = "refer";
      collateralDetail = `Verified collateral covers ${ratioText} of the requested amount (refer below ${(POLICY.COLLATERAL_COVERAGE_REFER_BELOW * 100).toFixed(0)}%).`;
    } else {
      collateralDetail = `Verified collateral covers ${ratioText} of the requested amount.`;
    }
  }
  rules.push(
    rule(
      "COLLATERAL_COVERAGE",
      "Collateral coverage",
      collateralStatus,
      collateralDetail,
      { value: coverageRatio, threshold: POLICY.COLLATERAL_COVERAGE_REFER_BELOW }
    )
  );

  // The verdict is the worst status any single rule returned — one mandatory
  // breach declines the application however well everything else scored,
  // which is the whole point of a policy floor.
  const outcome = rules.reduce((worst, r) => {
    const candidate = STATUS_TO_OUTCOME[r.status] || "pass";
    return OUTCOME_RANK[candidate] > OUTCOME_RANK[worst] ? candidate : worst;
  }, "pass");

  return {
    policy_version: POLICY_VERSION,
    outcome,
    metrics: m,
    rules,
    // Stable codes for the rules that were not satisfied, worst first —
    // this is the list D4 turns into adverse-action reasons.
    reason_codes: rules
      .filter((r) => r.status === "fail" || r.status === "refer")
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "fail" ? -1 : 1))
      .map((r) => r.code),
  };
}

/**
 * One-line summary of a verdict, for notifications and staff list rows.
 * @param {object} evaluation the output of evaluateCreditPolicy
 * @returns {string}
 */
function summarizePolicy(evaluation) {
  if (!evaluation) return "Credit policy not evaluated.";
  const failed = evaluation.rules.filter((r) => r.status === "fail");
  const referred = evaluation.rules.filter((r) => r.status === "refer");
  if (evaluation.outcome === "decline") {
    return `Declined by credit policy: ${failed.map((r) => r.label).join(", ")}.`;
  }
  if (evaluation.outcome === "refer") {
    return `Manual review required: ${referred.map((r) => r.label).join(", ")}.`;
  }
  return "Meets all mandatory credit policy criteria.";
}

module.exports = {
  evaluateCreditPolicy,
  summarizePolicy,
  ageAtMaturity,
  POLICY,
  POLICY_VERSION,
};

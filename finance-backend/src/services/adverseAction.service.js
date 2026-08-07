"use strict";

/**
 * Adverse-action documentation (D4) — pure, deterministic. No DB, no I/O.
 *
 * A rejected applicant is owed a specific, standardized reason — not "the
 * system said no" and not a free-text note a reviewer happened to type.
 * Before this module, the only structured "why" a rejection carried was:
 *
 *   - an auto-reject's credit-policy reason_codes (D1) — real, but written
 *     in rule-engineer language ("PREVIOUS_DEFAULTS", "DTI_LIMIT"), not
 *     something to hand an applicant;
 *   - a manual rejection's override_reason_code (D2) — but ONLY when that
 *     rejection deviated from the decision matrix's recommendation. A
 *     manual reject that follows the matrix's own `manual_review` verdict
 *     (the single most common way a human actually rejects someone) needed
 *     no code at all.
 *
 * This module is the catalog and the mapping that closes that gap: a fixed
 * set of applicant-facing reasons (REASONS below), a translation from D1's
 * rule codes into that language (deriveReasonCodesFromPolicy), and the
 * assembly of one immutable record (buildAdverseActionRecord) that snapshots
 * every judgement behind a rejection — model, policy, matrix, and price —
 * independent of loan_applications' own decision columns, which D2's reopen
 * flow deliberately clears. See migration 032.
 *
 * Deliberately separate from decisionMatrix.service.js's OVERRIDE_REASONS:
 * those answer "why did a reviewer decide against the system's
 * recommendation" (an internal governance question); these answer "why is
 * this applicant not getting the loan" (the question the applicant is
 * actually owed an answer to). The two are asked at different moments and
 * of different audiences, and conflating them would mean a matrix-consistent
 * rejection — which needs no override — could still show up with no
 * adverse-action reason at all, exactly the hole this module exists to
 * close.
 */

/**
 * The standardized reason catalog. `label`/`description` are applicant-
 * facing — plain language, not rule-engineer shorthand — because these are
 * shown to the declined applicant, not just kept for internal audit.
 *
 * `policyRuleCodes` is the ONLY place the mapping from D1's
 * creditPolicy.service.js rule codes to these reasons lives — see
 * deriveReasonCodesFromPolicy. A reason with an empty array can never be
 * auto-suggested from a policy verdict; it exists for a human to pick
 * because a machine could never have inferred it (e.g. ADVERSE_INFORMATION,
 * by definition, is something the automated assessment didn't capture).
 *
 * `requiresNote` marks reasons that mean nothing without the accompanying
 * free-text note — mirrors decisionMatrix.service.js OVERRIDE_REASONS'
 * same field, and for the same purpose.
 */
const REASONS = [
  {
    code: "INSUFFICIENT_INCOME",
    label: "Income does not meet the minimum required",
    description:
      "Your declared income falls below the minimum this facility requires, or leaves no disposable income once regular expenses are met.",
    policyRuleCodes: ["MIN_MONTHLY_INCOME", "NET_INCOME_POSITIVE"],
  },
  {
    code: "EXCESSIVE_OBLIGATIONS",
    label: "Existing and proposed obligations are high relative to income",
    description:
      "The instalment for this facility, together with your existing commitments, would take up more of your income than we can responsibly lend against.",
    policyRuleCodes: ["DTI_LIMIT", "RESIDUAL_INCOME", "LOAN_TO_INCOME", "EXISTING_FACILITIES"],
  },
  {
    code: "INSUFFICIENT_CREDIT_HISTORY",
    label: "Credit history does not meet our minimum requirement",
    description:
      "The credit bureau score on file for you falls below the minimum we require for this facility.",
    policyRuleCodes: ["CRIB_SCORE"],
  },
  {
    code: "DELINQUENT_CREDIT_HISTORY",
    label: "Credit history includes delinquent or defaulted accounts",
    description:
      "Our records show one or more prior defaults, either on your own borrowing or on a facility you guaranteed for someone else.",
    policyRuleCodes: ["PREVIOUS_DEFAULTS", "GUARANTOR_DEFAULTS"],
  },
  {
    code: "INSUFFICIENT_EMPLOYMENT_HISTORY",
    label: "Length of time in current employment does not meet our requirement",
    description:
      "We require a minimum period in your current role before extending this facility, and the time you declared falls short of it.",
    policyRuleCodes: ["EMPLOYMENT_TENURE"],
  },
  {
    code: "AGE_INELIGIBLE",
    label: "Does not meet the age requirements for this facility",
    description:
      "Your age, or your age at the facility's final instalment, falls outside the range we are able to lend within.",
    policyRuleCodes: ["AGE_MIN", "AGE_AT_MATURITY"],
  },
  {
    code: "GUARANTOR_RELIABILITY_CONCERN",
    label: "Concerns regarding the proposed guarantor",
    description:
      "The person nominated to guarantee this facility is currently overdue on another commitment they have guaranteed, which affects our ability to rely on their backing.",
    policyRuleCodes: ["GUARANTOR_RELIABILITY"],
  },
  {
    code: "INSUFFICIENT_COLLATERAL",
    label: "Security offered does not sufficiently cover the amount requested",
    description:
      "The collateral offered against this facility, once verified, falls short of the coverage we require for the amount requested.",
    policyRuleCodes: ["COLLATERAL_COVERAGE"],
  },
  // The remaining reasons have no policyRuleCodes mapping — nothing in the
  // deterministic policy engine can ever produce them. They exist purely
  // for a reviewer to select, for cases the automated assessment could not
  // have caught.
  {
    code: "UNABLE_TO_VERIFY",
    label: "Unable to verify information provided",
    description:
      "We were unable to confirm one or more details of your application (income, employment, or identity) well enough to proceed.",
    policyRuleCodes: [],
  },
  {
    code: "ADVERSE_INFORMATION",
    label: "Adverse information came to light",
    description:
      "Information came to our attention that the automated assessment did not have visibility of, and which affects this decision.",
    policyRuleCodes: [],
  },
  {
    code: "HIGH_RISK_ASSESSMENT",
    label: "Risk assessment did not support approval",
    description:
      "Our risk assessment placed this application in a band we are not able to approve at this time, independent of the specific policy checks above.",
    policyRuleCodes: [],
  },
  {
    code: "OTHER",
    label: "Other (see the reviewer's note)",
    description: "A reason not covered by the categories above — see the accompanying note.",
    policyRuleCodes: [],
    requiresNote: true,
  },
];

const REASON_CODES = REASONS.map((r) => r.code);

/** The catalog entry for a code, or undefined. */
function findReason(code) {
  return REASONS.find((r) => r.code === code);
}

/** Whether `code` is a real reason code. */
function isValidReasonCode(code) {
  return REASONS.some((r) => r.code === code);
}

/**
 * Translate D1's credit-policy rule codes (creditPolicy.service.js
 * `reason_codes`, e.g. `["PREVIOUS_DEFAULTS", "CRIB_SCORE"]`) into this
 * catalog's applicant-facing codes. Many-to-one: several policy rules can
 * map to the same adverse-action reason (EXCESSIVE_OBLIGATIONS covers four
 * different affordability rules), because an applicant is owed "your
 * obligations are too high," not four separate near-duplicate sentences
 * about ratios they never agreed to be judged on individually.
 *
 * @param {string[]} policyReasonCodes
 * @returns {string[]} adverse-action codes, each appearing at most once, in
 *   REASONS' own order (stable, so the same policy verdict always produces
 *   the same suggested list in the same order)
 */
function deriveReasonCodesFromPolicy(policyReasonCodes = []) {
  const policySet = new Set(policyReasonCodes);
  return REASONS.filter(
    (r) => r.policyRuleCodes.length > 0 && r.policyRuleCodes.some((rc) => policySet.has(rc))
  ).map((r) => r.code);
}

/**
 * Assemble one immutable adverse-action record.
 *
 * Deliberately takes the SNAPSHOT fields as an opaque bag rather than
 * re-deriving them: this module has no DB access and must not guess what
 * risk_label/policy_version/etc. were at decision time. The caller (
 * loan.controller.js) reads them from the same row it already has —
 * risk_assessments/credit_policy_evaluations/decision_matrix_evaluations
 * joined onto the application — at the moment of rejection, auto or manual.
 *
 * @param {object} p
 * @param {string[]} p.reasonCodes   ≥1 codes from REASON_CODES
 * @param {'system'|'manual'} p.decisionSource
 * @param {number|null} [p.decidedBy] user_id, null for an automatic rejection
 * @param {string|null} [p.note]
 * @param {object} [p.snapshot]      { riskLabel, riskCategory, probLow,
 *   probMedium, probHigh, modelVersion, policyVersion, policyOutcome,
 *   matrixVersion, matrixAction, pricedInterestRate } — each individually
 *   optional; whatever the caller doesn't have is stored NULL rather than
 *   guessed.
 * @returns {object} ready for loanModel.createAdverseActionRecordWithin
 * @throws {Error} if reasonCodes is empty or contains an unknown code — an
 *   adverse-action record with no reason, or an invented one, defeats the
 *   entire point of this module.
 */
function buildAdverseActionRecord({
  reasonCodes = [],
  decisionSource,
  decidedBy = null,
  note = null,
  snapshot = {},
} = {}) {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    throw new Error("buildAdverseActionRecord requires at least one reason code.");
  }
  const invalid = reasonCodes.filter((c) => !isValidReasonCode(c));
  if (invalid.length > 0) {
    throw new Error(`Unknown adverse-action reason code(s): ${invalid.join(", ")}`);
  }
  if (decisionSource !== "system" && decisionSource !== "manual") {
    throw new Error("buildAdverseActionRecord requires decisionSource 'system' or 'manual'.");
  }

  // Deduplicate while preserving first-seen order — a caller merging a
  // policy-derived suggestion list with a reviewer's own picks may hand
  // back overlapping codes.
  const uniqueCodes = [...new Set(reasonCodes)];
  const reasons = uniqueCodes.map((code) => {
    const r = findReason(code);
    return { code: r.code, label: r.label, description: r.description };
  });

  return {
    reasonCodes: uniqueCodes,
    reasons,
    decisionSource,
    decidedBy,
    note,
    riskLabel: snapshot.riskLabel ?? null,
    riskCategory: snapshot.riskCategory ?? null,
    probLow: snapshot.probLow ?? null,
    probMedium: snapshot.probMedium ?? null,
    probHigh: snapshot.probHigh ?? null,
    modelVersion: snapshot.modelVersion ?? null,
    policyVersion: snapshot.policyVersion ?? null,
    policyOutcome: snapshot.policyOutcome ?? null,
    matrixVersion: snapshot.matrixVersion ?? null,
    matrixAction: snapshot.matrixAction ?? null,
    pricedInterestRate: snapshot.pricedInterestRate ?? null,
  };
}

module.exports = {
  REASONS,
  REASON_CODES,
  findReason,
  isValidReasonCode,
  deriveReasonCodesFromPolicy,
  buildAdverseActionRecord,
};

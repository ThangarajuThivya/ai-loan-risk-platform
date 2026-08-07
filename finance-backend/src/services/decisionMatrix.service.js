"use strict";

/**
 * Decision policy matrix (D2) — pure, deterministic. No DB, no I/O.
 *
 * D1 produced two independent judgements on an application: the ML model's
 * risk band (loan-risk-model, via mlClient.service.js) and the institution's
 * mandatory lending criteria (creditPolicy.service.js). Neither one is a
 * decision. This module is the single place where they are combined into
 * one, so that "how does this bank decide" is a table someone can read
 * rather than a rule scattered across a controller.
 *
 * THE MATRIX
 *
 *   policy \ risk │ Low (0)       Medium (1)     High (2)
 *   ──────────────┼──────────────────────────────────────────
 *   pass          │ auto_approve  manual_review  manual_review
 *   refer         │ manual_review manual_review  manual_review
 *   decline       │ auto_reject   auto_reject    auto_reject
 *
 * Two things about that table are deliberate and worth stating plainly:
 *
 *  1. The `decline` row ignores the risk band entirely. A mandatory policy
 *     criterion is, by definition, one the institution does not lend
 *     against — a flattering model score cannot buy an exception, and if it
 *     could, the criterion was never mandatory. The model has no vote here.
 *  2. Only ONE cell auto-approves. Everything the model is unsure about, and
 *     everything policy wants a second look at, goes to a human. The system
 *     is allowed to say no by itself and allowed to say "obviously fine",
 *     but the interesting middle is exactly where automation is worst and a
 *     reviewer is cheapest.
 *
 * WHAT THE ACTIONS MEAN AT RUNTIME (see loan.controller.js assess):
 *
 *   auto_reject   The system acts. The application is written straight to
 *                 'rejected' with the system as the deciding actor. An admin
 *                 can reopen it for review (applicationStatus.service.js
 *                 rejected → under_review), which requires an override
 *                 reason code — that is the "authorized override" path.
 *   auto_approve  The system RECOMMENDS. Status is untouched; staff get a
 *                 pre-cleared application flagged for one-click approval.
 *                 Approving issues a binding offer with real money behind
 *                 it (migration 023), so a human stays on that path.
 *   manual_review The system recommends nothing; normal review applies.
 *
 * OVERRIDES
 *
 * A reviewer may always decide against the matrix — they are the authority,
 * not this table. What they may not do is leave no trace of why. Any
 * decision that deviates from the recommendation, in either direction,
 * requires a standardized code from OVERRIDE_REASONS below plus a free-text
 * note. Matrix-consistent decisions need neither. See requiresOverride().
 */

/** Every action the matrix can produce, worst-to-best for display ordering. */
const DECISION_ACTIONS = ["auto_reject", "manual_review", "auto_approve"];

/**
 * Bumped whenever a cell or an override rule changes, and stored on every
 * evaluation (migration 030) for the same reason creditPolicy carries
 * POLICY_VERSION: a decision taken under an older matrix must stay
 * explainable after the table moves.
 */
const MATRIX_VERSION = "dm-1.0";

/**
 * The table itself, keyed [policyOutcome][riskLabel]. Kept as data rather
 * than as branching code so the shape above is literally what executes, and
 * so a test can walk every cell.
 */
const MATRIX = {
  pass: {
    0: "auto_approve",
    1: "manual_review",
    2: "manual_review",
  },
  refer: {
    0: "manual_review",
    1: "manual_review",
    2: "manual_review",
  },
  decline: {
    0: "auto_reject",
    1: "auto_reject",
    2: "auto_reject",
  },
};

/** Human-readable risk bands, matching mlClient.service.js RISK_LABELS. */
const RISK_BAND = { 0: "Low Risk", 1: "Medium Risk", 2: "High Risk" };

/**
 * The standardized override reason codes.
 *
 * `direction` says which way an override has to be going for the code to be
 * offerable, so a reviewer is never shown "adverse information came to
 * light" as a justification for approving:
 *   lenient — deciding MORE favourably than the matrix (approving something
 *             it wanted rejected or reviewed against policy)
 *   strict  — deciding LESS favourably (rejecting something it recommended)
 *   any     — applies either way
 *
 * `requiresNote` marks the codes that say nothing on their own. Every
 * override carries a note in practice (the controller demands one), but
 * these are the ones where the code alone is meaningless.
 */
const OVERRIDE_REASONS = [
  {
    code: "POLICY_EXCEPTION",
    label: "Policy exception authorised",
    direction: "lenient",
    description:
      "A mandatory criterion is knowingly waived by an authorised approver.",
  },
  {
    code: "COMPENSATING_FACTORS",
    label: "Compensating factors",
    direction: "lenient",
    description:
      "Evidence outside the assessment (savings, assets, family support) offsets the finding.",
  },
  {
    code: "ADDITIONAL_SECURITY",
    label: "Additional security or guarantor",
    direction: "lenient",
    description: "Collateral or a guarantor not reflected in the assessment.",
  },
  {
    code: "RELATIONSHIP_HISTORY",
    label: "Existing customer repayment history",
    direction: "lenient",
    description: "A settled facility with this institution supports the decision.",
  },
  {
    code: "ADVERSE_INFORMATION",
    label: "Adverse information",
    direction: "strict",
    description:
      "Negative information came to light that the assessment did not capture.",
  },
  {
    code: "AFFORDABILITY_CONCERN",
    label: "Affordability concern",
    direction: "strict",
    description:
      "The reviewer judges the instalment unaffordable despite the assessment.",
  },
  {
    code: "VERIFICATION_FAILED",
    label: "Verification failed",
    direction: "strict",
    description: "Declared income, employment or identity could not be verified.",
  },
  {
    code: "DATA_CORRECTION",
    label: "Assessed on incorrect data",
    direction: "any",
    description:
      "The application was scored on figures now known to be wrong; re-assessment is warranted.",
    requiresNote: true,
  },
  {
    code: "OTHER",
    label: "Other (explain in the note)",
    direction: "any",
    description: "Anything the codes above do not cover.",
    requiresNote: true,
  },
];

const OVERRIDE_REASON_CODES = OVERRIDE_REASONS.map((r) => r.code);

/**
 * Rank of a decision outcome, used only to work out whether an override is
 * lenient or strict relative to what the matrix wanted. Higher = more
 * favourable to the applicant.
 */
const FAVOURABILITY = {
  auto_reject: 0,
  rejected: 0,
  manual_review: 1,
  under_review: 1,
  more_info_required: 1,
  auto_approve: 2,
  approved: 2,
};

/** Normalise a risk label that may arrive as a string from SQL/JSON. */
function toRiskLabel(value) {
  const n = Number(value);
  return n === 0 || n === 1 || n === 2 ? n : null;
}

/**
 * Evaluate the matrix.
 *
 * @param {object} p
 * @param {string} p.policyOutcome 'pass' | 'refer' | 'decline' (D1)
 * @param {number} p.riskLabel     0 | 1 | 2 (ML model)
 * @param {string} [p.riskCategory] display name; derived when omitted
 * @returns {{matrix_version:string, action:string, policy_outcome:string,
 *            risk_label:number|null, risk_category:string|null,
 *            rationale:string, acts_automatically:boolean}}
 */
function evaluateDecisionMatrix({ policyOutcome, riskLabel, riskCategory } = {}) {
  const label = toRiskLabel(riskLabel);
  const outcome = MATRIX[policyOutcome] ? policyOutcome : null;

  // An unknown input must land on the human, never on an automatic verdict.
  // This is the safe default and the only one: a matrix that guesses when it
  // doesn't recognise its own inputs is worse than no matrix.
  const action =
    outcome === null || label === null ? "manual_review" : MATRIX[outcome][label];

  const band = riskCategory || (label === null ? null : RISK_BAND[label]);

  return {
    matrix_version: MATRIX_VERSION,
    action,
    policy_outcome: outcome,
    risk_label: label,
    risk_category: band,
    rationale: buildRationale({ action, policyOutcome: outcome, riskCategory: band }),
    // Only auto_reject changes anything by itself — see the module note.
    acts_automatically: action === "auto_reject",
  };
}

/**
 * One sentence explaining the cell that fired, for the staff panel, the
 * customer's rejection notice, and the stored evaluation.
 */
function buildRationale({ action, policyOutcome, riskCategory }) {
  if (policyOutcome === null || !riskCategory) {
    return "Sent for manual review because the assessment was incomplete.";
  }
  const band = String(riskCategory).toLowerCase();
  switch (action) {
    case "auto_reject":
      return `Automatically rejected: the application failed a mandatory credit policy criterion, which no risk score can offset (model band: ${band}).`;
    case "auto_approve":
      return `Recommended for approval: every mandatory criterion was met and the model placed the applicant in the ${band} band.`;
    default:
      return policyOutcome === "refer"
        ? `Sent for manual review: the credit policy flagged one or more criteria for a reviewer's judgement (model band: ${band}).`
        : `Sent for manual review: policy criteria were met but the model placed the applicant in the ${band} band.`;
  }
}

/**
 * Does this decision deviate from what the matrix recommended, and therefore
 * need a reason code?
 *
 * Deliberately asks about the DECISION, not the click: moving an application
 * to under_review or more_info_required is workflow, not a verdict, and
 * demanding a justification for opening a file would train reviewers to pick
 * a code at random. Only credit decisions (approved/rejected) and reopening
 * a rejection are gated.
 *
 * A policy `decline` gates approval on its own, even where the matrix
 * happened to say manual_review — approving over a mandatory criterion is
 * the single most consequential thing a reviewer can do here, and it must
 * never depend on which cell fired.
 *
 * @param {object} p
 * @param {string} p.targetStatus   the status being moved to
 * @param {string} [p.fromStatus]   the status being moved from
 * @param {string} [p.matrixAction] the stored recommendation, if any
 * @param {string} [p.policyOutcome] the stored policy verdict, if any
 * @returns {{required:boolean, direction:'lenient'|'strict'|null, reason:string|null}}
 */
function requiresOverride({ targetStatus, fromStatus, matrixAction, policyOutcome } = {}) {
  const no = { required: false, direction: null, reason: null };

  // Reopening a rejection is always an override — it is the only way back
  // out of a terminal state, automatic or not.
  if (fromStatus === "rejected" && targetStatus === "under_review") {
    return {
      required: true,
      direction: "lenient",
      reason: "Reopening a rejected application requires an authorised reason.",
    };
  }

  if (targetStatus !== "approved" && targetStatus !== "rejected") return no;

  if (targetStatus === "approved" && policyOutcome === "decline") {
    return {
      required: true,
      direction: "lenient",
      reason:
        "This application failed a mandatory credit policy criterion; approving it requires an authorised reason.",
    };
  }

  // Nothing to deviate from — an application assessed before D2, or one
  // whose matrix evaluation never ran, is decided the old way.
  if (!matrixAction || FAVOURABILITY[matrixAction] === undefined) return no;

  // manual_review is the matrix explicitly declining to have an opinion, so
  // neither verdict can contradict it.
  if (matrixAction === "manual_review") return no;

  const recommended = FAVOURABILITY[matrixAction];
  const chosen = FAVOURABILITY[targetStatus];
  if (chosen === recommended) return no;

  return chosen > recommended
    ? {
        required: true,
        direction: "lenient",
        reason: "The system recommended rejection; approving it requires an authorised reason.",
      }
    : {
        required: true,
        direction: "strict",
        reason: "The system recommended approval; rejecting it requires an authorised reason.",
      };
}

/**
 * The reason codes offerable for an override in `direction` — the codes
 * marked 'any' plus those matching the direction. Drives both the API's
 * catalogue endpoint and the server-side validation, so the list a reviewer
 * picks from is by construction the list the server accepts.
 * @param {'lenient'|'strict'} [direction] omit for the full catalogue
 * @returns {object[]}
 */
function overrideReasonsFor(direction) {
  if (!direction) return OVERRIDE_REASONS;
  return OVERRIDE_REASONS.filter(
    (r) => r.direction === "any" || r.direction === direction
  );
}

/**
 * Whether `code` is a real reason code, and appropriate for the direction
 * the override is going. Rejecting a mismatched code matters: "adverse
 * information" as the stated justification for an APPROVAL would poison the
 * audit trail more quietly than a missing code would.
 * @param {string} code
 * @param {'lenient'|'strict'} [direction]
 * @returns {boolean}
 */
function isValidOverrideReason(code, direction) {
  return overrideReasonsFor(direction).some((r) => r.code === code);
}

/** The catalogue entry for a code, or undefined. */
function findOverrideReason(code) {
  return OVERRIDE_REASONS.find((r) => r.code === code);
}

module.exports = {
  evaluateDecisionMatrix,
  requiresOverride,
  overrideReasonsFor,
  isValidOverrideReason,
  findOverrideReason,
  MATRIX,
  MATRIX_VERSION,
  DECISION_ACTIONS,
  OVERRIDE_REASONS,
  OVERRIDE_REASON_CODES,
};

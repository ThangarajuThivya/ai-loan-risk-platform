"use strict";

/**
 * Behavioural credit features — what this institution already knows about how
 * a customer repays, turned into risk-model inputs.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * mlClient.service.js has to fill 30-odd model fields, and most CRIB-sourced
 * ones had no data source, so they were sent as hardcoded constants. Three of
 * those constants are among the model's strongest inputs:
 *
 *     number_of_defaults      sent as 0     ~38% of the model's total gain
 *     overdue_installments    sent as 0     ~5%
 *     credit_utilization      sent as 30    ~4%
 *
 * Close to half the model's decision power was therefore fixed for every
 * applicant, and no amount of retraining fixes that — it is an input problem.
 *
 * There is still no CRIB bureau integration. But for a customer who has
 * borrowed from us before, we hold these facts first-hand: their accounts,
 * their instalments, their payment dates. This module derives the same
 * quantities from that record.
 *
 * APPLICATION SCORING vs. BEHAVIOURAL SCORING
 * -------------------------------------------
 * A first-time applicant has nothing to derive from, and that is the normal
 * case rather than a failure. Such a "thin file" falls back to the documented
 * neutral defaults and is flagged as such, so a reviewer can see that the
 * behavioural inputs were unavailable rather than genuinely clean. This is the
 * standard distinction in the credit-scoring literature between scoring an
 * application and scoring observed conduct.
 *
 * SHRINKAGE, NOT A CLIFF
 * ----------------------
 * A customer two instalments into their first loan is not evidence of
 * anything. Rate-style measures are therefore shrunk toward the neutral prior
 * in proportion to how much history exists, so confidence grows smoothly with
 * evidence instead of flipping at an arbitrary cut-off.
 *
 * COUNTS ARE NEVER SHRUNK. A recorded write-off is a fact, not an estimate;
 * softening it toward a prior would understate a default that actually
 * happened.
 */

/**
 * Instalments of history at which an observed rate is weighted equally
 * against the neutral prior. Half-weight at 6 observations is deliberately
 * cautious: it takes roughly a year of monthly repayments before the
 * customer's own record dominates the assumption.
 */
const SHRINKAGE_STRENGTH = 6;

/**
 * A file with fewer than this many instalments on record is reported as thin.
 * The features are still computed and still shrunk — this flag only tells a
 * reviewer (and the UI) how much of the assessment rests on real conduct.
 */
const THIN_FILE_INSTALLMENTS = 3;

/**
 * Neutral priors, mirroring mlClient.service.js NEUTRAL_DEFAULTS. Chosen to
 * sit mid-distribution for the model's training data so they neither inflate
 * nor flatter risk.
 */
const PRIORS = {
  credit_utilization: 30,
  avg_repayment_behaviour: 0.85,
};

/**
 * Model inputs that stay assumptions even for a customer with a full history,
 * because nothing in this system observes them. Named explicitly so the gap is
 * visible to a reviewer rather than implied by absence.
 */
const STILL_DEFAULTED = [
  "income_stability",
  "digital_payment_ratio",
  "rent",
  "province",
];

/**
 * Blend an observed rate with the neutral prior according to how many
 * observations back it.
 *
 *     shrunk = (n * observed + k * prior) / (n + k)
 *
 * @param {number} observed  the rate measured from the customer's record
 * @param {number} prior     the neutral value used when nothing is known
 * @param {number} n         how many observations `observed` rests on
 * @param {number} [k]       observations at which the two weigh equally
 * @returns {number}
 */
function shrink(observed, prior, n, k = SHRINKAGE_STRENGTH) {
  if (!Number.isFinite(observed)) return prior;
  const count = Math.max(0, Number(n) || 0);
  return (count * observed + k * prior) / (count + k);
}

/** Clamp to a range, tolerating non-finite input. */
function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Turn the raw counters from loanModel.findBorrowerCreditHistory into model
 * fields plus the metadata a reviewer needs to interpret them.
 *
 * @param {object|null} history  the row from findBorrowerCreditHistory, or
 *                               null/undefined for a customer with no record
 * @returns {{fields: object, meta: object}}
 *   `fields` overrides mlClient.service.js NEUTRAL_DEFAULTS for exactly the
 *   inputs we can source; `meta` explains how much evidence sits behind them.
 */
function deriveBehaviouralFeatures(history) {
  const h = history || {};

  const totalInstallments = Math.max(0, Number(h.total_installments) || 0);
  const paidInstallments = Math.max(0, Number(h.paid_installments) || 0);
  const lateInstallments = Math.max(0, Number(h.late_installments) || 0);
  const totalAccounts = Math.max(0, Number(h.total_accounts) || 0);

  const hasHistory = totalAccounts > 0;
  const isThinFile = totalInstallments < THIN_FILE_INSTALLMENTS;

  // --- Punctuality -----------------------------------------------------
  // Share of SETTLED instalments that were settled on time. Judged against
  // instalments actually concluded, not against every instalment ever
  // scheduled: a loan three months into a five-year term has 57 instalments
  // that are neither late nor on time yet, and counting them as on-time
  // would manufacture a spotless record out of a loan barely started.
  //
  // Shrunk toward the prior when there IS a record but a short one — a
  // customer two instalments in is weak evidence, not no evidence. Null when
  // nothing has concluded at all, because then there is genuinely nothing to
  // shrink and a prior would be pure invention.
  const concluded = Math.max(paidInstallments, lateInstallments);
  const avgRepaymentBehaviour =
    concluded > 0
      ? clamp(
          shrink(
            (concluded - lateInstallments) / concluded,
            PRIORS.avg_repayment_behaviour,
            concluded
          ),
          0,
          1
        )
      : null;

  // --- Utilisation ------------------------------------------------------
  // Outstanding principal as a share of what was originally scheduled on
  // live facilities. Someone halfway through repaying is ~50% utilised.
  const scheduled = Number(h.scheduled_principal) || 0;
  const outstanding = Number(h.outstanding_principal) || 0;
  // Not shrunk: this is not a noisy estimate of some underlying rate, it is
  // the exact utilisation of the facilities they currently hold. Damping a
  // fact toward a prior would understate a genuinely maxed-out borrower.
  // Null when there are no live facilities to measure.
  const creditUtilization =
    scheduled > 0 ? clamp((outstanding / scheduled) * 100, 0, 100) : null;

  // --- Nothing observed at all -----------------------------------------
  // Report UNKNOWN, not a population average.
  //
  // This is the correction that mattered most. Substituting an average for an
  // unknown is not neutral: `avg_repayment_behaviour = 0.85` asserts the
  // applicant pays reliably and `overdue_installments = 0` asserts they are
  // never late. That block carries a large share of the model's gain, so a
  // first-time applicant was being credited with exemplary conduct nobody had
  // ever observed — measured, one declaring three defaults still scored
  // "Low Risk".
  //
  // The model is trained with the same fields absent at the same rate, and
  // XGBoost learns a default branch for missing values, so null is a value it
  // knows how to interpret. Verified: an unknown file now scores ~2.8x the PD
  // of an observed-excellent one, where before the two were indistinguishable.
  if (!hasHistory) {
    return {
      fields: {
        number_of_defaults: null,
        overdue_installments: null,
        historical_delinquencies: null,
        active_facilities: null,
        settled_loans: null,
        existing_loans: null,
        credit_inquiry_count: null,
        loan_restructuring_history: null,
        highest_outstanding_balance: null,
        credit_utilization: null,
        avg_repayment_behaviour: null,
      },
      meta: {
        has_internal_history: false,
        is_thin_file: true,
        accounts_observed: 0,
        installments_observed: 0,
        installments_concluded: 0,
        late_installments: 0,
        written_off_accounts: 0,
        evidence_weight: 0,
        still_defaulted: STILL_DEFAULTED,
      },
    };
  }

  // --- Hard counts — never shrunk --------------------------------------
  const fields = {
    // A charged-off facility with us IS a default, and this is the single most
    // influential model input.
    //
    // HONEST CAVEAT: `loan_accounts.status` declares 'written_off' but no
    // endpoint or job currently sets it (see ARCHITECTURE.md's limitations
    // list), so in practice this resolves to 0 today and the applicant's own
    // declaration is still what drives the field — via the max() in
    // mlClient.service.js. The wiring is correct and will start producing real
    // values the moment a write-off flow exists, with no change here. Every
    // other behavioural feature below fires on real data now.
    number_of_defaults: Math.max(0, Number(h.written_off_accounts) || 0),
    overdue_installments: Math.max(0, Number(h.overdue_installments) || 0),
    historical_delinquencies: lateInstallments,
    active_facilities: Math.max(0, Number(h.active_accounts) || 0),
    settled_loans: Math.max(0, Number(h.closed_accounts) || 0),
    existing_loans: Math.max(0, Number(h.active_accounts) || 0),
    credit_inquiry_count: Math.max(0, Number(h.application_count) || 0),
    loan_restructuring_history: Math.max(
      0,
      Number(h.restructured_facilities) || 0
    ),
    highest_outstanding_balance: Math.max(0, Number(h.highest_principal) || 0),
    credit_utilization:
      creditUtilization === null ? null : Number(creditUtilization.toFixed(2)),
    avg_repayment_behaviour:
      avgRepaymentBehaviour === null
        ? null
        : Number(avgRepaymentBehaviour.toFixed(4)),
  };

  const meta = {
    // Whether ANY of the above rests on observed conduct.
    has_internal_history: hasHistory,
    is_thin_file: isThinFile,
    accounts_observed: totalAccounts,
    installments_observed: totalInstallments,
    installments_concluded: concluded,
    late_installments: lateInstallments,
    written_off_accounts: Math.max(0, Number(h.written_off_accounts) || 0),
    // How much the shrunk rates lean on real evidence vs. the prior — 0 means
    // entirely assumption, 1 means entirely the customer's own record.
    evidence_weight: Number(
      (concluded / (concluded + SHRINKAGE_STRENGTH)).toFixed(3)
    ),
    still_defaulted: STILL_DEFAULTED,
  };

  return { fields, meta };
}

/**
 * The highest CRIB score a file carrying this much adverse history could
 * plausibly still hold. Two independent ceilings; the stricter one wins.
 *
 * These are POLICY thresholds, not a reproduction of the bureau's formula.
 * Restating the model's scoring equation here would create exactly the
 * train/serve drift this codebase works to avoid — two copies of one formula
 * in two languages. A coarse, monotone, auditable ceiling is both safer and
 * easier for a credit officer to defend.
 */
const CRIB_CEILING_BY_DEFAULTS = [900, 660, 560, 470];
const CRIB_CEILING_BY_OVERDUE = [
  { upTo: 0, ceiling: 900 },
  { upTo: 2, ceiling: 720 },
  { upTo: 5, ceiling: 620 },
  { upTo: Infinity, ceiling: 520 },
];

/**
 * Reconcile a self-declared CRIB score against the adverse history actually
 * on file.
 *
 * WHY THIS EXISTS: there is no CRIB integration, so `crib_score` is a number
 * the applicant typed with nothing to verify it against — and a bureau score
 * is, by construction, a summary of exactly the default and delinquency
 * history recorded elsewhere on the same application. Declaring three
 * defaults AND a score of 900 is not a difficult case to judge; it is
 * self-contradictory, and the two statements cannot both be true.
 *
 * The risk model was separately hardened against this (it is trained on
 * declared rather than true scores, so it discounts the field — see
 * loan-risk-model/src/data_generator.py), which cut the benefit of an inflated
 * claim from a 90.8% reduction in PD to 17.8% and stopped it changing the risk
 * band. This is the second layer: it removes the residual benefit and, just as
 * importantly, SURFACES the contradiction to a reviewer rather than silently
 * absorbing it.
 *
 * The cap only binds when the other credit inputs are themselves adverse. An
 * applicant declaring a clean history and a high score is untouched, which is
 * the common, honest case.
 *
 * @param {number|null|undefined} declaredScore  what the applicant stated
 * @param {object} evidence  { number_of_defaults, overdue_installments }
 *   as resolved from behavioural history and declarations
 * @returns {{score: number|null, capped: boolean, ceiling: number,
 *            declared: number|null}}
 */
function reconcileDeclaredCribScore(declaredScore, evidence = {}) {
  // Guard the empty cases explicitly BEFORE coercing: Number(null) is 0 and
  // Number("") is 0, both of which are finite, so a bare Number.isFinite check
  // turns "the applicant did not declare a score" into "the applicant declared
  // zero" — a value below every ceiling, which would then be passed to the
  // model as a genuine, catastrophically low bureau score.
  const missing =
    declaredScore === null || declaredScore === undefined || declaredScore === "";
  const coerced = Number(declaredScore);
  const declared = !missing && Number.isFinite(coerced) ? coerced : null;

  const defaults = Math.max(0, Number(evidence.number_of_defaults) || 0);
  const overdue = Math.max(0, Number(evidence.overdue_installments) || 0);

  const byDefaults =
    CRIB_CEILING_BY_DEFAULTS[Math.min(defaults, CRIB_CEILING_BY_DEFAULTS.length - 1)];
  const byOverdue = (
    CRIB_CEILING_BY_OVERDUE.find((b) => overdue <= b.upTo) ||
    CRIB_CEILING_BY_OVERDUE[CRIB_CEILING_BY_OVERDUE.length - 1]
  ).ceiling;

  const ceiling = Math.min(byDefaults, byOverdue);

  if (declared === null || declared <= ceiling) {
    return { score: declared, capped: false, ceiling, declared };
  }
  return { score: ceiling, capped: true, ceiling, declared };
}

module.exports = {
  deriveBehaviouralFeatures,
  reconcileDeclaredCribScore,
  shrink,
  SHRINKAGE_STRENGTH,
  THIN_FILE_INSTALLMENTS,
  PRIORS,
  CRIB_CEILING_BY_DEFAULTS,
};

"use strict";

/**
 * Loan controller — the assessment spine (GUIDANCE.md §5 Day 1, §8; ARCHITECTURE.md §7).
 *
 * POST /api/loans/assess (customer):
 *   1. Load the caller's customer_profiles row.
 *   2. Merge it with the request (product_id, requested_amount, tenure_months, purpose).
 *   3. Map to the 35 model fields and call the Python risk model (mlClient).
 *   4. Persist loan_applications (pending) + risk_assessments + recommendations
 *      in one transaction.
 *   5. Return { risk, recommendation, explanation } (GUIDANCE.md §8 shape).
 */

const { validationResult } = require("express-validator");
const fs = require("fs");
const path = require("path");

const loanModel = require("../models/loanModel");
const consentModel = require("../models/consentModel");
const { findMissingConsents } = require("../services/consent.service");
const { LOAN_DOCUMENT_DIR } = require("../config/multer");
const {
  sanitizeDownloadFilename,
  TWO_SIDED_DOCUMENT_TYPES,
} = require("../services/loanDocument.service");
const {
  processDocumentInBackground,
  runExtractionPipeline,
  presentExtraction,
} = require("../services/documentPipeline.service");
const {
  mapProfileToModelFields,
  predictRisk,
  isProvided,
  ageFromDob,
  DECLARABLE_FIELDS,
  PROFILE_BACKED_FIELDS,
} = require("../services/mlClient.service");
const {
  deriveBehaviouralFeatures,
  reconcileDeclaredCribScore,
} = require("../services/behaviouralFeatures.service");
const {
  sanitizeDraftPayload,
  sanitizeStep,
  DraftPayloadError,
} = require("../services/loanDraft.service");
const bankAccountModel = require("../models/bankAccountModel");
const notificationModel = require("../models/notificationModel");
const {
  buildRecommendation,
  computeEmi,
  computeEmiForRateType,
} = require("../services/recommendation.service");
const {
  evaluateCreditPolicy,
  summarizePolicy,
} = require("../services/creditPolicy.service");
const {
  evaluateDecisionMatrix,
  requiresOverride,
  overrideReasonsFor,
  isValidOverrideReason,
} = require("../services/decisionMatrix.service");
const { priceInterestRate, TIER_BY_RISK } = require("../services/interestPricing.service");
const {
  summarizeGuarantorFindings,
  summarizeCollateral,
  isValidNic,
} = require("../services/collateralGuarantor.service");
const {
  REASONS: ADVERSE_ACTION_REASONS,
  isValidReasonCode,
  deriveReasonCodesFromPolicy,
  buildAdverseActionRecord,
} = require("../services/adverseAction.service");
const { explainRisk } = require("../services/gemini.service");
const {
  allowedTransitions,
  needsStaffAction,
  computeProcessingAge,
} = require("../services/applicationStatus.service");
const { buildOfferTerms } = require("../services/loanOffer.service");
const { buildOfferFees, computeEffectiveApr } = require("../services/loanFees.service");
const { generateDecisionLetterPdf } = require("../services/decisionLetter.service");
const {
  computeArrears,
  computeOutstanding,
  computeSettlement,
  outstandingOn,
} = require("../services/repayment.service");

// Duplicate/exposure guard for /assess (see loanModel.getActiveExposure).
// A customer may have at most this many undecided applications at once...
const MAX_PENDING_APPLICATIONS = 3;
// ...and their combined pending+approved requested amount may not exceed
// this multiple of their declared monthly income (5 years' worth of gross
// income — a coarse sanity ceiling, not a real underwriting affordability
// calculation, which stays per-loan in recommendation.service.js).
const MAX_EXPOSURE_MONTHLY_INCOME_MULTIPLE = 60;

/**
 * Pull prob_low/medium/high out of the model's probabilities object, which is
 * keyed by human labels ("Low Risk", …). Missing keys default to 0.
 */
function splitProbabilities(probabilities = {}) {
  return {
    probLow: Number(probabilities["Low Risk"] || 0),
    probMedium: Number(probabilities["Medium Risk"] || 0),
    probHigh: Number(probabilities["High Risk"] || 0),
  };
}

/**
 * Decode risk_assessments.behavioural_snapshot (043).
 *
 * mysql2 returns a JSON column as an already-parsed object on some driver
 * versions and as a raw string on others, so both are handled. A malformed
 * value degrades to null rather than throwing: this is display-only
 * provenance, and it must never be able to break loading an application.
 *
 * @param {object|string|null} value
 * @returns {object|null}
 */
function parseBehaviouralSnapshot(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Shape the latest loan_offers row, which arrives joined onto the
 * application row under an `offer_`-prefixed alias (see loanModel's
 * APPLICATION_DETAIL_SELECT) — `id`, `status` and `rate_type` would
 * otherwise collide with the application's own columns.
 *
 * `is_actionable` is computed against the SERVER clock rather than left to
 * the client: a browser with a skewed clock must not decide whether an
 * offer is still live. It is a display hint only — the accept endpoint
 * re-checks expiry in SQL (loanModel.respondToOfferWithin), which is what
 * actually enforces it.
 */
function serializeOffer(row, offerFees) {
  if (!row || !row.offer_id) return null;
  const tenure = Number(row.offered_tenure_months);
  const emi = Number(row.offered_emi);
  const amount = Number(row.offered_amount);

  // Fees (I1) are loaded separately — they are 1-to-many against an offer, so
  // joining them into the application row would multiply it. `undefined`
  // means "this endpoint didn't load them"; an empty array means "this offer
  // genuinely has none". The two must stay distinguishable, or a UI would
  // render "no fees" for an endpoint that simply never asked.
  const feeLines = Array.isArray(offerFees)
    ? offerFees.map((f) => ({
        fee_type: f.fee_type,
        label: f.label,
        calc_method: f.calc_method,
        rate_or_amount: Number(f.rate_or_amount),
        amount: Number(f.amount),
        waived: Boolean(f.waived),
        waived_reason: f.waived_reason || null,
      }))
    : undefined;
  const totalFees = feeLines
    ? Math.round(feeLines.reduce((s, f) => s + f.amount, 0) * 100) / 100
    : undefined;
  const netDisbursed =
    totalFees === undefined ? undefined : Math.round((amount - totalFees) * 100) / 100;

  return {
    offer_id: row.offer_id,
    amount,
    tenure_months: tenure,
    interest_rate: Number(row.offered_interest_rate),
    rate_type: row.offer_rate_type,
    emi,
    // What the borrower REPAYS — unchanged by fees, because fees are deducted
    // from what they receive, not added to what they owe. Conflating the two
    // would misstate both figures.
    total_repayable: Math.round(emi * tenure * 100) / 100,
    fees: feeLines,
    total_fees: totalFees,
    // What actually reaches their account.
    net_disbursed: netDisbursed,
    // The true cost once fees are accounted for. null when it cannot be
    // determined (see computeEffectiveApr); undefined when fees weren't loaded.
    effective_apr:
      netDisbursed === undefined
        ? undefined
        : computeEffectiveApr({ netDisbursed, emi, tenureMonths: tenure }),
    note: row.offer_note,
    status: row.offer_status,
    offered_by_name:
      [row.offered_by_first_name, row.offered_by_last_name].filter(Boolean).join(" ") || null,
    offered_at: row.offered_at,
    expires_at: row.expires_at,
    responded_at: row.offer_responded_at,
    response_note: row.offer_response_note,
    is_actionable:
      row.offer_status === "pending" && new Date(row.expires_at) > new Date(),
  };
}

/**
 * Render a MySQL DATE column as a plain YYYY-MM-DD string.
 *
 * mysql2 hands back a JS Date positioned at LOCAL midnight of the stored
 * day, so letting it reach JSON.stringify emits a UTC instant
 * ("2026-09-04T18:30:00.000Z" for a stored 2026-09-05 on a +05:30 server)
 * and any client west of the server renders the previous day. A DATE has no
 * time and no timezone; reading the local Y/M/D parts back out is what
 * preserves the value that was actually stored.
 *
 * Only for DATE columns — TIMESTAMPs like disbursed_at are genuine instants
 * and are left as-is.
 */
function toDateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Shape the joined loan_accounts row (025), which arrives under an
 * `account_`-prefixed alias where it would collide with the application's
 * own columns. null until the loan is drawn down.
 */
function serializeAccount(row) {
  if (!row || !row.account_id) return null;
  const tenure = Number(row.account_tenure_months);
  const emi = Number(row.account_emi);
  return {
    account_id: row.account_id,
    account_no: row.account_no,
    status: row.account_status,
    principal: Number(row.principal),
    interest_rate: Number(row.account_interest_rate),
    rate_type: row.account_rate_type,
    tenure_months: tenure,
    emi,
    total_repayable: Math.round(emi * tenure * 100) / 100,
    // What was withheld at payout, and what actually reached the customer
    // (I1). principal above is unchanged — it is what is owed and amortised.
    // net_disbursed_amount is NULL for loans disbursed before fees existed;
    // surfaced as null rather than defaulted to principal, since those loans
    // genuinely have no evaluated fee position.
    total_fees_charged: Number(row.total_fees_charged || 0),
    net_disbursed_amount:
      row.net_disbursed_amount === null || row.net_disbursed_amount === undefined
        ? null
        : Number(row.net_disbursed_amount),
    disbursed_at: row.disbursed_at,
    first_due_date: toDateOnly(row.first_due_date),
    maturity_date: toDateOnly(row.maturity_date),
    closed_at: row.closed_at,
  };
}

/**
 * Shape the joined credit_policy_evaluations row (029), which arrives under a
 * `policy_`-prefixed alias (see loanModel POLICY_COLUMNS). null for
 * applications assessed before D1 existed — the policy panel simply doesn't
 * render for those rather than showing a fabricated clean pass.
 *
 * `rules` is a JSON column: mysql2 parses it to an array already, but a
 * connection configured otherwise (or an older row) can hand back the raw
 * string, so parse defensively rather than letting a JSON column shape
 * break the whole application response.
 */
function serializePolicy(row) {
  if (!row || !row.policy_id) return null;

  let rules = row.policy_rules;
  if (typeof rules === "string") {
    try {
      rules = JSON.parse(rules);
    } catch {
      rules = [];
    }
  }
  if (!Array.isArray(rules)) rules = [];

  const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));

  return {
    outcome: row.policy_outcome,
    policy_version: row.policy_version,
    reason_codes: row.policy_reason_codes
      ? String(row.policy_reason_codes).split(",")
      : [],
    metrics: {
      dti: numOrNull(row.policy_dti),
      loan_to_income: numOrNull(row.policy_loan_to_income),
      residual_income: numOrNull(row.policy_residual_income),
      age_at_maturity: numOrNull(row.policy_age_at_maturity),
    },
    rules,
    evaluated_at: row.policy_evaluated_at,
    // D1's rule codes translated into D4's applicant-facing adverse-action
    // catalog (adverseAction.service.js) — a starting point for staff
    // rejecting this application manually, so they aren't re-deriving by
    // hand which reasons a policy decline/refer already points to. Empty
    // for a clean pass, or when nothing here maps (e.g. a pure refer with
    // no decline-capable rule fired).
    suggested_adverse_action_reasons: row.policy_reason_codes
      ? deriveReasonCodesFromPolicy(String(row.policy_reason_codes).split(","))
      : [],
  };
}

/**
 * Shape the joined adverse_action_records row (032), which arrives under an
 * `aar_`-prefixed alias (see loanModel ADVERSE_ACTION_COLUMNS) — `id` and
 * `note` would otherwise collide with loan_applications' own columns.
 * null for an application that has never been rejected, or one rejected
 * before D4 existed.
 *
 * This is the LATEST record only (loanModel's join picks the newest by id);
 * the full history — every reject/reopen/reject-again cycle — is fetched
 * separately via getApplicationAdverseActions, mirroring
 * getApplicationHistory's split for the same reason: D2's reopen flow
 * clears loan_applications' own decision columns, so the CURRENT state and
 * the HISTORY are genuinely different questions here.
 */
function serializeAdverseAction(row) {
  if (!row || !row.aar_id) return null;

  let reasons = row.aar_reasons;
  if (typeof reasons === "string") {
    try {
      reasons = JSON.parse(reasons);
    } catch {
      reasons = [];
    }
  }
  if (!Array.isArray(reasons)) reasons = [];

  return {
    reason_codes: row.aar_reason_codes ? String(row.aar_reason_codes).split(",") : [],
    reasons,
    decision_source: row.aar_decision_source,
    decided_by: row.aar_decided_by,
    note: row.aar_note,
    // The technical snapshot — shown to staff, not customers (see
    // AdverseActionPanel on the frontend, which hides this block for
    // non-detailed callers).
    risk_label: row.aar_risk_label === null ? null : Number(row.aar_risk_label),
    risk_category: row.aar_risk_category,
    model_version: row.aar_model_version,
    policy_version: row.aar_policy_version,
    matrix_version: row.aar_matrix_version,
    created_at: row.aar_created_at,
  };
}

/**
 * Shape the joined decision_matrix_evaluations row (030), which arrives under
 * a `matrix_`-prefixed alias (see loanModel MATRIX_COLUMNS). null for
 * applications assessed before D2.
 *
 * `acted` is surfaced separately from `action` because they answer different
 * questions: an auto_reject that acted is why the application is already
 * rejected, whereas an auto_approve never acts and is only ever a
 * recommendation waiting on a reviewer.
 */
function serializeMatrix(row) {
  if (!row || !row.matrix_id) return null;
  return {
    action: row.matrix_action,
    matrix_version: row.matrix_version,
    rationale: row.matrix_rationale,
    acted: Boolean(row.matrix_acted),
    policy_outcome: row.matrix_policy_outcome,
    risk_label: row.matrix_risk_label === null ? null : Number(row.matrix_risk_label),
    evaluated_at: row.matrix_evaluated_at,
  };
}

/**
 * Shape the rate this application was actually assessed and quoted at
 * (D3), from `la.priced_interest_rate` plus the joined product's own bounds
 * (`product_min_interest_rate`/`product_max_interest_rate`, see loanModel's
 * APPLICATION_DETAIL_SELECT). null for applications assessed before D3 —
 * rendering nothing is honest; showing the product's CURRENT base rate would
 * claim a rate this specific application was never actually priced at.
 *
 * `tier` is reconstructed from the stored risk_label rather than by
 * comparing priced_interest_rate against the bounds, so it stays correct
 * even for a zero-width range (min === base === max) where every tier would
 * otherwise look identical.
 */
function serializePricing(row) {
  if (row.priced_interest_rate === null || row.priced_interest_rate === undefined) return null;
  const hasRange =
    row.product_min_interest_rate !== null &&
    row.product_min_interest_rate !== undefined &&
    row.product_max_interest_rate !== null &&
    row.product_max_interest_rate !== undefined;
  const riskLabel =
    row.risk_label === null || row.risk_label === undefined ? null : Number(row.risk_label);
  return {
    interest_rate: Number(row.priced_interest_rate),
    tier: hasRange && riskLabel !== null ? TIER_BY_RISK[riskLabel] ?? null : null,
    risk_based: hasRange,
  };
}

/**
 * Shape a joined loan_applications+risk_assessments+recommendations row into
 * the same { risk, recommendation, explanation } response shape as assess().
 *
 * `role` (the *requesting* user's role) drives allowed_transitions, so each
 * client is told exactly which lifecycle moves the server would accept from
 * it and no UI has to keep its own copy of the status machine. Omitting
 * `role` yields an empty list rather than a permissive one.
 */
function serializeApplication(row, role, { offerFees } = {}) {
  const hasRisk = row.risk_label !== null && row.risk_label !== undefined;
  const hasRec = row.recommended_amount !== null && row.recommended_amount !== undefined;
  // F2 — staff work queue. null for anything already decided (approved,
  // rejected, disbursed, ...): there's no SLA on a resolved application.
  const age = needsStaffAction(row.status)
    ? computeProcessingAge(row.last_status_changed_at || row.created_at)
    : null;
  return {
    application_id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    requested_amount: row.requested_amount,
    tenure_months: row.tenure_months,
    purpose: row.purpose,
    status: row.status,
    allowed_transitions: role ? allowedTransitions(row.status, role) : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    processing_age_days: age?.days ?? null,
    sla_status: age?.sla_status ?? null,
    decision:
      row.decided_by || row.decided_at
        ? {
            decided_by: row.decided_by,
            // NULL decided_by with source 'system' is the decision matrix
            // having decided by itself (D2), not an unknown or deleted
            // reviewer — the UI must be able to tell those apart.
            decided_by_name: [row.decided_by_first_name, row.decided_by_last_name]
              .filter(Boolean)
              .join(" ") || null,
            source: row.decision_source || null,
            override_reason_code: row.override_reason_code || null,
            note: row.decision_note,
            decided_at: row.decided_at,
          }
        : null,
    // The current (latest) request/response cycle only — see
    // applicationStatus.service.js isInfoRequest/isInfoResponse and
    // migration 021. A full history of past cycles is out of scope here.
    info_request:
      row.info_request_note || row.info_requested_at
        ? {
            note: row.info_request_note,
            requested_at: row.info_requested_at,
            response: row.info_response,
            responded_at: row.info_responded_at,
          }
        : null,
    // The most recent offer (023), whatever its status — a superseded or
    // declined one is still worth showing. null when none has been issued.
    offer: serializeOffer(row, offerFees),
    // The live loan account (025). null until drawdown.
    account: serializeAccount(row),
    // The deterministic credit-policy verdict (029), independent of `risk`
    // below. null for applications assessed before D1.
    policy: serializePolicy(row),
    // What the decision matrix (030) made of the two together. null for
    // applications assessed before D2.
    decision_matrix: serializeMatrix(row),
    // The rate this application was assessed and quoted at (031). null for
    // applications assessed before D3.
    pricing: serializePricing(row),
    // The standardized reasons this application was declined for (032),
    // and the immutable model/policy/matrix snapshot behind them. null when
    // the application has never been rejected, or predates D4.
    adverse_action: serializeAdverseAction(row),
    declared: {
      marital_status: row.marital_status,
      education_level: row.education_level,
      occupation: row.occupation,
      employer_category: row.employer_category,
      years_employed: row.years_employed,
      additional_income: row.additional_income,
      existing_loans: row.existing_loans,
      previous_defaults: row.previous_defaults,
      crib_score: row.crib_score,
      guarantor_exposure: row.guarantor_exposure,
      guarantor_defaults: row.guarantor_defaults,
    },
    risk: hasRisk
      ? {
          label: row.risk_label,
          category: row.risk_category,
          probabilities: {
            "Low Risk": Number(row.prob_low),
            "Medium Risk": Number(row.prob_medium),
            "High Risk": Number(row.prob_high),
          },
          // Under the v2 model the three probabilities are OUTCOME
          // probabilities (repaid cleanly / delinquent / defaulted), so the
          // stored prob_high IS the probability of default — no extra column
          // needed, and every historical row keeps working.
          probability_of_default: Number(row.prob_high),
        }
      : null,
    // What the model was shown about this customer's repayment record AT THE
    // TIME it scored them (043). Null for assessments made before behavioural
    // features existed, which is accurate rather than a gap.
    credit_history: parseBehaviouralSnapshot(row.behavioural_snapshot),
    recommendation: hasRec
      ? {
          recommended_amount: row.recommended_amount,
          recommended_emi: row.recommended_emi,
        }
      : null,
    explanation: row.gemini_explanation || null,
  };
}

// POST /api/loans/emi-preview — public, no persistence. Reuses the same
// reducing-balance EMI engine as the assess flow's recommendation.
exports.emiPreview = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const { principal, annualRatePct, tenureMonths } = req.body;

  try {
    const emi = computeEmi(principal, annualRatePct, tenureMonths);
    const totalPayable = emi * tenureMonths;
    const totalInterest = totalPayable - principal;

    return res.status(200).json({
      emi: Math.round(emi * 100) / 100,
      totalPayable: Math.round(totalPayable * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
    });
  } catch (err) {
    console.error("EMI PREVIEW ERROR:", err);
    return res.status(500).json({ message: "Failed to compute EMI preview." });
  }
};

// ?lang=si|ta serves the translated name/description, falling back to English
// per field when a product has no translation (migration 012).
exports.getProducts = async (req, res) => {
  try {
    // ?include_inactive=true is for the admin catalogue screen, which has to
    // show a retired product in order to manage it. This route is
    // unauthenticated, so the flag is not access-controlled — acceptable
    // because a product catalogue is not sensitive, and the only thing the
    // flag reveals is that a product exists but is not on sale.
    const products = await loanModel.findAllProducts({
      lang: req.query.lang,
      includeInactive: req.query.include_inactive === "true",
    });
    return res.status(200).json({ products });
  } catch (err) {
    console.error("GET LOAN PRODUCTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch loan products." });
  }
};

// POST /api/admin/products (admin): add a new loan product to the catalog.
exports.createProduct = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  try {
    const product = await loanModel.createProduct(req.body);
    return res.status(201).json(product);
  } catch (err) {
    console.error("CREATE LOAN PRODUCT ERROR:", err);
    return res.status(500).json({ message: "Failed to create loan product." });
  }
};

// PUT /api/admin/products/:id (admin): update a loan product's terms.
exports.updateProduct = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const productId = Number(req.params.id);
  try {
    const product = await loanModel.updateProduct(productId, req.body);
    if (!product) {
      return res.status(404).json({ message: "Loan product not found." });
    }
    return res.status(200).json(product);
  } catch (err) {
    console.error("UPDATE LOAN PRODUCT ERROR:", err);
    return res.status(500).json({ message: "Failed to update loan product." });
  }
};

// DELETE /api/admin/products/:id (admin): remove a loan product. Rejected if
// any loan_applications still reference it (loan_products has no ON DELETE
// CASCADE, by design).
exports.deleteProduct = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const productId = Number(req.params.id);
  try {
    const result = await loanModel.deleteProduct(productId);
    if (result.notFound) {
      return res.status(404).json({ message: "Loan product not found." });
    }
    return res.status(204).send();
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        message:
          "This product has existing loan applications and cannot be deleted.",
      });
    }
    console.error("DELETE LOAN PRODUCT ERROR:", err);
    return res.status(500).json({ message: "Failed to delete loan product." });
  }
};

// GET /api/admin/products/:id/fees (staff/admin; I1) — a product's configured
// fee schedule. Returns inactive fees too: the admin editor has to be able to
// see and re-activate them, unlike offer issuance which only ever charges
// active ones.
exports.getProductFees = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  const productId = Number(req.params.id);
  try {
    const product = await loanModel.findProductById(productId);
    if (!product) return res.status(404).json({ message: "Loan product not found." });
    const fees = await loanModel.findProductFees(productId);
    return res.status(200).json({ product_id: productId, fees });
  } catch (err) {
    console.error("GET PRODUCT FEES ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch product fees." });
  }
};

// PUT /api/admin/products/:id/fees (admin; I1) — replace a product's entire
// fee schedule. PUT, not PATCH: the editor sends the whole set, same
// convention as the product endpoints themselves.
//
// Only touches CONFIG. Offers already issued keep the fees they were quoted
// (they were snapshotted onto loan_offer_fees at issuance) — re-pricing a
// product must never retroactively change what an existing customer was told.
exports.replaceProductFees = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  const productId = Number(req.params.id);
  const incoming = Array.isArray(req.body?.fees) ? req.body.fees : [];

  // One fee per type — the table's UNIQUE key enforces it anyway, but a
  // clean 400 beats a raw ER_DUP_ENTRY.
  const seen = new Set();
  for (const fee of incoming) {
    if (seen.has(fee.fee_type)) {
      return res.status(400).json({
        message: `Duplicate fee type '${fee.fee_type}' — a product may only charge each fee once.`,
      });
    }
    seen.add(fee.fee_type);
    if (
      fee.calc_method === "percentage" &&
      fee.min_amount !== null && fee.min_amount !== undefined && fee.min_amount !== "" &&
      fee.max_amount !== null && fee.max_amount !== undefined && fee.max_amount !== "" &&
      Number(fee.min_amount) > Number(fee.max_amount)
    ) {
      return res.status(400).json({
        message: `'${fee.label || fee.fee_type}' has a minimum above its maximum, which can never be satisfied.`,
      });
    }
  }

  try {
    const product = await loanModel.findProductById(productId);
    if (!product) return res.status(404).json({ message: "Loan product not found." });
    const fees = await loanModel.replaceProductFees(productId, incoming);
    return res.status(200).json({ product_id: productId, fees });
  } catch (err) {
    console.error("REPLACE PRODUCT FEES ERROR:", err);
    return res.status(500).json({ message: "Failed to update product fees." });
  }
};

/**
 * Fee lines for every offer in a set of application rows, keyed by offer_id
 * (I1). One batched query rather than one per row — the customer dashboard
 * and the staff queue both render offers in a list, and a per-row fetch would
 * be N+1.
 */
async function loadOfferFeesFor(rows) {
  const offerIds = rows.map((r) => r.offer_id).filter(Boolean);
  return loanModel.findOfferFeesForOffers(offerIds);
}

/**
 * serializeApplication for ONE row, with its offer's fee lines loaded (I1).
 * Every endpoint that returns a single application goes through this so the
 * fee breakdown can never be present on some responses and silently missing
 * on others.
 */
async function serializeApplicationWithFees(row, role) {
  const offerFees = row?.offer_id ? await loanModel.findOfferFees(row.offer_id) : undefined;
  return serializeApplication(row, role, { offerFees });
}

exports.getMyApplications = async (req, res) => {
  try {
    const rows = await loanModel.findApplicationsByUserId(req.user.user_id);
    const feesByOffer = await loadOfferFeesFor(rows);
    return res.status(200).json({
      applications: rows.map((row) =>
        serializeApplication(row, req.user.role, {
          // [] not undefined for an offer with no fee rows — "this offer has
          // none" is a real answer here, unlike an endpoint that never asked.
          offerFees: row.offer_id ? feesByOffer.get(row.offer_id) || [] : undefined,
        })
      ),
    });
  } catch (err) {
    console.error("GET MY APPLICATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch applications." });
  }
};

// --- Wizard drafts (H3) ------------------------------------------------
// Save-and-continue-later for an UNSUBMITTED application. All three handlers
// scope strictly to req.user.user_id (taken from the verified token, never
// from the body or params), so a customer can only ever read or write their
// own draft — there is no id in the route to tamper with.
//
// A draft is form state, not loan data: it is replayed into the wizard's
// fields on resume and is never a submission path. Submitting still goes
// through POST /assess and its express-validator chain, so a tampered draft
// cannot smuggle unvalidated values into an application.

exports.getDraft = async (req, res) => {
  try {
    const row = await loanModel.findDraftByUserId(req.user.user_id);
    if (!row) return res.status(200).json({ draft: null });

    return res.status(200).json({
      draft: {
        // mysql2 returns a JSON column already parsed; tolerate a string too
        // in case the driver/column type ever changes underneath us.
        payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
        step: row.step,
        updated_at: row.updated_at,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error("GET LOAN DRAFT ERROR:", err);
    return res.status(500).json({ message: "Failed to load your saved application." });
  }
};

exports.saveDraft = async (req, res) => {
  let payload;
  let step;
  try {
    payload = sanitizeDraftPayload(req.body?.payload);
    step = sanitizeStep(req.body?.step);
  } catch (err) {
    if (err instanceof DraftPayloadError) {
      return res.status(400).json({ message: err.message });
    }
    throw err;
  }

  try {
    await loanModel.upsertDraft(req.user.user_id, { step, payload });
    return res.status(200).json({ saved: true, step });
  } catch (err) {
    console.error("SAVE LOAN DRAFT ERROR:", err);
    return res.status(500).json({ message: "Failed to save your application." });
  }
};

exports.deleteDraft = async (req, res) => {
  try {
    await loanModel.deleteDraftByUserId(req.user.user_id);
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error("DELETE LOAN DRAFT ERROR:", err);
    return res.status(500).json({ message: "Failed to discard your saved application." });
  }
};

exports.getApplicationById = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Permission denied" });
    }
    return res.status(200).json(await serializeApplicationWithFees(row, req.user.role));
  } catch (err) {
    console.error("GET APPLICATION BY ID ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch application." });
  }
};

// GET /api/loans/:id/history (owner, staff, or admin): the full transition
// audit trail (migration 022) — every status change on this application,
// oldest first, with who made it and any note. Complements `decision` and
// `info_request` on the application itself, which only ever show the
// LATEST cycle; this is the complete record B1/B3 deferred.
exports.getApplicationHistory = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const events = await loanModel.getApplicationHistory(applicationId);
    return res.status(200).json({
      application_id: applicationId,
      events: events.map((ev) => ({
        id: ev.id,
        from_status: ev.from_status,
        to_status: ev.to_status,
        actor_user_id: ev.actor_user_id,
        actor_role: ev.actor_role,
        actor_name:
          [ev.actor_first_name, ev.actor_last_name].filter(Boolean).join(" ") || null,
        note: ev.note,
        // The standardized justification when this transition overrode the
        // decision matrix (D2). null for ordinary, matrix-consistent moves.
        override_reason_code: ev.override_reason_code || null,
        created_at: ev.created_at,
      })),
    });
  } catch (err) {
    console.error("GET APPLICATION HISTORY ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch application history." });
  }
};

// GET /api/loans/:id/adverse-actions (owner, staff, or admin): the FULL
// adverse-action history (D4/032) — every reject-reopen-reject cycle this
// application has been through, oldest first, each an honest immutable
// snapshot of its own decision. Complements `adverse_action` on the
// application itself (see serializeApplication), which only ever shows the
// LATEST record — the same split as getApplicationHistory/
// loan_application_events, and for the same reason: D2's reopen flow
// clears the application's own current-decision columns, so the running
// record only survives here.
exports.getApplicationAdverseActions = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const records = await loanModel.getAdverseActionHistory(applicationId);
    return res.status(200).json({
      application_id: applicationId,
      adverse_actions: records.map((r) => ({
        id: r.id,
        reason_codes: r.reason_codes ? String(r.reason_codes).split(",") : [],
        reasons: (() => {
          if (Array.isArray(r.reasons)) return r.reasons;
          try {
            const parsed = JSON.parse(r.reasons);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        decision_source: r.decision_source,
        decided_by: r.decided_by,
        decided_by_name:
          [r.decided_by_first_name, r.decided_by_last_name].filter(Boolean).join(" ") || null,
        note: r.note,
        risk_label: r.risk_label === null ? null : Number(r.risk_label),
        risk_category: r.risk_category,
        model_version: r.model_version,
        policy_version: r.policy_version,
        matrix_version: r.matrix_version,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error("GET APPLICATION ADVERSE ACTIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch adverse-action history." });
  }
};

// GET /api/loans/:id/security (owner, staff, or admin; D5): the guarantor(s)
// and collateral pledged against this application. A separate endpoint
// rather than fields on serializeApplication because both are 1:many —
// unlike policy/matrix/pricing (each latest-by-id, one row), a list can't
// collapse into a single joined column set without duplicating the
// application row per guarantor/item.
exports.getApplicationSecurity = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const [guarantors, collateral] = await Promise.all([
      loanModel.getApplicationGuarantors(applicationId),
      loanModel.getApplicationCollateral(applicationId),
    ]);

    return res.status(200).json({
      application_id: applicationId,
      guarantors: guarantors.map((g) => ({
        id: g.id,
        // The customer never sees another guarantor's raw NIC beyond their
        // own submission context — staff do, since verifying identity is
        // part of their job; a customer only ever has THEIR OWN
        // application's guarantors here anyway, but the redaction is kept
        // role-based rather than relying on that being permanently true.
        nic: isReviewer ? g.nic : null,
        full_name: g.full_name,
        phone: isReviewer ? g.phone : null,
        address: isReviewer ? g.address : null,
        relationship_to_applicant: g.relationship_to_applicant,
        guaranteed_amount: Number(g.guaranteed_amount),
        status: g.status,
        added_by_name:
          [g.added_by_first_name, g.added_by_last_name].filter(Boolean).join(" ") || null,
        added_at: g.added_at,
        released_at: g.released_at,
      })),
      collateral: collateral.map((c) => ({
        id: c.id,
        collateral_type: c.collateral_type,
        description: c.description,
        estimated_value: Number(c.estimated_value),
        valuation_date: c.valuation_date,
        ownership_reference: c.ownership_reference,
        verification_status: c.verification_status,
        verified_by_name:
          [c.verified_by_first_name, c.verified_by_last_name].filter(Boolean).join(" ") || null,
        verified_at: c.verified_at,
        status: c.status,
        created_at: c.created_at,
      })),
    });
  } catch (err) {
    console.error("GET APPLICATION SECURITY ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch guarantor/collateral details." });
  }
};

// --- loan application documents (E1) ------------------------------------

/**
 * Shared access check for every document route: load the application and
 * confirm the caller may see it — the owning customer, or any staff/admin.
 * Mirrors fxExchange.controller.js's loadRequestForDocumentAccess.
 * @returns {Promise<{row:object}|{error:{status:number,message:string}}>}
 */
async function loadApplicationForDocumentAccess(applicationId, user) {
  const row = await loanModel.findApplicationById(applicationId);
  if (!row) {
    return { error: { status: 404, message: "Application not found." } };
  }
  const isOwner = row.user_id === user.user_id;
  const isReviewer = user.role === "admin" || user.role === "staff";
  if (!isOwner && !isReviewer) {
    return { error: { status: 403, message: "Permission denied" } };
  }
  return { row };
}

/** Remove an uploaded file that we've decided not to keep, best-effort. */
function discardUploadedLoanFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, (err) => {
    if (err) console.error("LOAN DOCUMENT CLEANUP ERROR:", err.message);
  });
}

// POST /api/loans/:id/documents (customer, own) — upload one supporting
// document. Multer has already written the file to secure-uploads/ by the
// time this runs, so every rejection path below has to delete it again
// rather than leave an orphan on disk.
exports.uploadDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    discardUploadedLoanFile(req.file);
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);

  if (!req.file) {
    return res.status(400).json({ message: "A file is required." });
  }

  // `side` only means something for a two-sided document submitted as a
  // photo (a National ID card) — reject it outright for anything else
  // rather than silently store a value that can never apply, e.g. a bank
  // statement PDF with side=front.
  const side = req.body.side || null;
  if (side && !TWO_SIDED_DOCUMENT_TYPES.includes(req.body.document_type)) {
    discardUploadedLoanFile(req.file);
    return res.status(400).json({
      message: `side is only accepted for: ${TWO_SIDED_DOCUMENT_TYPES.join(", ")}`,
    });
  }

  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      discardUploadedLoanFile(req.file);
      return res.status(404).json({ message: "Application not found." });
    }
    // Upload is owner-only even though *reading* documents is open to
    // staff/admin: staff review evidence, they don't supply it.
    if (row.user_id !== req.user.user_id) {
      discardUploadedLoanFile(req.file);
      return res.status(403).json({ message: "Permission denied" });
    }

    const doc = await loanModel.createApplicationDocument({
      applicationId,
      documentType: req.body.document_type,
      side,
      uploadedBy: req.user.user_id,
      originalName: req.file.originalname,
      storagePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });

    res.status(201).json(doc);

    // Advisory OCR/extraction, AFTER the response has gone out: the upload
    // is complete and the customer has been told so, so this cannot slow
    // the upload down or fail it. processDocumentInBackground never
    // rejects, and never touches verification_status — staff sign-off
    // remains the sole authority on whether a document is accepted.
    processDocumentInBackground({
      source: "loan",
      documentId: doc.id,
      applicationId: row.id,
      userId: row.user_id,
      documentType: doc.document_type,
      storagePath: req.file.path,
      mimeType: req.file.mimetype,
    });
    return;
  } catch (err) {
    console.error("UPLOAD LOAN DOCUMENT ERROR:", err);
    // Once the 201 is out the upload HAS succeeded and the stored file must
    // survive — only a failure before that point discards it and reports an
    // error, or we would delete a document the customer was told we kept.
    if (res.headersSent) return;
    discardUploadedLoanFile(req.file);
    return res.status(500).json({ message: "Failed to upload the document." });
  }
};

// GET /api/loans/:id/documents — metadata only (owner, staff, or admin).
exports.listDocuments = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const { row, error } = await loadApplicationForDocumentAccess(applicationId, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const documents = await loanModel.getApplicationDocuments(row.id);
    return res.status(200).json({
      documents: documents.map((d) => ({
        id: d.id,
        document_type: d.document_type,
        side: d.side,
        original_name: d.original_name,
        mime_type: d.mime_type,
        size_bytes: d.size_bytes,
        verification_status: d.verification_status,
        verified_by_name:
          [d.verified_by_first_name, d.verified_by_last_name].filter(Boolean).join(" ") || null,
        verified_at: d.verified_at,
        verification_notes: d.verification_notes,
        created_at: d.created_at,
      })),
    });
  } catch (err) {
    console.error("LIST LOAN DOCUMENTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the documents." });
  }
};

// GET /api/loans/:id/documents/:docId/download — stream the file back. This
// route exists because secure-uploads/ is deliberately NOT served
// statically (see migration 034's header): it is the only way to read a
// loan document, and it checks ownership/role on every hit.
exports.downloadDocument = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const { row, error } = await loadApplicationForDocumentAccess(applicationId, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const doc = await loanModel.getApplicationDocumentById(Number(req.params.docId));
    // The id must belong to the application named in the path — otherwise
    // any authenticated customer could read another customer's document by
    // pairing their own application id with someone else's document id.
    if (!doc || doc.application_id !== row.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    // Defence in depth: refuse to serve anything that resolved outside the
    // document directory, whatever ended up in the column.
    const resolved = path.resolve(doc.storage_path);
    if (!resolved.startsWith(path.resolve(LOAN_DOCUMENT_DIR) + path.sep)) {
      console.error("DOWNLOAD LOAN DOCUMENT ERROR: path escapes document dir:", resolved);
      return res.status(404).json({ message: "Document not found." });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ message: "The stored file is no longer available." });
    }

    res.setHeader("Content-Type", doc.mime_type);
    // `inline` so staff can preview a PDF/image in the browser rather than
    // being forced to download it.
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${sanitizeDownloadFilename(doc.original_name)}"`
    );
    return fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error("DOWNLOAD LOAN DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the document." });
  }
};

// GET /api/loans/:id/documents/:docId/extraction — the advisory OCR result
// for one document. Same access rules as every other document read (owner,
// staff or admin, and the document must belong to the application in the
// path): extracted fields quote the document's contents, so anyone who may
// not read the document may not read what was pulled out of it either.
//
// Advisory only. This endpoint reports; it decides nothing. The document's
// own verification_status is unaffected by anything here, whatever the
// findings say.
exports.getDocumentExtraction = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const { row, error } = await loadApplicationForDocumentAccess(applicationId, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const doc = await loanModel.getApplicationDocumentById(Number(req.params.docId));
    if (!doc || doc.application_id !== row.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    const extraction = await loanModel.getLoanDocumentExtraction(doc.id);
    return res.status(200).json(presentExtraction(doc, extraction));
  } catch (err) {
    console.error("GET LOAN DOCUMENT EXTRACTION ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the extraction result." });
  }
};

// POST /api/loans/:id/documents/:docId/extraction/retry — re-run the
// advisory OCR/extraction pipeline for one document on demand (owner,
// staff, or admin — same access rule as reading the result above).
//
// runExtractionPipeline already retries a transient recognition failure
// once on its own, but that only covers the automatic run triggered at
// upload time. This exists for everything that first retry didn't fix — a
// document whose recognition genuinely failed twice in a row, or one
// uploaded while auto-extraction was switched off. Deliberately bypasses
// the ocr_auto_extraction setting: that setting only gates the automatic,
// upload-triggered run (see processDocumentInBackground's jsdoc), not a
// human deliberately asking for another attempt right now. Awaited rather
// than fire-and-forget, unlike the upload path — there is no response
// already sent to protect here, and the caller needs the fresh result to
// show it.
exports.retryDocumentExtraction = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const { row, error } = await loadApplicationForDocumentAccess(applicationId, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const doc = await loanModel.getApplicationDocumentById(Number(req.params.docId));
    if (!doc || doc.application_id !== row.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    await runExtractionPipeline({
      source: "loan",
      documentId: doc.id,
      applicationId: row.id,
      userId: row.user_id,
      documentType: doc.document_type,
      storagePath: doc.storage_path,
      mimeType: doc.mime_type,
    });

    const extraction = await loanModel.getLoanDocumentExtraction(doc.id);
    return res.status(200).json(presentExtraction(doc, extraction));
  } catch (err) {
    console.error("RETRY LOAN DOCUMENT EXTRACTION ERROR:", err);
    return res.status(500).json({ message: "Failed to retry the extraction." });
  }
};

// DELETE /api/loans/:id/documents/:docId (customer, own) — only while the
// document is still 'pending' review. Once staff have acted, the record is
// locked for audit; the customer uploads a fresh document instead of
// erasing the trail (see loanModel.deleteApplicationDocument).
exports.deleteDocument = async (req, res) => {
  const applicationId = Number(req.params.id);
  const documentId = Number(req.params.docId);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (row.user_id !== req.user.user_id) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const existing = await loanModel.getApplicationDocumentById(documentId);
    if (!existing || existing.application_id !== row.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    const deleted = await loanModel.deleteApplicationDocument(documentId);
    if (!deleted) {
      return res.status(409).json({
        message: "This document has already been reviewed and can no longer be removed.",
      });
    }

    fs.unlink(deleted.storage_path, (err) => {
      if (err) console.error("LOAN DOCUMENT DELETE FILE ERROR:", err.message);
    });

    return res.status(204).send();
  } catch (err) {
    console.error("DELETE LOAN DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to delete the document." });
  }
};

// PATCH /api/admin/applications/:id/documents/:docId/verify (staff/admin) —
// sign off on, or reject, one uploaded document. Advisory only (E1): does
// not touch loan_applications or the B1 status machine — see
// applicationStatus.service.js, which is untouched by this feature.
exports.verifyDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);
  const documentId = Number(req.params.docId);
  const { verification_status: verificationStatus, verification_notes: verificationNotes } = req.body;

  try {
    // Confirm the document actually belongs to the application in the URL —
    // without this, any staff member could verify ANY document row by
    // guessing its id.
    const existing = await loanModel.getApplicationDocumentById(documentId);
    if (!existing || existing.application_id !== applicationId) {
      return res.status(404).json({ message: "Document not found on this application." });
    }

    const updated = await loanModel.verifyApplicationDocument(documentId, {
      verificationStatus,
      verifiedBy: req.user.user_id,
      verificationNotes,
    });
    if (!updated) {
      return res.status(409).json({
        message: "This document has already been verified or rejected and cannot be changed again.",
      });
    }

    return res.status(200).json({
      id: updated.id,
      verification_status: updated.verification_status,
      verification_notes: updated.verification_notes,
      verified_at: updated.verified_at,
    });
  } catch (err) {
    console.error("VERIFY LOAN DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to update the document." });
  }
};

// PATCH /api/admin/applications/:id/collateral/:collateralId/verify
// (staff/admin; D5): sign off on, or reject, one pledged collateral item.
// Does not touch loan_applications or re-run credit policy — a policy
// verdict is a point-in-time snapshot (see D1); staff who now trust
// verified collateral more than the stored verdict use D2's override
// mechanism (POLICY_EXCEPTION / COMPENSATING_FACTORS) to act on it.
exports.verifyCollateral = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);
  const collateralId = Number(req.params.collateralId);
  const { verification_status: verificationStatus } = req.body;

  try {
    // Confirm the collateral item actually belongs to the application in
    // the URL — without this, any staff member could verify ANY
    // collateral_items row by guessing its id.
    const items = await loanModel.getApplicationCollateral(applicationId);
    const belongs = items.some((i) => i.id === collateralId);
    if (!belongs) {
      return res.status(404).json({ message: "Collateral item not found on this application." });
    }

    const updated = await loanModel.verifyCollateralItem(collateralId, {
      verificationStatus,
      verifiedBy: req.user.user_id,
    });
    if (!updated) {
      return res.status(409).json({
        message: "This item has already been verified or rejected and cannot be changed again.",
      });
    }

    return res.status(200).json({
      id: updated.id,
      verification_status: updated.verification_status,
      verified_at: updated.verified_at,
    });
  } catch (err) {
    console.error("VERIFY COLLATERAL ERROR:", err);
    return res.status(500).json({ message: "Failed to update the collateral item." });
  }
};

// GET /api/admin/guarantors/:nic/exposure (staff/admin; D5): one
// guarantor's full standing across the system — every application they
// back, its status, and whether any of it is currently overdue. The
// detail behind the summary creditPolicy.service.js's GUARANTOR_RELIABILITY
// rule computes at assess time, for a reviewer who wants to see the
// underlying facilities rather than just the verdict.
exports.getGuarantorExposure = async (req, res) => {
  const nic = String(req.params.nic || "").trim().toUpperCase();
  if (!isValidNic(nic)) {
    return res.status(400).json({ message: `"${req.params.nic}" is not a valid NIC number.` });
  }

  try {
    const { guarantor, guarantees } = await loanModel.getGuarantorExposureDetail(nic);
    if (!guarantor) {
      return res.status(404).json({ message: "No guarantor found with this NIC." });
    }

    const activeGuarantees = guarantees.filter((g) => g.guarantee_status === "active");
    return res.status(200).json({
      guarantor: {
        nic: guarantor.nic,
        full_name: guarantor.full_name,
        phone: guarantor.phone,
        address: guarantor.address,
      },
      total_active_exposure: activeGuarantees.reduce(
        (sum, g) => sum + Number(g.guaranteed_amount),
        0
      ),
      active_guarantee_count: activeGuarantees.length,
      distressed_guarantee_count: activeGuarantees.filter((g) => Boolean(g.is_distressed)).length,
      guarantees: guarantees.map((g) => ({
        application_id: g.application_id,
        applicant_name:
          [g.applicant_first_name, g.applicant_last_name].filter(Boolean).join(" ") || null,
        application_status: g.application_status,
        requested_amount: Number(g.requested_amount),
        guaranteed_amount: Number(g.guaranteed_amount),
        guarantee_status: g.guarantee_status,
        account_status: g.account_status,
        is_distressed: Boolean(g.is_distressed),
        added_at: g.added_at,
      })),
    });
  } catch (err) {
    console.error("GET GUARANTOR EXPOSURE ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch guarantor exposure." });
  }
};

// GET /api/admin/applications/:id/beneficiary-account (staff/admin only —
// role-gated at the route). Lets staff see WHERE a disbursement will send
// funds before they click "Mark Disbursed".
//
// Since migration 039 this is purely informational: an absent account no
// longer blocks anything, because createAccountWithin opens one if it has to
// (and offer acceptance normally already did). `will_be_opened` says which of
// those two the staff member is looking at, so the UI can be honest about it
// rather than showing a scary "missing" state for a non-problem.
exports.getApplicationBeneficiaryAccount = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }

    const account = await bankAccountModel.findActiveByUserId(row.user_id);
    return res.status(200).json({
      application_id: applicationId,
      branch: account?.branch || null,
      account_number: account?.account_number || null,
      account_holder: account?.account_holder || null,
      complete: Boolean(account),
      will_be_opened: !account,
    });
  } catch (err) {
    console.error("GET APPLICATION BENEFICIARY ACCOUNT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch beneficiary account." });
  }
};

// GET /api/loans/:id/schedule (owner, staff, or admin): the full repayment
// calendar for this application's loan account (migration 026). Empty
// `schedule` (not a 404) when the application has no account yet — "not
// disbursed" is a normal state to view, not an error.
exports.getRepaymentSchedule = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const schedule = await loanModel.getRepaymentSchedule(applicationId);
    // Arrears, outstanding and the settlement figure are all DERIVED, never
    // stored — they change with the calendar alone (see migration 027).
    // Computing them here means they are always as-at right now.
    const arrears = computeArrears(schedule);
    const outstanding = computeOutstanding(schedule);
    const settlement = computeSettlement(schedule);

    return res.status(200).json({
      application_id: applicationId,
      account: serializeAccount(row),
      outstanding,
      arrears,
      // Only meaningful while money is still owed.
      settlement: outstanding.total > 0 ? settlement : null,
      schedule: schedule.map((r) => ({
        installment_no: r.installment_no,
        due_date: toDateOnly(r.due_date),
        opening_balance: Number(r.opening_balance),
        principal_component: Number(r.principal_component),
        interest_component: Number(r.interest_component),
        emi: Number(r.emi),
        closing_balance: Number(r.closing_balance),
        principal_paid: Number(r.principal_paid || 0),
        interest_paid: Number(r.interest_paid || 0),
        late_fee_amount: Number(r.late_fee_amount || 0),
        late_fee_paid: Number(r.late_fee_paid || 0),
        late_fee_waived: Number(r.late_fee_waived || 0),
        schedule_id: r.id,
        outstanding: outstandingOn(r).total,
        status: r.status,
      })),
    });
  } catch (err) {
    console.error("GET REPAYMENT SCHEDULE ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the repayment schedule." });
  }
};

// Quote a CSV field only when it needs it, doubling any inner quotes —
// mirrors fxExchange.controller.js's csvField() escaper, the only other
// CSV export in this codebase.
function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/loans/:id/decision-letter (owner, staff, or admin): a formatted
// PDF letter confirming an approval or rejection. 409 for anything without
// a credit decision yet — there's nothing to write a letter about.
exports.getDecisionLetter = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }
    if (row.status !== "approved" && row.status !== "rejected") {
      return res.status(409).json({
        message: "A decision letter is only available once this application has been approved or rejected.",
      });
    }

    const buffer = await generateDecisionLetterPdf({
      applicationId,
      applicantName: [row.applicant_first_name, row.applicant_last_name].filter(Boolean).join(" ") || "Applicant",
      productName: row.product_name,
      requestedAmount: Number(row.requested_amount),
      tenureMonths: row.tenure_months,
      status: row.status,
      decision: {
        decided_at: row.decided_at,
        note: row.decision_note,
        source: row.decision_source,
        decided_by_name: [row.decided_by_first_name, row.decided_by_last_name].filter(Boolean).join(" ") || null,
      },
      // Fee lines are loaded so the letter can state the net disbursement and
      // effective APR (I1) — the figures that make the quoted rate honest.
      offer: serializeOffer(row, row.offer_id ? await loanModel.findOfferFees(row.offer_id) : []),
      adverseAction: serializeAdverseAction(row),
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="decision-letter-app-${applicationId}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    console.error("GET DECISION LETTER ERROR:", err);
    return res.status(500).json({ message: "Failed to generate the decision letter." });
  }
};

// GET /api/loans/:id/statement.csv (owner, staff, or admin): the repayment
// schedule as a CSV statement. 409 when no loan account exists yet —
// nothing has been disbursed to state.
exports.getLoanStatementCsv = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }
    if (!row.account_id) {
      return res.status(409).json({ message: "No loan account exists for this application yet." });
    }

    const schedule = await loanModel.getRepaymentSchedule(applicationId);
    const header = [
      "installment_no",
      "due_date",
      "opening_balance",
      "principal_component",
      "interest_component",
      "emi",
      "principal_paid",
      "interest_paid",
      "late_fee_amount",
      "late_fee_paid",
      "closing_balance",
      "status",
    ];
    const lines = [header.join(",")];
    for (const r of schedule) {
      lines.push(
        [
          r.installment_no,
          toDateOnly(r.due_date),
          Number(r.opening_balance),
          Number(r.principal_component),
          Number(r.interest_component),
          Number(r.emi),
          Number(r.principal_paid || 0),
          Number(r.interest_paid || 0),
          Number(r.late_fee_amount || 0),
          Number(r.late_fee_paid || 0),
          Number(r.closing_balance),
          r.status,
        ]
          .map(csvField)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="loan-statement-app-${applicationId}.csv"`);
    return res.status(200).send(lines.join("\r\n"));
  } catch (err) {
    console.error("GET LOAN STATEMENT CSV ERROR:", err);
    return res.status(500).json({ message: "Failed to generate the loan statement." });
  }
};

// GET /api/loans/:id/payments (owner, staff, or admin): every payment
// recorded against this loan, newest first.
exports.getPayments = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) return res.status(404).json({ message: "Application not found." });

    const isOwner = row.user_id === req.user.user_id;
    const isReviewer = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const payments = await loanModel.getPayments(applicationId);
    return res.status(200).json({
      application_id: applicationId,
      payments: payments.map((pmt) => ({
        payment_id: pmt.id,
        reference_no: pmt.reference_no,
        amount: Number(pmt.amount),
        paid_on: toDateOnly(pmt.paid_on),
        method: pmt.method,
        payment_type: pmt.payment_type,
        external_ref: pmt.external_ref,
        note: pmt.note,
        recorded_at: pmt.recorded_at,
        recorded_by_name:
          [pmt.recorded_by_first_name, pmt.recorded_by_last_name]
            .filter(Boolean)
            .join(" ") || null,
      })),
    });
  } catch (err) {
    console.error("GET PAYMENTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch payments." });
  }
};

// POST /api/admin/applications/:id/payments (staff/admin): record a payment
// received against a loan. Customers never self-report payments — a
// repayment is a fact the bank observes, not one the borrower asserts.
//
// The allocation itself is done under a row lock inside the model, so two
// cashiers keying receipts at the same moment can't both allocate against
// the same outstanding balance.
exports.recordPayment = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);
  const { amount, paid_on, method, payment_type, external_ref, note } = req.body;

  try {
    const result = await loanModel.recordPayment({
      applicationId,
      amount,
      paidOn: paid_on,
      method: method || "cash",
      paymentType: payment_type || "installment",
      externalRef: external_ref,
      note,
      recordedBy: req.user.user_id,
    });

    if (result.notFound) {
      return res.status(404).json({
        message: "This application has no disbursed loan to record a payment against.",
      });
    }
    if (result.inactive) {
      return res.status(409).json({
        message: `This loan is ${result.status}; no further payments can be recorded.`,
      });
    }
    if (result.overpayment) {
      return res.status(400).json({
        message: `That is more than the loan owes. The outstanding balance is ${result.outstanding}.`,
        outstanding: result.outstanding,
      });
    }
    if (result.settlementMismatch) {
      return res.status(400).json({
        message: `An early settlement must be paid in full. The settlement figure is ${result.expected}.`,
        settlement_amount: result.expected,
      });
    }

    // The final payment closes the ACCOUNT inside the payment transaction.
    // The APPLICATION is moved through the normal status machine here, so
    // the closure is audited, notified and permission-checked exactly like
    // any other transition rather than being written behind its back. A
    // failure here leaves the loan correctly closed and the application
    // closable by hand, so it is logged rather than surfaced as an error on
    // an otherwise successful payment.
    if (result.accountClosed) {
      try {
        await loanModel.updateApplicationStatus({
          applicationId,
          status: "closed",
          actorId: req.user.user_id,
          actorRole: req.user.role,
          note: `Loan fully repaid (payment ${result.referenceNo}).`,
        });
      } catch (closeErr) {
        console.error("AUTO-CLOSE AFTER FINAL PAYMENT FAILED:", closeErr.message);
      }
    }

    const schedule = await loanModel.getRepaymentSchedule(applicationId);
    return res.status(201).json({
      payment_id: result.paymentId,
      reference_no: result.referenceNo,
      account_closed: result.accountClosed,
      outstanding: computeOutstanding(schedule),
      arrears: computeArrears(schedule),
    });
  } catch (err) {
    console.error("RECORD PAYMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to record the payment." });
  }
};

// PATCH /api/admin/applications/:id/schedule/:scheduleId/waive-fee
// (staff/admin): waive whatever remains of one installment's late fee.
// Always the FULL remaining amount — see loanModel.waiveLateFee for why a
// partial waiver isn't offered here.
exports.waiveLateFee = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);
  const scheduleId = Number(req.params.scheduleId);

  try {
    const result = await loanModel.waiveLateFee({
      applicationId,
      scheduleId,
      waivedBy: req.user.user_id,
      note: req.body.note,
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Installment not found on this application." });
    }
    if (result.nothingToWaive) {
      return res.status(409).json({
        message: "This installment has no outstanding late fee to waive.",
      });
    }

    const schedule = await loanModel.getRepaymentSchedule(applicationId);
    return res.status(200).json({
      waived: result.waived,
      outstanding: computeOutstanding(schedule),
    });
  } catch (err) {
    console.error("WAIVE LATE FEE ERROR:", err);
    return res.status(500).json({ message: "Failed to waive the late fee." });
  }
};

exports.getAllApplications = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const { status } = req.query;
  try {
    const rows = await loanModel.findAllApplications(status);
    const feesByOffer = await loadOfferFeesFor(rows);
    const applications = rows.map((row) => ({
      ...serializeApplication(row, req.user.role, {
        offerFees: row.offer_id ? feesByOffer.get(row.offer_id) || [] : undefined,
      }),
      applicant: {
        user_id: row.user_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
      },
    }));
    return res.status(200).json({ applications });
  } catch (err) {
    console.error("GET ALL APPLICATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch applications." });
  }
};

// GET /api/admin/override-reasons (staff/admin): the standardized override
// reason codes (D2). Served from decisionMatrix.service.js rather than
// duplicated in the client, so the list a reviewer picks from is by
// construction the list the server will accept.
//
// ?direction=lenient|strict narrows it to the codes valid for that kind of
// override; omitting it returns the full catalogue.
exports.getOverrideReasons = (req, res) => {
  const { direction } = req.query;
  const valid = direction === "lenient" || direction === "strict";
  return res.status(200).json({
    reasons: overrideReasonsFor(valid ? direction : undefined),
  });
};

// GET /api/admin/adverse-action-reasons (staff/admin): the standardized D4
// adverse-action reason codes, served from adverseAction.service.js rather
// than duplicated in the client — the list a reviewer picks a rejection
// reason from is by construction the list the server will accept.
exports.getAdverseActionReasons = (req, res) => {
  return res.status(200).json({ reasons: ADVERSE_ACTION_REASONS });
};

// PATCH /api/admin/applications/:id/status (staff/admin): move an application
// along its lifecycle and notify the applicant. Which moves are legal from
// where, and by whom, comes entirely from applicationStatus.service.js — the
// authoritative check happens inside the model's transaction, under the row
// lock, so simultaneous reviewers can't both win.
exports.updateApplicationStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const applicationId = Number(req.params.id);
  const { status, note } = req.body;
  const overrideReasonCode = req.body.override_reason_code || null;
  const reasonCodes = Array.isArray(req.body.reason_codes) ? req.body.reason_codes : [];

  try {
    // D2's override gate. A reviewer may always decide against the matrix —
    // they are the authority, not the table — but a deviation has to say
    // why, in a standardized code the audit trail can be queried on.
    //
    // The check runs against the application's CURRENT stored state, before
    // the transition is attempted. It is not a race-sensitive check: if a
    // concurrent reviewer wins the row lock first, the transition itself
    // conflicts (409) inside the transaction and this decision never lands.
    const currentRow = await loanModel.findApplicationById(applicationId);
    if (!currentRow) {
      return res.status(404).json({ message: "Application not found." });
    }

    const override = requiresOverride({
      targetStatus: status,
      fromStatus: currentRow.status,
      matrixAction: currentRow.matrix_action,
      policyOutcome: currentRow.policy_outcome,
    });

    if (override.required) {
      if (!overrideReasonCode) {
        return res.status(422).json({
          message: override.reason,
          override_required: true,
          override_direction: override.direction,
          // Hand back exactly the codes this override may use, so a client
          // never has to guess and never offers "adverse information" as a
          // justification for an approval.
          override_reasons: overrideReasonsFor(override.direction),
        });
      }
      if (!isValidOverrideReason(overrideReasonCode, override.direction)) {
        return res.status(422).json({
          message: `"${overrideReasonCode}" is not a valid reason for this override.`,
          override_required: true,
          override_direction: override.direction,
          override_reasons: overrideReasonsFor(override.direction),
        });
      }
      // A code without an explanation is a dropdown selection, not a
      // justification — the whole point is that a human can read back why.
      if (!String(note || "").trim()) {
        return res.status(422).json({
          message: "A note explaining the override is required alongside the reason code.",
          override_required: true,
          override_direction: override.direction,
          override_reasons: overrideReasonsFor(override.direction),
        });
      }
    }

    // D4's adverse-action gate. EVERY rejection — auto or manual, whether
    // or not it also required a D2 override — must carry ≥1 standardized,
    // applicant-facing reason. Before D4 a manual reject that happened to
    // match the matrix's own `manual_review` verdict (the single most
    // common way a human actually rejects someone) needed no code at all;
    // this closes that gap unconditionally, independent of the override
    // gate above — the two ask different questions ("why did you go
    // against the system" vs. "why is the applicant declined") and a
    // decision can need one, the other, both, or (a matrix-consistent
    // reject) just this one.
    if (status === "rejected") {
      const invalidCodes = reasonCodes.filter((c) => !isValidReasonCode(c));
      if (reasonCodes.length === 0 || invalidCodes.length > 0) {
        return res.status(422).json({
          message:
            reasonCodes.length === 0
              ? "At least one adverse-action reason is required to reject an application."
              : `Unknown adverse-action reason code(s): ${invalidCodes.join(", ")}.`,
          adverse_action_required: true,
          // What D1's policy verdict already points to, if anything — a
          // starting point for the reviewer, not a forced answer.
          suggested_reason_codes: currentRow.policy_reason_codes
            ? deriveReasonCodesFromPolicy(String(currentRow.policy_reason_codes).split(","))
            : [],
          reasons: ADVERSE_ACTION_REASONS,
        });
      }
    }

    // Approving isn't just a flag any more — it issues the offer the
    // applicant will accept or decline (migration 023). The terms are
    // resolved BEFORE the transition so a bad counter-offer is a clean 400
    // rather than a rolled-back transaction, and the insert itself rides
    // the transition's own transaction via beforeCommit so an application
    // can never end up 'approved' with no offer attached.
    let beforeCommit;
    let termsError = null;
    if (status === "approved") {
      const row = currentRow;
      const product = await loanModel.findProductById(row.product_id);
      if (!product) {
        return res.status(409).json({
          message: "This application's loan product no longer exists; it cannot be approved.",
        });
      }
      try {
        const terms = buildOfferTerms({
          application: row,
          product,
          overrides: req.body.offer || {},
        });
        // Fees (I1) resolved against the OFFERED amount, not the requested
        // one — a counter-offer for less money owes a proportionally smaller
        // percentage fee. activeOnly: an inactive fee must never be charged.
        const feeConfigs = await loanModel.findProductFees(row.product_id, {
          activeOnly: true,
        });
        const fees = buildOfferFees({
          feeConfigs,
          approvedAmount: terms.amount,
          emi: terms.emi,
          tenureMonths: terms.tenureMonths,
          waivers: req.body.offer?.fee_waivers || [],
        });
        beforeCommit = (conn) =>
          loanModel.createOfferWithin(conn, {
            applicationId,
            amount: terms.amount,
            tenureMonths: terms.tenureMonths,
            interestRate: terms.interestRate,
            rateType: terms.rateType,
            emi: terms.emi,
            validityDays: terms.validityDays,
            offeredBy: req.user.user_id,
            note: req.body.offer?.note || null,
            fees: fees.lines,
          });
      } catch (err) {
        termsError = err.message;
      }
    }
    if (termsError) {
      return res.status(400).json({ message: termsError });
    }

    // Drawdown opens the loan account (025) from the ACCEPTED offer's terms,
    // inside the transition's transaction. createAccountWithin throws
    // NO_ACCEPTED_OFFER if there isn't one, which rolls the disbursal back —
    // belt and braces alongside the status machine, which already only
    // allows disbursed from accepted.
    if (status === "disbursed") {
      beforeCommit = (conn, ctx) =>
        loanModel.createAccountWithin(conn, {
          applicationId,
          userId: ctx.userId,
          disbursedBy: req.user.user_id,
        });
    }

    // Closing the application closes the loan behind it, so the two can
    // never disagree about whether the facility is still running.
    if (status === "closed") {
      beforeCommit = (conn) => loanModel.closeAccountWithin(conn, applicationId);
    }

    // The adverse-action record itself (D4), written in the SAME
    // transaction as the rejection — an application can never end up
    // 'rejected' with no standardized record behind it, manual or
    // automatic. The snapshot comes from currentRow — the risk/policy/
    // matrix/pricing state as it stood the moment this reviewer acted,
    // exactly what they were looking at when they decided.
    if (status === "rejected") {
      const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));
      beforeCommit = (conn) =>
        loanModel.createAdverseActionRecordWithin(conn, {
          applicationId,
          ...buildAdverseActionRecord({
            reasonCodes,
            decisionSource: "manual",
            decidedBy: req.user.user_id,
            note: note || null,
            snapshot: {
              riskLabel: numOrNull(currentRow.risk_label),
              riskCategory: currentRow.risk_category,
              probLow: numOrNull(currentRow.prob_low),
              probMedium: numOrNull(currentRow.prob_medium),
              probHigh: numOrNull(currentRow.prob_high),
              modelVersion: currentRow.model_version,
              policyVersion: currentRow.policy_version,
              policyOutcome: currentRow.policy_outcome,
              matrixVersion: currentRow.matrix_version,
              matrixAction: currentRow.matrix_action,
              pricedInterestRate: numOrNull(currentRow.priced_interest_rate),
            },
          }),
        });
    }

    const result = await loanModel.updateApplicationStatus({
      applicationId,
      status,
      actorId: req.user.user_id,
      actorRole: req.user.role,
      note,
      overrideReasonCode,
      beforeCommit,
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (result.conflict) {
      return res.status(409).json({
        message: result.reason,
        current_status: result.status,
        allowed_transitions: allowedTransitions(result.status, req.user.role),
      });
    }

    const row = await loanModel.findApplicationById(applicationId);
    return res.status(200).json(await serializeApplicationWithFees(row, req.user.role));
  } catch (err) {
    if (err.message === "NO_ACCEPTED_OFFER") {
      return res.status(409).json({
        message:
          "This application has no accepted offer, so there are no agreed terms to disburse against.",
      });
    }
    console.error("UPDATE APPLICATION STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to update application status." });
  }
};

// PATCH /api/loans/:id/withdraw (customer): pull back their own application.
// Only reachable from non-terminal, non-disbursed statuses (see
// applicationStatus.service.js TRANSITIONS) — a customer cannot withdraw
// money that has already gone out. Ownership is enforced inside the same
// transaction/row-lock as the status check itself (requireOwnerId), not as
// a separate pre-fetch, to close the race with a staff decision landing at
// the same instant.
exports.withdrawApplication = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const applicationId = Number(req.params.id);
  const { note } = req.body;

  try {
    const result = await loanModel.updateApplicationStatus({
      applicationId,
      status: "withdrawn",
      actorId: req.user.user_id,
      actorRole: req.user.role,
      note,
      requireOwnerId: req.user.user_id,
    });

    if (result.notFound || result.forbidden) {
      // Same 404 for "doesn't exist" and "isn't yours" — do not reveal to a
      // customer that a given application id belongs to someone else.
      return res.status(404).json({ message: "Application not found." });
    }
    if (result.conflict) {
      return res.status(409).json({
        message: result.reason,
        current_status: result.status,
        allowed_transitions: allowedTransitions(result.status, req.user.role),
      });
    }

    const row = await loanModel.findApplicationById(applicationId);
    return res.status(200).json(await serializeApplicationWithFees(row, req.user.role));
  } catch (err) {
    console.error("WITHDRAW APPLICATION ERROR:", err);
    return res.status(500).json({ message: "Failed to withdraw application." });
  }
};

// PATCH /api/loans/:id/respond (customer): answer a staff "more information
// required" request, moving the application back to under_review. Only
// legal from more_info_required (see applicationStatus.service.js
// TRANSITIONS) — attempting this from any other status is a 409, same
// conflict shape as every other transition endpoint. The response text is
// required: this move exists specifically to record what the applicant
// said, so an empty one would defeat the point (see loan.routes.js).
exports.respondToInfoRequest = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const applicationId = Number(req.params.id);
  const { note } = req.body;

  try {
    const result = await loanModel.updateApplicationStatus({
      applicationId,
      status: "under_review",
      actorId: req.user.user_id,
      actorRole: req.user.role,
      note,
      requireOwnerId: req.user.user_id,
    });

    if (result.notFound || result.forbidden) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (result.conflict) {
      return res.status(409).json({
        message: result.reason,
        current_status: result.status,
        allowed_transitions: allowedTransitions(result.status, req.user.role),
      });
    }

    const row = await loanModel.findApplicationById(applicationId);
    return res.status(200).json(await serializeApplicationWithFees(row, req.user.role));
  } catch (err) {
    console.error("RESPOND TO INFO REQUEST ERROR:", err);
    return res.status(500).json({ message: "Failed to submit your response." });
  }
};

/**
 * Shared implementation of the applicant's two possible answers to an offer.
 * Accepting and declining differ only in the resulting application status
 * and the offer row's outcome, so they share one code path — that's what
 * guarantees a declined offer can never leave the application 'approved'
 * with a dead offer, or vice versa.
 *
 * The offer update runs in the transition's own transaction (beforeCommit)
 * and is guarded on `status='pending' AND expires_at > NOW()` in SQL. If it
 * matches nothing — already actioned, superseded, or lapsed a moment ago —
 * we throw, which rolls the status change back too.
 */
async function respondToOffer(req, res, { outcome, targetStatus, failureMessage, opensAccount }) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);
  // req.body is undefined (not {}) when the client sends no body at all —
  // express.json() only populates it when Content-Type is application/json.
  // note is fully optional here (see OFFER_RESPONSE_VALIDATORS), so a bodyless
  // request is legitimate, not malformed.
  const { note } = req.body || {};
  const STALE = "OFFER_NOT_ACTIONABLE";

  // Populated by beforeCommit on the accept path; read after the transaction
  // has committed, so nothing is announced to the customer that then rolls back.
  let disbursementAccount = null;
  let accountWasOpened = false;

  try {
    const result = await loanModel.updateApplicationStatus({
      applicationId,
      status: targetStatus,
      actorId: req.user.user_id,
      actorRole: req.user.role,
      note,
      requireOwnerId: req.user.user_id,
      beforeCommit: async (conn) => {
        const affected = await loanModel.respondToOfferWithin(
          conn,
          applicationId,
          outcome,
          note
        );
        if (affected === 0) throw new Error(STALE);

        // Accepting is the moment the loan becomes real, so it is the moment
        // the money needs somewhere to land. Resolving the account HERE, in
        // the acceptance transaction, is what stops the customer from
        // reaching an approved-and-accepted loan that cannot be disbursed.
        // find-or-open covers both situations in one call: an existing
        // account is reused, and a customer without one has theirs issued.
        // Declining opens nothing — there is no loan to disburse.
        if (opensAccount) {
          const resolved = await bankAccountModel.findOrOpenWithin(conn, {
            userId: req.user.user_id,
            openedVia: "auto_offer_acceptance",
          });
          disbursementAccount = resolved.account;
          accountWasOpened = resolved.opened;
        }
      },
    });

    if (result.notFound || result.forbidden) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (result.conflict) {
      return res.status(409).json({
        message: result.reason,
        current_status: result.status,
        allowed_transitions: allowedTransitions(result.status, req.user.role),
      });
    }

    // After commit — a notification about an account that ended up rolled
    // back would be a lie. Deliberately separate from the existing
    // "offer accepted" notification rather than folded into it: where the
    // money lands is distinct information the customer will want to find
    // again later, not a restatement of what they just clicked.
    if (disbursementAccount) {
      await notificationModel
        .create({
          userId: req.user.user_id,
          title: accountWasOpened ? "Disbursement account opened" : "Disbursement account ready",
          message: accountWasOpened
            ? `We have opened account ${disbursementAccount.account_number} (${disbursementAccount.branch} branch) in your name. Loan #${applicationId} will be credited to it.`
            : `Loan #${applicationId} will be credited to your account ${disbursementAccount.account_number} (${disbursementAccount.branch} branch).`,
        })
        // The offer IS accepted at this point. A failed notification must not
        // turn that into an error response the customer would retry.
        .catch((e) => console.error("DISBURSEMENT ACCOUNT NOTIFICATION ERROR:", e));
    }

    const row = await loanModel.findApplicationById(applicationId);
    return res.status(200).json({
      ...(await serializeApplicationWithFees(row, req.user.role)),
      // Lets the dashboard name the account in its success toast without a
      // second round trip. Absent on the decline path.
      disbursement_account: disbursementAccount
        ? {
            account_number: disbursementAccount.account_number,
            branch: disbursementAccount.branch,
            opened: accountWasOpened,
          }
        : undefined,
    });
  } catch (err) {
    if (err.message === STALE) {
      return res.status(409).json({
        message:
          "This offer is no longer available — it may have expired or been replaced. Please refresh.",
      });
    }
    console.error("RESPOND TO OFFER ERROR:", err);
    return res.status(500).json({ message: failureMessage });
  }
}

// PATCH /api/loans/:id/offer/accept (customer): accept the outstanding offer.
exports.acceptOffer = (req, res) =>
  respondToOffer(req, res, {
    outcome: "accepted",
    targetStatus: "accepted",
    failureMessage: "Failed to accept the offer.",
    opensAccount: true,
  });

// PATCH /api/loans/:id/offer/decline (customer): decline the outstanding
// offer. The application goes to 'withdrawn' — declining terms is the
// applicant choosing not to proceed, which is what withdrawn already means;
// the offer row records that it was specifically a decline.
exports.declineOffer = (req, res) =>
  respondToOffer(req, res, {
    outcome: "declined",
    targetStatus: "withdrawn",
    failureMessage: "Failed to decline the offer.",
  });

// POST /api/admin/applications/:id/offer (staff/admin): (re-)issue an offer
// against an application already in 'approved' — for a lapsed offer, a
// renegotiation, or an application approved before offers existed (see
// migration 024). Supersedes any outstanding offer.
exports.reissueOffer = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const applicationId = Number(req.params.id);

  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const product = await loanModel.findProductById(row.product_id);
    if (!product) {
      return res.status(409).json({
        message: "This application's loan product no longer exists.",
      });
    }

    let terms;
    try {
      terms = buildOfferTerms({ application: row, product, overrides: req.body || {} });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }

    // Fees are re-resolved against the CURRENT product config, not copied
    // from the superseded offer — a re-issue is a fresh quote, and quoting
    // a fee the product no longer charges would be wrong. The superseded
    // offer keeps its own snapshot regardless (041).
    const feeConfigs = await loanModel.findProductFees(row.product_id, { activeOnly: true });
    const fees = buildOfferFees({
      feeConfigs,
      approvedAmount: terms.amount,
      emi: terms.emi,
      tenureMonths: terms.tenureMonths,
      waivers: req.body?.fee_waivers || [],
    });

    const result = await loanModel.reissueOffer({
      applicationId,
      amount: terms.amount,
      tenureMonths: terms.tenureMonths,
      interestRate: terms.interestRate,
      rateType: terms.rateType,
      emi: terms.emi,
      validityDays: terms.validityDays,
      offeredBy: req.user.user_id,
      note: req.body?.note || null,
      fees: fees.lines,
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (result.conflict) {
      return res.status(409).json({
        message: `An offer can only be issued against an approved application; this one is ${result.status}.`,
        current_status: result.status,
      });
    }

    const updated = await loanModel.findApplicationById(applicationId);
    return res.status(201).json(await serializeApplicationWithFees(updated, req.user.role));
  } catch (err) {
    console.error("REISSUE OFFER ERROR:", err);
    return res.status(500).json({ message: "Failed to issue the offer." });
  }
};

exports.assess = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const userId = req.user.user_id;
  const { product_id, requested_amount, tenure_months, purpose } = req.body;

  // J1 — this is the point where personal data gets processed (profile,
  // declared fields, guarantor/collateral) and a credit bureau check
  // effectively happens (the CRIB-aware ML risk assessment below). Neither
  // may proceed without current, on-file consent — checked here, on the
  // server, because a frontend gate alone is only ever a UX nicety.
  const latestConsents = await consentModel.getLatestConsentsByUser(userId);
  const missingConsents = findMissingConsents(latestConsents);
  if (missingConsents.length) {
    return res.status(403).json({
      message:
        "Required consent has not been provided. Please review and accept the consent notices before applying.",
      missing_consents: missingConsents,
    });
  }

  // Applicant-declared overrides for otherwise-hardcoded model fields (see
  // mlClient.service.js NEUTRAL_DEFAULTS / DECLARABLE_FIELDS) — all optional,
  // validated in loan.routes.js. Left-blank fields stay undefined here and
  // fall back to the neutral default inside mapProfileToModelFields.
  const declared = {};
  for (const field of DECLARABLE_FIELDS) {
    if (isProvided(req.body[field])) declared[field] = req.body[field];
  }

  // H2 — the subset of PROFILE_BACKED_FIELDS the applicant actually declared
  // ON THIS REQUEST (captured before the profile-fallback backfill below),
  // so the write-back after a successful assessment only persists what was
  // genuinely re-affirmed/edited just now, not values merely carried over
  // from the existing profile.
  const submittedProfileFields = {};
  for (const field of PROFILE_BACKED_FIELDS) {
    if (isProvided(declared[field])) submittedProfileFields[field] = declared[field];
  }

  try {
    // 1. Profile — required to build the model inputs.
    const profile = await loanModel.findProfileByUserId(userId);
    if (!profile) {
      return res.status(400).json({
        message:
          "No customer profile found. Complete your profile before applying.",
      });
    }

    // H2 — stable attributes (marital status, education, occupation,
    // employer category, years employed) now live on customer_profiles too.
    // A field left undeclared on THIS application falls back to the
    // customer's profile value (rather than straight to mlClient's
    // NEUTRAL_DEFAULTS) — this flows into the ML model, the credit-policy
    // EMPLOYMENT_TENURE rule, and the loan_applications snapshot below, all
    // from this single resolution point.
    for (const field of PROFILE_BACKED_FIELDS) {
      if (!isProvided(declared[field]) && isProvided(profile[field])) {
        declared[field] = profile[field];
      }
    }

    // 2. Product — drives interest rate / rate type and validates product_id.
    const product = await loanModel.findProductById(product_id);
    if (!product) {
      return res.status(400).json({
        message: `Unknown loan product (product_id=${product_id}).`,
      });
    }

    // Reject requests outside the product's own advertised amount/tenure
    // range before spending an ML call and persisting anything.
    const minAmount = Number(product.min_amount);
    const maxAmount = Number(product.max_amount);
    const minTenure = Number(product.min_tenure_months);
    const maxTenure = Number(product.max_tenure_months);
    if (requested_amount < minAmount || requested_amount > maxAmount) {
      return res.status(400).json({
        message: `requested_amount must be between ${minAmount} and ${maxAmount} for ${product.name}.`,
      });
    }
    if (tenure_months < minTenure || tenure_months > maxTenure) {
      return res.status(400).json({
        message: `tenure_months must be between ${minTenure} and ${maxTenure} for ${product.name}.`,
      });
    }

    const interestRate = Number(product.interest_rate);
    const monthlyIncome = Number(profile.monthly_income) || 0;
    const monthlyExpense = Number(profile.monthly_expense) || 0;
    // Net (disposable) income drives the affordability ceiling.
    const netIncome = Math.max(0, monthlyIncome - monthlyExpense);

    // 2b. Duplicate/exposure guard — a customer stacking unlimited pending
    // applications, or requesting far more than their income could ever
    // support across applications, should be stopped before an ML call and
    // a persisted row, not caught later at manual review.
    const exposure = await loanModel.getActiveExposure(userId);
    if (exposure.undecidedCount >= MAX_PENDING_APPLICATIONS) {
      return res.status(409).json({
        message: `You already have ${exposure.undecidedCount} applications awaiting a decision. Wait for those to be reviewed before applying again.`,
      });
    }
    const exposureCap = monthlyIncome * MAX_EXPOSURE_MONTHLY_INCOME_MULTIPLE;
    const projectedExposure = exposure.totalActiveAmount + Number(requested_amount);
    if (monthlyIncome > 0 && projectedExposure > exposureCap) {
      return res.status(409).json({
        message: `This request would bring your total pending/approved loan exposure to ${projectedExposure.toLocaleString(
          "en-LK"
        )}, above the ${exposureCap.toLocaleString("en-LK")} limit for your declared income.`,
      });
    }

    // 2c. Behavioural credit features from this customer's OWN record with
    // us. Read BEFORE the assess transaction opens, exactly like the
    // guarantor exposure lookup above: the application being scored does not
    // exist yet, so it cannot contaminate its own history.
    //
    // This is what un-pins the model's strongest inputs. Before it,
    // number_of_defaults / overdue_installments / credit_utilization were
    // sent as fixed constants for every applicant — roughly 46% of the
    // model's total gain frozen at one value. A first-time borrower still
    // has nothing to observe and falls back to the neutral defaults, flagged
    // as a thin file so a reviewer can tell "clean record" from "no record".
    const creditHistory = await loanModel.findBorrowerCreditHistory(userId);
    const { fields: behaviouralFields, meta: behaviouralMeta } =
      deriveBehaviouralFeatures(creditHistory);

    // 3. Map to the raw model fields and score via the Python service.
    // The model is fed the product's BASE rate — same reasoning as a real
    // underwriter assessing against the headline terms before a risk-based
    // price is set. D3's priced rate is an OUTPUT of this assessment, not
    // an input to it, so it cannot appear here; see
    // interestPricing.service.js's module docblock.
    const modelFields = mapProfileToModelFields(
      profile,
      { requested_amount, tenure_months, interest_rate: interestRate },
      declared,
      behaviouralFields
    );

    // Did the applicant's declared bureau score contradict the adverse history
    // on the same application? The mapper already capped it; this recomputes
    // the (pure, trivial) check so the outcome can be shown to a reviewer.
    // A self-contradictory declaration is a signal worth surfacing, not one to
    // absorb quietly.
    const cribCheck = reconcileDeclaredCribScore(
      isProvided(declared.crib_score) ? Number(declared.crib_score) : null,
      {
        number_of_defaults: modelFields.number_of_defaults,
        overdue_installments: modelFields.overdue_installments,
      }
    );
    behaviouralMeta.crib_declaration = {
      declared: cribCheck.declared,
      used: modelFields.crib_score,
      capped: cribCheck.capped,
      plausible_ceiling: cribCheck.ceiling,
    };

    const risk = await predictRisk(modelFields);

    // 3b. Risk-based interest pricing (D3) — resolves the rate this
    // application is actually assessed and quoted at, now that the risk
    // band exists to price against. Falls back to the product's flat
    // interestRate when the product has no configured min/max range, so
    // this is a no-op for every product until an admin opts one in.
    const pricing = priceInterestRate({
      baseRate: interestRate,
      minRate: product.min_interest_rate,
      maxRate: product.max_interest_rate,
      riskLabel: risk.risk_label,
    });

    // 3c. Guarantor(s)/collateral submitted with this application (D5) — a
    // real, queried fact, not self-declared. Each guarantor's OTHER
    // exposure in the system is looked up by NIC now, before this
    // application (and its own loan_guarantors rows) exists, so the lookup
    // naturally can't double-count it. Actually WRITING these rows happens
    // later, atomically with the rest of the application, inside
    // runAssessmentTransaction — this step only reads.
    const submittedGuarantors = Array.isArray(req.body.guarantors) ? req.body.guarantors : [];
    const submittedCollateral = Array.isArray(req.body.collateral) ? req.body.collateral : [];

    for (const g of submittedGuarantors) {
      if (!isValidNic(g.nic)) {
        return res.status(400).json({ message: `"${g.nic}" is not a valid NIC number.` });
      }
      const amt = Number(g.guaranteed_amount);
      if (!Number.isFinite(amt) || amt <= 0 || amt > Number(requested_amount)) {
        return res.status(400).json({
          message: `Each guarantor's guaranteed_amount must be a positive number not exceeding the requested amount (${requested_amount}).`,
        });
      }
    }

    // NICs are normalised (trimmed, uppercased) HERE and reused verbatim at
    // persistence time (runAssessmentTransaction → upsertGuarantorWithin) —
    // "851234567v" and "851234567V" must resolve to the same guarantors row,
    // or exposure tracking silently splits one real person into two.
    const guarantorNics = submittedGuarantors.map((g) => String(g.nic).trim().toUpperCase());
    const exposureRows = await loanModel.findGuarantorExposureByNic(guarantorNics);
    const exposureByNic = new Map(exposureRows.map((r) => [r.nic, r]));
    const guarantorFindings = summarizeGuarantorFindings(
      submittedGuarantors.map((g) => {
        const nic = String(g.nic).trim().toUpperCase();
        // A brand-new guarantor (never nominated before) has no row yet —
        // zero prior exposure, not missing data.
        return (
          exposureByNic.get(nic) || {
            full_name: g.full_name,
            other_active_guarantees: 0,
            other_active_exposure: 0,
            other_distressed_guarantees: 0,
          }
        );
      })
    );
    const collateralSummary = summarizeCollateral(
      // Every item is self_declared at submission time — nothing has been
      // verified yet (see creditPolicy.service.js COLLATERAL_COVERAGE).
      submittedCollateral.map((c) => ({
        estimated_value: c.estimated_value,
        verification_status: "self_declared",
      }))
    );

    // 3d. Deterministic credit policy (D1) — independent of the risk SCORE
    // (nothing here reads risk.probabilities or risk.risk_category), but
    // necessarily runs after the model call because it judges the
    // instalment at the PRICED rate: the DTI and residual-income rules must
    // be judged against what the applicant would actually pay, not the
    // product's base-rate instalment nobody was offered. It judges the
    // terms the applicant actually asked for (not the affordability-capped
    // recommendation).
    const requestedEmi = computeEmiForRateType(
      Number(requested_amount),
      pricing.rate,
      Number(tenure_months),
      product.rate_type
    );
    const policy = evaluateCreditPolicy({
      applicant: {
        age: ageFromDob(profile.date_of_birth),
        monthlyIncome,
        monthlyExpense,
        employmentType: profile.employment_type,
        // Credit-history inputs are passed through ONLY when the applicant
        // declared them — mlClient's neutral defaults are a modelling
        // convenience and must never become a policy finding (see
        // creditPolicy.service.js on `skipped`).
        additionalIncome: declared.additional_income,
        yearsEmployed: declared.years_employed,
        existingLoans: declared.existing_loans,
        previousDefaults: declared.previous_defaults,
        cribScore: declared.crib_score,
        guarantorDefaults: declared.guarantor_defaults,
        // The real guarantor(s) backing THIS loan (D5) — a different
        // question from guarantorDefaults above; see GUARANTOR_RELIABILITY.
        guarantors: guarantorFindings,
      },
      loan: {
        amount: Number(requested_amount),
        tenureMonths: Number(tenure_months),
        emi: requestedEmi,
        collateral: collateralSummary,
      },
    });

    // 4. Deterministic recommendation (loan type, affordable amount, EMI) —
    // priced at pricing.rate, the same rate policy was judged against, so
    // the EMI shown to the applicant here is the one they would actually
    // pay if approved.
    const recommendation = buildRecommendation({
      netIncome,
      riskLabel: risk.risk_label,
      annualRatePct: pricing.rate,
      tenureMonths: tenure_months,
      requestedAmount: requested_amount,
      purpose,
    });

    // 4b. Decision matrix (D2) — the one place the model's band and the
    // policy verdict are combined into a recommended action. auto_reject is
    // carried out inside the assess transaction below; everything else is a
    // recommendation for a reviewer.
    const matrix = evaluateDecisionMatrix({
      policyOutcome: policy.outcome,
      riskLabel: risk.risk_label,
      riskCategory: risk.risk_category,
    });

    // 4c. Adverse-action record (D4) — built whenever the matrix is about to
    // auto-reject, so the rejection this transaction is about to write NEVER
    // lands without a standardized, immutable "why" alongside it (enforced
    // again, defensively, inside runAssessmentTransaction itself). The
    // reasons are derived entirely from policy.reason_codes — the only
    // input to an auto-reject — translated into D4's applicant-facing
    // catalog. HIGH_RISK_ASSESSMENT is the fallback for the theoretical case
    // where policy declined on a rule with no adverse-action mapping yet;
    // deriveReasonCodesFromPolicy is exhaustively tested against every
    // decline-capable policy rule (adverseAction.test.js) so this should
    // never actually fire, but buildAdverseActionRecord refuses to write a
    // reasonless rejection, so there must be SOME fallback.
    const probs = splitProbabilities(risk.probabilities);
    const adverseAction =
      matrix.action === "auto_reject"
        ? buildAdverseActionRecord({
            reasonCodes: deriveReasonCodesFromPolicy(policy.reason_codes).length
              ? deriveReasonCodesFromPolicy(policy.reason_codes)
              : ["HIGH_RISK_ASSESSMENT"],
            decisionSource: "system",
            decidedBy: null,
            note: matrix.rationale,
            snapshot: {
              riskLabel: risk.risk_label,
              riskCategory: risk.risk_category,
              probLow: probs.probLow,
              probMedium: probs.probMedium,
              probHigh: probs.probHigh,
              modelVersion: risk.model_version,
              policyVersion: policy.policy_version,
              policyOutcome: policy.outcome,
              matrixVersion: matrix.matrix_version,
              matrixAction: matrix.action,
              pricedInterestRate: pricing.rate,
            },
          })
        : null;

    // 5. Persist application + assessment + recommendation + policy + matrix
    // atomically (and the auto-rejection + its adverse-action record, when
    // that is the verdict).
    const { applicationId, status: applicationStatus } = await loanModel.runAssessmentTransaction({
      userId,
      productId: product_id,
      requestedAmount: requested_amount,
      tenureMonths: tenure_months,
      purpose,
      declared,
      risk: {
        risk_label: risk.risk_label,
        risk_category: risk.risk_category,
        model_version: risk.model_version,
        // Frozen alongside the score (043): what the model was actually shown
        // about this customer's repayment record at this moment.
        behaviouralSnapshot: behaviouralMeta,
        ...probs,
      },
      recommendation,
      recommendedProductId: product_id,
      policy,
      matrix,
      pricedInterestRate: pricing.rate,
      adverseAction,
      // D5 — persisted verbatim in the SAME transaction as everything
      // above; NICs already normalised (trimmed/uppercased) to match the
      // lookup that fed guarantorFindings into the policy verdict.
      guarantors: submittedGuarantors.map((g) => ({
        nic: String(g.nic).trim().toUpperCase(),
        fullName: g.full_name,
        phone: g.phone,
        address: g.address,
        relationshipToApplicant: g.relationship_to_applicant,
        guaranteedAmount: Number(g.guaranteed_amount),
      })),
      collateral: submittedCollateral.map((c) => ({
        collateralType: c.collateral_type,
        description: c.description,
        estimatedValue: Number(c.estimated_value),
        valuationDate: c.valuation_date,
        ownershipReference: c.ownership_reference,
      })),
    });

    // H2 — keep customer_profiles current with whatever the applicant just
    // (re)declared, so future applications and the profile page see it. Only
    // the fields actually submitted this request (not profile-fallback
    // values merely carried over) — best-effort, must never fail an already-
    // successful application.
    if (Object.keys(submittedProfileFields).length) {
      loanModel.updateProfileDeclaredFields(userId, submittedProfileFields).catch((err) => {
        console.error("PROFILE DECLARED-FIELDS WRITE-BACK FAILED:", err.message);
      });
    }

    // 6. Natural-language explanation (Gemini, with deterministic fallback).
    //    The four factors that most influence the result — DTI is computed the
    //    same way the model derives it; the rest come from the mapped fields.
    const totalIncome =
      Number(modelFields.monthly_salary) + Number(modelFields.additional_income);
    const factors = {
      dti: totalIncome > 0 ? Number(requested_amount) / 12 / totalIncome : null,
      cribScore: modelFields.crib_score,
      // Flags so the explanation never asserts a self-declared/neutral-default
      // number as if it were a verified credit-bureau record.
      cribProvided: isProvided(declared.crib_score),
      guarantorExposure: modelFields.guarantor_exposure,
      guarantorProvided: isProvided(declared.guarantor_exposure),
      savingsRatio: modelFields.savings_ratio,
    };
    // explainRisk never throws — it degrades to a fallback string on any Gemini
    // failure, so the assess response always carries a non-empty explanation.
    const explanation = await explainRisk({
      riskCategory: risk.risk_category,
      probabilities: risk.probabilities,
      factors,
      language: req.body.language,
    });
    // Persist the explanation outside the assess transaction; a failed UPDATE
    // must not discard the risk/recommendation already saved and returned.
    try {
      await loanModel.updateRecommendationExplanation(applicationId, explanation);
    } catch (updateErr) {
      console.error("GEMINI EXPLANATION PERSIST ERROR:", updateErr);
    }

    return res.status(201).json({
      application_id: applicationId,
      // The real status, which is 'rejected' when the matrix auto-rejected.
      // The applicant must not be shown "pending" for an application the
      // system has already decided.
      status: applicationStatus,
      risk: {
        label: risk.risk_label,
        category: risk.risk_category,
        probabilities: risk.probabilities,
        // The calibrated probability the band was derived from (v2). Exposed
        // separately because it is the number that actually means something —
        // the band is a policy cut-off applied to it.
        probability_of_default: risk.probability_of_default,
      },
      // How much of the assessment rested on this customer's observed conduct
      // versus neutral assumptions. Surfaced so a reviewer can distinguish a
      // genuinely clean record from no record at all.
      credit_history: behaviouralMeta,
      recommendation,
      // The rate this application was actually assessed and quoted at (D3),
      // and which recommendation.recommended_emi above is computed from.
      // `risk_based: false` means the product has no configured range and
      // `rate` is simply its flat interest_rate — unchanged from before D3.
      pricing: {
        interest_rate: pricing.rate,
        tier: pricing.tier,
        risk_based: pricing.risk_based,
      },
      decision_matrix: {
        action: matrix.action,
        matrix_version: matrix.matrix_version,
        rationale: matrix.rationale,
        acted: matrix.acts_automatically,
      },
      // The policy verdict rides alongside `risk` rather than replacing it —
      // the two are independent judgements and the applicant is shown both.
      // A 'decline' here does NOT change the application's status; D1
      // records and surfaces, D2's matrix decides.
      policy: {
        outcome: policy.outcome,
        policy_version: policy.policy_version,
        reason_codes: policy.reason_codes,
        metrics: policy.metrics,
        rules: policy.rules,
        summary: summarizePolicy(policy),
      },
      // The standardized, immutable "why" (D4) — present only when the
      // matrix just auto-rejected this application. null otherwise: a
      // pending/auto-approved application hasn't been declined, so it has
      // no adverse action to report.
      adverse_action: adverseAction
        ? { reason_codes: adverseAction.reasonCodes, reasons: adverseAction.reasons }
        : null,
      explanation,
    });
  } catch (err) {
    console.error("LOAN ASSESS ERROR:", err);
    // A model-service failure is an upstream/gateway problem, not a client one.
    const isModelError = /risk model/i.test(err.message || "");
    return res.status(isModelError ? 502 : 500).json({
      message: isModelError
        ? "The risk model service is unavailable. Please try again shortly."
        : "Failed to assess the loan application.",
      error: err.message,
    });
  }
};

// POST /api/loans/manual-assess (admin/staff): a standalone risk calculator.
// The caller supplies the full applicant profile directly instead of it
// coming from a customer_profiles row — there is no target customer account,
// and nothing is persisted (no loan_applications/risk_assessments/
// recommendations rows). Useful for a quick what-if check on a prospect who
// isn't (yet) a registered customer.
exports.manualAssess = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const {
    age,
    gender,
    employment_type,
    monthly_income,
    monthly_expense,
    requested_amount,
    tenure_months,
    interest_rate,
    purpose,
  } = req.body;

  const declared = {};
  for (const field of DECLARABLE_FIELDS) {
    if (isProvided(req.body[field])) declared[field] = req.body[field];
  }

  try {
    const profile = { age, gender, employment_type, monthly_income, monthly_expense };

    // No behavioural features here, deliberately: this is a what-if for a
    // hypothetical person (a walk-in enquiry), who by definition has no
    // account history to observe. Everything not declared falls back to the
    // neutral defaults, which is the honest answer for someone we have never
    // lent to.
    const modelFields = mapProfileToModelFields(
      profile,
      { requested_amount, tenure_months, interest_rate },
      declared
    );
    const risk = await predictRisk(modelFields);

    const netIncome = Math.max(0, Number(monthly_income) - Number(monthly_expense));
    const recommendation = buildRecommendation({
      netIncome,
      riskLabel: risk.risk_label,
      annualRatePct: Number(interest_rate),
      tenureMonths: tenure_months,
      requestedAmount: requested_amount,
      purpose,
    });

    const totalIncome =
      Number(modelFields.monthly_salary) + Number(modelFields.additional_income);
    const factors = {
      dti: totalIncome > 0 ? Number(requested_amount) / 12 / totalIncome : null,
      cribScore: modelFields.crib_score,
      cribProvided: isProvided(declared.crib_score),
      guarantorExposure: modelFields.guarantor_exposure,
      guarantorProvided: isProvided(declared.guarantor_exposure),
      savingsRatio: modelFields.savings_ratio,
    };
    const explanation = await explainRisk({
      riskCategory: risk.risk_category,
      probabilities: risk.probabilities,
      factors,
      language: req.body.language,
    });

    // The same policy engine as /assess, so a what-if check tells staff
    // whether the prospect would clear the mandatory criteria and not just
    // how the model scores them. There is no product here — the caller
    // states the rate directly — so the instalment uses the reducing-balance
    // formula, as the rest of this endpoint already does.
    const policy = evaluateCreditPolicy({
      applicant: {
        age,
        monthlyIncome: monthly_income,
        monthlyExpense: monthly_expense,
        employmentType: employment_type,
        additionalIncome: declared.additional_income,
        yearsEmployed: declared.years_employed,
        existingLoans: declared.existing_loans,
        previousDefaults: declared.previous_defaults,
        cribScore: declared.crib_score,
        guarantorDefaults: declared.guarantor_defaults,
      },
      loan: {
        amount: Number(requested_amount),
        tenureMonths: Number(tenure_months),
        emi: computeEmi(
          Number(requested_amount),
          Number(interest_rate),
          Number(tenure_months)
        ),
      },
    });

    return res.status(200).json({
      risk: {
        label: risk.risk_label,
        category: risk.risk_category,
        probabilities: risk.probabilities,
        probability_of_default: risk.probability_of_default,
      },
      recommendation,
      policy: {
        outcome: policy.outcome,
        policy_version: policy.policy_version,
        reason_codes: policy.reason_codes,
        metrics: policy.metrics,
        rules: policy.rules,
        summary: summarizePolicy(policy),
      },
      explanation,
    });
  } catch (err) {
    console.error("MANUAL ASSESS ERROR:", err);
    const isModelError = /risk model/i.test(err.message || "");
    return res.status(isModelError ? 502 : 500).json({
      message: isModelError
        ? "The risk model service is unavailable. Please try again shortly."
        : "Failed to run the risk assessment.",
      error: err.message,
    });
  }
};

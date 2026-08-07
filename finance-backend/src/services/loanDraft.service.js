"use strict";

/**
 * Loan-wizard draft sanitization (H3) — pure, deterministic. No DB, no I/O.
 *
 * A draft is the customer's own unsubmitted wizard state, POSTed up by the
 * browser so they can close the tab and resume later (migration 037). Because
 * the payload arrives as free-form client JSON, this module is the gate that
 * stops `loan_application_drafts.payload` becoming an arbitrary user-controlled
 * blob store: only known wizard fields survive, values are coerced to the
 * primitive shapes the wizard actually uses, and anything oversized is
 * rejected outright.
 *
 * IMPORTANT — this is NOT a substitute for request validation. A draft is only
 * ever replayed back into the wizard's form fields on resume; submitting still
 * goes through POST /api/loans/assess and its full express-validator chain in
 * loan.routes.js. Nothing here should ever be treated as validated loan data,
 * which is why fields are shape-checked but deliberately NOT range-checked
 * (a half-finished draft is *expected* to hold incomplete, invalid values —
 * that is the entire point of a draft).
 */

/** Wizard steps 0-6 (STEP_META in LoanApplication.jsx has 7 entries). */
const MAX_STEP = 6;

/**
 * Reject anything that couldn't plausibly be one customer's wizard state.
 * Generous enough that a legitimate draft (including several collateral
 * items with descriptions) never trips it.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Most collateral items one application may pledge. */
const MAX_COLLATERAL_ITEMS = 20;

/** Longest any single free-text draft value may be. */
const MAX_STRING_LENGTH = 1000;

/**
 * Every wizard state key a draft may carry, by the frontend's own camelCase
 * names (LoanApplication.jsx useState identifiers) — NOT the snake_case the
 * /assess API uses, because a draft round-trips form state, not a payload.
 * Anything outside this list is silently dropped.
 */
const DRAFT_FIELDS = [
  // Step 0 — Loan Request
  "productId",
  "requestedAmount",
  "tenureMonths",
  "purpose",
  // Step 1 — About You
  "maritalStatus",
  "educationLevel",
  "occupation",
  "employerCategory",
  "yearsEmployed",
  "hasAdditionalIncome",
  "additionalIncome",
  // Step 2 — Existing Credit
  "hasExistingLoans",
  "existingLoans",
  "hasPreviousDefaults",
  "previousDefaults",
  // Step 3 — Guarantor Details (applicant's own liability elsewhere)
  "isGuarantor",
  "guarantorExposure",
  "guarantorCalled",
  "guarantorDefaults",
  // Step 4 — CRIB
  "knowsCribScore",
  "cribScore",
  // Step 5 — Security backing THIS loan (D5)
  "hasGuarantorForLoan",
  "guarantorNic",
  "guarantorFullName",
  "guarantorPhone",
  "guarantorAddress",
  "guarantorRelationship",
  "guarantorAmount",
  "hasCollateral",
  "collateralItems",
  // H1 per-section "still accurate?" reaffirmations — carried so a resumed
  // draft doesn't re-ask what the applicant already confirmed.
  "aboutYouReaffirm",
  "creditReaffirm",
  "guarantorReaffirm",
  "cribReaffirm",
];

/** Keys allowed on each entry of `collateralItems`. */
const COLLATERAL_ITEM_FIELDS = ["type", "description", "estimatedValue", "ownershipReference"];

/** Thrown for a payload this module refuses; the controller maps it to a 400. */
class DraftPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DraftPayloadError";
  }
}

/**
 * Coerce one scalar draft value. The wizard holds nearly everything as a
 * string (including numeric inputs, which are `<input type="number">` string
 * state), so strings pass through trimmed-to-length; numbers and booleans are
 * accepted as-is for robustness. null/undefined collapse to "" — the wizard's
 * universal "unanswered" value. Objects/arrays/functions are rejected.
 * @param {string} key   field name, for the error message
 * @param {*} value
 * @returns {string|number|boolean}
 */
function coerceScalar(key, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DraftPayloadError(`${key} must be a finite number.`);
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new DraftPayloadError(`${key} exceeds ${MAX_STRING_LENGTH} characters.`);
    }
    return value;
  }
  throw new DraftPayloadError(`${key} must be a string, number or boolean.`);
}

/**
 * Sanitize the `collateralItems` array: a bounded list of plain objects with
 * only the four known keys, each scalar-coerced.
 * @param {*} value
 * @returns {object[]}
 */
function sanitizeCollateralItems(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new DraftPayloadError("collateralItems must be an array.");
  }
  if (value.length > MAX_COLLATERAL_ITEMS) {
    throw new DraftPayloadError(`collateralItems may hold at most ${MAX_COLLATERAL_ITEMS} entries.`);
  }

  return value.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new DraftPayloadError(`collateralItems[${index}] must be an object.`);
    }
    const clean = {};
    for (const field of COLLATERAL_ITEM_FIELDS) {
      clean[field] = coerceScalar(`collateralItems[${index}].${field}`, item[field]);
    }
    return clean;
  });
}

/**
 * Whitelist and coerce a client-supplied draft payload.
 *
 * Only keys in DRAFT_FIELDS survive; unknown keys are dropped silently rather
 * than rejected, so a newer frontend sending a field this backend doesn't know
 * yet degrades to "that field isn't saved" instead of breaking the applicant's
 * whole draft. Keys the payload omits are simply absent from the result — the
 * frontend merges what it gets over its own defaults on resume, so a draft
 * written before a field existed still hydrates cleanly.
 *
 * @param {*} raw the parsed request body's `payload`
 * @returns {object} a payload safe to persist
 * @throws {DraftPayloadError} if the payload isn't a plain object, is
 *   oversized, or holds a value of an impossible shape
 */
function sanitizeDraftPayload(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DraftPayloadError("payload must be an object.");
  }

  const clean = {};
  for (const key of DRAFT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    clean[key] =
      key === "collateralItems"
        ? sanitizeCollateralItems(raw[key])
        : coerceScalar(key, raw[key]);
  }

  // Size is checked on the SANITIZED result: what actually gets stored is what
  // has to fit, and checking here means a huge unknown key is dropped rather
  // than counted against the applicant.
  const bytes = Buffer.byteLength(JSON.stringify(clean), "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new DraftPayloadError(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
  }

  return clean;
}

/**
 * Validate the wizard step a draft was saved at.
 * @param {*} value
 * @returns {number} an integer in [0, MAX_STEP]
 * @throws {DraftPayloadError}
 */
function sanitizeStep(value) {
  if (value === null || value === undefined) return 0;
  const step = Number(value);
  if (!Number.isInteger(step) || step < 0 || step > MAX_STEP) {
    throw new DraftPayloadError(`step must be an integer between 0 and ${MAX_STEP}.`);
  }
  return step;
}

module.exports = {
  DRAFT_FIELDS,
  COLLATERAL_ITEM_FIELDS,
  MAX_STEP,
  MAX_PAYLOAD_BYTES,
  MAX_COLLATERAL_ITEMS,
  MAX_STRING_LENGTH,
  DraftPayloadError,
  sanitizeDraftPayload,
  sanitizeStep,
};

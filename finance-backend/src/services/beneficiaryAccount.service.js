"use strict";

/**
 * Beneficiary bank account for loan disbursement (H4) — pure, deterministic.
 * No DB, no I/O.
 *
 * This system is a SINGLE bank's own digital loan platform, so every
 * customer's beneficiary account is necessarily an account AT that same
 * bank — there is deliberately no "which bank" field to capture or validate;
 * unlike a general payments platform, that question has exactly one answer
 * here. Only branch (this bank has many) + account number + account holder
 * name are needed to route an internal disbursement.
 *
 * Sri Lanka has no IBAN and no universal account-number checksum algorithm
 * (unlike, say, a UK sort code + modulus check), so validation here is
 * format-only — the same philosophy as collateralGuarantor.service.js's NIC
 * regex: catch a typo/garbage input, don't pretend to verify the account is
 * real. The account actually holding the money is confirmed the same way
 * any real disbursement is today — out of band, by staff, before releasing
 * funds — this only stops "empty" or "obviously malformed" from reaching
 * that step.
 */

/** Digits only — account numbers vary in length by branch/product, typically 6-17 digits. */
const ACCOUNT_NUMBER_PATTERN = /^[0-9]{6,20}$/;

/** Longest a branch / account-holder string may be (matches the VARCHAR caps in migration 038). */
const MAX_BRANCH_LENGTH = 100;
const MAX_ACCOUNT_HOLDER_LENGTH = 150;

/**
 * Whether `value` is a well-formed account number. Format only — this does
 * not (and cannot) confirm the account exists or belongs to the applicant.
 * @param {string} value
 * @returns {boolean}
 */
function isValidAccountNumber(value) {
  return typeof value === "string" && ACCOUNT_NUMBER_PATTERN.test(value.trim());
}

/**
 * Whether a plain non-empty-string field is present and within its length cap.
 * @param {*} value
 * @param {number} maxLength
 * @returns {boolean}
 */
function isValidTextField(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

/**
 * Whether a customer_profiles-shaped row (or any object carrying the same
 * field names) has a COMPLETE beneficiary account — every field present and
 * well-formed. This is the single source of truth for "complete": both the
 * disbursement gate (loanModel.createAccountWithin) and the staff-facing
 * lookup (GET /admin/applications/:id/beneficiary-account) call this exact
 * function, so the two can never disagree about whether an account is usable.
 *
 * @param {object} profile a row/object with beneficiary_branch,
 *   beneficiary_account_number, beneficiary_account_holder
 * @returns {boolean}
 */
function isCompleteBeneficiaryAccount(profile) {
  if (!profile) return false;
  return (
    isValidTextField(profile.beneficiary_branch, MAX_BRANCH_LENGTH) &&
    isValidAccountNumber(profile.beneficiary_account_number) &&
    isValidTextField(profile.beneficiary_account_holder, MAX_ACCOUNT_HOLDER_LENGTH)
  );
}

module.exports = {
  ACCOUNT_NUMBER_PATTERN,
  MAX_BRANCH_LENGTH,
  MAX_ACCOUNT_HOLDER_LENGTH,
  isValidAccountNumber,
  isValidTextField,
  isCompleteBeneficiaryAccount,
};

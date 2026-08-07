"use strict";

/**
 * Bank accounts held BY customers AT THIS BANK (migration 039) — pure,
 * deterministic. No DB, no I/O. The stateful half lives in
 * models/bankAccountModel.js.
 *
 * This system is a single bank's own platform, so an account number here is
 * ISSUED, not declared. That is the whole difference from the superseded 038
 * design, where the customer typed a number nobody could verify: a number this
 * module derives is guaranteed well-formed and, because the sequence comes
 * from the row's own auto-increment id, guaranteed unique without a counter.
 *
 * beneficiaryAccount.service.js is deliberately NOT replaced — its
 * isValidAccountNumber / isValidTextField / MAX_* caps are still exactly what
 * is needed to validate the one remaining hand-typed path (staff registering
 * an account that was opened at a branch), so they are reused rather than
 * duplicated here.
 */

const {
  isValidAccountNumber,
  isValidTextField,
  MAX_BRANCH_LENGTH,
  MAX_ACCOUNT_HOLDER_LENGTH,
} = require("./beneficiaryAccount.service");

/**
 * Branch -> 4-digit code. There is no branches table in this schema and
 * branch is free text everywhere else (fx_exchange_requests.branch); migration
 * 015 explicitly ruled normalizing it into a real dimension out of scope, and
 * that has not changed. A constant map is the honest representation of "we
 * know a handful of branch names and nothing more".
 */
const BRANCH_CODES = Object.freeze({
  "Head Office": "0071",
  Colombo: "0011",
  Kandy: "0043",
  Galle: "0052",
  Jaffna: "0064",
  Negombo: "0025",
  Kurunegala: "0037",
  Batticaloa: "0088",
});

/** Branch every auto-opened account is issued at, unless overridden. */
const DEFAULT_BRANCH = process.env.BANK_DEFAULT_BRANCH || "Head Office";

/** Code for an unrecognised branch name — also the code for DEFAULT_BRANCH. */
const FALLBACK_BRANCH_CODE = "0071";

/** Digits in the sequence half of an account number (see formatAccountNumber). */
const SEQUENCE_DIGITS = 6;

/**
 * The 4-digit code for a branch name, falling back for anything unrecognised.
 * A wrong-but-well-formed code is far better than a failed disbursement: the
 * code is a routing hint on a number that is already unique on its own.
 * @param {string} branchName
 * @returns {string} exactly 4 digits
 */
function branchCodeFor(branchName) {
  if (typeof branchName !== "string") return FALLBACK_BRANCH_CODE;
  return BRANCH_CODES[branchName.trim()] || FALLBACK_BRANCH_CODE;
}

/**
 * Derive a customer's account number from their branch and the real primary
 * key of their bank_accounts row: <4-digit branch code><6-digit padded id>.
 *
 * Same "human reference derived from the real key" approach as
 * loan_accounts.account_no (LN-000123) and fx_exchange_requests.reference_no,
 * for the same reason — a separate counter can drift or collide, an
 * auto-increment id cannot. Ten digits keeps the result inside
 * beneficiaryAccount's ACCOUNT_NUMBER_PATTERN (6-20 digits), so every existing
 * validator accepts it unchanged.
 *
 * Ids past 999999 simply widen the number rather than wrapping — still digits,
 * still unique, still inside the 20-digit cap.
 *
 * @param {string} branchName
 * @param {number} id the bank_accounts row id
 * @returns {string}
 */
function formatAccountNumber(branchName, id) {
  return `${branchCodeFor(branchName)}${String(id).padStart(SEQUENCE_DIGITS, "0")}`;
}

/**
 * Whether a staff-supplied "register an existing account" payload is usable.
 * Format only, same philosophy as beneficiaryAccount.service.js — the real
 * check is that a member of staff looked it up in core banking before typing
 * it, which is precisely why this path is staff-only.
 * @param {{branch?:string, accountNumber?:string, accountHolder?:string}} input
 * @returns {{valid:boolean, message?:string}}
 */
function validateRegistration(input) {
  const { branch, accountNumber, accountHolder } = input || {};
  if (!isValidTextField(branch, MAX_BRANCH_LENGTH)) {
    return { valid: false, message: `branch is required (max ${MAX_BRANCH_LENGTH} characters).` };
  }
  if (!isValidAccountNumber(accountNumber)) {
    return { valid: false, message: "accountNumber must be 6-20 digits." };
  }
  if (!isValidTextField(accountHolder, MAX_ACCOUNT_HOLDER_LENGTH)) {
    return {
      valid: false,
      message: `accountHolder is required (max ${MAX_ACCOUNT_HOLDER_LENGTH} characters).`,
    };
  }
  return { valid: true };
}

module.exports = {
  BRANCH_CODES,
  DEFAULT_BRANCH,
  FALLBACK_BRANCH_CODE,
  SEQUENCE_DIGITS,
  branchCodeFor,
  formatAccountNumber,
  validateRegistration,
};

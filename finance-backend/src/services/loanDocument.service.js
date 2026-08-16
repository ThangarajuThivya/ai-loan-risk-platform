"use strict";

/**
 * Loan application document constants (E1) — pure, deterministic. No DB,
 * no I/O.
 *
 * Mirrors collateralGuarantor.service.js's role: the DB rows live in
 * loanModel.js (loan_application_documents, migration 034) and the actual
 * upload/streaming lives in loan.controller.js, but the small closed set of
 * valid values, and the one bit of string-sanitization logic involved in
 * serving a file back, sit here so they're unit-testable without a database
 * and reusable by both the route validators and the controller.
 */

/** Supporting-document categories a customer can upload against an application. */
const DOCUMENT_TYPES = ["national_id", "payslip", "bank_statement", "other"];

/** Staff review outcomes for an uploaded document. */
const VERIFICATION_STATUSES = ["pending", "verified", "rejected"];

/**
 * Document types that are physically two-sided, so a customer submitting a
 * photo (rather than a scanned/printed PDF) may reasonably want to attach
 * both the front and the back. A front/back photo is stored as two ordinary
 * rows of the same document_type — see migration 056's `side` column.
 */
const TWO_SIDED_DOCUMENT_TYPES = ["national_id"];

/** Valid values for the `side` column (migration 056). */
const DOCUMENT_SIDES = ["front", "back"];

/**
 * Make a customer-supplied filename safe to embed in a `Content-Disposition`
 * header. Strips quotes and newlines, which could otherwise be used to
 * inject extra header directives or break out of the quoted filename.
 * Extracted from the equivalent inline logic in
 * fxExchange.controller.js#downloadDocument so it's covered by a unit test
 * rather than only exercised by hitting the real download route.
 * @param {string} name
 * @returns {string}
 */
function sanitizeDownloadFilename(name) {
  return String(name || "").replace(/["\r\n]/g, "_");
}

module.exports = {
  DOCUMENT_TYPES,
  VERIFICATION_STATUSES,
  TWO_SIDED_DOCUMENT_TYPES,
  DOCUMENT_SIDES,
  sanitizeDownloadFilename,
};

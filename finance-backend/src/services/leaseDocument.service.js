"use strict";

/**
 * Lease application document constants — pure, deterministic. No DB, no
 * I/O.
 *
 * Mirrors loanDocument.service.js's role for the loan pipeline: the closed
 * set of document types a lease application accepts (045's ENUM) needs to
 * be reusable by lease.routes.js's validator and by
 * documentExtraction.service.js without either pulling in the other (the
 * routes file has DB-connecting side effects at require time, which a pure
 * service must not depend on).
 */

/** Document types a lease application accepts (045's ENUM). */
const LEASE_DOCUMENT_TYPES = [
  "national_id",
  "payslip",
  "bank_statement",
  "vehicle_invoice",
  "valuation_report",
  "cr_copy",
  "lease_agreement",
  "release_letter",
  "other",
];

/**
 * Lease document types that are physically two-sided (a National ID card;
 * a CR copy's data lives on the front, but a customer photographing rather
 * than scanning one may still want the back attached). Stored as two rows
 * of the same document_type, distinguished by the `side` column (migration
 * 056) — mirrors loanDocument.service.js's TWO_SIDED_DOCUMENT_TYPES.
 */
const TWO_SIDED_DOCUMENT_TYPES = ["national_id", "cr_copy"];

/** Valid values for the `side` column (migration 056). */
const DOCUMENT_SIDES = ["front", "back"];

module.exports = {
  LEASE_DOCUMENT_TYPES,
  TWO_SIDED_DOCUMENT_TYPES,
  DOCUMENT_SIDES,
};

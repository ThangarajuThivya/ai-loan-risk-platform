"use strict";

/**
 * Runnable test script for loan application document constants (E1).
 *   node src/services/__tests__/loanDocument.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  DOCUMENT_TYPES,
  VERIFICATION_STATUSES,
  sanitizeDownloadFilename,
} = require("../loanDocument.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("catalog");

check("DOCUMENT_TYPES is a fixed, non-empty list including the roadmap's examples", () => {
  assert(Array.isArray(DOCUMENT_TYPES));
  assert(DOCUMENT_TYPES.length > 0);
  assert(DOCUMENT_TYPES.includes("national_id"));
  assert(DOCUMENT_TYPES.includes("payslip"));
  assert(DOCUMENT_TYPES.includes("bank_statement"));
  assert(DOCUMENT_TYPES.includes("other"));
});

check("VERIFICATION_STATUSES is pending/verified/rejected", () => {
  assert.deepStrictEqual(VERIFICATION_STATUSES, ["pending", "verified", "rejected"]);
});

console.log("sanitizeDownloadFilename");

check("passes through an ordinary filename unchanged", () => {
  assert.strictEqual(sanitizeDownloadFilename("payslip-march.pdf"), "payslip-march.pdf");
});

check("strips double quotes so they cannot close the Content-Disposition value early", () => {
  assert.strictEqual(sanitizeDownloadFilename('evil".pdf'), "evil_.pdf");
});

check("strips CR/LF so they cannot inject extra header lines", () => {
  assert.strictEqual(
    sanitizeDownloadFilename("evil\r\nX-Injected: true.pdf"),
    "evil__X-Injected: true.pdf"
  );
});

check("a missing or non-string name becomes an empty string, not a crash", () => {
  assert.strictEqual(sanitizeDownloadFilename(null), "");
  assert.strictEqual(sanitizeDownloadFilename(undefined), "");
  assert.strictEqual(sanitizeDownloadFilename(""), "");
});

console.log(`\n${passed} assertions passed.`);

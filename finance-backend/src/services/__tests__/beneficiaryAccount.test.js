"use strict";

/**
 * Runnable test script for beneficiary bank account validation (H4).
 *   node src/services/__tests__/beneficiaryAccount.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  MAX_BRANCH_LENGTH,
  MAX_ACCOUNT_HOLDER_LENGTH,
  isValidAccountNumber,
  isValidTextField,
  isCompleteBeneficiaryAccount,
} = require("../beneficiaryAccount.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("isValidAccountNumber");

check("accepts digits-only within the length range", () => {
  assert.strictEqual(isValidAccountNumber("123456"), true); // 6 digits, the floor
  assert.strictEqual(isValidAccountNumber("12345678901234567890"), true); // 20 digits, the ceiling
  assert.strictEqual(isValidAccountNumber("0123456789"), true); // leading zero is fine, it's a string
});

check("tolerates surrounding whitespace", () => {
  assert.strictEqual(isValidAccountNumber("  1234567  "), true);
});

check("rejects too short, too long, non-digits, and garbage", () => {
  assert.strictEqual(isValidAccountNumber("12345"), false); // 5 digits
  assert.strictEqual(isValidAccountNumber("123456789012345678901"), false); // 21 digits
  assert.strictEqual(isValidAccountNumber("12345A"), false);
  assert.strictEqual(isValidAccountNumber("1234-5678"), false);
  assert.strictEqual(isValidAccountNumber(""), false);
  assert.strictEqual(isValidAccountNumber(null), false);
  assert.strictEqual(isValidAccountNumber(undefined), false);
  assert.strictEqual(isValidAccountNumber(123456), false); // must be a string, not a number
});

console.log("isValidTextField");

check("accepts a non-empty string within the cap", () => {
  assert.strictEqual(isValidTextField("Colombo Main", MAX_BRANCH_LENGTH), true);
});

check("rejects empty, whitespace-only, and over-length strings", () => {
  assert.strictEqual(isValidTextField("", MAX_BRANCH_LENGTH), false);
  assert.strictEqual(isValidTextField("   ", MAX_BRANCH_LENGTH), false);
  assert.strictEqual(isValidTextField("x".repeat(MAX_BRANCH_LENGTH + 1), MAX_BRANCH_LENGTH), false);
});

check("accepts exactly at the cap", () => {
  assert.strictEqual(isValidTextField("x".repeat(MAX_ACCOUNT_HOLDER_LENGTH), MAX_ACCOUNT_HOLDER_LENGTH), true);
});

check("rejects non-strings", () => {
  assert.strictEqual(isValidTextField(null, MAX_BRANCH_LENGTH), false);
  assert.strictEqual(isValidTextField(undefined, MAX_BRANCH_LENGTH), false);
  assert.strictEqual(isValidTextField(123, MAX_BRANCH_LENGTH), false);
});

console.log("isCompleteBeneficiaryAccount — the disbursement gate's single source of truth");

const COMPLETE = {
  beneficiary_branch: "Colombo Main",
  beneficiary_account_number: "1234567890",
  beneficiary_account_holder: "H1 Browser",
};

check("a fully-populated profile is complete", () => {
  assert.strictEqual(isCompleteBeneficiaryAccount(COMPLETE), true);
});

check("null/undefined profile is incomplete", () => {
  assert.strictEqual(isCompleteBeneficiaryAccount(null), false);
  assert.strictEqual(isCompleteBeneficiaryAccount(undefined), false);
});

check("a brand-new customer_profiles row (all three fields NULL) is incomplete", () => {
  assert.strictEqual(
    isCompleteBeneficiaryAccount({
      beneficiary_branch: null,
      beneficiary_account_number: null,
      beneficiary_account_holder: null,
    }),
    false
  );
});

check("SECURITY: missing any ONE of the three fields fails the whole check", () => {
  for (const field of Object.keys(COMPLETE)) {
    const partial = { ...COMPLETE, [field]: null };
    assert.strictEqual(
      isCompleteBeneficiaryAccount(partial),
      false,
      `expected incomplete with ${field} missing`
    );
  }
});

check("a malformed account number fails completeness even if the other two fields are fine", () => {
  assert.strictEqual(
    isCompleteBeneficiaryAccount({ ...COMPLETE, beneficiary_account_number: "not-a-number" }),
    false
  );
});

check("extra/unrelated fields on the object don't affect the result", () => {
  assert.strictEqual(
    isCompleteBeneficiaryAccount({ ...COMPLETE, employment_type: "Permanent", monthly_income: 200000 }),
    true
  );
});

console.log(`\n${passed} assertions passed.`);

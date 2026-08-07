"use strict";

/**
 * Runnable test script for bank account number issuance (039).
 *   node src/services/__tests__/bankAccount.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  BRANCH_CODES,
  DEFAULT_BRANCH,
  FALLBACK_BRANCH_CODE,
  branchCodeFor,
  formatAccountNumber,
  validateRegistration,
} = require("../bankAccount.service");
const { isValidAccountNumber } = require("../beneficiaryAccount.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("branchCodeFor");

check("maps every known branch to its own 4-digit code", () => {
  for (const [name, code] of Object.entries(BRANCH_CODES)) {
    assert.strictEqual(branchCodeFor(name), code, `expected ${name} -> ${code}`);
    assert.match(code, /^[0-9]{4}$/, `${name}'s code must be exactly 4 digits`);
  }
});

check("branch codes are unique — two branches must never share one", () => {
  const codes = Object.values(BRANCH_CODES);
  assert.strictEqual(new Set(codes).size, codes.length);
});

check("tolerates surrounding whitespace", () => {
  assert.strictEqual(branchCodeFor("  Kandy  "), BRANCH_CODES.Kandy);
});

check("falls back rather than throwing on an unknown or non-string branch", () => {
  // A wrong-but-well-formed code is far better than a failed disbursement:
  // the account number is already unique on its own, the code only routes.
  for (const input of ["Nowhere", "", null, undefined, 42, {}]) {
    assert.strictEqual(branchCodeFor(input), FALLBACK_BRANCH_CODE);
  }
});

check("the default branch resolves to the fallback code, not by accident", () => {
  assert.strictEqual(branchCodeFor(DEFAULT_BRANCH), FALLBACK_BRANCH_CODE);
});

console.log("\nformatAccountNumber");

check("is <4-digit branch code><6-digit zero-padded id>", () => {
  assert.strictEqual(formatAccountNumber("Head Office", 4512), "0071004512");
  assert.strictEqual(formatAccountNumber("Kandy", 1), "0043000001");
});

check("output always satisfies the existing ACCOUNT_NUMBER_PATTERN", () => {
  // This is the contract that lets every 038-era validator keep working
  // untouched now that numbers are issued rather than typed.
  for (const id of [1, 42, 999999, 1000000, 987654321]) {
    const number = formatAccountNumber("Colombo", id);
    assert.strictEqual(isValidAccountNumber(number), true, `${number} must validate`);
  }
});

check("ids past the 6-digit pad widen the number instead of wrapping", () => {
  // Wrapping would silently mint a duplicate; widening keeps it unique.
  assert.strictEqual(formatAccountNumber("Kandy", 1000000), "00431000000");
  assert.notStrictEqual(
    formatAccountNumber("Kandy", 1000000),
    formatAccountNumber("Kandy", 0)
  );
});

check("distinct ids never collide, and neither do equal ids across branches", () => {
  const ids = [1, 2, 10, 100, 999999, 1000000];
  const numbers = ids.map((id) => formatAccountNumber("Galle", id));
  assert.strictEqual(new Set(numbers).size, ids.length);

  const branches = Object.keys(BRANCH_CODES);
  const sameId = branches.map((b) => formatAccountNumber(b, 7));
  assert.strictEqual(new Set(sameId).size, branches.length);
});

check("an unknown branch still yields a valid, well-formed number", () => {
  const number = formatAccountNumber("Some Branch That Does Not Exist", 12);
  assert.strictEqual(number, `${FALLBACK_BRANCH_CODE}000012`);
  assert.strictEqual(isValidAccountNumber(number), true);
});

console.log("\nvalidateRegistration");

const VALID = {
  branch: "Kandy",
  accountNumber: "0043009988",
  accountHolder: "N. Christopher",
};

check("accepts a complete, well-formed staff registration", () => {
  assert.deepStrictEqual(validateRegistration(VALID), { valid: true });
});

check("rejects each field being missing, with a message naming it", () => {
  for (const field of ["branch", "accountNumber", "accountHolder"]) {
    const result = validateRegistration({ ...VALID, [field]: "" });
    assert.strictEqual(result.valid, false, `expected ${field} to be required`);
    assert.ok(result.message.includes(field), `message should name ${field}`);
  }
});

check("rejects a malformed account number", () => {
  for (const bad of ["12345", "12345A", "0043-009988", "123456789012345678901"]) {
    assert.strictEqual(validateRegistration({ ...VALID, accountNumber: bad }).valid, false);
  }
});

check("rejects over-length branch and holder", () => {
  assert.strictEqual(validateRegistration({ ...VALID, branch: "x".repeat(101) }).valid, false);
  assert.strictEqual(
    validateRegistration({ ...VALID, accountHolder: "x".repeat(151) }).valid,
    false
  );
});

check("survives null/undefined input rather than throwing", () => {
  assert.strictEqual(validateRegistration(null).valid, false);
  assert.strictEqual(validateRegistration(undefined).valid, false);
  assert.strictEqual(validateRegistration({}).valid, false);
});

console.log(`\n${passed} assertions passed.`);

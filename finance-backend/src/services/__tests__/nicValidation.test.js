"use strict";

/**
 * Runnable test script for NIC parsing & validation.
 *   node src/services/__tests__/nicValidation.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  normalizeNic,
  parseNic,
  crossCheckNic,
} = require("../nicValidation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("normalizeNic");

check("strips spaces and dashes and uppercases the trailing letter", () => {
  assert.strictEqual(normalizeNic("85-1234567-v"), "851234567V");
  assert.strictEqual(normalizeNic("85 1234567 V"), "851234567V");
});

check("leaves an all-digit new-format NIC unchanged apart from stray whitespace", () => {
  assert.strictEqual(normalizeNic(" 198512345678 "), "198512345678");
});

check("a missing or non-string value becomes an empty string, not a crash", () => {
  assert.strictEqual(normalizeNic(null), "");
  assert.strictEqual(normalizeNic(undefined), "");
});

console.log("parseNic — old format");

check("parses a male old-format NIC", () => {
  const result = parseNic("851234567V");
  assert.strictEqual(result.format, "old");
  assert.strictEqual(result.birthYear, 1985);
  assert.strictEqual(result.gender, "male");
  assert.strictEqual(result.dayOfYear, 123);
  assert.strictEqual(result.dateOfBirth, "1985-05-03");
  assert.strictEqual(result.serial, "4567");
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.errors, []);
});

check("parses a female old-format NIC (day-of-year offset by 500)", () => {
  const result = parseNic("856234567V");
  assert.strictEqual(result.gender, "female");
  assert.strictEqual(result.dayOfYear, 123);
  assert.strictEqual(result.dateOfBirth, "1985-05-03");
  assert.strictEqual(result.valid, true);
});

check("accepts a lowercase trailing letter and embedded dashes", () => {
  const result = parseNic("85-1234567-v");
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.gender, "male");
});

console.log("parseNic — new format");

check("parses a male new-format NIC", () => {
  const result = parseNic("198512345678");
  assert.strictEqual(result.format, "new");
  assert.strictEqual(result.birthYear, 1985);
  assert.strictEqual(result.gender, "male");
  assert.strictEqual(result.dateOfBirth, "1985-05-03");
  assert.strictEqual(result.serial, "45678");
  assert.strictEqual(result.valid, true);
});

check("parses a female new-format NIC (day-of-year offset by 500)", () => {
  const result = parseNic("198562345678");
  assert.strictEqual(result.gender, "female");
  assert.strictEqual(result.dateOfBirth, "1985-05-03");
  assert.strictEqual(result.valid, true);
});

console.log("parseNic — structural validation");

check("rejects a string that matches neither NIC format", () => {
  const result = parseNic("12345");
  assert.strictEqual(result.format, null);
  assert.strictEqual(result.valid, false);
  assert(result.errors.includes("invalid_format"));
});

check("rejects a day-of-year of 0", () => {
  const result = parseNic("850004567V");
  assert.strictEqual(result.valid, false);
  assert(result.errors.includes("day_of_year_out_of_range"));
  assert.strictEqual(result.gender, null);
});

check("rejects a day-of-year above the valid female range", () => {
  const result = parseNic("859004567V");
  assert.strictEqual(result.valid, false);
  assert(result.errors.includes("day_of_year_out_of_range"));
});

console.log("parseNic — leap year handling");

check("accepts day-of-year 366 in a leap birth year", () => {
  const result = parseNic("963664567V");
  assert.strictEqual(result.birthYear, 1996);
  assert.strictEqual(result.dateOfBirth, "1996-12-31");
  assert.strictEqual(result.valid, true);
});

check("rejects day-of-year 366 in a non-leap birth year", () => {
  const result = parseNic("973664567V");
  assert.strictEqual(result.birthYear, 1997);
  assert.strictEqual(result.valid, false);
  assert(result.errors.includes("day_of_year_invalid_for_year"));
  assert.strictEqual(result.dateOfBirth, null);
});

console.log("parseNic — plausibility rules");

check("rejects a birth year in the future", () => {
  const result = parseNic("209912345678");
  assert.strictEqual(result.valid, false);
  assert(result.errors.includes("birth_year_in_future"));
  assert.strictEqual(result.dateOfBirth, null);
});

check("rejects an applicant who is not yet 18", () => {
  const result = parseNic("201000145678");
  assert.strictEqual(result.valid, false);
  assert(result.errors.includes("applicant_under_18"));
});

check("accepts an adult applicant born well over 18 years ago", () => {
  const result = parseNic("199000145678");
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.errors, []);
});

console.log("crossCheckNic");

check("reports no mismatch when declared DOB and gender agree with the NIC", () => {
  const result = crossCheckNic("198512345678", {
    declaredDob: "1985-05-03",
    declaredGender: "male",
  });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.dobMismatch, false);
  assert.strictEqual(result.genderMismatch, false);
});

check("flags a declared date of birth that disagrees with the NIC", () => {
  const result = crossCheckNic("198512345678", {
    declaredDob: "1990-01-01",
    declaredGender: "male",
  });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.dobMismatch, true);
  assert.strictEqual(result.genderMismatch, false);
});

check("flags a declared gender that disagrees with the NIC", () => {
  const result = crossCheckNic("198512345678", {
    declaredDob: "1985-05-03",
    declaredGender: "female",
  });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.genderMismatch, true);
});

check("an unparseable NIC cannot be cross-checked and is reported invalid", () => {
  const result = crossCheckNic("not-a-nic", {
    declaredDob: "1985-05-03",
    declaredGender: "male",
  });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.dobMismatch, false);
  assert.strictEqual(result.genderMismatch, false);
});

console.log(`\n${passed} assertions passed.`);

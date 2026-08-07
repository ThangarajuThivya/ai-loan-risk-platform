"use strict";

/**
 * Runnable test script for collateral/guarantor summarization (D5).
 *   node src/services/__tests__/collateralGuarantor.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  COLLATERAL_TYPES,
  isValidNic,
  summarizeCollateral,
  computeCoverageRatio,
  summarizeGuarantorFindings,
} = require("../collateralGuarantor.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("isValidNic");

check("accepts the old 9-digit + V/X format, either case", () => {
  assert.strictEqual(isValidNic("851234567V"), true);
  assert.strictEqual(isValidNic("851234567v"), true);
  assert.strictEqual(isValidNic("851234567X"), true);
  assert.strictEqual(isValidNic("851234567x"), true);
});

check("accepts the new 12-digit format", () => {
  assert.strictEqual(isValidNic("200012345678"), true);
});

check("tolerates surrounding whitespace", () => {
  assert.strictEqual(isValidNic("  851234567V  "), true);
});

check("rejects the wrong digit count, missing suffix, or garbage", () => {
  assert.strictEqual(isValidNic("85123456V"), false); // 8 digits
  assert.strictEqual(isValidNic("8512345678V"), false); // 10 digits
  assert.strictEqual(isValidNic("851234567"), false); // no suffix
  assert.strictEqual(isValidNic("85123456712"), false); // 11 digits, no suffix
  assert.strictEqual(isValidNic("2000123456789"), false); // 13 digits
  assert.strictEqual(isValidNic("abcdefghiV"), false);
  assert.strictEqual(isValidNic(""), false);
  assert.strictEqual(isValidNic(null), false);
  assert.strictEqual(isValidNic(undefined), false);
  assert.strictEqual(isValidNic(851234567), false); // not even a string
});

console.log("summarizeCollateral");

check("no items summarizes to all zeros, no unverified flag", () => {
  const s = summarizeCollateral([]);
  assert.deepStrictEqual(s, {
    itemCount: 0,
    totalDeclaredValue: 0,
    totalVerifiedValue: 0,
    hasUnverified: false,
  });
  assert.deepStrictEqual(summarizeCollateral(), {
    itemCount: 0,
    totalDeclaredValue: 0,
    totalVerifiedValue: 0,
    hasUnverified: false,
  });
});

check("self_declared items count toward the declared total but not verified", () => {
  const s = summarizeCollateral([
    { estimated_value: 500000, verification_status: "self_declared" },
  ]);
  assert.strictEqual(s.totalDeclaredValue, 500000);
  assert.strictEqual(s.totalVerifiedValue, 0);
  assert.strictEqual(s.hasUnverified, true);
});

check("verified items count toward both totals", () => {
  const s = summarizeCollateral([
    { estimated_value: 500000, verification_status: "verified" },
  ]);
  assert.strictEqual(s.totalDeclaredValue, 500000);
  assert.strictEqual(s.totalVerifiedValue, 500000);
  assert.strictEqual(s.hasUnverified, false);
});

check("rejected items still count toward the DECLARED total (an honest record of what was claimed), never the verified one", () => {
  const s = summarizeCollateral([
    { estimated_value: 500000, verification_status: "rejected" },
  ]);
  assert.strictEqual(s.totalDeclaredValue, 500000);
  assert.strictEqual(s.totalVerifiedValue, 0);
  // A rejection is a resolved outcome, not an open question — it must not
  // itself flag hasUnverified (there's nothing left to verify).
  assert.strictEqual(s.hasUnverified, false);
});

check("a mix sums correctly and flags unverified only while something is unresolved", () => {
  const s = summarizeCollateral([
    { estimated_value: 1000000, verification_status: "verified" },
    { estimated_value: 200000, verification_status: "self_declared" },
    { estimated_value: 50000, verification_status: "rejected" },
  ]);
  assert.strictEqual(s.itemCount, 3);
  assert.strictEqual(s.totalDeclaredValue, 1250000);
  assert.strictEqual(s.totalVerifiedValue, 1000000);
  assert.strictEqual(s.hasUnverified, true);
});

check("all-verified items never flag hasUnverified", () => {
  const s = summarizeCollateral([
    { estimated_value: 300000, verification_status: "verified" },
    { estimated_value: 400000, verification_status: "verified" },
  ]);
  assert.strictEqual(s.hasUnverified, false);
  assert.strictEqual(s.totalVerifiedValue, 700000);
});

check("a missing or non-numeric estimated_value contributes zero, not NaN", () => {
  const s = summarizeCollateral([
    { verification_status: "verified" },
    { estimated_value: "not a number", verification_status: "verified" },
  ]);
  assert.strictEqual(s.totalVerifiedValue, 0);
  assert(Number.isFinite(s.totalVerifiedValue));
});

console.log("computeCoverageRatio");

check("full coverage is exactly 1", () => {
  assert.strictEqual(computeCoverageRatio(1000000, 1000000), 1);
});

check("partial and over-coverage compute correctly", () => {
  assert.strictEqual(computeCoverageRatio(500000, 1000000), 0.5);
  assert.strictEqual(computeCoverageRatio(1500000, 1000000), 1.5);
});

check("zero verified value against a real request is a real zero ratio", () => {
  assert.strictEqual(computeCoverageRatio(0, 1000000), 0);
});

check("a non-positive or missing requested amount is null, not a division error", () => {
  assert.strictEqual(computeCoverageRatio(500000, 0), null);
  assert.strictEqual(computeCoverageRatio(500000, -100), null);
  assert.strictEqual(computeCoverageRatio(500000, null), null);
  assert.strictEqual(computeCoverageRatio(500000, undefined), null);
  assert.strictEqual(computeCoverageRatio(500000, NaN), null);
});

console.log("summarizeGuarantorFindings");

check("no rows summarizes to an empty array", () => {
  assert.deepStrictEqual(summarizeGuarantorFindings([]), []);
  assert.deepStrictEqual(summarizeGuarantorFindings(), []);
});

check("a clean guarantor with no other exposure is not distressed", () => {
  const findings = summarizeGuarantorFindings([
    {
      full_name: "K. Perera",
      other_active_guarantees: 0,
      other_active_exposure: 0,
      other_distressed_guarantees: 0,
    },
  ]);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].fullName, "K. Perera");
  assert.strictEqual(findings[0].otherActiveGuaranteeCount, 0);
  assert.strictEqual(findings[0].otherActiveExposure, 0);
  assert.strictEqual(findings[0].isDistressedElsewhere, false);
});

check("a guarantor backing other clean facilities is not distressed", () => {
  const findings = summarizeGuarantorFindings([
    {
      full_name: "N. Silva",
      other_active_guarantees: 2,
      other_active_exposure: 1500000,
      other_distressed_guarantees: 0,
    },
  ]);
  assert.strictEqual(findings[0].otherActiveGuaranteeCount, 2);
  assert.strictEqual(findings[0].otherActiveExposure, 1500000);
  assert.strictEqual(findings[0].isDistressedElsewhere, false);
});

check("even one distressed facility elsewhere flags the guarantor", () => {
  const findings = summarizeGuarantorFindings([
    {
      full_name: "R. Fernando",
      other_active_guarantees: 3,
      other_active_exposure: 2000000,
      other_distressed_guarantees: 1,
    },
  ]);
  assert.strictEqual(findings[0].isDistressedElsewhere, true);
});

check("multiple guarantor rows are summarized independently", () => {
  const findings = summarizeGuarantorFindings([
    { full_name: "A", other_active_guarantees: 0, other_active_exposure: 0, other_distressed_guarantees: 0 },
    { full_name: "B", other_active_guarantees: 1, other_active_exposure: 500000, other_distressed_guarantees: 1 },
  ]);
  assert.strictEqual(findings.length, 2);
  assert.strictEqual(findings[0].isDistressedElsewhere, false);
  assert.strictEqual(findings[1].isDistressedElsewhere, true);
});

check("SQL string-typed DECIMAL/COUNT results are coerced numerically", () => {
  // mysql2 can hand back DECIMAL columns as strings; this must not produce
  // NaN or string concatenation instead of arithmetic downstream.
  const findings = summarizeGuarantorFindings([
    {
      full_name: "String Coercion Case",
      other_active_guarantees: "2",
      other_active_exposure: "750000.50",
      other_distressed_guarantees: "0",
    },
  ]);
  assert.strictEqual(findings[0].otherActiveGuaranteeCount, 2);
  assert.strictEqual(findings[0].otherActiveExposure, 750000.5);
  assert.strictEqual(findings[0].isDistressedElsewhere, false);
});

console.log("catalog");

check("COLLATERAL_TYPES is a fixed, non-empty list", () => {
  assert(Array.isArray(COLLATERAL_TYPES));
  assert(COLLATERAL_TYPES.length > 0);
  assert(COLLATERAL_TYPES.includes("property"));
  assert(COLLATERAL_TYPES.includes("other"));
});

console.log(`\n${passed} assertions passed.`);

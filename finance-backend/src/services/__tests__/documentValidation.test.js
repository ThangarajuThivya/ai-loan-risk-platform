"use strict";

/**
 * Runnable test script for cross-document validation.
 *   node src/services/__tests__/documentValidation.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const { validateApplication, nameMatchScore, NAME_MATCH_THRESHOLD } = require("../documentValidation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** Wrap a raw value the way documentExtraction.service.js's extractFields does. */
function f(value) {
  return { value, snippet: "test", confidence: 1 };
}

function codesOf(findings) {
  return findings.map((f2) => f2.code);
}

function findByCode(findings, code) {
  return findings.find((f2) => f2.code === code);
}

// ---------------------------------------------------------------------------
// nameMatchScore
// ---------------------------------------------------------------------------

console.log("nameMatchScore");

check("scores an exact name match at 1", () => {
  assert.strictEqual(nameMatchScore("K.G. Perera", "K.G. Perera"), 1);
});

check("scores an initial standing in for a full given name above threshold", () => {
  const score = nameMatchScore("K.G. Perera", "Kamal Gunathilaka Perera".replace("Kamal", "K").replace("Gunathilaka", "G"));
  assert(score >= NAME_MATCH_THRESHOLD);
});

check("is order-insensitive", () => {
  assert.strictEqual(nameMatchScore("Perera K.G.", "K.G. Perera"), 1);
});

check("scores a materially different name below threshold", () => {
  const score = nameMatchScore("K.G. Perera", "W.M. Silva");
  assert(score < NAME_MATCH_THRESHOLD);
});

// ---------------------------------------------------------------------------
// 3.1 Payslip arithmetic
// ---------------------------------------------------------------------------

console.log("3.1 payslip arithmetic");

check("flags consistent gross - deductions = net as info", () => {
  const findings = validateApplication({
    extracted: {
      payslip: {
        gross_salary: f(100000),
        total_deductions: f(15000),
        net_salary: f(85000),
      },
    },
  });
  const found = findByCode(findings, "payslip_arithmetic_consistent");
  assert(found);
  assert.strictEqual(found.severity, "info");
});

check("flags an arithmetic mismatch as a warning", () => {
  const findings = validateApplication({
    extracted: {
      payslip: {
        gross_salary: f(100000),
        total_deductions: f(15000),
        net_salary: f(70000),
      },
    },
  });
  const found = findByCode(findings, "payslip_arithmetic_mismatch");
  assert(found);
  assert.strictEqual(found.severity, "warning");
});

check("skips arithmetic check entirely when a figure is missing", () => {
  const findings = validateApplication({
    extracted: { payslip: { gross_salary: f(100000) } },
  });
  assert.strictEqual(codesOf(findings).some((c) => c.startsWith("payslip_arithmetic")), false);
});

check("corroborates an 8% EPF employee contribution against basic salary", () => {
  const findings = validateApplication({
    extracted: {
      payslip: { basic_salary: f(50000), epf_employee: f(4000) },
    },
  });
  const found = findByCode(findings, "epf_employee_rate_corroborated");
  assert(found);
  assert.strictEqual(found.severity, "info");
});

check("flags an EPF employee contribution inconsistent with 8% of basic", () => {
  const findings = validateApplication({
    extracted: {
      payslip: { basic_salary: f(50000), epf_employee: f(1000) },
    },
  });
  const found = findByCode(findings, "epf_employee_rate_inconsistent");
  assert(found);
  assert.strictEqual(found.severity, "warning");
});

check("corroborates EPF employer (12%) and ETF employer (3%) rates", () => {
  const findings = validateApplication({
    extracted: {
      payslip: { basic_salary: f(50000), epf_employer: f(6000), etf_employer: f(1500) },
    },
  });
  assert(findByCode(findings, "epf_employer_rate_corroborated"));
  assert(findByCode(findings, "etf_employer_rate_corroborated"));
});

// ---------------------------------------------------------------------------
// 3.2 Cross-document identity
// ---------------------------------------------------------------------------

console.log("3.2 cross-document identity");

check("matches names that are consistent across NIC, payslip, and bank statement", () => {
  const findings = validateApplication({
    extracted: {
      national_id: { name: f("K.G. Perera") },
      payslip: { employee_name: f("Perera K.G.") },
      bank_statement: { account_holder: f("K G Perera") },
    },
  });
  assert(findByCode(findings, "identity_name_nic_payslip_match"));
  assert(findByCode(findings, "identity_name_nic_bank_statement_match"));
  assert(findByCode(findings, "identity_name_payslip_bank_statement_match"));
});

check("flags a mismatched name across documents as a warning", () => {
  const findings = validateApplication({
    extracted: {
      national_id: { name: f("K.G. Perera") },
      bank_statement: { account_holder: f("W.M. Silva") },
    },
  });
  const found = findByCode(findings, "identity_name_nic_bank_statement_mismatch");
  assert(found);
  assert.strictEqual(found.severity, "warning");
});

check("compares the registered bank account holder from declared data", () => {
  const findings = validateApplication({
    extracted: { national_id: { name: f("K.G. Perera") } },
    declared: { bankAccountHolderName: "W.M. Silva" },
  });
  assert(findByCode(findings, "identity_name_nic_registered_account_mismatch"));
});

check("skips identity comparisons when fewer than two names are available", () => {
  const findings = validateApplication({
    extracted: { national_id: { name: f("K.G. Perera") } },
  });
  assert.strictEqual(codesOf(findings).some((c) => c.startsWith("identity_name_")), false);
});

// ---------------------------------------------------------------------------
// 3.3 NIC-derived identity facts
// ---------------------------------------------------------------------------

console.log("3.3 NIC-derived identity facts");

const VALID_NIC_FIELD = f({ nic: "851234567V" }); // 1985-05-03, male

check("matches NIC-derived DOB and gender against declared data", () => {
  const findings = validateApplication({
    extracted: { national_id: { national_id: VALID_NIC_FIELD } },
    declared: { dateOfBirth: "1985-05-03", gender: "male" },
  });
  assert(findByCode(findings, "nic_dob_match"));
  assert(findByCode(findings, "nic_gender_match"));
});

check("blocks on a NIC-derived date of birth mismatch", () => {
  const findings = validateApplication({
    extracted: { national_id: { national_id: VALID_NIC_FIELD } },
    declared: { dateOfBirth: "1990-01-01", gender: "male" },
  });
  const found = findByCode(findings, "nic_dob_mismatch");
  assert(found);
  assert.strictEqual(found.severity, "blocker");
});

check("blocks on a NIC-derived gender mismatch", () => {
  const findings = validateApplication({
    extracted: { national_id: { national_id: VALID_NIC_FIELD } },
    declared: { dateOfBirth: "1985-05-03", gender: "female" },
  });
  const found = findByCode(findings, "nic_gender_mismatch");
  assert(found);
  assert.strictEqual(found.severity, "blocker");
});

check("skips NIC-derived checks when the NIC itself is invalid", () => {
  const findings = validateApplication({
    extracted: { national_id: { national_id: f({ nic: "not-a-nic" }) } },
    declared: { dateOfBirth: "1985-05-03", gender: "male" },
  });
  assert.strictEqual(codesOf(findings).some((c) => c.startsWith("nic_")), false);
});

// ---------------------------------------------------------------------------
// 3.4 Income corroboration
// ---------------------------------------------------------------------------

console.log("3.4 income corroboration");

check("corroborates payslip net salary against declared income within tolerance", () => {
  const findings = validateApplication({
    extracted: { payslip: { net_salary: f(85000) } },
    declared: { monthlyIncome: 88000 },
  });
  const found = findByCode(findings, "income_corroboration_match");
  assert(found);
  assert.strictEqual(found.severity, "info");
});

check("flags an income figure inconsistent with declared income", () => {
  const findings = validateApplication({
    extracted: { payslip: { net_salary: f(85000) } },
    declared: { monthlyIncome: 30000 },
  });
  const found = findByCode(findings, "income_corroboration_mismatch");
  assert(found);
  assert.strictEqual(found.severity, "warning");
});

check("compares the recurring bank salary credit as well", () => {
  const findings = validateApplication({
    extracted: {
      payslip: { net_salary: f(85000) },
      bank_statement: { recurring_salary_credit: f(84500) },
    },
    declared: { monthlyIncome: 85500 },
  });
  assert.strictEqual(codesOf(findings).filter((c) => c === "income_corroboration_match").length, 3);
});

check("skips income corroboration when no comparable figures are present", () => {
  const findings = validateApplication({ extracted: {}, declared: {} });
  assert.strictEqual(codesOf(findings).some((c) => c.startsWith("income_corroboration")), false);
});

// ---------------------------------------------------------------------------
// 3.5 Lease-specific chassis chain
// ---------------------------------------------------------------------------

console.log("3.5 chassis chain");

check("confirms a matching chassis number across all four documents", () => {
  const findings = validateApplication({
    extracted: {
      cr_copy: { chassis_number: f("MR053-6012345") },
      vehicle_invoice: { chassis_number: f("mr053 6012345") },
      valuation_report: { chassis_number: f("MR053-6012345") },
      release_letter: { chassis_number: f("MR053-6012345") },
    },
  });
  const found = findByCode(findings, "chassis_number_consistent");
  assert(found);
  assert.strictEqual(found.severity, "info");
});

check("blocks on a chassis number mismatch across documents", () => {
  const findings = validateApplication({
    extracted: {
      cr_copy: { chassis_number: f("MR053-6012345") },
      vehicle_invoice: { chassis_number: f("MR053-9999999") },
    },
  });
  const found = findByCode(findings, "chassis_number_mismatch");
  assert(found);
  assert.strictEqual(found.severity, "blocker");
});

check("skips the chassis chain check when fewer than two documents have a chassis number", () => {
  const findings = validateApplication({
    extracted: { cr_copy: { chassis_number: f("MR053-6012345") } },
  });
  assert.strictEqual(codesOf(findings).some((c) => c.startsWith("chassis_number_")), false);
});

// ---------------------------------------------------------------------------
// 3.6 Encumbrance
// ---------------------------------------------------------------------------

console.log("3.6 encumbrance");

check("returns a blocker when the absolute owner is not the applicant on a lease", () => {
  const findings = validateApplication({
    extracted: {
      cr_copy: { absolute_owner: f({ name: "PEOPLE'S LEASING FINANCE PLC", likelyFinanceCompany: true }) },
    },
    declared: { fullName: "K.G. Perera", isLease: true },
  });
  const found = findByCode(findings, "encumbrance_absolute_owner_not_applicant");
  assert(found);
  assert.strictEqual(found.severity, "blocker");
});

check("returns info when the absolute owner matches the applicant on a lease", () => {
  const findings = validateApplication({
    extracted: {
      cr_copy: { absolute_owner: f({ name: "K.G. Perera", likelyFinanceCompany: false }) },
    },
    declared: { fullName: "K.G. Perera", isLease: true },
  });
  const found = findByCode(findings, "no_encumbrance_detected");
  assert(found);
  assert.strictEqual(found.severity, "info");
});

check("does not run the encumbrance check outside of a lease application", () => {
  const findings = validateApplication({
    extracted: {
      cr_copy: { absolute_owner: f({ name: "PEOPLE'S LEASING FINANCE PLC", likelyFinanceCompany: true }) },
    },
    declared: { fullName: "K.G. Perera", isLease: false },
  });
  assert.strictEqual(codesOf(findings).some((c) => c.startsWith("encumbrance") || c === "no_encumbrance_detected"), false);
});

console.log(`\n${passed} assertions passed.`);

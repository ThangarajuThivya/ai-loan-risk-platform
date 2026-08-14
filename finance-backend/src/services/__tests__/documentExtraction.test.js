"use strict";

/**
 * Runnable test script for rule-based document field extraction.
 *   node src/services/__tests__/documentExtraction.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const { extractFields, parseLkrAmount, parseLocalDate } = require("../documentExtraction.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NIC_LABELLED_TEXT = `
LOAN APPLICATION - SUPPORTING DOCUMENT
Applicant Details
Name: K.G. Perera
NIC No: 851234567V
Address: No 45, Galle Road, Colombo 03
`;

const NIC_BARE_NEW_FORMAT_TEXT = `
Attached photocopy of the identity card shows 198512345678 printed on the reverse.
`;

const NIC_BARE_INVALID_TEXT = `
Invoice reference number 999999999X does not belong to any applicant record.
`;

const CR_COPY_TEXT = `
DEPARTMENT OF MOTOR TRAFFIC
CERTIFICATE OF REGISTRATION

Registration No: CAB-1234
Chassis No: MR053-6012345
Engine No: 4A91-8877665
Make: TOYOTA
Model: AQUA
Year of Manufacture: 2015
Fuel Type: Hybrid
Class of Vehicle: Motor Car
Absolute Owner: PEOPLE'S LEASING FINANCE PLC
`;

const CR_COPY_APPLICANT_OWNED_TEXT = `
Registration No: KY-9988
Absolute Owner: K.G. Perera
`;

const CR_COPY_OLD_PLATE_BARE_TEXT = `
The vehicle bearing number plate 25-1234 was inspected on site; no registration label was legible.
`;

const BANK_STATEMENT_TEXT = `
SAMPATH BANK PLC
Statement of Account

Account Name: W.M. Silva
Account No: 0123456789012
Branch: Kandy
Statement Period: 01/01/2026 to 31/01/2026
Opening Balance: Rs. 125,430.50
Closing Balance: Rs. 98,760.00/=
`;

const BANK_STATEMENT_NEGATIVE_CLOSING_TEXT = `
COMMERCIAL BANK OF CEYLON PLC
Account No: 9988776655
Branch: Colombo 07
Opening Balance: LKR 2,000.00
Closing Balance: (1,234.00)
`;

// ---------------------------------------------------------------------------
// parseLkrAmount
// ---------------------------------------------------------------------------

console.log("parseLkrAmount");

check("parses a 'Rs.' prefixed amount with thousands separators", () => {
  assert.strictEqual(parseLkrAmount("Rs. 12,345.67"), 12345.67);
});

check("parses a Sinhala 'රු.' prefixed amount", () => {
  assert.strictEqual(parseLkrAmount("රු. 1,234"), 1234);
});

check("parses an 'LKR' prefixed amount", () => {
  assert.strictEqual(parseLkrAmount("LKR 10,000"), 10000);
});

check("parses the trailing '/=' convention", () => {
  assert.strictEqual(parseLkrAmount("5,000.00/="), 5000);
});

check("treats a parenthesized amount as negative", () => {
  assert.strictEqual(parseLkrAmount("(1,234.00)"), -1234);
});

check("returns null for text with no parseable amount", () => {
  assert.strictEqual(parseLkrAmount("N/A"), null);
  assert.strictEqual(parseLkrAmount(""), null);
  assert.strictEqual(parseLkrAmount(null), null);
});

// ---------------------------------------------------------------------------
// parseLocalDate
// ---------------------------------------------------------------------------

console.log("parseLocalDate");

check("parses DD/MM/YYYY, never MM/DD/YYYY", () => {
  assert.strictEqual(parseLocalDate("31/01/2026"), "2026-01-31");
});

check("rejects a US-ordered date that isn't a valid DD/MM date", () => {
  assert.strictEqual(parseLocalDate("13/25/2026"), null);
});

check("accepts '-' and '.' separators", () => {
  assert.strictEqual(parseLocalDate("03-05-1985"), "1985-05-03");
  assert.strictEqual(parseLocalDate("03.05.1985"), "1985-05-03");
});

check("expands a 2-digit year using the pivot", () => {
  assert.strictEqual(parseLocalDate("03/05/85"), "1985-05-03");
  assert.strictEqual(parseLocalDate("03/05/25"), "2025-05-03");
});

check("returns null for an unparseable string", () => {
  assert.strictEqual(parseLocalDate("not a date"), null);
});

// ---------------------------------------------------------------------------
// extractFields — national_id
// ---------------------------------------------------------------------------

console.log("extractFields — national_id");

check("extracts a label-anchored old-format NIC with high confidence", () => {
  const result = extractFields(NIC_LABELLED_TEXT, "national_id");
  assert(result.national_id);
  assert.strictEqual(result.national_id.value.nic, "851234567V");
  assert.strictEqual(result.national_id.value.valid, true);
  assert.strictEqual(result.national_id.value.gender, "male");
  assert.strictEqual(result.national_id.value.dateOfBirth, "1985-05-03");
  assert.strictEqual(result.national_id.snippet.includes("851234567V"), true);
  assert.strictEqual(result.national_id.confidence, 0.95);
});

check("falls back to a loose bare-pattern match at lower confidence when there is no label", () => {
  const result = extractFields(NIC_BARE_NEW_FORMAT_TEXT, "national_id");
  assert(result.national_id);
  assert.strictEqual(result.national_id.value.nic, "198512345678");
  assert.strictEqual(result.national_id.confidence, 0.6);
  assert(result.national_id.confidence < 0.95);
});

check("never guesses — an invalid-looking token yields a null field, not a bad extraction", () => {
  const result = extractFields(NIC_BARE_INVALID_TEXT, "national_id");
  assert.strictEqual(result.national_id, null);
});

// ---------------------------------------------------------------------------
// extractFields — cr_copy
// ---------------------------------------------------------------------------

console.log("extractFields — cr_copy");

check("extracts the full set of CR copy fields from a labelled document", () => {
  const result = extractFields(CR_COPY_TEXT, "cr_copy");
  assert.strictEqual(result.registration_number.value, "CAB-1234");
  assert.strictEqual(result.chassis_number.value, "MR053-6012345");
  assert.strictEqual(result.engine_number.value, "4A91-8877665");
  assert.strictEqual(result.make.value, "TOYOTA");
  assert.strictEqual(result.model.value, "AQUA");
  assert.strictEqual(result.year_of_manufacture.value, 2015);
  assert.strictEqual(result.fuel_type.value, "Hybrid");
  assert.strictEqual(result.class_of_vehicle.value, "Motor Car");
});

check("flags a finance company as absolute owner — an encumbrance signal for underwriting", () => {
  const result = extractFields(CR_COPY_TEXT, "cr_copy");
  assert.strictEqual(result.absolute_owner.value.name, "PEOPLE'S LEASING FINANCE PLC");
  assert.strictEqual(result.absolute_owner.value.likelyFinanceCompany, true);
});

check("does not flag an individual as absolute owner", () => {
  const result = extractFields(CR_COPY_APPLICANT_OWNED_TEXT, "cr_copy");
  assert.strictEqual(result.absolute_owner.value.name, "K.G. Perera");
  assert.strictEqual(result.absolute_owner.value.likelyFinanceCompany, false);
});

check("recognizes the old two/three-digit-dash-four-digit plate format", () => {
  const result = extractFields(CR_COPY_APPLICANT_OWNED_TEXT, "cr_copy");
  assert.strictEqual(result.registration_number.value, "KY-9988");
  assert.strictEqual(result.registration_number.confidence, 0.95);
});

check("falls back to a loose plate match at lower confidence with no label", () => {
  const result = extractFields(CR_COPY_OLD_PLATE_BARE_TEXT, "cr_copy");
  assert.strictEqual(result.registration_number.value, "25-1234");
  assert.strictEqual(result.registration_number.confidence, 0.6);
});

check("leaves unfound cr_copy fields null rather than guessing", () => {
  const result = extractFields(CR_COPY_OLD_PLATE_BARE_TEXT, "cr_copy");
  assert.strictEqual(result.chassis_number, null);
  assert.strictEqual(result.engine_number, null);
  assert.strictEqual(result.make, null);
});

// ---------------------------------------------------------------------------
// extractFields — bank_statement
// ---------------------------------------------------------------------------

console.log("extractFields — bank_statement");

check("identifies the bank from header keywords and extracts account fields", () => {
  const result = extractFields(BANK_STATEMENT_TEXT, "bank_statement");
  assert.strictEqual(result.bank.value, "Sampath");
  assert.strictEqual(result.account_number.value, "0123456789012");
  assert.strictEqual(result.account_holder.value, "W.M. Silva");
  assert.strictEqual(result.branch.value, "Kandy");
});

check("extracts a statement period as DD/MM/YYYY-parsed ISO dates", () => {
  const result = extractFields(BANK_STATEMENT_TEXT, "bank_statement");
  assert.deepStrictEqual(result.statement_period.value, { from: "2026-01-01", to: "2026-01-31" });
});

check("extracts opening/closing balances through parseLkrAmount", () => {
  const result = extractFields(BANK_STATEMENT_TEXT, "bank_statement");
  assert.strictEqual(result.opening_balance.value, 125430.5);
  assert.strictEqual(result.closing_balance.value, 98760);
});

check("identifies a bank whose full name is used instead of its abbreviation", () => {
  const result = extractFields(BANK_STATEMENT_NEGATIVE_CLOSING_TEXT, "bank_statement");
  assert.strictEqual(result.bank.value, "Commercial Bank");
});

check("carries a parenthesized negative closing balance through as a negative number", () => {
  const result = extractFields(BANK_STATEMENT_NEGATIVE_CLOSING_TEXT, "bank_statement");
  assert.strictEqual(result.closing_balance.value, -1234);
});

check("leaves a missing statement period null rather than guessing one", () => {
  const result = extractFields(BANK_STATEMENT_NEGATIVE_CLOSING_TEXT, "bank_statement");
  assert.strictEqual(result.statement_period, null);
});

// ---------------------------------------------------------------------------
// extractFields — document type handling
// ---------------------------------------------------------------------------

console.log("extractFields — document type handling");

check("returns an empty field set for a supported document type with no extraction rules yet", () => {
  assert.deepStrictEqual(extractFields("some payslip text", "payslip"), {});
});

check("recognizes a lease-only document type (LEASE_DOCUMENT_TYPES) as valid, not just DOCUMENT_TYPES", () => {
  assert.deepStrictEqual(extractFields("some invoice text", "vehicle_invoice"), {});
});

check("throws for a document_type outside both DOCUMENT_TYPES and LEASE_DOCUMENT_TYPES", () => {
  assert.throws(() => extractFields("text", "passport"));
});

console.log(`\n${passed} assertions passed.`);

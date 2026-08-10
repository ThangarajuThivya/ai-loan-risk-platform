"use strict";

/**
 * Register write rules (L17).
 *   node src/services/__tests__/leaseRegister.test.js
 *
 * The load-bearing test in this file is "staff cannot set banking details".
 * Everything else here is convenience; that one is the separation of duties
 * that stops the person processing an application from also choosing the
 * account the purchase money is wired to. It is asserted three ways —
 * ignored on create, ignored on update, and NOT NULLED on update — because
 * the third is the failure mode that would look like a fix while quietly
 * wiping an admin's work.
 */

const assert = require("assert");
const {
  BANKING_FIELDS,
  PAYOUT_REQUIRED_FIELDS,
  canSetBanking,
  canChangeStatus,
  scrubSupplierWrite,
  scrubValuerWrite,
  describeSupplierReadiness,
} = require("../leaseRegister.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("leaseRegister.service — who may write what to the registers");

const FULL_BODY = {
  name: "Sandaru Motor Company (Pvt) Ltd",
  business_reg_no: "PV-84213",
  contact_person: "Dilan Wickramasinghe",
  phone: "0112345601",
  email: "sales@sandarumotors.lk",
  address: "No. 214, Nawala Road, Rajagiriya",
  bank_name: "Bank of Ceylon",
  bank_branch: "Rajagiriya",
  bank_account_no: "0000110022334",
  account_holder: "Sandaru Motor Company (Pvt) Ltd",
  status: "active",
};

/* ------------------------------------------------------------------ *
 * Role capabilities
 * ------------------------------------------------------------------ */

check("only admin may set banking details", () => {
  assert.strictEqual(canSetBanking("admin"), true);
  assert.strictEqual(canSetBanking("staff"), false);
  assert.strictEqual(canSetBanking("customer"), false);
  assert.strictEqual(canSetBanking(undefined), false);
});

check("only admin may suspend or reactivate", () => {
  assert.strictEqual(canChangeStatus("admin"), true);
  assert.strictEqual(canChangeStatus("staff"), false);
});

/* ------------------------------------------------------------------ *
 * Dealer creation
 * ------------------------------------------------------------------ */

check("admin creating a dealer keeps every field", () => {
  const { input, bankingOmitted } = scrubSupplierWrite({ body: FULL_BODY, role: "admin" });
  assert.strictEqual(bankingOmitted, false);
  assert.strictEqual(input.name, FULL_BODY.name);
  assert.strictEqual(input.bankName, "Bank of Ceylon");
  assert.strictEqual(input.bankBranch, "Rajagiriya");
  assert.strictEqual(input.bankAccountNo, "0000110022334");
  assert.strictEqual(input.accountHolder, FULL_BODY.account_holder);
});

check("staff creating a dealer keeps the identity", () => {
  const { input } = scrubSupplierWrite({ body: FULL_BODY, role: "staff" });
  assert.strictEqual(input.name, FULL_BODY.name);
  assert.strictEqual(input.businessRegNo, "PV-84213");
  assert.strictEqual(input.contactPerson, "Dilan Wickramasinghe");
  assert.strictEqual(input.phone, "0112345601");
  assert.strictEqual(input.email, "sales@sandarumotors.lk");
  assert.strictEqual(input.address, "No. 214, Nawala Road, Rajagiriya");
});

check("STAFF CANNOT SET BANKING DETAILS ON CREATE", () => {
  const { input, bankingOmitted } = scrubSupplierWrite({ body: FULL_BODY, role: "staff" });
  assert.strictEqual(bankingOmitted, true, "the omission must be reported, not silent");
  assert.strictEqual(input.bankName, null);
  assert.strictEqual(input.bankBranch, null);
  assert.strictEqual(input.bankAccountNo, null);
  assert.strictEqual(input.accountHolder, null);
});

check("a staff-created dealer is born unpayable", () => {
  // The whole point: the record exists so work can continue, but the L4.1
  // payout gate refuses it until an admin completes the banking.
  const { input } = scrubSupplierWrite({ body: FULL_BODY, role: "staff" });
  const stored = {
    bank_name: input.bankName,
    bank_account_no: input.bankAccountNo,
    account_holder: input.accountHolder,
  };
  assert.strictEqual(describeSupplierReadiness(stored).payable, false);
});

check("staff sending no banking fields is not flagged as an omission", () => {
  const { bankingOmitted } = scrubSupplierWrite({
    body: { name: "Ruhunu Auto Traders", phone: "0472345605" },
    role: "staff",
  });
  assert.strictEqual(bankingOmitted, false);
});

check("blank banking strings do not count as an attempted write", () => {
  const { bankingOmitted } = scrubSupplierWrite({
    body: { name: "X", bank_name: "", bank_account_no: "   ", account_holder: null },
    role: "staff",
  });
  assert.strictEqual(bankingOmitted, false);
});

check("staff cannot suspend a dealer at creation", () => {
  const { input, statusOmitted } = scrubSupplierWrite({
    body: { ...FULL_BODY, status: "suspended" },
    role: "staff",
  });
  assert.strictEqual(input.status, "active");
  assert.strictEqual(statusOmitted, true);
});

/* ------------------------------------------------------------------ *
 * Dealer update — the dangerous direction
 * ------------------------------------------------------------------ */

const EXISTING = {
  bank_name: "Commercial Bank of Ceylon",
  bank_branch: "Kiribathgoda",
  bank_account_no: "0000220033445",
  account_holder: "Lakvin Auto Lanka (Pvt) Ltd",
  status: "active",
};

check("a non-admin update PRESERVES stored banking rather than nulling it", () => {
  // This is the subtle one. The update path is "send the whole form", so a
  // narrower role posting a form it could not see all of would blank the
  // admin's work if the scrub simply set the fields to null.
  const { input } = scrubSupplierWrite({
    body: { name: "Lakvin Auto Lanka (Pvt) Ltd" },
    role: "staff",
    existing: EXISTING,
  });
  assert.strictEqual(input.bankName, "Commercial Bank of Ceylon");
  assert.strictEqual(input.bankBranch, "Kiribathgoda");
  assert.strictEqual(input.bankAccountNo, "0000220033445");
  assert.strictEqual(input.accountHolder, "Lakvin Auto Lanka (Pvt) Ltd");
});

check("a non-admin cannot REDIRECT an existing dealer's account", () => {
  const { input, bankingOmitted } = scrubSupplierWrite({
    body: { name: "Lakvin Auto Lanka (Pvt) Ltd", bank_account_no: "9999999999999" },
    role: "staff",
    existing: EXISTING,
  });
  assert.strictEqual(bankingOmitted, true);
  assert.strictEqual(input.bankAccountNo, "0000220033445");
});

check("an admin update may change banking", () => {
  const { input } = scrubSupplierWrite({
    body: { ...FULL_BODY, bank_account_no: "0000550066778" },
    role: "admin",
    existing: EXISTING,
  });
  assert.strictEqual(input.bankAccountNo, "0000550066778");
});

check("a non-admin update cannot flip status", () => {
  const { input, statusOmitted } = scrubSupplierWrite({
    body: { name: "X", status: "suspended" },
    role: "staff",
    existing: EXISTING,
  });
  assert.strictEqual(input.status, "active");
  assert.strictEqual(statusOmitted, true);
});

check("an admin may suspend", () => {
  const { input } = scrubSupplierWrite({
    body: { name: "X", status: "suspended" },
    role: "admin",
    existing: EXISTING,
  });
  assert.strictEqual(input.status, "suspended");
});

check("status defaults to the stored value, not to active", () => {
  // A suspended dealer edited by staff must stay suspended.
  const { input } = scrubSupplierWrite({
    body: { name: "X" },
    role: "staff",
    existing: { ...EXISTING, status: "suspended" },
  });
  assert.strictEqual(input.status, "suspended");
});

/* ------------------------------------------------------------------ *
 * Valuers
 * ------------------------------------------------------------------ */

check("staff may create a valuer outright", () => {
  const { input } = scrubValuerWrite({
    body: {
      name: "K. A. Sriyani Gunawardena",
      license_no: "IVSL/2016/1184",
      phone: "0771234501",
      email: "sriyani.valuations@gmail.com",
    },
    role: "staff",
  });
  assert.strictEqual(input.name, "K. A. Sriyani Gunawardena");
  assert.strictEqual(input.licenseNo, "IVSL/2016/1184");
  assert.strictEqual(input.phone, "0771234501");
  assert.strictEqual(input.email, "sriyani.valuations@gmail.com");
  assert.strictEqual(input.status, "active");
});

check("staff cannot suspend a valuer whose report they dislike", () => {
  const { input, statusOmitted } = scrubValuerWrite({
    body: { name: "M. T. Anuradha Silva", status: "suspended" },
    role: "staff",
    existing: { status: "active" },
  });
  assert.strictEqual(input.status, "active");
  assert.strictEqual(statusOmitted, true);
});

check("an admin may suspend a valuer", () => {
  const { input } = scrubValuerWrite({
    body: { name: "M. T. Anuradha Silva", status: "suspended" },
    role: "admin",
    existing: { status: "active" },
  });
  assert.strictEqual(input.status, "suspended");
});

/* ------------------------------------------------------------------ *
 * Payout readiness
 * ------------------------------------------------------------------ */

check("a fully banked dealer is payable with nothing missing", () => {
  const r = describeSupplierReadiness(EXISTING);
  assert.strictEqual(r.payable, true);
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.summary, null);
});

check("a missing branch does NOT block a payout", () => {
  // Deliberate: a transfer does not fail for want of a branch name, and
  // requiring it would block real money on a cosmetic gap.
  const r = describeSupplierReadiness({ ...EXISTING, bank_branch: null });
  assert.strictEqual(r.payable, true);
  assert.ok(!PAYOUT_REQUIRED_FIELDS.includes("bank_branch"));
  assert.ok(BANKING_FIELDS.includes("bank_branch"));
});

check("one missing field reads as a singular phrase", () => {
  const r = describeSupplierReadiness({ ...EXISTING, account_holder: "" });
  assert.strictEqual(r.payable, false);
  assert.deepStrictEqual(r.missing, ["account_holder"]);
  assert.strictEqual(r.summary, "Cannot be paid yet — missing account holder.");
});

check("several missing fields read as a list", () => {
  const r = describeSupplierReadiness({});
  assert.strictEqual(r.payable, false);
  assert.strictEqual(
    r.summary,
    "Cannot be paid yet — missing bank name, account number and account holder."
  );
});

check("whitespace is not a bank account", () => {
  const r = describeSupplierReadiness({ ...EXISTING, bank_account_no: "   " });
  assert.strictEqual(r.payable, false);
  assert.deepStrictEqual(r.missing, ["bank_account_no"]);
});

check("no dealer at all is reported, not crashed on", () => {
  const r = describeSupplierReadiness(null);
  assert.strictEqual(r.payable, false);
  assert.strictEqual(r.summary, "No dealer on record.");
});

console.log(`\n${passed} assertions passed.`);

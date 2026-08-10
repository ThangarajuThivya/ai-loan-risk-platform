"use strict";

/**
 * Rules governing writes to the two leasing registers (L17).
 *
 * Pure — no DB, no I/O — so the one rule that actually protects money can be
 * tested directly rather than inferred from an integration run.
 *
 * ---------------------------------------------------------------------------
 * WHY STAFF MAY CREATE A DEALER BUT NOT BANK ONE
 * ---------------------------------------------------------------------------
 * The registers were admin-write-only (044) for a good reason: the dealer is
 * the party the institution WIRES THE PURCHASE MONEY TO. Whoever controls
 * that record controls where the money lands, so an applicant must never be
 * able to influence it — which is still true and still enforced.
 *
 * But admin-only creation had a cost nobody priced in: a staff member sitting
 * with a live application whose dealer isn't on file has no move except to
 * stop and wait for an admin. Both registers currently hold ZERO rows, so in
 * practice every lease so far has been processed as "a private seller" with
 * an unassigned valuer — not because anyone chose that, but because it was
 * the only reachable state.
 *
 * The split below resolves that without reopening the fraud path:
 *
 *   VALUER   — staff may create outright. No money depends on a valuer, and
 *              their independence is evidenced by the licence number, which
 *              is checkable after the fact.
 *
 *   DEALER   — staff may create the IDENTITY (who they are, how to reach
 *              them) but never the BANKING. The record lands deliberately
 *              unpayable; leaseModel.supplierIsPayable() already gates the
 *              L4.1 payout on exactly those three fields, so an incomplete
 *              record cannot cause a payment, only a visible gap. An admin
 *              completes it before any money moves.
 *
 * The separation of duties is therefore preserved in the place it matters:
 * the person processing an application still cannot choose the account the
 * purchase money goes to.
 */

/**
 * The fields that decide where money lands. Admin-only on both create and
 * update. Named once here because the controller, the tests and the
 * readiness check below must all agree on the same list — the previous
 * arrangement had leaseModel.supplierIsPayable() encoding three of them
 * independently, which is a disagreement waiting to happen.
 */
const BANKING_FIELDS = Object.freeze([
  "bank_name",
  "bank_branch",
  "bank_account_no",
  "account_holder",
]);

/**
 * The subset of banking fields that must ALL be present before a payout is
 * allowed. bank_branch is excluded: it is useful for the payment advice but
 * a transfer does not fail without it, and requiring it would block payouts
 * on a cosmetic gap. Mirrors leaseModel.supplierIsPayable().
 */
const PAYOUT_REQUIRED_FIELDS = Object.freeze([
  "bank_name",
  "bank_account_no",
  "account_holder",
]);

const LABELS = Object.freeze({
  bank_name: "bank name",
  bank_branch: "branch",
  bank_account_no: "account number",
  account_holder: "account holder",
});

/** @returns {boolean} whether this role may set a dealer's banking details. */
function canSetBanking(role) {
  return role === "admin";
}

/** @returns {boolean} whether this role may suspend or reactivate a register entry. */
function canChangeStatus(role) {
  return role === "admin";
}

const blank = (v) => v === undefined || v === null || String(v).trim() === "";

/**
 * Normalise a dealer write into the shape leaseModel.createSupplier /
 * updateSupplier expect, dropping anything the caller's role may not set.
 *
 * Returns the omission as data rather than throwing: a staff member adding a
 * dealer mid-application has done nothing wrong, and the correct response is
 * to save the identity and tell them an admin still owes the banking — not
 * to reject the whole record and send them away.
 *
 * @param {object} p
 * @param {object} p.body   the request body (snake_case, as validated)
 * @param {string} p.role   the caller's role
 * @param {object} [p.existing]  current row, when updating
 * @returns {{input: object, bankingOmitted: boolean, statusOmitted: boolean}}
 */
function scrubSupplierWrite({ body = {}, role, existing = null }) {
  const input = {
    name: body.name,
    businessRegNo: body.business_reg_no ?? null,
    contactPerson: body.contact_person ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    address: body.address ?? null,
    bankName: body.bank_name ?? null,
    bankBranch: body.bank_branch ?? null,
    bankAccountNo: body.bank_account_no ?? null,
    accountHolder: body.account_holder ?? null,
    status: body.status || existing?.status || "active",
  };

  let bankingOmitted = false;
  if (!canSetBanking(role)) {
    // A non-admin sending banking fields is not an error to report back —
    // the UI does not offer them — but they are silently discarded, and on
    // an update the STORED values are preserved rather than nulled. Reusing
    // the same "send the whole form" update path with a narrower role must
    // never blank out fields the caller was not allowed to see.
    bankingOmitted = BANKING_FIELDS.some((f) => !blank(body[f]));
    input.bankName = existing?.bank_name ?? null;
    input.bankBranch = existing?.bank_branch ?? null;
    input.bankAccountNo = existing?.bank_account_no ?? null;
    input.accountHolder = existing?.account_holder ?? null;
  }

  let statusOmitted = false;
  if (!canChangeStatus(role)) {
    statusOmitted = Boolean(body.status) && body.status !== (existing?.status || "active");
    input.status = existing?.status || "active";
  }

  return { input, bankingOmitted, statusOmitted };
}

/**
 * Same idea for valuers, which have no money-bearing fields — only the
 * status flip is admin-owned, so staff cannot quietly suspend a valuer whose
 * report they dislike.
 */
function scrubValuerWrite({ body = {}, role, existing = null }) {
  const input = {
    name: body.name,
    licenseNo: body.license_no ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    status: body.status || existing?.status || "active",
  };

  let statusOmitted = false;
  if (!canChangeStatus(role)) {
    statusOmitted = Boolean(body.status) && body.status !== (existing?.status || "active");
    input.status = existing?.status || "active";
  }

  return { input, statusOmitted };
}

/**
 * "Can this dealer actually be paid, and if not, what is missing?"
 *
 * The boolean alone (leaseModel.supplierIsPayable) is enough to gate the
 * payout, but not enough to fix it — an admin looking at a blocked lease
 * needs to know WHICH field is absent. Returned to the admin register so the
 * gap is visible long before an approved lease is stuck waiting on it.
 *
 * @param {object} supplier
 * @returns {{payable: boolean, missing: string[], summary: string|null}}
 */
function describeSupplierReadiness(supplier) {
  if (!supplier) return { payable: false, missing: [], summary: "No dealer on record." };

  const missing = PAYOUT_REQUIRED_FIELDS.filter((f) => blank(supplier[f]));
  if (missing.length === 0) return { payable: true, missing: [], summary: null };

  const names = missing.map((f) => LABELS[f]);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    payable: false,
    missing,
    summary: `Cannot be paid yet — missing ${list}.`,
  };
}

module.exports = {
  BANKING_FIELDS,
  PAYOUT_REQUIRED_FIELDS,
  canSetBanking,
  canChangeStatus,
  scrubSupplierWrite,
  scrubValuerWrite,
  describeSupplierReadiness,
};

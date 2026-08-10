"use strict";

/**
 * Leasing reference data (L1.2/044) — the approved dealer and valuer
 * registers, both admin-owned.
 *
 * Kept out of loanModel.js deliberately. These are standing counterparties
 * that exist independently of any application, the way loan_products do —
 * not per-application facts. loanModel.js is already ~2,800 lines of
 * application lifecycle, and appending two CRUD registers to it would blur
 * that boundary for no benefit.
 *
 * NEITHER REGISTER SUPPORTS DELETION, only suspension. A supplier is
 * referenced by lease_vehicles and a valuer by vehicle_valuations, and the
 * historical record of who supplied or valued a vehicle has to outlive the
 * commercial relationship — the same reasoning that makes guarantors (033)
 * undeletable.
 */

// config/db exports the CALLBACK pool; .promise() is what every other model
// in this codebase awaits against (see loanModel.js line 39).
const pool = require("../config/db").promise();

/* ------------------------------------------------------------------ *
 * Suppliers (approved dealers)
 * ------------------------------------------------------------------ */

/**
 * @param {object} [opts]
 * @param {boolean} [opts.activeOnly] restrict to dealers still trading with us
 * @returns {Promise<object[]>}
 */
async function listSuppliers({ activeOnly = false } = {}) {
  const [rows] = await pool.query(
    `SELECT s.*,
            (SELECT COUNT(*) FROM lease_vehicles v WHERE v.supplier_id = s.id)
              AS vehicle_count
       FROM lease_suppliers s
      ${activeOnly ? "WHERE s.status = 'active'" : ""}
      ORDER BY s.name ASC`
  );
  return rows;
}

async function findSupplierById(id) {
  const [rows] = await pool.query(`SELECT * FROM lease_suppliers WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function createSupplier({
  name,
  businessRegNo,
  contactPerson,
  phone,
  email,
  address,
  bankName,
  bankBranch,
  bankAccountNo,
  accountHolder,
  createdBy,
}) {
  const [result] = await pool.query(
    `INSERT INTO lease_suppliers
       (name, business_reg_no, contact_person, phone, email, address,
        bank_name, bank_branch, bank_account_no, account_holder, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      businessRegNo ?? null,
      contactPerson ?? null,
      phone ?? null,
      email ?? null,
      address ?? null,
      bankName ?? null,
      bankBranch ?? null,
      bankAccountNo ?? null,
      accountHolder ?? null,
      createdBy ?? null,
    ]
  );
  return findSupplierById(result.insertId);
}

/**
 * Full replace of the editable fields, matching the "send the whole form"
 * convention the product endpoints already use rather than a partial patch.
 */
async function updateSupplier(
  id,
  {
    name,
    businessRegNo,
    contactPerson,
    phone,
    email,
    address,
    bankName,
    bankBranch,
    bankAccountNo,
    accountHolder,
    status,
  }
) {
  await pool.query(
    `UPDATE lease_suppliers
        SET name = ?, business_reg_no = ?, contact_person = ?, phone = ?,
            email = ?, address = ?, bank_name = ?, bank_branch = ?,
            bank_account_no = ?, account_holder = ?, status = ?
      WHERE id = ?`,
    [
      name,
      businessRegNo ?? null,
      contactPerson ?? null,
      phone ?? null,
      email ?? null,
      address ?? null,
      bankName ?? null,
      bankBranch ?? null,
      bankAccountNo ?? null,
      accountHolder ?? null,
      status || "active",
      id,
    ]
  );
  return findSupplierById(id);
}

/**
 * A dealer cannot be paid without somewhere to send the money. L4.1 gates
 * the payout on this, but the admin UI surfaces it much earlier so the gap
 * is found before an approved lease is sitting waiting on it.
 *
 * @param {object} supplier
 * @returns {boolean}
 */
function supplierIsPayable(supplier) {
  return Boolean(
    supplier && supplier.bank_name && supplier.bank_account_no && supplier.account_holder
  );
}

/* ------------------------------------------------------------------ *
 * Valuers
 * ------------------------------------------------------------------ */

async function listValuers({ activeOnly = false } = {}) {
  const [rows] = await pool.query(
    `SELECT v.*,
            (SELECT COUNT(*) FROM vehicle_valuations vv WHERE vv.valuer_id = v.id)
              AS valuation_count
       FROM lease_valuers v
      ${activeOnly ? "WHERE v.status = 'active'" : ""}
      ORDER BY v.name ASC`
  );
  return rows;
}

async function findValuerById(id) {
  const [rows] = await pool.query(`SELECT * FROM lease_valuers WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function createValuer({ name, licenseNo, phone, email, createdBy }) {
  const [result] = await pool.query(
    `INSERT INTO lease_valuers (name, license_no, phone, email, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [name, licenseNo ?? null, phone ?? null, email ?? null, createdBy ?? null]
  );
  return findValuerById(result.insertId);
}

async function updateValuer(id, { name, licenseNo, phone, email, status }) {
  await pool.query(
    `UPDATE lease_valuers
        SET name = ?, license_no = ?, phone = ?, email = ?, status = ?
      WHERE id = ?`,
    [name, licenseNo ?? null, phone ?? null, email ?? null, status || "active", id]
  );
  return findValuerById(id);
}

module.exports = {
  listSuppliers,
  findSupplierById,
  createSupplier,
  updateSupplier,
  supplierIsPayable,
  listValuers,
  findValuerById,
  createValuer,
  updateValuer,
};

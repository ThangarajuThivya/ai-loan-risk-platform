"use strict";

/**
 * Leasing reference-data admin (L1.2) — the approved dealer and valuer
 * registers.
 *
 * Separate from loan.controller.js, which is already ~2,900 lines of
 * application lifecycle. These endpoints administer standing counterparties,
 * not applications, and the two have no logic in common.
 *
 * READ is admin+staff. WRITE was originally admin-only; as of L17 staff may
 * ALSO create an entry — but only the parts of one that carry no money. The
 * rules live in services/leaseRegister.service.js, which explains why, and
 * the routes admit both roles so the controller (not the router) can apply
 * the narrower rule. In short: staff may add a valuer outright and a dealer's
 * identity, but only an admin may set a dealer's banking details or suspend
 * anyone. Editing an existing entry stays admin-only.
 *
 * There is NO DELETE on either register, only a status flip to 'suspended'.
 * Suppliers are referenced by lease_vehicles and valuers by
 * vehicle_valuations, and who supplied or valued a vehicle has to remain
 * answerable years later — the same reasoning that makes guarantors (033)
 * undeletable.
 */

const { validationResult } = require("express-validator");
const leaseModel = require("../models/leaseModel");
const leaseRegister = require("../services/leaseRegister.service");

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  return true;
}

/* ------------------------------------------------------------------ *
 * Suppliers
 * ------------------------------------------------------------------ */

// GET /api/admin/lease/suppliers
exports.listSuppliers = async (req, res) => {
  try {
    const suppliers = await leaseModel.listSuppliers({
      activeOnly: req.query.active === "true",
    });
    // payable is computed, not stored: "can this dealer actually be paid?"
    // is a question about completeness of their banking details, and
    // answering it here means the admin list shows the gap long before an
    // approved lease is stuck waiting on it at L4.1. `readiness` carries the
    // same verdict plus WHICH field is missing, because a boolean tells an
    // admin there is a problem but not how to fix it.
    //
    // Staff get the list without banking details at all. They need to know
    // who is approved and whether a dealer is payable; they have no business
    // reading the account number, and L17 lets them create a dealer, so the
    // projection has to be narrow in both directions.
    const isAdmin = req.user.role === "admin";
    return res.status(200).json({
      suppliers: suppliers.map((s) => {
        const readiness = leaseRegister.describeSupplierReadiness(s);
        const row = { ...s, payable: readiness.payable, readiness };
        if (!isAdmin) {
          for (const f of leaseRegister.BANKING_FIELDS) delete row[f];
        }
        return row;
      }),
    });
  } catch (err) {
    console.error("LIST LEASE SUPPLIERS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch dealers." });
  }
};

// POST /api/admin/lease/suppliers
exports.createSupplier = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const { input, bankingOmitted } = leaseRegister.scrubSupplierWrite({
      body: req.body,
      role: req.user.role,
    });
    const supplier = await leaseModel.createSupplier({
      ...input,
      createdBy: req.user.user_id,
    });
    const readiness = leaseRegister.describeSupplierReadiness(supplier);
    return res.status(201).json({
      supplier: { ...supplier, payable: readiness.payable, readiness },
      // Told plainly rather than left implicit. A staff member who has just
      // added a dealer needs to know the record is not yet payable and why,
      // otherwise the lease stalls at the payout step with no explanation.
      notice: bankingOmitted || !readiness.payable ? readiness.summary : null,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "A dealer with that name already exists." });
    }
    console.error("CREATE LEASE SUPPLIER ERROR:", err);
    return res.status(500).json({ message: "Failed to create the dealer." });
  }
};

// PUT /api/admin/lease/suppliers/:id
exports.updateSupplier = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const existing = await leaseModel.findSupplierById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Dealer not found." });

    const { input } = leaseRegister.scrubSupplierWrite({
      body: req.body,
      role: req.user.role,
      existing,
    });
    const supplier = await leaseModel.updateSupplier(req.params.id, input);
    const readiness = leaseRegister.describeSupplierReadiness(supplier);
    return res
      .status(200)
      .json({ supplier: { ...supplier, payable: readiness.payable, readiness } });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "A dealer with that name already exists." });
    }
    console.error("UPDATE LEASE SUPPLIER ERROR:", err);
    return res.status(500).json({ message: "Failed to update the dealer." });
  }
};

/* ------------------------------------------------------------------ *
 * Valuers
 * ------------------------------------------------------------------ */

// GET /api/admin/lease/valuers
exports.listValuers = async (req, res) => {
  try {
    const valuers = await leaseModel.listValuers({ activeOnly: req.query.active === "true" });
    return res.status(200).json({ valuers });
  } catch (err) {
    console.error("LIST LEASE VALUERS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch valuers." });
  }
};

// POST /api/admin/lease/valuers
exports.createValuer = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const { input } = leaseRegister.scrubValuerWrite({ body: req.body, role: req.user.role });
    const valuer = await leaseModel.createValuer({ ...input, createdBy: req.user.user_id });
    return res.status(201).json({ valuer });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "A valuer with that name and licence number already exists." });
    }
    console.error("CREATE LEASE VALUER ERROR:", err);
    return res.status(500).json({ message: "Failed to create the valuer." });
  }
};

// PUT /api/admin/lease/valuers/:id
exports.updateValuer = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const existing = await leaseModel.findValuerById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Valuer not found." });

    const { input } = leaseRegister.scrubValuerWrite({
      body: req.body,
      role: req.user.role,
      existing,
    });
    const valuer = await leaseModel.updateValuer(req.params.id, input);
    return res.status(200).json({ valuer });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ message: "A valuer with that name and licence number already exists." });
    }
    console.error("UPDATE LEASE VALUER ERROR:", err);
    return res.status(500).json({ message: "Failed to update the valuer." });
  }
};

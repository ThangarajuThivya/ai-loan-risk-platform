"use strict";

/**
 * Lease vehicle intake rules (L2.1) — turning what the applicant sent into
 * what the model stores, and refusing what cannot be underwritten.
 *
 * Pure: no DB, no I/O.
 *
 * Unlike the first (reverted) version of this file, nothing here consults a
 * product type. A lease application always has a vehicle — that is what
 * makes it a lease — so this validates unconditionally rather than asking
 * whether a vehicle happens to be required.
 *
 * THE DOWN PAYMENT IS NOT VALIDATED HERE. It is derived from the vehicle
 * price and the financed amount by leasing.service.resolveDownPayment, and
 * judged against the condition's minimum by the caller. This module only
 * establishes that the vehicle itself is coherent and that its price leaves
 * room for a down payment at all.
 */

const { VEHICLE_CONDITIONS } = require("./leasing.service");

const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric", "other"];
const TRANSMISSIONS = ["manual", "automatic"];

// Older than this is a typo, not a classic someone is leasing.
const EARLIEST_MANUFACTURE_YEAR = 1950;

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function trimOrNull(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Map the snake_case request body onto the camelCase parameters
 * leaseApplication.model expects.
 *
 * @param {object} raw req.body.vehicle
 * @returns {object|null}
 */
function normalizeVehicleInput(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    supplierId: toNumberOrNull(raw.supplier_id),
    conditionType: trimOrNull(raw.condition_type),
    make: trimOrNull(raw.make),
    model: trimOrNull(raw.model),
    yearOfManufacture: toNumberOrNull(raw.year_of_manufacture),
    registrationNo: trimOrNull(raw.registration_no),
    chassisNo: trimOrNull(raw.chassis_no),
    engineNo: trimOrNull(raw.engine_no),
    fuelType: trimOrNull(raw.fuel_type),
    transmission: trimOrNull(raw.transmission),
    mileageKm: toNumberOrNull(raw.mileage_km),
    invoicePrice: toNumberOrNull(raw.invoice_price),
    invoiceNo: trimOrNull(raw.invoice_no),
    invoiceDate: trimOrNull(raw.invoice_date),
  };
}

/**
 * Every problem with the vehicle, at once.
 *
 * Returns a list rather than throwing on the first fault, so an applicant
 * fixing one field per round trip does not have to submit a long form six
 * times to discover six problems.
 *
 * @param {object|null} vehicle normalizeVehicleInput output
 * @param {object} ctx
 * @param {number} ctx.financedAmount
 * @returns {string[]}
 */
function validateLeaseVehicle(vehicle, { financedAmount } = {}) {
  const errors = [];

  if (!vehicle) {
    errors.push("Vehicle details are required for a lease application.");
    return errors;
  }

  if (!vehicle.conditionType || !VEHICLE_CONDITIONS.includes(vehicle.conditionType)) {
    errors.push(`vehicle.condition_type must be one of: ${VEHICLE_CONDITIONS.join(", ")}.`);
  }
  if (!vehicle.make) errors.push("vehicle.make is required.");
  if (!vehicle.model) errors.push("vehicle.model is required.");

  const currentYear = new Date().getFullYear();
  if (
    !Number.isInteger(vehicle.yearOfManufacture) ||
    vehicle.yearOfManufacture < EARLIEST_MANUFACTURE_YEAR ||
    // +1 because next-year models genuinely go on sale this year.
    vehicle.yearOfManufacture > currentYear + 1
  ) {
    errors.push(
      `vehicle.year_of_manufacture must be between ${EARLIEST_MANUFACTURE_YEAR} and ${currentYear + 1}.`
    );
  }

  if (vehicle.fuelType && !FUEL_TYPES.includes(vehicle.fuelType)) {
    errors.push(`vehicle.fuel_type must be one of: ${FUEL_TYPES.join(", ")}.`);
  }
  if (vehicle.transmission && !TRANSMISSIONS.includes(vehicle.transmission)) {
    errors.push(`vehicle.transmission must be one of: ${TRANSMISSIONS.join(", ")}.`);
  }

  // An already-registered vehicle must say so: this is the number the CR
  // hypothecation is recorded against, and chasing it after the institution
  // has already bought the vehicle is far harder than asking now.
  if (vehicle.conditionType === "used" && !vehicle.registrationNo) {
    errors.push("vehicle.registration_no is required for a used vehicle.");
  }

  const price = vehicle.invoicePrice;
  if (price === null || price <= 0) {
    errors.push("vehicle.invoice_price must be a positive amount.");
    return errors;
  }

  // A lease finances less than the asset costs — the gap is the down
  // payment. Financing the whole price is not a lease this institution
  // writes, and financing MORE than the price is not a thing at all.
  if (financedAmount !== undefined && !(Number(financedAmount) < price)) {
    errors.push(
      "The amount financed must be less than the vehicle price — a lease requires a down payment."
    );
  }

  return errors;
}

module.exports = {
  FUEL_TYPES,
  TRANSMISSIONS,
  EARLIEST_MANUFACTURE_YEAR,
  normalizeVehicleInput,
  validateLeaseVehicle,
};

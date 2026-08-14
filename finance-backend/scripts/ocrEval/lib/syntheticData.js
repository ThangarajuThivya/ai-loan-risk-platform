"use strict";

/**
 * Synthetic Sri Lankan document field values — no real applicant data is
 * used anywhere in this generator, consistent with how
 * loan-risk-model/src/data_generator.py produces its training rows (see
 * OCR_FEATURE.md §evaluation methodology, ARCHITECTURE.md §7.1). Every
 * value here is either drawn from a small closed list of plausible-looking
 * but fictitious names/institutions, or built arithmetically (NIC day-of-
 * year encoding, LKR amounts) from the seeded PRNG.
 */

const { randInt, pick } = require("./prng");

const FIRST_NAMES = [
  "Nimal", "Sunil", "Kamal", "Priyantha", "Chaminda", "Ruwan", "Ashan",
  "Dilani", "Nadeeka", "Sanduni", "Kumari", "Malithi", "Thilini", "Anusha",
];
const LAST_NAMES = [
  "Perera", "Fernando", "Silva", "Jayasuriya", "Bandara", "Wickramasinghe",
  "Rathnayake", "Gunawardena", "Karunaratne", "Dissanayake",
];

const BANK_NAMES = [
  "Bank of Ceylon",
  "People's Bank",
  "Commercial Bank of Ceylon PLC",
  "Hatton National Bank",
  "Sampath Bank",
  "National Development Bank",
  "National Savings Bank",
  "Seylan Bank",
  "DFCC Bank",
  "Nations Trust Bank",
];

const VEHICLE_MAKES_MODELS = [
  ["Toyota", "Prius"],
  ["Toyota", "Aqua"],
  ["Honda", "Vezel"],
  ["Honda", "Fit"],
  ["Nissan", "Leaf"],
  ["Suzuki", "Alto"],
  ["Micro", "Panda"],
];

function randomFullName(rng) {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

/**
 * Build a structurally-valid old-format NIC (9 digits + V/X) whose
 * day-of-year and birth year satisfy nicValidation.service.js#parseNic:
 * birth year in the past, applicant well over 18, day-of-year in range.
 * Female NICs encode dayOfYear + 500, per the same module.
 */
function randomNic(rng, gender) {
  const yy = randInt(rng, 60, 99); // 1960-1999 — always well past 18 today
  const dayOfYear = randInt(rng, 1, 300); // avoid Dec 31 leap-year edge cases
  const dayCode = gender === "female" ? dayOfYear + 500 : dayOfYear;
  const serial = String(randInt(rng, 0, 9999)).padStart(4, "0");
  const letter = pick(rng, ["V", "X"]);
  return `${String(yy).padStart(2, "0")}${String(dayCode).padStart(3, "0")}${serial}${letter}`;
}

/** VIN-style chassis number — 17 uppercase alphanumerics, no I/O/Q (as on real VINs). */
function randomChassisNumber(rng) {
  const alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 17; i += 1) {
    out += alphabet[randInt(rng, 0, alphabet.length - 1)];
  }
  return out;
}

function randomRegistrationNumber(rng) {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const prefix = `${letters[randInt(rng, 0, letters.length - 1)]}${letters[randInt(rng, 0, letters.length - 1)]}`;
  const digits = String(randInt(rng, 1000, 9999));
  return `${prefix}-${digits}`;
}

function randomAccountNumber(rng) {
  let out = "";
  for (let i = 0; i < randInt(rng, 10, 12); i += 1) out += String(randInt(rng, 0, 9));
  return out;
}

/** LKR amount as a plain number (ground truth) — callers format for display separately. */
function randomAmount(rng, min, max) {
  return Math.round(randInt(rng, min, max) / 50) * 50;
}

function formatLkr(amount) {
  return `Rs. ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function randomDate(rng, yearFrom, yearTo) {
  const year = randInt(rng, yearFrom, yearTo);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

module.exports = {
  FIRST_NAMES,
  LAST_NAMES,
  BANK_NAMES,
  VEHICLE_MAKES_MODELS,
  randomFullName,
  randomNic,
  randomChassisNumber,
  randomRegistrationNumber,
  randomAccountNumber,
  randomAmount,
  formatLkr,
  randomDate,
};

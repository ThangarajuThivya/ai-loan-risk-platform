"use strict";

/**
 * Sri Lankan NIC parsing & validation — pure, deterministic. No DB, no I/O,
 * no OCR. Mirrors loanDocument.service.js's role: a small closed set of
 * parsing/validation rules that needs to be unit-testable without any
 * external dependency.
 *
 * Scope is intentionally limited to what is actually checkable from the
 * public NIC number layout:
 *   - structural validation (format, digit counts)
 *   - day-of-year range validation
 *   - derived date of birth
 *   - derived gender
 *   - cross-checking derived DOB/gender against declared applicant data
 *
 * The old-format NIC's trailing V/X is a voter/non-voter marker, not a
 * check digit — there is no publicly citable check-digit algorithm for
 * either NIC format, so none is implemented or claimed here.
 */

const OLD_FORMAT_RE = /^\d{9}[VX]$/;
const NEW_FORMAT_RE = /^\d{12}$/;

/**
 * @param {string} raw
 * @returns {string} raw with spaces/dashes stripped and the trailing letter
 *   (old-format only) uppercased.
 */
function normalizeNic(raw) {
  return String(raw || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

/** Zero-pad an integer to `width` digits for YYYY-MM-DD assembly. */
function pad(n, width) {
  return String(n).padStart(width, "0");
}

/** Convert a (year, dayOfYear) pair into a "YYYY-MM-DD" string. Assumes dayOfYear is already range-checked against the year's length. */
function dayOfYearToIsoDate(year, dayOfYear) {
  const monthLengths = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  let remaining = dayOfYear;
  for (let month = 0; month < 12; month += 1) {
    if (remaining <= monthLengths[month]) {
      return `${pad(year, 4)}-${pad(month + 1, 2)}-${pad(remaining, 2)}`;
    }
    remaining -= monthLengths[month];
  }
  return null;
}

/**
 * Parse and validate a Sri Lankan NIC number (old 9-digit+letter or new
 * 12-digit format).
 * @param {string} raw
 * @returns {{format: 'old'|'new'|null, birthYear: number|null, dayOfYear: number|null, gender: 'male'|'female'|null, dateOfBirth: string|null, serial: string|null, valid: boolean, errors: string[]}}
 */
function parseNic(raw) {
  const errors = [];
  const normalized = normalizeNic(raw);

  const result = {
    format: null,
    birthYear: null,
    dayOfYear: null,
    gender: null,
    dateOfBirth: null,
    serial: null,
    valid: false,
    errors,
  };

  let format = null;
  let birthYear = null;
  let dayOfYearRaw = null;
  let serial = null;

  if (OLD_FORMAT_RE.test(normalized)) {
    format = "old";
    birthYear = 1900 + parseInt(normalized.slice(0, 2), 10);
    dayOfYearRaw = parseInt(normalized.slice(2, 5), 10);
    serial = normalized.slice(5, 9);
  } else if (NEW_FORMAT_RE.test(normalized)) {
    format = "new";
    birthYear = parseInt(normalized.slice(0, 4), 10);
    dayOfYearRaw = parseInt(normalized.slice(4, 7), 10);
    serial = normalized.slice(7, 12);
  } else {
    errors.push("invalid_format");
    return result;
  }

  result.format = format;
  result.serial = serial;
  result.birthYear = birthYear;

  let gender = null;
  let dayOfYear = null;
  if (dayOfYearRaw >= 1 && dayOfYearRaw <= 366) {
    gender = "male";
    dayOfYear = dayOfYearRaw;
  } else if (dayOfYearRaw >= 501 && dayOfYearRaw <= 866) {
    gender = "female";
    dayOfYear = dayOfYearRaw - 500;
  } else {
    errors.push("day_of_year_out_of_range");
  }

  const currentYear = new Date().getUTCFullYear();
  if (birthYear > currentYear) {
    errors.push("birth_year_in_future");
  }

  if (gender && dayOfYear > daysInYear(birthYear)) {
    errors.push("day_of_year_invalid_for_year");
    gender = null;
    dayOfYear = null;
  }

  result.gender = gender;
  result.dayOfYear = dayOfYear;

  if (gender && dayOfYear && birthYear <= currentYear) {
    const dob = dayOfYearToIsoDate(birthYear, dayOfYear);
    result.dateOfBirth = dob;

    if (dob) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const eighteenthBirthdayIso = `${pad(birthYear + 18, 4)}-${dob.slice(5)}`;
      if (eighteenthBirthdayIso > todayIso) {
        errors.push("applicant_under_18");
      }
    }
  }

  result.valid = errors.length === 0;
  return result;
}

/**
 * Cross-check a NIC's derived date of birth / gender against applicant-
 * declared values.
 * @param {string} nic
 * @param {{declaredDob?: string, declaredGender?: string}} declared
 * @returns {{valid: boolean, dobMismatch: boolean, genderMismatch: boolean, parsed: object}}
 */
function crossCheckNic(nic, { declaredDob, declaredGender } = {}) {
  const parsed = parseNic(nic);

  if (!parsed.valid) {
    return { valid: false, dobMismatch: false, genderMismatch: false, parsed };
  }

  const dobMismatch = Boolean(
    declaredDob && parsed.dateOfBirth && String(declaredDob).slice(0, 10) !== parsed.dateOfBirth
  );
  const genderMismatch = Boolean(
    declaredGender &&
      parsed.gender &&
      String(declaredGender).toLowerCase() !== parsed.gender
  );

  return {
    valid: !dobMismatch && !genderMismatch,
    dobMismatch,
    genderMismatch,
    parsed,
  };
}

module.exports = {
  normalizeNic,
  parseNic,
  crossCheckNic,
};

"use strict";

/**
 * Loan calendar arithmetic — pure, deterministic. No DB, no I/O.
 *
 * Works entirely in UTC and returns YYYY-MM-DD strings, because these values
 * land in MySQL DATE columns. Doing the arithmetic with local-time Date
 * methods would let the server's timezone shift a due date across midnight
 * and quietly move someone's repayment day by one.
 *
 * See migration 025 for why the derived dates are STORED on the account
 * rather than recomputed on every read.
 */

/** Parse a Date | 'YYYY-MM-DD' | timestamp into UTC y/m/d parts. */
function toUtcParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Days in a given UTC month (month is 0-based). */
function daysInMonth(year, month) {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Format UTC parts as the YYYY-MM-DD MySQL expects for a DATE column. */
function formatDate(year, month, day) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/**
 * Add whole months to a date, CLAMPING to the end of the target month.
 *
 * This is the part that bites: JavaScript's own Date rolls overflow forward,
 * so 31 Jan + 1 month gives 3 March (or 2 March in a leap year) rather than
 * the last day of February. For a repayment calendar that is simply wrong —
 * a loan drawn on the 31st must fall due on the 28th/29th/30th, not skip
 * into the following month and shift every subsequent instalment.
 *
 * @param {Date|string|number} from
 * @param {number} months whole months to add (may be 0)
 * @returns {string} YYYY-MM-DD
 */
function addMonths(from, months) {
  if (!Number.isInteger(months)) {
    throw new Error("months must be a whole number");
  }
  const { year, month, day } = toUtcParts(from);

  const absolute = year * 12 + month + months;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = ((absolute % 12) + 12) % 12;

  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return formatDate(targetYear, targetMonth, clampedDay);
}

/**
 * The repayment calendar for a loan drawn down on `disbursedAt`.
 *
 * Convention: the first instalment falls one month after drawdown, and the
 * last falls `tenureMonths` after it — so maturity is also the final due
 * date, and there are exactly `tenureMonths` instalments.
 *
 * @param {object} p
 * @param {Date|string|number} p.disbursedAt
 * @param {number} p.tenureMonths must be >= 1
 * @returns {{firstDueDate:string, maturityDate:string}} both YYYY-MM-DD
 */
function deriveAccountDates({ disbursedAt, tenureMonths }) {
  if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
    throw new Error("tenureMonths must be a whole number of at least 1");
  }
  return {
    firstDueDate: addMonths(disbursedAt, 1),
    maturityDate: addMonths(disbursedAt, tenureMonths),
  };
}

module.exports = { addMonths, deriveAccountDates };

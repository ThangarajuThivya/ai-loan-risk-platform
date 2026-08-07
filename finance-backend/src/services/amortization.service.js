"use strict";

/**
 * Amortization schedule generation — pure, deterministic. No DB, no I/O.
 *
 * Turns an account's terms into the row-by-row repayment calendar
 * (migration 026): due date, opening balance, principal/interest split,
 * closing balance, for every installment. Called once at drawdown
 * (loanModel.createAccountWithin) and the result is stored, never
 * recomputed — see that migration's header for why.
 *
 * Reducing and flat loans are genuinely different schedules, not the same
 * loop with a different interest number:
 *
 *   reducing — interest is charged on the OUTSTANDING balance each month,
 *              so it shrinks every installment as principal is paid down.
 *              The EMI is fixed (recommendation.service.js computeEmi);
 *              what varies month to month is the principal/interest split.
 *
 *   flat     — interest is charged on the ORIGINAL principal for the whole
 *              term (recommendation.service.js computeFlatEmi), so both the
 *              interest AND principal portions are constant every month.
 *              "closing balance" here still tracks OUTSTANDING PRINCIPAL,
 *              declining evenly — that's what "flat" describes: interest
 *              that doesn't reduce with it, not a balance that doesn't move.
 *
 * ROUNDING: every row is rounded to 2dp as it's produced, which means naive
 * per-row rounding can leave the schedule a cent or two short of (or over)
 * the true principal/interest total by the final row. Both branches below
 * force the LAST installment to absorb that residual — its principal
 * component is exactly "whatever balance remains" (so closing_balance is
 * exactly 0.00, never -0.01 or 0.01), and for flat loans its interest
 * component is "whatever interest remains" against the total (so the sum of
 * interest across all rows exactly equals the flat-rate total, not an
 * accumulation of independently-rounded fractions). This is standard
 * lending practice — a real amortization table's final payment is very
 * rarely bit-identical to the others.
 */

const { addMonths } = require("./loanSchedule.service");

/** Round money to 2dp without accumulating binary-float drift. */
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Reducing-balance schedule. EMI is fixed (equal to `emi`, the value already
 * stored on the account); the balance and the principal/interest split move.
 */
function buildReducingSchedule({ principal, tenureMonths, annualRatePct, emi }) {
  const r = annualRatePct / 12 / 100;
  const rows = [];
  let balance = round2(principal);

  for (let i = 1; i <= tenureMonths; i++) {
    const opening = balance;
    const interest = round2(opening * r);
    const isLast = i === tenureMonths;
    // Every row but the last pays down by (emi − interest); the last row
    // pays down whatever is actually left, so closing balance lands on
    // exactly 0 regardless of rounding drift accumulated earlier.
    const principalComponent = isLast ? opening : round2(emi - interest);
    const closing = isLast ? 0 : round2(opening - principalComponent);

    rows.push({
      installmentNo: i,
      openingBalance: opening,
      principalComponent,
      interestComponent: interest,
      // The last row's own EMI is principal+interest, which may differ
      // from the nominal `emi` by a cent — that cent IS the rounding
      // residual being absorbed, not a bug.
      emi: isLast ? round2(principalComponent + interest) : round2(emi),
      closingBalance: closing,
    });

    balance = closing;
  }
  return rows;
}

/**
 * Flat-rate schedule. Both principal and interest are constant per month
 * (before the final-row correction) — see computeFlatEmi for the same
 * total-interest formula this schedule must reconcile against.
 */
function buildFlatSchedule({ principal, tenureMonths, annualRatePct }) {
  const totalInterest = round2(principal * (annualRatePct / 100) * (tenureMonths / 12));
  const interestPerMonth = round2(totalInterest / tenureMonths);
  const principalPerMonth = round2(principal / tenureMonths);

  const rows = [];
  let balance = round2(principal);
  let interestPaid = 0;

  for (let i = 1; i <= tenureMonths; i++) {
    const opening = balance;
    const isLast = i === tenureMonths;
    // Last row: principal absorbs whatever balance remains (closing = 0);
    // interest absorbs whatever's left of totalInterest, so the column
    // sums to exactly totalInterest rather than tenureMonths independently
    // rounded fractions that may not add back up.
    const principalComponent = isLast ? opening : principalPerMonth;
    const interestComponent = isLast ? round2(totalInterest - interestPaid) : interestPerMonth;
    const closing = isLast ? 0 : round2(opening - principalComponent);

    rows.push({
      installmentNo: i,
      openingBalance: opening,
      principalComponent,
      interestComponent,
      emi: round2(principalComponent + interestComponent),
      closingBalance: closing,
    });

    balance = closing;
    interestPaid = round2(interestPaid + interestComponent);
  }
  return rows;
}

/**
 * Build the full amortization schedule for an account.
 *
 * @param {object} p
 * @param {number} p.principal
 * @param {number} p.tenureMonths must be >= 1
 * @param {number} p.annualRatePct
 * @param {string} p.rateType 'reducing' | 'flat'
 * @param {number} p.emi the account's stored EMI — used as the fixed
 *   instalment for reducing loans; ignored for flat (recomputed here from
 *   the same formula computeFlatEmi uses, so the two never drift apart).
 * @param {Date|string|number} p.firstDueDate the account's first_due_date
 * @returns {Array<{installmentNo:number, dueDate:string, openingBalance:number,
 *   principalComponent:number, interestComponent:number, emi:number,
 *   closingBalance:number}>}
 */
function buildAmortizationSchedule({
  principal,
  tenureMonths,
  annualRatePct,
  rateType,
  emi,
  firstDueDate,
}) {
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new Error("principal must be a positive number");
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
    throw new Error("tenureMonths must be a whole number of at least 1");
  }
  if (!Number.isFinite(annualRatePct) || annualRatePct < 0) {
    throw new Error("annualRatePct must be zero or greater");
  }

  const rows =
    rateType === "flat"
      ? buildFlatSchedule({ principal, tenureMonths, annualRatePct })
      : buildReducingSchedule({ principal, tenureMonths, annualRatePct, emi });

  // Due dates derive from firstDueDate via the same month-end-clamping
  // addMonths the account's own dates use (loanSchedule.service.js), so
  // installment 1 is exactly first_due_date and every later one inherits
  // its clamping behaviour consistently.
  return rows.map((row) => ({
    ...row,
    dueDate: addMonths(firstDueDate, row.installmentNo - 1),
  }));
}

module.exports = { buildAmortizationSchedule, round2 };

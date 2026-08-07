"use strict";

/**
 * Repayment arithmetic — pure, deterministic. No DB, no I/O, no clock of its
 * own (every function that needs "today" takes it as an argument, so the
 * behaviour is testable and a report can be run as-at any date).
 *
 * Four jobs, all of which the rest of the loan feature delegates here:
 *
 *   allocatePayment  — split an incoming amount across outstanding
 *                      installments. The one place money is divided by a
 *                      rule, so the rule lives in one function.
 *   computeArrears   — how overdue is this loan, and by how much.
 *   computeSettlement— what would it cost to clear the loan today.
 *   computeLateFee   — the one-time penalty for an installment overdue past
 *                      its grace period (migration 028).
 *
 * ALLOCATION ORDER is fixed and not configurable: oldest installment first,
 * and within an installment, late fee before interest before principal.
 * Oldest-first is what stops a borrower's arrears being quietly masked by a
 * payment landing on a future installment. Fee-before-interest is a stated
 * policy choice (not the only defensible one): the penalty for being late is
 * satisfied before the interest that continues to accrue regardless, so a
 * partial payment cannot silently leave every fee unpaid forever while
 * interest keeps getting serviced. A split whose order depended on a
 * setting nobody can see later would be unauditable, which is the whole
 * reason migration 027 keeps a ledger.
 */

/** Round money to 2dp without accumulating binary-float drift. */
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Parse 'YYYY-MM-DD' | Date into a UTC-midnight Date, for day comparisons. */
function toUtcDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days between two dates (b − a), ignoring any time component. */
function daysBetween(a, b) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((toUtcDay(b) - toUtcDay(a)) / MS_PER_DAY);
}

/**
 * What is still owed on one installment, split by bucket.
 * @param {object} row a repayment_schedule row
 * @returns {{fee:number, interest:number, principal:number, total:number}}
 */
function outstandingOn(row) {
  // Waived interest/fee is gone but was never received, so it reduces
  // what's owed without counting as income — hence a bucket of its own
  // rather than being folded into interest_paid/late_fee_paid (027/028).
  const fee = round2(
    Math.max(
      0,
      Number(row.late_fee_amount || 0) -
        Number(row.late_fee_paid || 0) -
        Number(row.late_fee_waived || 0)
    )
  );
  const interest = round2(
    Math.max(
      0,
      Number(row.interest_component) -
        Number(row.interest_paid || 0) -
        Number(row.interest_waived || 0)
    )
  );
  const principal = round2(
    Math.max(0, Number(row.principal_component) - Number(row.principal_paid || 0))
  );
  return { fee, interest, principal, total: round2(fee + interest + principal) };
}

/**
 * Split a payment across installments, oldest first, interest before
 * principal (see the module header for why that order is fixed).
 *
 * Returns allocations only — it does not mutate the rows it is given, so the
 * caller can validate the result before writing anything.
 *
 * @param {object} p
 * @param {number} p.amount        the payment, > 0
 * @param {object[]} p.installments repayment_schedule rows. Sorted here by
 *   installment_no, so callers need not guarantee order.
 * @returns {{allocations: Array<{scheduleId:number, installmentNo:number,
 *   feeAmount:number, interestAmount:number, principalAmount:number}>,
 *   allocated:number, unallocated:number}}
 *   `unallocated` is any amount left over once every installment is fully
 *   settled — an overpayment. The caller decides what that means; this
 *   function will not invent a credit balance.
 */
function allocatePayment({ amount, installments }) {
  const payment = round2(amount);
  if (!Number.isFinite(payment) || payment <= 0) {
    throw new Error("Payment amount must be a positive number.");
  }

  const ordered = [...installments].sort(
    (a, b) => Number(a.installment_no) - Number(b.installment_no)
  );

  let remaining = payment;
  const allocations = [];

  for (const row of ordered) {
    if (remaining <= 0) break;
    const owed = outstandingOn(row);
    if (owed.total <= 0) continue;

    const feeAmount = round2(Math.min(remaining, owed.fee));
    remaining = round2(remaining - feeAmount);

    const interestAmount = round2(Math.min(remaining, owed.interest));
    remaining = round2(remaining - interestAmount);

    const principalAmount = round2(Math.min(remaining, owed.principal));
    remaining = round2(remaining - principalAmount);

    if (feeAmount > 0 || interestAmount > 0 || principalAmount > 0) {
      allocations.push({
        scheduleId: row.id,
        installmentNo: Number(row.installment_no),
        feeAmount,
        interestAmount,
        principalAmount,
      });
    }
  }

  return {
    allocations,
    allocated: round2(payment - remaining),
    unallocated: round2(remaining),
  };
}

/**
 * Total still owed across every installment.
 * @param {object[]} installments
 * @returns {{principal:number, interest:number, fees:number, total:number}}
 */
function computeOutstanding(installments) {
  let principal = 0;
  let interest = 0;
  let fees = 0;
  for (const row of installments) {
    const owed = outstandingOn(row);
    principal = round2(principal + owed.principal);
    interest = round2(interest + owed.interest);
    fees = round2(fees + owed.fee);
  }
  return { principal, interest, fees, total: round2(principal + interest + fees) };
}

/**
 * Arrears position as at a given date.
 *
 * An installment is overdue when its due date has PASSED and it is not
 * fully settled. Days-past-due is measured from the OLDEST such installment,
 * not the most recent — that is what makes DPD a measure of how long the
 * borrower has been behind rather than of the latest missed payment.
 *
 * An installment due today is not yet late; `daysPastDue` only becomes
 * positive the day after.
 *
 * @param {object[]} installments
 * @param {Date|string} [asOf] defaults to now — pass it in for reports and tests
 * @returns {{isInArrears:boolean, daysPastDue:number, arrearsAmount:number,
 *   overdueCount:number, oldestOverdueDate:string|null,
 *   nextDueDate:string|null, nextDueAmount:number}}
 */
function computeArrears(installments, asOf = new Date()) {
  const today = toUtcDay(asOf);
  let arrearsAmount = 0;
  let overdueCount = 0;
  let oldestOverdue = null;
  let nextDue = null;
  let nextDueAmount = 0;

  const ordered = [...installments].sort(
    (a, b) => Number(a.installment_no) - Number(b.installment_no)
  );

  for (const row of ordered) {
    const owed = outstandingOn(row);
    if (owed.total <= 0) continue;

    const due = toUtcDay(row.due_date);
    if (due < today) {
      arrearsAmount = round2(arrearsAmount + owed.total);
      overdueCount += 1;
      if (!oldestOverdue || due < oldestOverdue) oldestOverdue = due;
    } else if (!nextDue || due < nextDue) {
      nextDue = due;
      nextDueAmount = owed.total;
    }
  }

  const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

  return {
    isInArrears: overdueCount > 0,
    daysPastDue: oldestOverdue ? daysBetween(oldestOverdue, today) : 0,
    arrearsAmount,
    overdueCount,
    oldestOverdueDate: iso(oldestOverdue),
    nextDueDate: iso(nextDue),
    nextDueAmount,
  };
}

/**
 * What it would cost to clear the loan today.
 *
 * POLICY (stated, not universal): the borrower pays all outstanding
 * PRINCIPAL, plus interest only on installments that have ALREADY fallen
 * due. Interest on future installments is waived — they have not borrowed
 * the money for that time, so charging for it would be charging for nothing.
 *
 * Real lenders vary here: many apply a rebate formula (Rule of 78 and
 * similar) or an early-settlement fee instead. Those are commercial
 * policies, not arithmetic, and none is implemented — this is the simple,
 * borrower-favourable rule, and it is documented so nobody mistakes it for
 * the only possibility.
 *
 * Late fees are never waived by settlement — a fee can only exist on an
 * installment that is already overdue (see computeLateFee), so it always
 * falls in the "already due" branch alongside its interest.
 *
 * @param {object[]} installments
 * @param {Date|string} [asOf]
 * @returns {{principal:number, interest:number, fees:number, total:number,
 *   interestWaived:number}}
 */
function computeSettlement(installments, asOf = new Date()) {
  const today = toUtcDay(asOf);
  let principal = 0;
  let interest = 0;
  let fees = 0;
  let interestWaived = 0;

  for (const row of installments) {
    const owed = outstandingOn(row);
    principal = round2(principal + owed.principal);
    fees = round2(fees + owed.fee);
    // "Already due" includes today: an installment due today is payable.
    if (toUtcDay(row.due_date) <= today) {
      interest = round2(interest + owed.interest);
    } else {
      interestWaived = round2(interestWaived + owed.interest);
    }
  }

  return {
    principal,
    interest,
    fees,
    total: round2(principal + interest + fees),
    interestWaived,
  };
}

/**
 * The per-installment interest waiver an early settlement implies.
 *
 * Settlement is applied as WAIVE-THEN-ALLOCATE, not allocate-then-waive.
 * That ordering matters: the normal allocation rule is oldest-first,
 * interest-before-principal, so paying the settlement figure straight into
 * it would consume future interest on early installments and leave
 * principal stranded on later ones — the loan would take the money and
 * still not close. Waiving first makes the outstanding total exactly equal
 * the settlement figure, so the payment clears it precisely.
 *
 * @param {object[]} installments
 * @param {Date|string} [asOf]
 * @returns {Array<{scheduleId:number, waive:number}>} rows needing a waiver
 */
function computeSettlementWaivers(installments, asOf = new Date()) {
  const today = toUtcDay(asOf);
  const waivers = [];
  for (const row of installments) {
    if (toUtcDay(row.due_date) <= today) continue;
    const owed = outstandingOn(row);
    if (owed.interest > 0) {
      waivers.push({ scheduleId: row.id, waive: owed.interest });
    }
  }
  return waivers;
}

/**
 * The status an installment should carry given what has been paid against
 * it. Derived rather than set by hand so the three states stay mutually
 * exclusive and exhaustive.
 * @param {object} row
 * @returns {'due'|'partial'|'paid'}
 */
function installmentStatus(row) {
  const owed = outstandingOn(row);
  if (owed.total <= 0) return "paid";
  const paid =
    Number(row.interest_paid || 0) +
    Number(row.principal_paid || 0) +
    Number(row.late_fee_paid || 0);
  return paid > 0 ? "partial" : "due";
}

/** Default late-fee policy — see computeLateFee for how these combine. */
const LATE_FEE_GRACE_DAYS = 3;
const LATE_FEE_PERCENT = 2;
const LATE_FEE_MIN_AMOUNT = 500;

/**
 * The one-time penalty for an installment overdue past its grace period.
 *
 * POLICY (stated, not universal — same spirit as computeSettlement's
 * rebate rule): the greater of a flat minimum and a percentage of the
 * installment's EMI. A pure percentage would charge almost nothing on a
 * small instalment and a pure flat fee would be disproportionate on a
 * large one; the "greater of" combination is a common, simple middle
 * ground. Real lenders vary widely (flat-only, tiered by DPD, capped at a
 * ceiling) and none of that is implemented — this is one defensible rule.
 *
 * @param {number} emiAmount the installment's own EMI
 * @param {object} [opts]
 * @param {number} [opts.percent] default LATE_FEE_PERCENT
 * @param {number} [opts.minAmount] default LATE_FEE_MIN_AMOUNT
 * @returns {number}
 */
function computeLateFee(emiAmount, opts = {}) {
  const percent = opts.percent ?? LATE_FEE_PERCENT;
  const minAmount = opts.minAmount ?? LATE_FEE_MIN_AMOUNT;
  const emi = Math.max(0, Number(emiAmount) || 0);
  return round2(Math.max(minAmount, emi * (percent / 100)));
}

/**
 * Which installments should be charged a NEW late fee as at `asOf`.
 *
 * Eligible = overdue past the grace period, still genuinely owing
 * principal or interest (a technically-late installment that was in fact
 * paid off in full owes nothing and earns no penalty), and not already
 * charged one (row.late_fee_charged_at is null — a one-time fee per
 * installment, ever; see migration 028).
 *
 * @param {object[]} installments
 * @param {Date|string} [asOf]
 * @param {object} [opts] forwarded to computeLateFee
 * @returns {Array<{scheduleId:number, installmentNo:number, feeAmount:number}>}
 */
function computeLateFeeAssessments(installments, asOf = new Date(), opts = {}) {
  const graceDays = opts.graceDays ?? LATE_FEE_GRACE_DAYS;
  const today = toUtcDay(asOf);
  const assessments = [];

  for (const row of installments) {
    if (row.late_fee_charged_at) continue;
    const owed = outstandingOn(row);
    if (owed.principal <= 0 && owed.interest <= 0) continue;

    const dpd = daysBetween(toUtcDay(row.due_date), today);
    if (dpd > graceDays) {
      assessments.push({
        scheduleId: row.id,
        installmentNo: Number(row.installment_no),
        feeAmount: computeLateFee(row.emi, opts),
      });
    }
  }
  return assessments;
}

module.exports = {
  allocatePayment,
  computeOutstanding,
  computeArrears,
  computeSettlement,
  computeSettlementWaivers,
  computeLateFee,
  computeLateFeeAssessments,
  installmentStatus,
  outstandingOn,
  round2,
  daysBetween,
  LATE_FEE_GRACE_DAYS,
  LATE_FEE_PERCENT,
  LATE_FEE_MIN_AMOUNT,
};

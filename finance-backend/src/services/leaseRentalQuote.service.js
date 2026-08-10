"use strict";

/**
 * What a lessee may pay today, and how much each option costs.
 *
 * Pure — no DB, no I/O, no clock of its own. Everything is derived from the
 * rental schedule, the total money received so far, and a supplied `today`.
 *
 * WHY THIS EXISTS SEPARATELY FROM repaymentQuote.service.js. That one quotes
 * a reducing-balance LOAN, where outstanding principal already is the
 * settlement figure. A flat-rate lease is different in kind: the remaining
 * rentals still carry finance charges the lessor has not earned, so settling
 * early must hand back the unearned portion (sum-of-digits, see
 * leasing.service.computeEarlySettlement). Quoting a lease with the loan's
 * logic would overcharge the lessee — which is exactly the mistake this
 * module exists to make impossible.
 *
 * THE AMOUNTS ARE TOP-UPS, NOT FACE VALUES. The rental ledger carries no
 * per-row paid amount: a rental's status is re-derived from the TOTAL
 * received (see leaseAgreement.model.recordRental). So "pay the next rental"
 * cannot mean "charge one rental_amount" — if an earlier overpayment already
 * sits on that row, charging the full amount would take more than is owed.
 * Every figure below is therefore "what it takes to get from here to there",
 * computed by walking the cumulative schedule against `received`.
 */

const { round2 } = require("./amortization.service");
const { computeEarlySettlement } = require("./leasing.service");

/** Tolerance for a final cent of rounding dust, as used across the ledger. */
const EPSILON = 0.01;

/**
 * Smallest amount worth sending to a card gateway. Stripe itself refuses a
 * charge below roughly 30 pence once converted, and a lessee would never
 * deliberately pay LKR 0.36 anyway — matches repaymentQuote.service.js's
 * MIN_PAYMENT for the loan side of the same product line.
 */
const MIN_PAYMENT = 100;

const isFiniteNumber = (v) => Number.isFinite(Number(v));

/**
 * A DATE column as a comparable `YYYY-MM-DD` string.
 *
 * TWO TRAPS, BOTH LIVE. mysql2 hands back DATE columns as JS `Date` objects
 * unless `dateStrings` is set, and this pool does not set it:
 *
 *   1. `String(date).slice(0, 10)` yields "Sat May 09" — not a date at all.
 *      Compared against "2026-08-09" it is always false, so an overdue
 *      rental silently reads as on time. That is how lease arrears went
 *      undetected: the comparison never returned true for anything.
 *   2. `date.toISOString().slice(0, 10)` looks like the fix and is not. The
 *      Date is local midnight, and in Sri Lanka (+05:30) that converts to
 *      18:30 UTC the PREVIOUS day — every due date shifts back one, so a
 *      rental falls into arrears a day early.
 *
 * Local calendar components are the only reading that survives both.
 *
 * @param {Date|string|null|undefined} value
 * @returns {string} `YYYY-MM-DD`, or "" when there is no date
 */
function toIsoDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // Already a string: take the date part of "2026-05-09" or an ISO datetime.
  return String(value).slice(0, 10);
}

/** Today as `YYYY-MM-DD`, in the local calendar for the same reason. */
function todayIso() {
  return toIsoDate(new Date());
}

/**
 * Walk the schedule and work out where the money received has reached.
 *
 * @param {Array<{rental_no:number, due_date:string|Date, rental_amount:number|string,
 *                finance_component?:number|string}>} schedule
 * @param {number} received total of every rental payment posted so far
 * @returns {{cumulative:number[], fullyCoveredCount:number, creditOnNextRow:number}}
 */
function walk(schedule, received) {
  const cumulative = [];
  let running = 0;
  for (const row of schedule) {
    running = round2(running + Number(row.rental_amount));
    cumulative.push(running);
  }

  // A row can be DISCHARGED without having been paid at face value: an early
  // settlement clears the whole schedule for less than its face value,
  // because the unearned finance charge is rebated. Deriving "what is left"
  // from money alone would then report the rebate as though the lessee still
  // owed it — a settled lease showing a balance.
  //
  // So the schedule's own status wins where it exists. Callers that pass
  // bare rows (the unit tests, and any caller quoting a hypothetical) fall
  // back to deriving coverage from the money, which is the same answer
  // whenever no settlement has happened.
  const statusKnown = schedule.every((row) => typeof row.status === "string" && row.status);

  let fullyCoveredCount = 0;
  if (statusKnown) {
    for (const row of schedule) {
      if (row.status === "paid") fullyCoveredCount += 1;
      else break;
    }
  } else {
    for (const total of cumulative) {
      if (received + EPSILON >= total) fullyCoveredCount += 1;
      else break;
    }
  }

  const coveredThrough = fullyCoveredCount === 0 ? 0 : cumulative[fullyCoveredCount - 1];
  // Money sitting on the first row that is not yet discharged. Clamped at
  // zero: after a settlement, `received` is LESS than what has been
  // discharged, and that difference is a rebate, not a debt.
  const creditOnNextRow = round2(Math.max(0, received - coveredThrough));

  return { cumulative, fullyCoveredCount, coveredThrough, creditOnNextRow };
}

/**
 * Build every payment option available on a lease today.
 *
 * @param {object} input
 * @param {Array} input.schedule       lease_rental_schedule rows, ascending
 * @param {number} input.received      total already posted to lease_rentals
 * @param {number} input.monthlyRental the agreement's contractual rental
 * @param {string} [input.today]       ISO date; defaults to the real today
 * @returns {object|null} null when there is no schedule to quote against
 */
function buildRentalOptions({ schedule, received, monthlyRental, today }) {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  if (!isFiniteNumber(received) || Number(received) < 0) return null;

  const paidTotal = round2(Number(received));
  const asOf = today || todayIso();

  const totalRentals = round2(
    schedule.reduce((sum, row) => sum + Number(row.rental_amount), 0)
  );

  const { cumulative, fullyCoveredCount, coveredThrough, creditOnNextRow } = walk(
    schedule,
    paidTotal
  );

  // What is left is what has NOT been discharged, less any money already
  // sitting on the next row — not `total − received`, which would count a
  // settlement's rebate as an unpaid balance.
  const outstanding = round2(Math.max(0, totalRentals - coveredThrough - creditOnNextRow));

  // Nothing left to pay. Reported as an option set with payable:false rather
  // than as null, so the caller can still show the closed position.
  if (outstanding <= EPSILON) {
    return {
      payable: false,
      totalRentals,
      received: paidTotal,
      outstanding: 0,
      rentalsPaid: schedule.length,
      rentalsTotal: schedule.length,
      nextRental: null,
      arrears: null,
      settlement: null,
      maxPayment: 0,
    };
  }

  // --- the next rental -----------------------------------------------------
  const nextRow = schedule[fullyCoveredCount];
  let nextRental = null;
  if (nextRow) {
    let amount = round2(Number(nextRow.rental_amount) - creditOnNextRow);
    let combinedRentalAmount = round2(Number(nextRow.rental_amount));
    let throughIndex = fullyCoveredCount;

    // A residual below MIN_PAYMENT is not something a card gateway will
    // process, and nobody would deliberately pay LKR 0.36 anyway. It arises
    // whenever an earlier payment landed a few cents short of a full
    // rental — an offline receipt keyed in as 35,583.00 instead of
    // 35,583.34, say — and the shortfall would otherwise sit on the ledger
    // forever with no payable way to clear it, since "pay the next rental"
    // would forever quote an amount nothing will charge.
    //
    // So it rolls forward into the following rental(s), exactly like a
    // phone bill carries a small credit into next month's invoice rather
    // than issuing a separate bill for it. This changes nothing about how
    // the payment is ALLOCATED once made — recordRental's waterfall derives
    // every row's status from the total received regardless of what the
    // quote was for, so a combined charge simply clears both rows.
    while (amount > 0 && amount < MIN_PAYMENT && throughIndex + 1 < schedule.length) {
      throughIndex += 1;
      const row = schedule[throughIndex];
      amount = round2(amount + Number(row.rental_amount));
      combinedRentalAmount = round2(combinedRentalAmount + Number(row.rental_amount));
    }

    nextRental = {
      rentalNo: nextRow.rental_no,
      // Present only when rolled forward, so a caller that doesn't care can
      // ignore it — the common case of a clean full rental is unaffected.
      throughRentalNo:
        throughIndex !== fullyCoveredCount ? schedule[throughIndex].rental_no : undefined,
      dueDate: toIsoDate(nextRow.due_date),
      // The contractual figure(s), for display…
      rentalAmount: combinedRentalAmount,
      // …and what it actually takes to clear it from here.
      amount,
      partiallyPaid: creditOnNextRow > EPSILON,
    };
  }

  // --- arrears -------------------------------------------------------------
  // Everything whose DUE DATE has passed and is not yet covered. Judged on
  // the due date, never on when a payment happened to be keyed in.
  let lastOverdueIndex = -1;
  for (let i = 0; i < schedule.length; i += 1) {
    if (toIsoDate(schedule[i].due_date) < asOf) lastOverdueIndex = i;
    else break;
  }
  let arrears = null;
  if (lastOverdueIndex >= 0) {
    const owedThroughOverdue = cumulative[lastOverdueIndex];
    const amount = round2(Math.max(0, owedThroughOverdue - paidTotal));
    if (amount > EPSILON) {
      arrears = {
        count: lastOverdueIndex + 1 - fullyCoveredCount,
        amount,
        oldestDueDate: toIsoDate(schedule[fullyCoveredCount].due_date),
      };
    }
  }

  // --- early settlement ----------------------------------------------------
  // The rebate is a function of how many rentals have been PAID IN FULL, so
  // a part-paid row does not earn a rebate it has not reached. Whatever sits
  // on that row is then netted off the figure quoted, because the lessee has
  // already handed it over.
  const totalInterest = round2(
    schedule.reduce((sum, row) => sum + Number(row.finance_component || 0), 0)
  );
  const quote = computeEarlySettlement({
    rental: monthlyRental,
    totalInterest,
    tenureMonths: schedule.length,
    instalmentsPaid: fullyCoveredCount,
  });

  let settlement = null;
  if (quote) {
    const amount = round2(Math.max(0, quote.settlementAmount - creditOnNextRow));
    // A "saving" that is zero or negative is not a settlement offer worth
    // making — on the final rental the rebate rounds away and settling is
    // simply paying what is due.
    settlement = {
      amount,
      grossOutstanding: round2(quote.grossOutstanding - creditOnNextRow),
      interestRebate: quote.interestRebate,
      rentalsRemaining: quote.instalmentsRemaining,
      saving: round2(Math.max(0, outstanding - amount)),
    };
  }

  return {
    payable: true,
    totalRentals,
    received: paidTotal,
    outstanding,
    rentalsPaid: fullyCoveredCount,
    rentalsTotal: schedule.length,
    nextRental,
    arrears,
    settlement,
    // A custom payment can never exceed what the lease owes. Settling is
    // cheaper than `outstanding`, but it is a distinct act with a rebate
    // attached — a lessee cannot reach it by typing the number in.
    maxPayment: outstanding,
  };
}

/**
 * Resolve a requested payment kind to the amount the SERVER will charge.
 *
 * The client sends a kind, never a price. `custom` is the one exception and
 * even then the figure is a bounded REQUEST, re-checked here against the
 * real outstanding balance before any card is touched.
 *
 * @returns {{amount:number}|{error:string, message:string}}
 */
function resolvePaymentAmount(options, kind, customAmount) {
  if (!options || !options.payable) {
    return { error: "NOTHING_DUE", message: "This lease has nothing outstanding." };
  }

  let resolved;
  switch (kind) {
    case "rental":
      if (!options.nextRental) {
        return { error: "NO_NEXT_RENTAL", message: "There is no rental left to pay." };
      }
      resolved = { amount: options.nextRental.amount };
      break;

    case "arrears":
      if (!options.arrears) {
        return { error: "NO_ARREARS", message: "This lease is not in arrears." };
      }
      resolved = { amount: options.arrears.amount };
      break;

    case "settlement":
      if (!options.settlement || options.settlement.amount <= 0) {
        return { error: "NO_SETTLEMENT", message: "This lease cannot be settled early." };
      }
      resolved = { amount: options.settlement.amount };
      break;

    case "custom": {
      const amount = round2(Number(customAmount));
      if (!isFiniteNumber(customAmount) || amount <= 0) {
        return { error: "INVALID_AMOUNT", message: "Enter an amount greater than zero." };
      }
      if (amount > options.maxPayment + EPSILON) {
        return {
          error: "OVERPAYMENT",
          message:
            `That is more than this lease owes. The most you can pay is ` +
            `LKR ${options.maxPayment.toLocaleString("en-LK")}.`,
        };
      }
      resolved = { amount };
      break;
    }

    default:
      return { error: "UNKNOWN_KIND", message: "Unrecognised payment type." };
  }

  // Final floor, defense in depth. 'rental' rolls a tiny residual forward
  // above so this should not normally fire for it — but it is the backstop
  // for whatever that cannot cover (the very last rental of a schedule, with
  // no following row to combine into) and for arrears/settlement/custom,
  // where a comparable rounding edge is far less likely but no cheaper to
  // guard against. Nothing should ever reach the gateway below what it will
  // actually process.
  if (resolved.amount > 0 && resolved.amount < MIN_PAYMENT) {
    return {
      error: "BELOW_MINIMUM",
      message:
        `This comes to LKR ${resolved.amount.toLocaleString("en-LK")}, which is too small to pay ` +
        `online. Please contact us to settle it another way, or wait for it to be included with ` +
        `your next payment.`,
    };
  }
  return resolved;
}

module.exports = {
  EPSILON,
  MIN_PAYMENT,
  toIsoDate,
  todayIso,
  buildRentalOptions,
  resolvePaymentAmount,
};

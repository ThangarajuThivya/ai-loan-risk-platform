"use strict";

/**
 * WHAT to remind someone about, given a lease's state and today's date.
 *
 * PURE — no DB, no clock of its own, no I/O. The sweep does the reading and
 * the writing; this decides. Keeping the decision separate is what makes
 * "does a rental 3 days out produce exactly one notice?" answerable without
 * a database and without waiting six hours for a timer.
 *
 * THE SHAPE OF A REMINDER PROBLEM. A reminder is not an event — it is a
 * CONDITION that stays true for a while. "Rental #4 is due in 3 days" is
 * true all day, and a sweep on a 6-hour timer sees it four times. Two
 * mechanisms keep that from becoming four notices:
 *
 *   1. THRESHOLDS, not ranges. A due-soon notice fires only on the exact
 *      day-markers below, so the condition is true for one day per marker
 *      rather than continuously.
 *   2. DEDUPE KEYS carrying that marker, enforced by a UNIQUE index. Even
 *      two sweeps on the same day cannot produce two rows.
 *
 * Overdue notices use widening BUCKETS rather than day-markers, because
 * lateness has no upper bound — a daily "you are late" for six months is
 * harassment, not a reminder.
 */

const { toIsoDate, todayIso } = require("./leaseRentalQuote.service");

/** Days BEFORE a rental falls due on which to send a reminder. */
const DUE_SOON_MARKERS = [7, 3, 1, 0];

/**
 * Days AFTER a due date at which to escalate. A rental that is 4 days late
 * gets the 3-day notice; at 7 it gets another; then weekly-ish, widening.
 * The bucket, not the exact day count, is what the dedupe key carries.
 */
const OVERDUE_BUCKETS = [3, 7, 14, 30, 60, 90];

/** Days before a quotation lapses on which to warn the lessee. */
const QUOTATION_EXPIRY_MARKERS = [3, 1];

/** Days an unpaid signing amount may sit before the lessee is chased. */
const DOWN_PAYMENT_MARKERS = [3, 7, 14, 30];

/**
 * Days a lease may sit on a STAFF-owned stage before the desk is nudged.
 * Deliberately generous: this is a backstop against work being forgotten,
 * not a service-level target, and firing it too eagerly would train people
 * to ignore it.
 */
const STALLED_AFTER_DAYS = 7;

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative = in the past. */
function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * The largest bucket a lateness has passed. 10 days late → bucket 7.
 * @returns {number|null} null when not late enough for the first bucket
 */
function overdueBucket(daysLate) {
  let bucket = null;
  for (const b of OVERDUE_BUCKETS) {
    if (daysLate >= b) bucket = b;
  }
  return bucket;
}

/**
 * Which rental reminders are due on a live lease today.
 *
 * Only ever considers the NEXT unpaid rental for the due-soon notice — a
 * lessee three rentals behind does not need three separate "due soon"
 * notices for rentals they already know about; they need the overdue one.
 *
 * @param {object} input
 * @param {Array}  input.schedule  lease_rental_schedule rows, ascending
 * @param {string} [input.today]
 * @returns {Array<{kind:'due_soon'|'overdue', rentalNo:number, dueDate:string,
 *                  amount:number, daysAhead?:number, daysLate?:number, bucket?:number}>}
 */
function rentalRemindersFor({ schedule, today }) {
  if (!Array.isArray(schedule) || schedule.length === 0) return [];
  const asOf = today || todayIso();
  const out = [];

  const unpaid = schedule.filter((r) => r.status !== "paid");
  if (unpaid.length === 0) return [];

  // --- overdue: the OLDEST unpaid rental that is past its date -------------
  // One notice, about the oldest, rather than one per overdue rental. The
  // lessee's problem is "I am behind", not "here are four separate rentals".
  const oldestOverdue = unpaid.find((r) => toIsoDate(r.due_date) < asOf);
  if (oldestOverdue) {
    const daysLate = daysBetween(toIsoDate(oldestOverdue.due_date), asOf);
    const bucket = overdueBucket(daysLate);
    if (bucket !== null) {
      out.push({
        kind: "overdue",
        rentalNo: oldestOverdue.rental_no,
        dueDate: toIsoDate(oldestOverdue.due_date),
        amount: Number(oldestOverdue.rental_amount),
        daysLate,
        bucket,
      });
    }
  }

  // --- due soon: the next rental not yet past its date ---------------------
  const nextUpcoming = unpaid.find((r) => toIsoDate(r.due_date) >= asOf);
  if (nextUpcoming) {
    const daysAhead = daysBetween(asOf, toIsoDate(nextUpcoming.due_date));
    if (DUE_SOON_MARKERS.includes(daysAhead)) {
      out.push({
        kind: "due_soon",
        rentalNo: nextUpcoming.rental_no,
        dueDate: toIsoDate(nextUpcoming.due_date),
        amount: Number(nextUpcoming.rental_amount),
        daysAhead,
      });
    }
  }

  return out;
}

/**
 * Should the lessee be warned that their quotation is about to lapse?
 * @returns {{daysLeft:number}|null}
 */
function quotationExpiryReminder({ quotation, today }) {
  if (!quotation || quotation.status !== "pending" || !quotation.expires_at) return null;
  const asOf = today || todayIso();
  const daysLeft = daysBetween(asOf, toIsoDate(quotation.expires_at));
  if (daysLeft === null || daysLeft < 0) return null;
  return QUOTATION_EXPIRY_MARKERS.includes(daysLeft) ? { daysLeft } : null;
}

/**
 * Should the lessee be chased for an unpaid signing amount?
 *
 * Counted from when the terms were ACCEPTED, not from the application date:
 * nothing is owed until then, so chasing earlier would be chasing a debt
 * that does not exist.
 *
 * @returns {{daysWaiting:number, outstanding:number}|null}
 */
function downPaymentReminder({ position, acceptedAt, today }) {
  if (!position || position.settled || !(position.outstanding > 0)) return null;
  if (!acceptedAt) return null;
  const asOf = today || todayIso();
  const daysWaiting = daysBetween(toIsoDate(acceptedAt), asOf);
  if (daysWaiting === null || daysWaiting <= 0) return null;
  return DOWN_PAYMENT_MARKERS.includes(daysWaiting)
    ? { daysWaiting, outstanding: position.outstanding }
    : null;
}

/**
 * Is this lease stuck waiting on US?
 *
 * The counterpart to every reminder above: those chase the customer, this
 * chases the institution. It exists because the failure it catches actually
 * happened — an approved lease sat with no quotation while the lessee waited
 * for a payment link and the desk waited for a payment.
 *
 * `nextActionActor` comes from the same derivation the portal uses, so a
 * lease the UI shows as "waiting on us" is exactly the one nudged here.
 *
 * @returns {{stageLabel:string, daysWaiting:number}|null}
 */
function stalledReminder({ nextActionActor, stageLabel, lastMovedAt, today }) {
  if (nextActionActor !== "staff" || !lastMovedAt) return null;
  const asOf = today || todayIso();
  const daysWaiting = daysBetween(toIsoDate(lastMovedAt), asOf);
  if (daysWaiting === null || daysWaiting < STALLED_AFTER_DAYS) return null;
  return { stageLabel: stageLabel || "this stage", daysWaiting };
}

module.exports = {
  DUE_SOON_MARKERS,
  OVERDUE_BUCKETS,
  QUOTATION_EXPIRY_MARKERS,
  DOWN_PAYMENT_MARKERS,
  STALLED_AFTER_DAYS,
  daysBetween,
  overdueBucket,
  rentalRemindersFor,
  quotationExpiryReminder,
  downPaymentReminder,
  stalledReminder,
};

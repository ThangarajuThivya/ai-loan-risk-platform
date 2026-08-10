"use strict";

/**
 * leaseReminders.service — WHICH reminders are due today.
 *
 * A reminder is a CONDITION that stays true for a while, not an event. The
 * sweep re-evaluates it every few hours, so the only thing standing between
 * a helpful nudge and spamming a customer four times a day is that this
 * module fires on exact day-markers rather than ranges. Every assertion
 * below is ultimately about that.
 *
 * `today` is injected throughout — a reminder module that reads the real
 * clock cannot be tested for "what happens 3 days before" without waiting
 * three days.
 */

const assert = require("assert");
const R = require("../leaseReminders.service");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok - " + name);
};

/** A monthly schedule; rentals 1..n from `firstDue`, all unpaid unless told. */
function schedule({ n = 6, firstDue = "2026-01-09", amount = 35583.34, paidUpTo = 0 } = {}) {
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    const d = new Date(`${firstDue}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + (i - 1));
    rows.push({
      rental_no: i,
      due_date: d.toISOString().slice(0, 10),
      rental_amount: amount,
      status: i <= paidUpTo ? "paid" : "due",
    });
  }
  return rows;
}

// --- daysBetween: the primitive everything else rests on --------------------
{
  assert.strictEqual(R.daysBetween("2026-01-01", "2026-01-04"), 3);
  assert.strictEqual(R.daysBetween("2026-01-04", "2026-01-01"), -3);
  assert.strictEqual(R.daysBetween("2026-01-01", "2026-01-01"), 0);
  // Across a month and a DST-style boundary — UTC parsing means no drift.
  assert.strictEqual(R.daysBetween("2026-02-25", "2026-03-04"), 7);
  assert.strictEqual(R.daysBetween("nonsense", "2026-01-01"), null);
  ok("daysBetween is exact across months and returns null on unparseable input");
}

// --- due-soon fires ONLY on the markers -------------------------------------
{
  const rows = schedule({ firstDue: "2026-06-10" });
  const fired = [];
  for (let d = 14; d >= 0; d -= 1) {
    const day = new Date("2026-06-10T00:00:00Z");
    day.setUTCDate(day.getUTCDate() - d);
    const today = day.toISOString().slice(0, 10);
    const due = R.rentalRemindersFor({ schedule: rows, today }).filter((r) => r.kind === "due_soon");
    if (due.length) fired.push(due[0].daysAhead);
  }
  assert.deepStrictEqual(
    fired,
    [7, 3, 1, 0],
    `expected notices only at 7/3/1/0 days out, got ${JSON.stringify(fired)}`
  );
  ok("LOAD-BEARING: across 15 days a rental produces exactly 4 due-soon notices, at 7/3/1/0");
}

{
  // The same day evaluated repeatedly — a sweep running four times — must
  // describe the identical notice each time, so the dedupe key matches.
  const rows = schedule({ firstDue: "2026-06-10" });
  const a = R.rentalRemindersFor({ schedule: rows, today: "2026-06-07" });
  const b = R.rentalRemindersFor({ schedule: rows, today: "2026-06-07" });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a[0].daysAhead, 3);
  ok("re-running the same day is deterministic — the sweep can be as dumb as it likes");
}

// --- overdue escalates by bucket, not daily ---------------------------------
{
  assert.strictEqual(R.overdueBucket(0), null);
  assert.strictEqual(R.overdueBucket(2), null);
  assert.strictEqual(R.overdueBucket(3), 3);
  assert.strictEqual(R.overdueBucket(6), 3);
  assert.strictEqual(R.overdueBucket(7), 7);
  assert.strictEqual(R.overdueBucket(13), 7);
  assert.strictEqual(R.overdueBucket(45), 30);
  assert.strictEqual(R.overdueBucket(999), 90);
  ok("overdue buckets widen and never run out — a year late still maps to the last bucket");
}

{
  // 90 days of lateness must produce a handful of DISTINCT notices, not 90.
  const rows = schedule({ n: 3, firstDue: "2026-01-09" });
  const buckets = new Set();
  let firedDays = 0;
  for (let d = 0; d <= 90; d += 1) {
    const day = new Date("2026-01-09T00:00:00Z");
    day.setUTCDate(day.getUTCDate() + d);
    const res = R.rentalRemindersFor({
      schedule: rows,
      today: day.toISOString().slice(0, 10),
    }).filter((r) => r.kind === "overdue");
    if (res.length) {
      firedDays += 1;
      buckets.add(res[0].bucket);
    }
  }
  assert.deepStrictEqual([...buckets].sort((x, y) => x - y), [3, 7, 14, 30, 60, 90]);
  assert.ok(firedDays > 80, "the condition is genuinely true on most of those days");
  ok(
    `LOAD-BEARING: 90 days overdue yields only ${buckets.size} distinct buckets — ` +
      `the dedupe key collapses ${firedDays} true days into ${buckets.size} notices`
  );
}

// --- a lessee behind on several rentals gets ONE overdue notice -------------
{
  const rows = schedule({ n: 6, firstDue: "2026-01-09" });
  const res = R.rentalRemindersFor({ schedule: rows, today: "2026-04-12" });
  const overdue = res.filter((r) => r.kind === "overdue");
  assert.strictEqual(overdue.length, 1, "one notice about being behind, not one per rental");
  assert.strictEqual(overdue[0].rentalNo, 1, "and it is about the OLDEST unpaid rental");
  ok("LOAD-BEARING: three rentals behind produces ONE overdue notice, about the oldest");
}

{
  // Paid rentals are skipped entirely when finding the oldest outstanding.
  const rows = schedule({ n: 6, firstDue: "2026-01-09", paidUpTo: 2 });
  const overdue = R.rentalRemindersFor({ schedule: rows, today: "2026-04-12" }).filter(
    (r) => r.kind === "overdue"
  );
  assert.strictEqual(overdue[0].rentalNo, 3);
  ok("already-paid rentals are never reported overdue");
}

{
  const rows = schedule({ n: 3, firstDue: "2026-01-09", paidUpTo: 3 });
  assert.deepStrictEqual(R.rentalRemindersFor({ schedule: rows, today: "2027-01-01" }), []);
  ok("a fully paid lease is never reminded of anything");
}

{
  assert.deepStrictEqual(R.rentalRemindersFor({ schedule: [], today: "2026-01-01" }), []);
  assert.deepStrictEqual(R.rentalRemindersFor({ schedule: null }), []);
  ok("no schedule produces no reminders rather than throwing");
}

// --- quotation expiry --------------------------------------------------------
{
  const q = { status: "pending", expires_at: "2026-08-23" };
  assert.strictEqual(R.quotationExpiryReminder({ quotation: q, today: "2026-08-20" }).daysLeft, 3);
  assert.strictEqual(R.quotationExpiryReminder({ quotation: q, today: "2026-08-22" }).daysLeft, 1);
  assert.strictEqual(R.quotationExpiryReminder({ quotation: q, today: "2026-08-21" }), null);
  assert.strictEqual(R.quotationExpiryReminder({ quotation: q, today: "2026-08-24" }), null,
    "an already-lapsed quotation is not 'expiring soon'");
  ok("a quotation warns at 3 and 1 days out, and never after it has lapsed");

  for (const status of ["accepted", "declined", "superseded"]) {
    assert.strictEqual(
      R.quotationExpiryReminder({ quotation: { ...q, status }, today: "2026-08-20" }),
      null
    );
  }
  ok("LOAD-BEARING: only a LIVE quotation warns — an accepted one must never nag");
}

// --- down payment chasing -----------------------------------------------------
{
  const position = { settled: false, outstanding: 100000 };
  const at = "2026-08-01";
  assert.strictEqual(
    R.downPaymentReminder({ position, acceptedAt: at, today: "2026-08-04" }).daysWaiting, 3);
  assert.strictEqual(
    R.downPaymentReminder({ position, acceptedAt: at, today: "2026-08-08" }).daysWaiting, 7);
  assert.strictEqual(R.downPaymentReminder({ position, acceptedAt: at, today: "2026-08-05" }), null);
  ok("an unpaid signing amount is chased at 3, 7, 14 and 30 days after acceptance");

  assert.strictEqual(
    R.downPaymentReminder({ position: { settled: true, outstanding: 0 }, acceptedAt: at, today: "2026-08-04" }),
    null
  );
  assert.strictEqual(
    R.downPaymentReminder({ position, acceptedAt: null, today: "2026-08-04" }),
    null,
    "nothing is owed before terms are accepted, so nothing is chased"
  );
  ok("LOAD-BEARING: a settled or not-yet-accepted lease is never chased for money");
}

// --- the desk gets nudged too -------------------------------------------------
{
  const base = { nextActionActor: "staff", stageLabel: "Terms quoted", lastMovedAt: "2026-08-01" };
  assert.strictEqual(R.stalledReminder({ ...base, today: "2026-08-06" }), null, "6 days is not stalled");
  const at7 = R.stalledReminder({ ...base, today: "2026-08-08" });
  assert.strictEqual(at7.daysWaiting, 7);
  assert.strictEqual(at7.stageLabel, "Terms quoted");
  ok("a lease waiting on us for 7 days nudges the desk");

  assert.strictEqual(
    R.stalledReminder({ ...base, nextActionActor: "customer", today: "2026-09-01" }),
    null,
    "a lease waiting on the LESSEE is not our backlog"
  );
  assert.strictEqual(R.stalledReminder({ ...base, nextActionActor: "none", today: "2026-09-01" }), null);
  ok("LOAD-BEARING: only staff-owned stages nudge the desk — a customer's delay is not our stall");
}

console.log(`\n${passed} passed`);

"use strict";

/**
 * Runnable test script for loan calendar arithmetic (no test runner needed).
 *   node src/services/__tests__/loanSchedule.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const { addMonths, deriveAccountDates } = require("../loanSchedule.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const D = (s) => new Date(`${s}T00:00:00Z`);

console.log("addMonths — the ordinary cases");

check("adds whole months within a year", () => {
  assert.strictEqual(addMonths(D("2026-01-15"), 1), "2026-02-15");
  assert.strictEqual(addMonths(D("2026-01-15"), 6), "2026-07-15");
});

check("crosses year boundaries", () => {
  assert.strictEqual(addMonths(D("2026-11-10"), 3), "2027-02-10");
  assert.strictEqual(addMonths(D("2026-06-01"), 24), "2028-06-01");
});

check("adding zero months is the identity", () => {
  assert.strictEqual(addMonths(D("2026-03-17"), 0), "2026-03-17");
});

check("accepts a YYYY-MM-DD string as well as a Date", () => {
  assert.strictEqual(addMonths("2026-01-15", 1), "2026-02-15");
});

console.log("addMonths — month-end clamping (the part that bites)");

check("31 Jan + 1 month is the LAST day of February, not early March", () => {
  // Plain JS Date rolls this forward to 2/3 March. A repayment calendar
  // must clamp instead, or every later instalment shifts too.
  assert.strictEqual(addMonths(D("2026-01-31"), 1), "2026-02-28");
});

check("clamping respects leap years", () => {
  assert.strictEqual(addMonths(D("2028-01-31"), 1), "2028-02-29");
  assert.strictEqual(addMonths(D("2028-02-29"), 12), "2029-02-28");
});

check("31st of a 31-day month lands on the 30th of a 30-day month", () => {
  assert.strictEqual(addMonths(D("2026-03-31"), 1), "2026-04-30");
  assert.strictEqual(addMonths(D("2026-05-31"), 1), "2026-06-30");
  assert.strictEqual(addMonths(D("2026-10-31"), 1), "2026-11-30");
});

check("clamping does NOT stick — it re-reads the original day each time", () => {
  // 31 Jan + 1 = 28 Feb (clamped), but 31 Jan + 2 must be 31 March, not
  // 28 March. Each call works from the original date, so the borrower's
  // repayment day recovers instead of drifting earlier every month.
  assert.strictEqual(addMonths(D("2026-01-31"), 1), "2026-02-28");
  assert.strictEqual(addMonths(D("2026-01-31"), 2), "2026-03-31");
  assert.strictEqual(addMonths(D("2026-01-31"), 3), "2026-04-30");
  assert.strictEqual(addMonths(D("2026-01-31"), 4), "2026-05-31");
});

check("a 30-day-month date is unaffected by clamping", () => {
  assert.strictEqual(addMonths(D("2026-04-30"), 1), "2026-05-30");
});

console.log("addMonths — timezone safety");

check("a late-evening UTC timestamp does not slip to the previous day", () => {
  // Local-time date maths would shift this across midnight on any server
  // west of UTC, moving the due date by a day.
  assert.strictEqual(addMonths(new Date("2026-01-15T23:59:00Z"), 1), "2026-02-15");
});

check("an early-morning UTC timestamp does not slip forward either", () => {
  assert.strictEqual(addMonths(new Date("2026-01-15T00:01:00Z"), 1), "2026-02-15");
});

console.log("addMonths — rejects nonsense");

check("a non-integer month count throws", () => {
  assert.throws(() => addMonths(D("2026-01-15"), 1.5), /whole number/);
});

check("an invalid date throws rather than yielding NaN-NaN-NaN", () => {
  assert.throws(() => addMonths("not-a-date", 1), /Invalid date/);
});

console.log("deriveAccountDates");

check("first instalment is one month after drawdown", () => {
  const { firstDueDate } = deriveAccountDates({
    disbursedAt: D("2026-08-05"),
    tenureMonths: 24,
  });
  assert.strictEqual(firstDueDate, "2026-09-05");
});

check("maturity is tenureMonths after drawdown — the final instalment date", () => {
  const { maturityDate } = deriveAccountDates({
    disbursedAt: D("2026-08-05"),
    tenureMonths: 24,
  });
  assert.strictEqual(maturityDate, "2028-08-05");
});

check("the gap between first due and maturity is exactly tenure-1 months", () => {
  // i.e. there are exactly `tenureMonths` instalments, inclusive.
  const tenureMonths = 36;
  const { firstDueDate, maturityDate } = deriveAccountDates({
    disbursedAt: D("2026-08-05"),
    tenureMonths,
  });
  assert.strictEqual(addMonths(firstDueDate, tenureMonths - 1), maturityDate);
});

check("a one-month loan matures on its only due date", () => {
  const { firstDueDate, maturityDate } = deriveAccountDates({
    disbursedAt: D("2026-08-05"),
    tenureMonths: 1,
  });
  assert.strictEqual(firstDueDate, maturityDate);
});

check("month-end drawdown clamps both derived dates", () => {
  const { firstDueDate, maturityDate } = deriveAccountDates({
    disbursedAt: D("2026-01-31"),
    tenureMonths: 13,
  });
  assert.strictEqual(firstDueDate, "2026-02-28");
  assert.strictEqual(maturityDate, "2027-02-28");
});

check("maturity is always strictly after the first due date beyond 1 month", () => {
  for (const tenure of [2, 6, 12, 36, 60]) {
    const { firstDueDate, maturityDate } = deriveAccountDates({
      disbursedAt: D("2026-01-31"),
      tenureMonths: tenure,
    });
    assert(
      new Date(maturityDate) > new Date(firstDueDate),
      `tenure ${tenure}: ${maturityDate} should be after ${firstDueDate}`
    );
  }
});

check("a zero or negative tenure throws", () => {
  for (const tenure of [0, -1, 2.5]) {
    assert.throws(
      () => deriveAccountDates({ disbursedAt: D("2026-08-05"), tenureMonths: tenure }),
      /at least 1|whole number/
    );
  }
});

console.log(`\n${passed} assertions passed.`);

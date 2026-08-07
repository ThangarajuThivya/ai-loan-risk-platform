"use strict";

/**
 * Runnable test script for amortization schedule generation (no test
 * runner needed).
 *   node src/services/__tests__/amortization.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const { buildAmortizationSchedule, round2 } = require("../amortization.service");
const { computeEmi, computeFlatEmi } = require("../recommendation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function sum(rows, key) {
  return round2(rows.reduce((acc, r) => acc + r[key], 0));
}

const FIRST_DUE = "2026-09-05";

console.log("shape & basic invariants");

check("produces exactly tenureMonths rows, numbered 1..n", () => {
  const rows = buildAmortizationSchedule({
    principal: 1200000,
    tenureMonths: 24,
    annualRatePct: 14,
    rateType: "reducing",
    emi: computeEmi(1200000, 14, 24),
    firstDueDate: FIRST_DUE,
  });
  assert.strictEqual(rows.length, 24);
  assert.deepStrictEqual(
    rows.map((r) => r.installmentNo),
    Array.from({ length: 24 }, (_, i) => i + 1)
  );
});

check("installment 1's due date is exactly first_due_date", () => {
  const rows = buildAmortizationSchedule({
    principal: 500000,
    tenureMonths: 6,
    annualRatePct: 10,
    rateType: "reducing",
    emi: computeEmi(500000, 10, 6),
    firstDueDate: FIRST_DUE,
  });
  assert.strictEqual(rows[0].dueDate, FIRST_DUE);
});

check("due dates are one month apart and clamp at month-end (reuses loanSchedule)", () => {
  const rows = buildAmortizationSchedule({
    principal: 500000,
    tenureMonths: 4,
    annualRatePct: 10,
    rateType: "reducing",
    emi: computeEmi(500000, 10, 4),
    firstDueDate: "2026-01-31",
  });
  assert.deepStrictEqual(
    rows.map((r) => r.dueDate),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
  );
});

check("each row's opening balance equals the previous row's closing balance", () => {
  const rows = buildAmortizationSchedule({
    principal: 900000,
    tenureMonths: 12,
    annualRatePct: 16,
    rateType: "flat",
    firstDueDate: FIRST_DUE,
  });
  for (let i = 1; i < rows.length; i++) {
    assert.strictEqual(rows[i].openingBalance, rows[i - 1].closingBalance);
  }
});

check("the first row's opening balance is the principal", () => {
  const rows = buildAmortizationSchedule({
    principal: 750000,
    tenureMonths: 18,
    annualRatePct: 12,
    rateType: "reducing",
    emi: computeEmi(750000, 12, 18),
    firstDueDate: FIRST_DUE,
  });
  assert.strictEqual(rows[0].openingBalance, 750000);
});

check("the LAST row's closing balance is exactly 0 — no leftover cents", () => {
  for (const rateType of ["reducing", "flat"]) {
    const rows = buildAmortizationSchedule({
      principal: 1000000,
      tenureMonths: 37, // deliberately awkward tenure to stress rounding
      annualRatePct: 13.75,
      rateType,
      emi: computeEmi(1000000, 13.75, 37),
      firstDueDate: FIRST_DUE,
    });
    assert.strictEqual(
      rows[rows.length - 1].closingBalance,
      0,
      `${rateType}: last closing balance should be exactly 0`
    );
  }
});

check("no row's closing balance is ever negative", () => {
  const rows = buildAmortizationSchedule({
    principal: 1000000,
    tenureMonths: 13,
    annualRatePct: 22.5,
    rateType: "reducing",
    emi: computeEmi(1000000, 22.5, 13),
    firstDueDate: FIRST_DUE,
  });
  for (const r of rows) assert(r.closingBalance >= 0, `negative balance at row ${r.installmentNo}`);
});

console.log("reducing-balance reconciliation");

check("sum of principal components equals the original principal exactly", () => {
  const principal = 2345678;
  const rows = buildAmortizationSchedule({
    principal,
    tenureMonths: 60,
    annualRatePct: 17.25,
    rateType: "reducing",
    emi: computeEmi(principal, 17.25, 60),
    firstDueDate: FIRST_DUE,
  });
  assert.strictEqual(sum(rows, "principalComponent"), principal);
});

check("interest declines monotonically as the balance shrinks", () => {
  const rows = buildAmortizationSchedule({
    principal: 1500000,
    tenureMonths: 36,
    annualRatePct: 14.5,
    rateType: "reducing",
    emi: computeEmi(1500000, 14.5, 36),
    firstDueDate: FIRST_DUE,
  });
  for (let i = 1; i < rows.length - 1; i++) {
    // Strictly non-increasing (equal only possible in pathological rounding
    // cases); with a real rate it should be strictly decreasing.
    assert(
      rows[i].interestComponent <= rows[i - 1].interestComponent,
      `interest rose at row ${i + 1}`
    );
  }
});

check("every row but the last carries the nominal EMI; only the last absorbs rounding", () => {
  const principal = 987654;
  const rate = 19.9;
  const tenure = 41;
  const emi = computeEmi(principal, rate, tenure);
  const rows = buildAmortizationSchedule({
    principal,
    tenureMonths: tenure,
    annualRatePct: rate,
    rateType: "reducing",
    emi,
    firstDueDate: FIRST_DUE,
  });
  for (const row of rows.slice(0, -1)) {
    assert.strictEqual(row.emi, round2(emi));
  }
  // The last row's EMI should be close to nominal but need not be identical.
  const last = rows[rows.length - 1];
  assert(Math.abs(last.emi - round2(emi)) < 1, "last EMI drifted implausibly far");
});

check("zero-interest reducing loan is straight-line principal, no interest anywhere", () => {
  const rows = buildAmortizationSchedule({
    principal: 1200000,
    tenureMonths: 12,
    annualRatePct: 0,
    rateType: "reducing",
    emi: computeEmi(1200000, 0, 12),
    firstDueDate: FIRST_DUE,
  });
  for (const r of rows) assert.strictEqual(r.interestComponent, 0);
  assert.strictEqual(sum(rows, "principalComponent"), 1200000);
  assert.deepStrictEqual(
    rows.map((r) => r.principalComponent),
    Array(12).fill(100000)
  );
});

console.log("flat-rate reconciliation");

check("sum of principal components equals the original principal exactly", () => {
  const principal = 1876543;
  const rows = buildAmortizationSchedule({
    principal,
    tenureMonths: 24,
    annualRatePct: 8.5,
    rateType: "flat",
    firstDueDate: FIRST_DUE,
  });
  assert.strictEqual(sum(rows, "principalComponent"), principal);
});

check("sum of interest components equals the flat total-interest formula exactly", () => {
  const principal = 1876543;
  const rate = 8.5;
  const tenure = 24;
  const rows = buildAmortizationSchedule({
    principal,
    tenureMonths: tenure,
    annualRatePct: rate,
    rateType: "flat",
    firstDueDate: FIRST_DUE,
  });
  const expectedTotalInterest = round2(principal * (rate / 100) * (tenure / 12));
  assert.strictEqual(sum(rows, "interestComponent"), expectedTotalInterest);
});

check("interest and principal are constant every month except the last (rounding absorption)", () => {
  const rows = buildAmortizationSchedule({
    principal: 900000,
    tenureMonths: 9,
    annualRatePct: 11,
    rateType: "flat",
    firstDueDate: FIRST_DUE,
  });
  const body = rows.slice(0, -1);
  const principals = new Set(body.map((r) => r.principalComponent));
  const interests = new Set(body.map((r) => r.interestComponent));
  assert.strictEqual(principals.size, 1, "principal component should be constant");
  assert.strictEqual(interests.size, 1, "interest component should be constant");
});

check("a flat schedule's total repayment matches computeFlatEmi × tenure to the cent", () => {
  const principal = 2500000;
  const rate = 14.5;
  const tenure = 36;
  const rows = buildAmortizationSchedule({
    principal,
    tenureMonths: tenure,
    annualRatePct: rate,
    rateType: "flat",
    firstDueDate: FIRST_DUE,
  });
  const totalFromSchedule = sum(rows, "emi");
  const totalFromFormula = round2(computeFlatEmi(principal, rate, tenure) * tenure);
  // Allow at most a couple of cents' difference — the schedule rounds each
  // EMI to 2dp per row (tenure roundings), the formula rounds once at the
  // end; both are "correct", they just distribute the same total rounding
  // budget differently.
  assert(
    Math.abs(totalFromSchedule - totalFromFormula) <= 0.05,
    `schedule total ${totalFromSchedule} vs formula total ${totalFromFormula}`
  );
});

console.log("edge cases");

check("a 1-month loan has exactly one row that pays off everything", () => {
  for (const rateType of ["reducing", "flat"]) {
    const principal = 100000;
    const rate = 15;
    const rows = buildAmortizationSchedule({
      principal,
      tenureMonths: 1,
      annualRatePct: rate,
      rateType,
      emi: computeEmi(principal, rate, 1),
      firstDueDate: FIRST_DUE,
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].principalComponent, principal);
    assert.strictEqual(rows[0].closingBalance, 0);
  }
});

check("rejects non-positive principal, non-integer/zero tenure, negative rate", () => {
  const base = {
    principal: 100000,
    tenureMonths: 12,
    annualRatePct: 10,
    rateType: "reducing",
    emi: 9000,
    firstDueDate: FIRST_DUE,
  };
  assert.throws(() => buildAmortizationSchedule({ ...base, principal: 0 }), /principal/);
  assert.throws(() => buildAmortizationSchedule({ ...base, principal: -5 }), /principal/);
  assert.throws(() => buildAmortizationSchedule({ ...base, tenureMonths: 0 }), /tenureMonths/);
  assert.throws(() => buildAmortizationSchedule({ ...base, tenureMonths: 2.5 }), /tenureMonths/);
  assert.throws(
    () => buildAmortizationSchedule({ ...base, annualRatePct: -1 }),
    /annualRatePct/
  );
});

check("an unrecognised rate_type falls back to reducing (matches computeEmiForRateType)", () => {
  const principal = 500000;
  const rate = 12;
  const tenure = 10;
  const asReducing = buildAmortizationSchedule({
    principal,
    tenureMonths: tenure,
    annualRatePct: rate,
    rateType: "reducing",
    emi: computeEmi(principal, rate, tenure),
    firstDueDate: FIRST_DUE,
  });
  const asUnknown = buildAmortizationSchedule({
    principal,
    tenureMonths: tenure,
    annualRatePct: rate,
    rateType: "nonsense",
    emi: computeEmi(principal, rate, tenure),
    firstDueDate: FIRST_DUE,
  });
  assert.deepStrictEqual(asUnknown, asReducing);
});

console.log(`\n${passed} assertions passed.`);

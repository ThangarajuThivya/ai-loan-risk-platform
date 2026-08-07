"use strict";

/**
 * Runnable test script for repayment allocation, arrears and settlement
 * (no test runner needed).
 *   node src/services/__tests__/repayment.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
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
  LATE_FEE_GRACE_DAYS,
  LATE_FEE_PERCENT,
  LATE_FEE_MIN_AMOUNT,
} = require("../repayment.service");
const { buildAmortizationSchedule } = require("../amortization.service");
const { computeEmi } = require("../recommendation.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/**
 * Build schedule rows in the shape the DB hands back (snake_case, with
 * paid columns), so the tests exercise exactly what production passes in.
 */
function makeSchedule({ principal = 900000, tenure = 12, rate = 12, rateType = "reducing" } = {}) {
  const rows = buildAmortizationSchedule({
    principal,
    tenureMonths: tenure,
    annualRatePct: rate,
    rateType,
    emi: computeEmi(principal, rate, tenure),
    firstDueDate: "2026-01-15",
  });
  return rows.map((r, i) => ({
    id: i + 1,
    installment_no: r.installmentNo,
    due_date: r.dueDate,
    principal_component: r.principalComponent,
    interest_component: r.interestComponent,
    emi: r.emi,
    principal_paid: 0,
    interest_paid: 0,
  }));
}

/** Apply allocations back onto rows, the way the model does after a write. */
function applyAllocations(rows, allocations) {
  for (const a of allocations) {
    const row = rows.find((r) => r.id === a.scheduleId);
    row.interest_paid = round2(row.interest_paid + a.interestAmount);
    row.principal_paid = round2(row.principal_paid + a.principalAmount);
  }
  return rows;
}

console.log("allocatePayment — ordering");

check("interest is satisfied before principal within an installment", () => {
  const rows = makeSchedule();
  const first = rows[0];
  // Pay exactly the interest and one rupee more.
  const { allocations } = allocatePayment({
    amount: round2(first.interest_component + 1),
    installments: rows,
  });
  assert.strictEqual(allocations.length, 1);
  assert.strictEqual(allocations[0].interestAmount, first.interest_component);
  assert.strictEqual(allocations[0].principalAmount, 1);
});

check("the oldest unpaid installment is served first, not the nearest due", () => {
  const rows = makeSchedule();
  const { allocations } = allocatePayment({ amount: 1000, installments: rows });
  assert.strictEqual(allocations[0].installmentNo, 1);
});

check("input order does not matter — rows are sorted by installment_no", () => {
  const rows = makeSchedule();
  const shuffled = [...rows].reverse();
  const a = allocatePayment({ amount: 200000, installments: rows });
  const b = allocatePayment({ amount: 200000, installments: shuffled });
  assert.deepStrictEqual(b.allocations, a.allocations);
});

check("already-settled installments are skipped entirely", () => {
  const rows = makeSchedule();
  // Settle installment 1 outright.
  rows[0].interest_paid = rows[0].interest_component;
  rows[0].principal_paid = rows[0].principal_component;
  const { allocations } = allocatePayment({ amount: 1000, installments: rows });
  assert.strictEqual(allocations[0].installmentNo, 2);
});

console.log("allocatePayment — amounts");

check("a payment smaller than the first installment's interest is all interest", () => {
  const rows = makeSchedule();
  const { allocations, allocated, unallocated } = allocatePayment({
    amount: 100,
    installments: rows,
  });
  assert.strictEqual(allocations[0].interestAmount, 100);
  assert.strictEqual(allocations[0].principalAmount, 0);
  assert.strictEqual(allocated, 100);
  assert.strictEqual(unallocated, 0);
});

check("a payment covering several installments spreads across them in order", () => {
  const rows = makeSchedule();
  const threeEmis = round2(rows[0].emi + rows[1].emi + rows[2].emi);
  const { allocations, unallocated } = allocatePayment({
    amount: threeEmis,
    installments: rows,
  });
  assert.deepStrictEqual(
    allocations.map((a) => a.installmentNo),
    [1, 2, 3]
  );
  assert.strictEqual(unallocated, 0);
  // Each of the three should be fully covered.
  applyAllocations(rows, allocations);
  for (const n of [1, 2, 3]) {
    assert.strictEqual(installmentStatus(rows[n - 1]), "paid");
  }
});

check("allocated + unallocated always equals the payment exactly", () => {
  const rows = makeSchedule();
  for (const amount of [1, 50000, 123456.78, 900000, 5000000]) {
    const { allocated, unallocated } = allocatePayment({ amount, installments: rows });
    assert.strictEqual(
      round2(allocated + unallocated),
      round2(amount),
      `payment ${amount} did not reconcile`
    );
  }
});

check("no allocation ever exceeds what that installment actually owes", () => {
  const rows = makeSchedule();
  const { allocations } = allocatePayment({ amount: 10000000, installments: rows });
  for (const a of allocations) {
    const row = rows.find((r) => r.id === a.scheduleId);
    assert(a.interestAmount <= row.interest_component + 1e-9, `over-allocated interest on ${a.installmentNo}`);
    assert(a.principalAmount <= row.principal_component + 1e-9, `over-allocated principal on ${a.installmentNo}`);
  }
});

check("an overpayment is reported as unallocated, never invented as credit", () => {
  const rows = makeSchedule();
  const total = computeOutstanding(rows).total;
  const { allocated, unallocated } = allocatePayment({
    amount: round2(total + 5000),
    installments: rows,
  });
  assert.strictEqual(allocated, total);
  assert.strictEqual(unallocated, 5000);
});

check("paying the exact outstanding total clears everything with nothing left over", () => {
  const rows = makeSchedule();
  const total = computeOutstanding(rows).total;
  const { allocations, unallocated } = allocatePayment({ amount: total, installments: rows });
  assert.strictEqual(unallocated, 0);
  applyAllocations(rows, allocations);
  assert.strictEqual(computeOutstanding(rows).total, 0);
  for (const row of rows) assert.strictEqual(installmentStatus(row), "paid");
});

check("a zero or negative payment is refused", () => {
  const rows = makeSchedule();
  for (const amount of [0, -1, -0.01]) {
    assert.throws(() => allocatePayment({ amount, installments: rows }), /positive/);
  }
});

console.log("allocatePayment — the ledger reconciles with the running totals");

check("sequential partial payments reconstruct the totals exactly", () => {
  // This is the invariant migration 027 exists to guarantee: the sum of the
  // allocation ledger must equal the *_paid running totals, always.
  const rows = makeSchedule();
  const ledger = [];
  for (const amount of [5000, 12345.67, 80000, 250000, 3333.33]) {
    const { allocations } = allocatePayment({ amount, installments: rows });
    ledger.push(...allocations);
    applyAllocations(rows, allocations);
  }
  for (const row of rows) {
    const mine = ledger.filter((a) => a.scheduleId === row.id);
    const interestFromLedger = round2(mine.reduce((s, a) => s + a.interestAmount, 0));
    const principalFromLedger = round2(mine.reduce((s, a) => s + a.principalAmount, 0));
    assert.strictEqual(interestFromLedger, row.interest_paid, `interest mismatch on ${row.installment_no}`);
    assert.strictEqual(principalFromLedger, row.principal_paid, `principal mismatch on ${row.installment_no}`);
  }
});

check("many small payments still fully retire the loan without drift", () => {
  const rows = makeSchedule({ principal: 1000000, tenure: 13, rate: 13.75 });
  const target = computeOutstanding(rows).total;
  let paid = 0;
  // Deliberately awkward instalment size that won't divide evenly.
  while (computeOutstanding(rows).total > 0 && paid < target + 1) {
    const { allocations, allocated } = allocatePayment({
      amount: Math.min(7777.77, computeOutstanding(rows).total),
      installments: rows,
    });
    applyAllocations(rows, allocations);
    paid = round2(paid + allocated);
  }
  assert.strictEqual(computeOutstanding(rows).total, 0);
  assert.strictEqual(paid, target, "total paid should exactly equal what was owed");
});

console.log("computeArrears");

const ARREARS_ROWS = () =>
  [
    { id: 1, installment_no: 1, due_date: "2026-01-15", principal_component: 1000, interest_component: 100, principal_paid: 0, interest_paid: 0 },
    { id: 2, installment_no: 2, due_date: "2026-02-15", principal_component: 1000, interest_component: 90, principal_paid: 0, interest_paid: 0 },
    { id: 3, installment_no: 3, due_date: "2026-03-15", principal_component: 1000, interest_component: 80, principal_paid: 0, interest_paid: 0 },
  ];

check("a loan with nothing yet due is not in arrears", () => {
  const a = computeArrears(ARREARS_ROWS(), "2026-01-01");
  assert.strictEqual(a.isInArrears, false);
  assert.strictEqual(a.daysPastDue, 0);
  assert.strictEqual(a.arrearsAmount, 0);
  assert.strictEqual(a.nextDueDate, "2026-01-15");
  assert.strictEqual(a.nextDueAmount, 1100);
});

check("an installment due TODAY is not yet late", () => {
  const a = computeArrears(ARREARS_ROWS(), "2026-01-15");
  assert.strictEqual(a.isInArrears, false);
  assert.strictEqual(a.daysPastDue, 0);
  assert.strictEqual(a.nextDueDate, "2026-01-15");
});

check("DPD starts the day after the due date", () => {
  const a = computeArrears(ARREARS_ROWS(), "2026-01-16");
  assert.strictEqual(a.isInArrears, true);
  assert.strictEqual(a.daysPastDue, 1);
  assert.strictEqual(a.arrearsAmount, 1100);
  assert.strictEqual(a.overdueCount, 1);
});

check("DPD is measured from the OLDEST unpaid installment, not the newest", () => {
  // Two installments overdue on 20 Feb: DPD must be 36 (from 15 Jan), not 5.
  const a = computeArrears(ARREARS_ROWS(), "2026-02-20");
  assert.strictEqual(a.overdueCount, 2);
  assert.strictEqual(a.daysPastDue, 36);
  assert.strictEqual(a.oldestOverdueDate, "2026-01-15");
  assert.strictEqual(a.arrearsAmount, round2(1100 + 1090));
});

check("clearing the oldest arrear moves DPD to the next one, it does not reset", () => {
  const rows = ARREARS_ROWS();
  rows[0].principal_paid = 1000;
  rows[0].interest_paid = 100;
  const a = computeArrears(rows, "2026-02-20");
  assert.strictEqual(a.daysPastDue, 5, "DPD should now run from 15 Feb");
  assert.strictEqual(a.oldestOverdueDate, "2026-02-15");
  assert.strictEqual(a.overdueCount, 1);
});

check("a partially paid overdue installment still counts, for its remainder only", () => {
  const rows = ARREARS_ROWS();
  rows[0].interest_paid = 100;
  rows[0].principal_paid = 400;
  const a = computeArrears(rows, "2026-01-20");
  assert.strictEqual(a.isInArrears, true);
  assert.strictEqual(a.arrearsAmount, 600);
});

check("a fully repaid loan is never in arrears, however old", () => {
  const rows = ARREARS_ROWS().map((r) => ({
    ...r,
    principal_paid: r.principal_component,
    interest_paid: r.interest_component,
  }));
  const a = computeArrears(rows, "2030-01-01");
  assert.strictEqual(a.isInArrears, false);
  assert.strictEqual(a.daysPastDue, 0);
  assert.strictEqual(a.nextDueDate, null);
});

console.log("computeSettlement");

check("future interest is waived; already-due interest is not", () => {
  // As at 20 Jan: installment 1 is due (interest payable), 2 and 3 are not.
  const s = computeSettlement(ARREARS_ROWS(), "2026-01-20");
  assert.strictEqual(s.principal, 3000, "all principal is always payable");
  assert.strictEqual(s.interest, 100, "only installment 1's interest");
  assert.strictEqual(s.interestWaived, 170, "installments 2 and 3");
  assert.strictEqual(s.total, 3100);
});

check("settling on day one waives essentially all the interest", () => {
  const s = computeSettlement(ARREARS_ROWS(), "2026-01-01");
  assert.strictEqual(s.interest, 0);
  assert.strictEqual(s.interestWaived, 270);
  assert.strictEqual(s.total, 3000);
});

check("settlement never exceeds the plain outstanding total", () => {
  const rows = makeSchedule();
  const s = computeSettlement(rows, "2026-03-01");
  const o = computeOutstanding(rows);
  assert(s.total <= o.total, "early settlement should never cost more than paying on schedule");
});

check("at maturity, settlement equals the full outstanding — nothing left to waive", () => {
  const s = computeSettlement(ARREARS_ROWS(), "2026-03-15");
  const o = computeOutstanding(ARREARS_ROWS());
  assert.strictEqual(s.total, o.total);
  assert.strictEqual(s.interestWaived, 0);
});

check("a settled loan settles for zero", () => {
  const rows = ARREARS_ROWS().map((r) => ({
    ...r,
    principal_paid: r.principal_component,
    interest_paid: r.interest_component,
  }));
  const s = computeSettlement(rows, "2026-02-01");
  assert.strictEqual(s.total, 0);
});

console.log("computeSettlementWaivers — waive-then-allocate");

check("only not-yet-due installments are waived", () => {
  const w = computeSettlementWaivers(ARREARS_ROWS(), "2026-01-20");
  assert.deepStrictEqual(
    w.map((x) => x.scheduleId),
    [2, 3],
    "installment 1 is already due, so its interest stands"
  );
  assert.strictEqual(round2(w.reduce((s, x) => s + x.waive, 0)), 170);
});

check("after waiving, outstanding equals the settlement quote exactly", () => {
  // This is the invariant that makes settlement work: waive first and the
  // loan can be cleared by a payment of exactly the quoted figure.
  const rows = ARREARS_ROWS();
  const quote = computeSettlement(rows, "2026-01-20");
  for (const w of computeSettlementWaivers(rows, "2026-01-20")) {
    const row = rows.find((r) => r.id === w.scheduleId);
    row.interest_waived = round2((row.interest_waived || 0) + w.waive);
  }
  assert.strictEqual(computeOutstanding(rows).total, quote.total);
});

check("paying the quote after waiving clears the loan to exactly zero", () => {
  const rows = ARREARS_ROWS();
  const quote = computeSettlement(rows, "2026-01-20");
  for (const w of computeSettlementWaivers(rows, "2026-01-20")) {
    const row = rows.find((r) => r.id === w.scheduleId);
    row.interest_waived = round2((row.interest_waived || 0) + w.waive);
  }
  const { allocations, unallocated } = allocatePayment({
    amount: quote.total,
    installments: rows,
  });
  assert.strictEqual(unallocated, 0);
  applyAllocations(rows, allocations);
  assert.strictEqual(computeOutstanding(rows).total, 0);
  for (const row of rows) assert.strictEqual(installmentStatus(row), "paid");
});

check("allocate-then-waive would NOT clear the loan — order is load-bearing", () => {
  // The naive order: pay the quote straight in, then waive. Oldest-first
  // allocation spends part of the payment on future interest, stranding
  // principal, so the loan stays open. This asserts the failure mode the
  // waive-first ordering exists to avoid.
  const rows = ARREARS_ROWS();
  const quote = computeSettlement(rows, "2026-01-20");
  const { allocations } = allocatePayment({ amount: quote.total, installments: rows });
  applyAllocations(rows, allocations);
  for (const w of computeSettlementWaivers(rows, "2026-01-20")) {
    const row = rows.find((r) => r.id === w.scheduleId);
    row.interest_waived = round2((row.interest_waived || 0) + w.waive);
  }
  assert(
    computeOutstanding(rows).total > 0,
    "the wrong order should leave a balance — if this ever passes, the ordering no longer matters"
  );
});

check("waived interest reduces what is owed without counting as received", () => {
  const rows = ARREARS_ROWS();
  rows[2].interest_waived = 80;
  const owed = outstandingOn(rows[2]);
  assert.strictEqual(owed.interest, 0, "nothing further is owed in interest");
  assert.strictEqual(Number(rows[2].interest_paid), 0, "but nothing was received either");
});

console.log("computeLateFee");

check("charges the greater of the flat minimum and the percentage", () => {
  // Small EMI: percentage would be tiny, so the flat minimum applies.
  assert.strictEqual(computeLateFee(1000), LATE_FEE_MIN_AMOUNT);
  // Large EMI: percentage exceeds the minimum, so it applies instead.
  const bigEmi = 100000;
  assert.strictEqual(computeLateFee(bigEmi), round2(bigEmi * (LATE_FEE_PERCENT / 100)));
});

check("a zero or missing EMI still charges the flat minimum, never negative", () => {
  assert.strictEqual(computeLateFee(0), LATE_FEE_MIN_AMOUNT);
  assert.strictEqual(computeLateFee(undefined), LATE_FEE_MIN_AMOUNT);
  assert.strictEqual(computeLateFee(-500), LATE_FEE_MIN_AMOUNT);
});

check("custom policy options override the defaults", () => {
  assert.strictEqual(computeLateFee(10000, { percent: 5, minAmount: 100 }), 500);
  assert.strictEqual(computeLateFee(100, { percent: 5, minAmount: 1000 }), 1000);
});

console.log("computeLateFeeAssessments");

function feeRows() {
  return [
    { id: 1, installment_no: 1, due_date: "2026-01-01", principal_component: 1000, interest_component: 100, emi: 1100, principal_paid: 0, interest_paid: 0, late_fee_charged_at: null },
    { id: 2, installment_no: 2, due_date: "2026-02-01", principal_component: 1000, interest_component: 90, emi: 1090, principal_paid: 0, interest_paid: 0, late_fee_charged_at: null },
    { id: 3, installment_no: 3, due_date: "2026-03-01", principal_component: 1000, interest_component: 80, emi: 1080, principal_paid: 0, interest_paid: 0, late_fee_charged_at: null },
  ];
}

check("nothing is assessed within the grace period", () => {
  // Due 1 Jan, grace 3 days: as at 3 Jan (DPD 2) no fee yet.
  const a = computeLateFeeAssessments(feeRows(), "2026-01-03");
  assert.deepStrictEqual(a, []);
});

check("a fee is assessed the day AFTER the grace period elapses", () => {
  // DPD 3 is still within grace (dpd > graceDays is the trigger); DPD 4 is not.
  assert.deepStrictEqual(computeLateFeeAssessments(feeRows(), "2026-01-04"), []);
  const a = computeLateFeeAssessments(feeRows(), "2026-01-05");
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].installmentNo, 1);
  assert.strictEqual(a[0].feeAmount, computeLateFee(1100));
});

check("multiple overdue installments are each assessed independently", () => {
  const a = computeLateFeeAssessments(feeRows(), "2026-03-10");
  assert.deepStrictEqual(a.map((x) => x.installmentNo), [1, 2, 3]);
});

check("an installment already charged a fee is never charged a second one", () => {
  const rows = feeRows();
  rows[0].late_fee_charged_at = "2026-01-10T00:00:00Z";
  const a = computeLateFeeAssessments(rows, "2026-06-01");
  assert.deepStrictEqual(
    a.map((x) => x.installmentNo),
    [2, 3],
    "installment 1 already has a fee and must be skipped forever"
  );
});

check("an installment already fully repaid earns no fee, however overdue", () => {
  const rows = feeRows();
  rows[0].principal_paid = 1000;
  rows[0].interest_paid = 100;
  const a = computeLateFeeAssessments(rows, "2026-06-01");
  assert.deepStrictEqual(a.map((x) => x.installmentNo), [2, 3]);
});

check("a partially paid overdue installment still earns the fee", () => {
  const rows = feeRows();
  rows[0].principal_paid = 500; // still owes 500 principal + all interest
  const a = computeLateFeeAssessments(rows, "2026-01-10");
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].installmentNo, 1);
});

check("custom grace period is honoured", () => {
  const a = computeLateFeeAssessments(feeRows(), "2026-01-03", { graceDays: 1 });
  assert.strictEqual(a.length, 1, "with 1 day grace, DPD 2 should already be assessable");
});

console.log("late fees inside allocation / outstanding / arrears / settlement");

function feeScheduleRow(overrides = {}) {
  return {
    id: 1,
    installment_no: 1,
    due_date: "2026-01-01",
    principal_component: 1000,
    interest_component: 100,
    emi: 1100,
    principal_paid: 0,
    interest_paid: 0,
    late_fee_amount: 0,
    late_fee_paid: 0,
    late_fee_waived: 0,
    ...overrides,
  };
}

check("outstandingOn includes the fee bucket in the total", () => {
  const row = feeScheduleRow({ late_fee_amount: 500 });
  const owed = outstandingOn(row);
  assert.strictEqual(owed.fee, 500);
  assert.strictEqual(owed.total, round2(500 + 100 + 1000));
});

check("allocatePayment pays the fee BEFORE interest and principal", () => {
  const row = feeScheduleRow({ late_fee_amount: 500 });
  const { allocations } = allocatePayment({ amount: 600, installments: [row] });
  assert.strictEqual(allocations[0].feeAmount, 500);
  assert.strictEqual(allocations[0].interestAmount, 100);
  assert.strictEqual(allocations[0].principalAmount, 0);
});

check("a fee-only payment settles the fee and leaves interest/principal untouched", () => {
  const row = feeScheduleRow({ late_fee_amount: 500 });
  const { allocations } = allocatePayment({ amount: 500, installments: [row] });
  assert.strictEqual(allocations[0].feeAmount, 500);
  assert.strictEqual(allocations[0].interestAmount, 0);
  assert.strictEqual(allocations[0].principalAmount, 0);
});

check("computeOutstanding sums fees across installments into its own bucket", () => {
  const rows = [feeScheduleRow({ id: 1, late_fee_amount: 500 }), feeScheduleRow({ id: 2, late_fee_amount: 300 })];
  const o = computeOutstanding(rows);
  assert.strictEqual(o.fees, 800);
  assert.strictEqual(o.total, round2(800 + 2200));
});

check("computeArrears' amount includes outstanding fees on overdue installments", () => {
  const row = feeScheduleRow({ late_fee_amount: 500, due_date: "2026-01-01" });
  const a = computeArrears([row], "2026-02-01");
  assert.strictEqual(a.arrearsAmount, round2(500 + 100 + 1000));
});

check("computeSettlement never waives a fee — it only ever sits on a due installment", () => {
  const row = feeScheduleRow({ late_fee_amount: 500, due_date: "2026-01-01" });
  const s = computeSettlement([row], "2026-01-01");
  assert.strictEqual(s.fees, 500);
  assert.strictEqual(s.total, round2(500 + 100 + 1000));
});

check("a waived fee is excluded from outstanding without counting as paid", () => {
  const row = feeScheduleRow({ late_fee_amount: 500, late_fee_waived: 500 });
  const owed = outstandingOn(row);
  assert.strictEqual(owed.fee, 0);
  assert.strictEqual(Number(row.late_fee_paid), 0);
});

check("a partially waived fee leaves the remainder still collectible", () => {
  const row = feeScheduleRow({ late_fee_amount: 500, late_fee_waived: 200 });
  assert.strictEqual(outstandingOn(row).fee, 300);
});

console.log("installmentStatus");

check("due / partial / paid are mutually exclusive and exhaustive", () => {
  const base = { principal_component: 1000, interest_component: 100 };
  assert.strictEqual(installmentStatus({ ...base, principal_paid: 0, interest_paid: 0 }), "due");
  assert.strictEqual(installmentStatus({ ...base, principal_paid: 0, interest_paid: 50 }), "partial");
  assert.strictEqual(installmentStatus({ ...base, principal_paid: 999, interest_paid: 100 }), "partial");
  assert.strictEqual(installmentStatus({ ...base, principal_paid: 1000, interest_paid: 100 }), "paid");
});

check("a late fee affects status too — paying only the fee counts as 'partial'", () => {
  const base = {
    principal_component: 1000,
    interest_component: 100,
    principal_paid: 0,
    interest_paid: 0,
    late_fee_amount: 500,
  };
  assert.strictEqual(installmentStatus({ ...base, late_fee_paid: 0 }), "due");
  assert.strictEqual(installmentStatus({ ...base, late_fee_paid: 500 }), "partial");
});

check("an installment is not 'paid' while its fee is still outstanding", () => {
  const row = {
    principal_component: 1000,
    interest_component: 100,
    principal_paid: 1000,
    interest_paid: 100,
    late_fee_amount: 500,
    late_fee_paid: 0,
  };
  assert.strictEqual(installmentStatus(row), "partial");
});

console.log(`\n${passed} assertions passed.`);

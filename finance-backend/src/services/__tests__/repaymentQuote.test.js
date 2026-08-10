"use strict";

/**
 * Runnable test script for customer repayment quoting (040).
 *   node src/services/__tests__/repaymentQuote.test.js
 * Exits non-zero on the first failed assertion.
 *
 * The property under test throughout: the CLIENT never decides the amount.
 * A quote must be derivable from the schedule alone, and must refuse anything
 * loanModel.recordPayment would refuse at the ledger.
 */

const assert = require("assert");
const {
  PAYMENT_KINDS,
  MIN_PAYMENT,
  nextInstallmentDue,
  buildQuoteOptions,
  resolvePayment,
} = require("../repaymentQuote.service");
const { computeOutstanding, computeSettlement } = require("../repayment.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** A schedule row with sane defaults; override what a test cares about. */
function row(overrides = {}) {
  return {
    id: overrides.installment_no ?? 1,
    installment_no: 1,
    due_date: "2026-01-15",
    principal_component: 9000,
    interest_component: 1000,
    emi: 10000,
    principal_paid: 0,
    interest_paid: 0,
    interest_waived: 0,
    late_fee_amount: 0,
    late_fee_paid: 0,
    late_fee_waived: 0,
    ...overrides,
  };
}

/** Three instalments: #1 past due, #2 due today-ish, #3 in the future. */
function schedule() {
  return [
    row({ id: 1, installment_no: 1, due_date: "2026-01-15" }),
    row({ id: 2, installment_no: 2, due_date: "2026-02-15" }),
    row({ id: 3, installment_no: 3, due_date: "2026-03-15" }),
  ];
}

const AS_OF = new Date("2026-02-20T00:00:00Z"); // #1 and #2 due, #3 not yet

console.log("nextInstallmentDue");

check("returns the OLDEST unpaid instalment, matching allocation order", () => {
  const next = nextInstallmentDue(schedule());
  assert.strictEqual(next.installmentNo, 1);
  assert.strictEqual(next.amount, 10000);
});

check("skips fully-paid rows", () => {
  const rows = schedule();
  rows[0].principal_paid = 9000;
  rows[0].interest_paid = 1000;
  assert.strictEqual(nextInstallmentDue(rows).installmentNo, 2);
});

check("is the REMAINING balance, not the nominal EMI", () => {
  const rows = schedule();
  rows[0].principal_paid = 4000; // part-paid
  assert.strictEqual(nextInstallmentDue(rows).amount, 6000);
});

check("includes an unpaid late fee", () => {
  const rows = schedule();
  rows[0].late_fee_amount = 500;
  assert.strictEqual(nextInstallmentDue(rows).amount, 10500);
});

check("excludes waived interest and waived fees", () => {
  const rows = schedule();
  rows[0].interest_waived = 1000;
  rows[0].late_fee_amount = 500;
  rows[0].late_fee_waived = 500;
  assert.strictEqual(nextInstallmentDue(rows).amount, 9000);
});

check("returns null on a fully repaid loan", () => {
  const rows = schedule().map((r) => ({
    ...r,
    principal_paid: r.principal_component,
    interest_paid: r.interest_component,
  }));
  assert.strictEqual(nextInstallmentDue(rows), null);
});

check("does not depend on the caller sorting the rows", () => {
  const reversed = schedule().reverse();
  assert.strictEqual(nextInstallmentDue(reversed).installmentNo, 1);
});

console.log("\nbuildQuoteOptions");

check("agrees with the engine it composes — no independent arithmetic", () => {
  const rows = schedule();
  const opts = buildQuoteOptions(rows, AS_OF);
  assert.deepStrictEqual(opts.outstanding, computeOutstanding(rows));
  assert.deepStrictEqual(opts.settlement, computeSettlement(rows, AS_OF));
});

check("payable is false only when nothing is owed", () => {
  assert.strictEqual(buildQuoteOptions(schedule(), AS_OF).payable, true);
  const paid = schedule().map((r) => ({
    ...r,
    principal_paid: r.principal_component,
    interest_paid: r.interest_component,
  }));
  assert.strictEqual(buildQuoteOptions(paid, AS_OF).payable, false);
});

console.log("\nresolvePayment — kind: installment");

check("charges the oldest unpaid instalment", () => {
  const res = resolvePayment({ installments: schedule(), kind: "installment", asOf: AS_OF });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.amount, 10000);
  assert.strictEqual(res.paymentType, "installment");
});

check("ignores any amount the client tries to supply", () => {
  // The whole security property: a tampered client cannot lower the charge.
  const res = resolvePayment({
    installments: schedule(),
    kind: "installment",
    amount: 1,
    asOf: AS_OF,
  });
  assert.strictEqual(res.amount, 10000);
});

console.log("\nresolvePayment — kind: settlement");

check("charges exactly computeSettlement's figure", () => {
  const rows = schedule();
  const res = resolvePayment({ installments: rows, kind: "settlement", asOf: AS_OF });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.amount, computeSettlement(rows, AS_OF).total);
  assert.strictEqual(res.paymentType, "settlement");
});

check("settlement is cheaper than the outstanding total when future interest is waived", () => {
  const rows = schedule();
  const res = resolvePayment({ installments: rows, kind: "settlement", asOf: AS_OF });
  const outstanding = computeOutstanding(rows).total;
  // #3 is not yet due, so its 1000 interest is waived.
  assert.strictEqual(outstanding - res.amount, 1000);
});

check("settlement amount is exact — recordPayment rejects anything else", () => {
  // recordPayment returns settlementMismatch unless amount === quote.total,
  // so a quote that were even a cent off would be unpayable.
  const rows = schedule();
  const res = resolvePayment({ installments: rows, kind: "settlement", asOf: AS_OF });
  assert.strictEqual(res.amount, computeSettlement(rows, AS_OF).total);
});

console.log("\nresolvePayment — kind: custom");

check("accepts a valid amount inside the outstanding balance", () => {
  const res = resolvePayment({
    installments: schedule(),
    kind: "custom",
    amount: 15000,
    asOf: AS_OF,
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.amount, 15000);
  assert.strictEqual(res.paymentType, "installment");
});

check("accepts exactly the outstanding balance", () => {
  const rows = schedule();
  const total = computeOutstanding(rows).total;
  assert.strictEqual(resolvePayment({ installments: rows, kind: "custom", amount: total, asOf: AS_OF }).ok, true);
});

check("rejects an overpayment, naming the balance", () => {
  const rows = schedule();
  const total = computeOutstanding(rows).total;
  const res = resolvePayment({ installments: rows, kind: "custom", amount: total + 1, asOf: AS_OF });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "OVERPAYMENT");
  assert.strictEqual(res.outstanding, total);
});

check("rejects zero, negative, NaN and non-numeric amounts", () => {
  for (const bad of [0, -1, NaN, "abc", null, undefined]) {
    const res = resolvePayment({ installments: schedule(), kind: "custom", amount: bad, asOf: AS_OF });
    assert.strictEqual(res.ok, false, `expected ${bad} to be rejected`);
  }
});

check("rejects an amount below the processing minimum", () => {
  const res = resolvePayment({
    installments: schedule(),
    kind: "custom",
    amount: MIN_PAYMENT - 1,
    asOf: AS_OF,
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "BELOW_MINIMUM");
});

console.log("\nresolvePayment — guards");

check("rejects an unknown kind rather than defaulting to one", () => {
  for (const bad of ["refund", "", null, undefined, "INSTALLMENT"]) {
    const res = resolvePayment({ installments: schedule(), kind: bad, asOf: AS_OF });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "INVALID_KIND");
  }
});

check("every advertised kind actually resolves", () => {
  for (const kind of PAYMENT_KINDS) {
    const res = resolvePayment({
      installments: schedule(),
      kind,
      amount: 5000,
      asOf: AS_OF,
    });
    assert.strictEqual(res.ok, true, `${kind} should resolve`);
    assert.ok(res.amount > 0);
    assert.ok(["installment", "settlement"].includes(res.paymentType));
  }
});

check("a fully repaid loan refuses every kind", () => {
  const paid = schedule().map((r) => ({
    ...r,
    principal_paid: r.principal_component,
    interest_paid: r.interest_component,
  }));
  for (const kind of PAYMENT_KINDS) {
    const res = resolvePayment({ installments: paid, kind, amount: 1000, asOf: AS_OF });
    assert.strictEqual(res.ok, false, `${kind} should be refused`);
    assert.strictEqual(res.reason, "NOTHING_OWED");
  }
});

// --- dust residuals: the same LKR-0.36 bug as the lease side, mirrored ----
// Confirmed live on the lease side (application #103): a rounding-off
// offline receipt left a rental 0.36 short, "pay next" quoted exactly that,
// and Stripe refused the checkout outright. nextInstallmentDue has the
// identical shape of bug — an EMI that is a few cents short after a rounded
// manual receipt — so it gets the identical fix.
check("a residual below MIN_PAYMENT rolls forward into the next instalment", () => {
  const rows = [
    row({ id: 1, installment_no: 1, due_date: "2026-01-15", principal_paid: 9000, interest_paid: 999.64 }),
    row({ id: 2, installment_no: 2, due_date: "2026-02-15" }),
  ];
  const next = nextInstallmentDue(rows);
  assert.strictEqual(next.installmentNo, 1);
  assert.strictEqual(next.throughInstallmentNo, 2);
  // 0.36 residual on #1, plus the whole of #2 (10,000).
  assert.strictEqual(next.amount, 10000.36);
});

check("an ordinary, non-dust instalment is unaffected by roll-forward", () => {
  const next = nextInstallmentDue(schedule());
  assert.strictEqual(next.throughInstallmentNo, undefined);
  assert.strictEqual(next.amount, 10000);
});

check("dust on the FINAL instalment, with nothing to roll into, is refused not charged", () => {
  const rows = [row({ id: 1, installment_no: 1, principal_paid: 9000, interest_paid: 999.64 })];
  const next = nextInstallmentDue(rows);
  assert.strictEqual(next.throughInstallmentNo, undefined);
  assert.ok(next.amount < 1, "the raw residual is still tiny");

  const res = resolvePayment({ installments: rows, kind: "installment", asOf: AS_OF });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "BELOW_MINIMUM");
  assert.ok(res.message.length > 0);
});

check("resolvePayment for 'installment' charges the rolled-forward figure, never the dust", () => {
  const rows = [
    row({ id: 1, installment_no: 1, principal_paid: 9000, interest_paid: 999.64 }),
    row({ id: 2, installment_no: 2, due_date: "2026-02-15" }),
  ];
  const res = resolvePayment({ installments: rows, kind: "installment", asOf: AS_OF });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.amount, 10000.36);
  assert.ok(res.amount >= MIN_PAYMENT);
});

check("every rejection carries a message a customer could act on", () => {
  const rejections = [
    resolvePayment({ installments: schedule(), kind: "nope", asOf: AS_OF }),
    resolvePayment({ installments: schedule(), kind: "custom", amount: 0, asOf: AS_OF }),
    resolvePayment({ installments: schedule(), kind: "custom", amount: 1e9, asOf: AS_OF }),
  ];
  for (const r of rejections) {
    assert.strictEqual(r.ok, false);
    assert.ok(typeof r.message === "string" && r.message.length > 0);
  }
});

console.log(`\n${passed} assertions passed.`);

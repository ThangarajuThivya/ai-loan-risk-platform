"use strict";

/**
 * leaseRentalQuote.service — what a lessee may pay today, and for how much.
 *
 * The load-bearing property throughout is that every quoted figure is a
 * TOP-UP, not a face value. The rental ledger keeps no per-row paid amount,
 * so quoting `rental_amount` when part of that rental has already been
 * covered would charge the lessee twice for the same money.
 */

const assert = require("assert");
const {
  buildRentalOptions,
  resolvePaymentAmount,
} = require("../leaseRentalQuote.service");
const { round2 } = require("../amortization.service");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok - " + name);
};

/**
 * A 12-month flat-rate lease: 100,000 capital + 12,000 finance charge,
 * quoted as 9,333.33 a month. Round numbers so the arithmetic is checkable
 * by hand.
 */
function schedule({ months = 12, rental = 9333.33, finance = 1000, firstDue = "2026-01-01" } = {}) {
  const rows = [];
  for (let i = 1; i <= months; i += 1) {
    const d = new Date(firstDue);
    d.setMonth(d.getMonth() + (i - 1));
    rows.push({
      rental_no: i,
      due_date: d.toISOString().slice(0, 10),
      rental_amount: rental,
      finance_component: finance,
    });
  }
  return rows;
}

const RENTAL = 9333.33;
const TOTAL = 111999.96; // 12 × 9333.33

// --- nothing paid yet -------------------------------------------------------
{
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });

  assert.strictEqual(o.payable, true);
  assert.strictEqual(o.totalRentals, TOTAL);
  assert.strictEqual(o.outstanding, TOTAL);
  assert.strictEqual(o.rentalsPaid, 0);
  ok("a fresh lease owes every rental and nothing has been paid");

  assert.strictEqual(o.nextRental.rentalNo, 1);
  assert.strictEqual(o.nextRental.amount, RENTAL);
  assert.strictEqual(o.nextRental.partiallyPaid, false);
  ok("the next rental is #1 at its full contractual amount");

  // Nothing is overdue on the day the first rental falls due.
  assert.strictEqual(o.arrears, null);
  ok("a rental due TODAY is not in arrears — arrears begin the day after");
}

// --- the top-up property ----------------------------------------------------
{
  // 5,000 sits on rental #1, which is not enough to clear it.
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 5000,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });

  assert.strictEqual(o.rentalsPaid, 0, "a part-paid rental is not a paid rental");
  assert.strictEqual(o.nextRental.rentalNo, 1);
  assert.strictEqual(o.nextRental.rentalAmount, RENTAL);
  assert.strictEqual(o.nextRental.amount, 4333.33);
  assert.strictEqual(o.nextRental.partiallyPaid, true);
  ok("LOAD-BEARING: a part-paid rental is quoted as the TOP-UP (4,333.33), not the full 9,333.33");

  assert.strictEqual(o.outstanding, 106999.96);
  ok("outstanding drops by exactly what was received");
}

// --- an overpayment rolls forward ------------------------------------------
{
  // Two rentals plus a bit: 20,000 covers #1 and #2 (18,666.66) with 1,333.34
  // left sitting on #3.
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 20000,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });

  assert.strictEqual(o.rentalsPaid, 2);
  assert.strictEqual(o.nextRental.rentalNo, 3);
  assert.strictEqual(o.nextRental.amount, 7999.99);
  ok("money beyond a rental rolls onto the next one and reduces what it costs to clear");
}

// --- arrears ----------------------------------------------------------------
{
  // 1 April: rentals 1, 2 and 3 (Jan, Feb, Mar) are all past due, nothing paid.
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-04-01",
  });

  assert.strictEqual(o.arrears.count, 3);
  assert.strictEqual(o.arrears.amount, 27999.99);
  assert.strictEqual(o.arrears.oldestDueDate, "2026-01-01");
  ok("three months unpaid on 1 April is 3 rentals of arrears, totalling 27,999.99");

  // The rental due on 1 April itself is not yet late.
  assert.strictEqual(o.nextRental.rentalNo, 1);
  ok("arrears are judged on the DUE DATE, and today's rental is not overdue");
}

{
  // Paying the arrears exactly clears them.
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 27999.99,
    monthlyRental: RENTAL,
    today: "2026-04-01",
  });
  assert.strictEqual(o.arrears, null);
  assert.strictEqual(o.rentalsPaid, 3);
  ok("paying the arrears figure exactly clears the arrears");
}

// --- early settlement -------------------------------------------------------
{
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });

  // Sum-of-digits with nothing paid rebates the WHOLE finance charge:
  // remaining=12, N=12 → 12×13 / 12×13 = 1. Total interest is 12 × 1,000.
  assert.strictEqual(o.settlement.interestRebate, 12000);
  assert.strictEqual(o.settlement.grossOutstanding, TOTAL);
  assert.strictEqual(o.settlement.amount, 99999.96);
  ok("LOAD-BEARING: settling before any rental is paid rebates the entire finance charge");

  assert.strictEqual(o.settlement.saving, 12000);
  assert.ok(o.settlement.amount < o.outstanding, "settling must cost less than paying it all out");
  ok("the saving is stated, and settlement is cheaper than the remaining rentals");
}

{
  // Half way through: 6 paid, 6 remaining. Rebate = 12000 × (6×7)/(12×13).
  const o = buildRentalOptions({
    schedule: schedule(),
    received: RENTAL * 6,
    monthlyRental: RENTAL,
    today: "2026-07-01",
  });

  assert.strictEqual(o.rentalsPaid, 6);
  assert.strictEqual(o.settlement.rentalsRemaining, 6);
  assert.strictEqual(o.settlement.interestRebate, 3230.77);
  assert.strictEqual(o.settlement.grossOutstanding, 55999.98);
  assert.strictEqual(o.settlement.amount, 52769.21);
  ok("half way through, the rebate is sum-of-digits on the SIX rentals not yet reached");
}

{
  // A part-paid row earns no rebate, but the money on it still counts.
  const withCredit = buildRentalOptions({
    schedule: schedule(),
    received: RENTAL * 6 + 4000,
    monthlyRental: RENTAL,
    today: "2026-07-01",
  });
  const without = buildRentalOptions({
    schedule: schedule(),
    received: RENTAL * 6,
    monthlyRental: RENTAL,
    today: "2026-07-01",
  });

  assert.strictEqual(withCredit.rentalsPaid, 6, "4,000 does not buy a seventh rental");
  assert.strictEqual(
    withCredit.settlement.interestRebate,
    without.settlement.interestRebate,
    "a part-paid rental earns no extra rebate"
  );
  assert.strictEqual(withCredit.settlement.amount, without.settlement.amount - 4000);
  ok("LOAD-BEARING: credit on a part-paid rental is netted off settlement, but earns no rebate");
}

// --- the lease is finished --------------------------------------------------
{
  const o = buildRentalOptions({
    schedule: schedule(),
    received: TOTAL,
    monthlyRental: RENTAL,
    today: "2027-01-01",
  });
  assert.strictEqual(o.payable, false);
  assert.strictEqual(o.outstanding, 0);
  assert.strictEqual(o.nextRental, null);
  assert.strictEqual(o.settlement, null);
  assert.strictEqual(o.rentalsPaid, 12);
  ok("a fully paid lease is not payable, and offers no options");
}

// --- a lease DISCHARGED by settlement, not by paying face value -------------
{
  // What the ledger looks like after an early settlement: every row is
  // 'paid', but the money received is short of the face value by exactly the
  // rebate. Deriving "what is left" from money alone would report that
  // rebate as an unpaid balance on a lease that is closed.
  const settled = schedule().map((r) => ({ ...r, status: "paid" }));
  const o = buildRentalOptions({
    schedule: settled,
    received: 99999.96, // the settlement figure, 12,000 below face value
    monthlyRental: RENTAL,
    today: "2026-02-01",
  });

  assert.strictEqual(o.payable, false);
  assert.strictEqual(o.outstanding, 0, "a settled lease owes nothing, rebate and all");
  assert.strictEqual(o.rentalsPaid, 12);
  assert.strictEqual(o.nextRental, null);
  assert.strictEqual(o.arrears, null, "a discharged row cannot be overdue");
  ok("LOAD-BEARING: a lease discharged by settlement owes 0 — the rebate is not a debt");
}

{
  // Row status also decides coverage part-way through, so a discharged row
  // is never re-quoted just because the money on it was short.
  const rows = schedule().map((r, i) => ({ ...r, status: i < 3 ? "paid" : "due" }));
  const o = buildRentalOptions({
    schedule: rows,
    received: RENTAL * 3,
    monthlyRental: RENTAL,
    today: "2026-04-02",
  });
  assert.strictEqual(o.rentalsPaid, 3);
  assert.strictEqual(o.nextRental.rentalNo, 4);
  assert.strictEqual(o.nextRental.amount, RENTAL);
  ok("the schedule's own status decides which rental comes next");
}

// --- degenerate inputs ------------------------------------------------------
{
  assert.strictEqual(buildRentalOptions({ schedule: [], received: 0, monthlyRental: 1 }), null);
  assert.strictEqual(buildRentalOptions({ schedule: null, received: 0, monthlyRental: 1 }), null);
  assert.strictEqual(
    buildRentalOptions({ schedule: schedule(), received: -1, monthlyRental: RENTAL }),
    null
  );
  ok("no schedule, or a negative receipt total, returns null rather than a wrong number");
}

// --- resolvePaymentAmount: the client sends a kind, never a price -----------
{
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-04-01",
  });

  assert.strictEqual(resolvePaymentAmount(o, "rental").amount, RENTAL);
  assert.strictEqual(resolvePaymentAmount(o, "arrears").amount, 27999.99);
  assert.strictEqual(resolvePaymentAmount(o, "settlement").amount, 99999.96);
  ok("each kind resolves to the figure the server computed, not one the client supplied");

  assert.strictEqual(resolvePaymentAmount(o, "custom", 5000).amount, 5000);
  ok("a custom amount within the balance is accepted");

  const over = resolvePaymentAmount(o, "custom", TOTAL + 1);
  assert.strictEqual(over.error, "OVERPAYMENT");
  assert.match(over.message, /most you can pay/i);
  ok("LOAD-BEARING: a custom amount beyond the balance is refused BEFORE any card is charged");

  assert.strictEqual(resolvePaymentAmount(o, "custom", 0).error, "INVALID_AMOUNT");
  assert.strictEqual(resolvePaymentAmount(o, "custom", -50).error, "INVALID_AMOUNT");
  assert.strictEqual(resolvePaymentAmount(o, "custom", "abc").error, "INVALID_AMOUNT");
  ok("zero, negative and non-numeric custom amounts are all refused");

  assert.strictEqual(resolvePaymentAmount(o, "nonsense").error, "UNKNOWN_KIND");
  ok("an unrecognised kind is refused rather than defaulted");
}

{
  // Settling is cheaper than the outstanding balance, so a lessee must not be
  // able to reach the settlement price by typing it into the custom box —
  // that would discharge the lease without the settlement path's checks.
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });
  const custom = resolvePaymentAmount(o, "custom", o.settlement.amount);
  assert.strictEqual(custom.amount, o.settlement.amount);
  assert.ok(!custom.error, "the amount itself is legal as a part payment");
  // It is accepted as a PART PAYMENT — 99,999.96 of 111,999.96 — and the
  // ledger will not treat it as a settlement, because kind is what decides
  // that, not the number. See leaseAgreement.model.recordRental.
  assert.ok(custom.amount < o.outstanding);
  ok("LOAD-BEARING: typing the settlement figure into custom buys a part payment, not a discharge");
}

// --- no arrears, no settlement, on a lease that has none --------------------
{
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });
  assert.strictEqual(resolvePaymentAmount(o, "arrears").error, "NO_ARREARS");
  ok("asking to pay arrears on a lease with none is refused");

  const finished = buildRentalOptions({
    schedule: schedule(),
    received: TOTAL,
    monthlyRental: RENTAL,
    today: "2027-01-01",
  });
  assert.strictEqual(resolvePaymentAmount(finished, "rental").error, "NOTHING_DUE");
  assert.strictEqual(resolvePaymentAmount(finished, "settlement").error, "NOTHING_DUE");
  ok("nothing can be paid on a lease that owes nothing");
}

// --- dust residuals: the LKR 0.36 bug, reproduced from real data -----------
// Application #103's real ledger: three rentals of 35,583.34 each, paid as
// 35,583.00 + 35,583.33 + 35,583.33 = 106,749.66 — 0.36 short of clearing
// the third. "Pay next rental" quoted exactly LKR 0.36, Stripe refused the
// checkout outright (502: "must convert to at least 30 pence"), and the
// customer had no way to pay online at all.
{
  const rows = schedule({ months: 24, rental: 35583.34, finance: 3000 });
  const o = buildRentalOptions({
    schedule: rows,
    received: 106749.66,
    monthlyRental: 35583.34,
    today: "2026-01-01",
  });

  assert.strictEqual(o.nextRental.rentalNo, 3);
  assert.strictEqual(o.nextRental.partiallyPaid, true);
  ok("reproduced: rental #3 is sitting 0.36 short, exactly as on #103");

  assert.ok(
    o.nextRental.amount >= 100,
    `LOAD-BEARING: the quoted amount (${o.nextRental.amount}) must never be a few cents`
  );
  assert.strictEqual(o.nextRental.throughRentalNo, 4);
  // 0.36 residual + a full rental #4.
  assert.strictEqual(o.nextRental.amount, round2(0.36 + 35583.34));
  ok("LOAD-BEARING: the 0.36 residual rolls forward into rental #4 rather than standing alone");

  const resolved = resolvePaymentAmount(o, "rental");
  assert.ok(!resolved.error, "the rolled-forward amount must not itself be refused");
  assert.strictEqual(resolved.amount, o.nextRental.amount);
  ok("resolvePaymentAmount charges the combined figure, not the original 0.36");
}

{
  // A clean, non-dust rental must NOT be touched by the roll-forward logic —
  // this is the ordinary case and it must render exactly as before.
  const o = buildRentalOptions({
    schedule: schedule(),
    received: 0,
    monthlyRental: RENTAL,
    today: "2026-01-01",
  });
  assert.strictEqual(o.nextRental.throughRentalNo, undefined);
  assert.strictEqual(o.nextRental.amount, RENTAL);
  ok("an ordinary full rental is quoted as itself, with no roll-forward field at all");
}

{
  // The dust sits on the FINAL rental, with nothing to roll forward into.
  // resolvePaymentAmount's floor is the only thing that can catch this.
  const rows = schedule({ months: 3, rental: 35583.34, finance: 500 });
  const o = buildRentalOptions({
    schedule: rows,
    // Full schedule is 35,583.34 × 3 = 106,750.02; paid to within 0.36 of
    // all of it, with no fourth rental to roll the shortfall into.
    received: round2(35583.34 * 3 - 0.36),
    monthlyRental: 35583.34,
    today: "2026-01-01",
  });
  assert.strictEqual(o.nextRental.rentalNo, 3);
  assert.strictEqual(o.nextRental.throughRentalNo, undefined, "there is no row left to roll into");
  assert.ok(o.nextRental.amount < 1, "the raw quote is still the tiny residual");

  const resolved = resolvePaymentAmount(o, "rental");
  assert.strictEqual(resolved.error, "BELOW_MINIMUM");
  assert.match(resolved.message, /too small to pay online/i);
  ok("LOAD-BEARING: dust on the LAST rental has nowhere to roll to, so the floor refuses it (never Stripe)");
}

console.log(`\n${passed} passed`);

"use strict";

/**
 * leaseNotification.service — the catalogue of every notice a lease sends.
 *
 * The properties that matter are not the wording, which will change; they
 * are the invariants a reader depends on and that a bug would quietly
 * violate:
 *
 *   - REMINDERS MUST NOT REPEAT. A sweep re-evaluates the same true
 *     condition every few hours; without a stable dedupe key the lessee
 *     gets "rental due in 3 days" a dozen times. The key must be identical
 *     across calls with the same facts, and different across day-markers.
 *   - REAL EVENTS MUST REPEAT. Two payments of the same amount on the same
 *     day are two events. Deduping those hides money.
 *   - EVERY NOTICE MUST BE ACTIONABLE. A category, an event type, a link
 *     and a reference — a notice a reader cannot act on or trace is noise.
 *   - THE LINK MUST MATCH THE AUDIENCE. Sending a lessee to the staff queue
 *     (or vice versa) produces a 403, not a page.
 */

const assert = require("assert");
const N = require("../leaseNotification.service");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok - " + name);
};

const APP = {
  id: 103,
  make: "Toyota",
  model: "Aqua",
  financed_amount: 700000,
  term_months: 24,
};
const QUOTE = {
  id: 47,
  monthly_rental: 35583.34,
  term_months: 24,
  down_payment_amount: 6300000,
  expires_at: "2026-08-23",
};

/** Every builder in the catalogue, invoked with plausible arguments. */
function everyNotice() {
  return [
    ["applicationSubmitted.lessee", N.applicationSubmitted.lessee(APP)],
    ["applicationSubmitted.staff", N.applicationSubmitted.staff(APP, "Thomas Cabriel")],
    ["statusChanged.approved", N.statusChanged(APP, "approved")],
    ["statusChanged.rejected", N.statusChanged(APP, "rejected")],
    ["statusChanged.info_requested", N.statusChanged(APP, "info_requested")],
    ["statusChanged.under_review", N.statusChanged(APP, "under_review")],
    ["statusChanged.withdrawn", N.statusChanged(APP, "withdrawn")],
    ["valuation.requested", N.valuation.requested(APP)],
    ["valuation.completed", N.valuation.completed(APP, 6800000)],
    ["quotation.issued", N.quotation.issued(APP, QUOTE)],
    ["quotation.accepted", N.quotation.accepted(APP, QUOTE, "Thomas Cabriel")],
    ["quotation.declined", N.quotation.declined(APP, QUOTE, "Thomas Cabriel")],
    ["quotation.expiringSoon", N.quotation.expiringSoon(APP, QUOTE, 3)],
    ["downPayment.received", N.downPayment.received(APP, 500000, 100000)],
    ["downPayment.settledStaff", N.downPayment.settledStaff(APP, "Thomas Cabriel")],
    ["downPayment.outstandingReminder", N.downPayment.outstandingReminder(APP, 100000, 7)],
    ["purchase.dealerPaid", N.purchase.dealerPaid(APP)],
    ["purchase.registered", N.purchase.registered(APP, "CR-2024-8891")],
    [
      "purchase.activated",
      N.purchase.activated(APP, {
        agreement_no: "LSE-000019",
        monthly_rental: 35583.34,
        term_months: 24,
        first_rental_date: "2026-09-09",
      }),
    ],
    ["rentals.received", N.rentals.received(APP, 35583.34, { rentalsPaid: 3, rentalsTotal: 24, outstanding: 747250 })],
    ["rentals.dueSoon", N.rentals.dueSoon(APP, 4, "2026-12-09", 35583.34, 3)],
    ["rentals.overdue", N.rentals.overdue(APP, 4, "2026-12-09", 35583.34, 10, 7)],
    ["rentals.arrearsStaff", N.rentals.arrearsStaff(APP, "Thomas Cabriel", 2, 71166.68, 35)],
    ["rentals.settled", N.rentals.settled(APP)],
    ["rentals.completed", N.rentals.completed(APP)],
    ["rentals.completedStaff", N.rentals.completedStaff(APP, "Thomas Cabriel")],
    ["release.issued", N.release.issued(APP, "REL-000005")],
    ["release.transferred", N.release.transferred(APP)],
    ["stalled", N.stalled(APP, "Terms quoted", 14, "Thomas Cabriel")],
  ];
}

// --- shape: every notice is complete and actionable -------------------------
{
  for (const [name, notice] of everyNotice()) {
    assert.ok(notice, `${name} returned nothing`);
    assert.strictEqual(notice.category, "lease", `${name}: wrong category`);
    assert.ok(notice.eventType, `${name}: no eventType`);
    assert.ok(/^[a-z0-9_]+$/.test(notice.eventType), `${name}: eventType "${notice.eventType}" is not machine-readable`);
    assert.ok(notice.title && notice.title.length > 3, `${name}: no usable title`);
    assert.ok(notice.message && notice.message.length > 25, `${name}: message too thin to act on`);
    assert.ok(notice.link && notice.link.startsWith("/"), `${name}: link must be an in-app path`);
    assert.strictEqual(notice.referenceType, "lease_application", `${name}: wrong referenceType`);
    assert.strictEqual(notice.referenceId, APP.id, `${name}: wrong referenceId`);
  }
  ok(`all ${everyNotice().length} notices carry a category, event type, link and reference`);
}

// --- the link must match who is being told ----------------------------------
{
  const staffNotices = [
    "applicationSubmitted.staff",
    "quotation.accepted",
    "quotation.declined",
    "downPayment.settledStaff",
    "rentals.arrearsStaff",
    "rentals.completedStaff",
    "stalled",
  ];
  for (const [name, notice] of everyNotice()) {
    const expected = staffNotices.includes(name) ? N.staffLink() : N.lesseeLink(APP.id);
    assert.strictEqual(
      notice.link,
      expected,
      `${name} links to ${notice.link}, but a ${staffNotices.includes(name) ? "staff" : "lessee"} notice should link to ${expected}`
    );
  }
  ok("LOAD-BEARING: staff notices link to the queue, lessee notices to their own lease — never crossed");
}

// --- reminders must be idempotent -------------------------------------------
{
  const a = N.rentals.dueSoon(APP, 4, "2026-12-09", 35583.34, 3);
  const b = N.rentals.dueSoon(APP, 4, "2026-12-09", 35583.34, 3);
  assert.strictEqual(a.dedupeKey, b.dedupeKey);
  assert.ok(a.dedupeKey, "a reminder with no dedupe key would repeat every sweep");
  ok("LOAD-BEARING: the same rental reminder twice produces the same dedupe key");

  const d7 = N.rentals.dueSoon(APP, 4, "2026-12-09", 35583.34, 7);
  assert.notStrictEqual(a.dedupeKey, d7.dedupeKey);
  ok("a 7-day and a 3-day notice for the same rental are distinct — both should send");

  const other = N.rentals.dueSoon(APP, 5, "2027-01-09", 35583.34, 3);
  assert.notStrictEqual(a.dedupeKey, other.dedupeKey);
  ok("the same day-marker on a different rental is distinct");
}

{
  const bucket7 = N.rentals.overdue(APP, 4, "2026-12-09", 35583.34, 10, 7);
  const sameBucket = N.rentals.overdue(APP, 4, "2026-12-09", 35583.34, 12, 7);
  assert.strictEqual(
    bucket7.dedupeKey,
    sameBucket.dedupeKey,
    "10 and 12 days late fall in the same escalation bucket and must not both send"
  );
  const bucket30 = N.rentals.overdue(APP, 4, "2026-12-09", 35583.34, 33, 30);
  assert.notStrictEqual(bucket7.dedupeKey, bucket30.dedupeKey);
  ok("LOAD-BEARING: overdue notices escalate by bucket, not once per day");
}

{
  // Reissued terms are genuinely new terms — the lessee must be told again.
  const first = N.quotation.issued(APP, QUOTE);
  const reissued = N.quotation.issued(APP, { ...QUOTE, id: 48, monthly_rental: 34000 });
  assert.notStrictEqual(
    first.dedupeKey,
    reissued.dedupeKey,
    "a reissued quotation must notify again, so its key is per-quotation not per-application"
  );
  ok("LOAD-BEARING: a reissued quotation notifies again — keyed per quotation, not per application");
}

// --- real events must NOT be deduped ----------------------------------------
{
  const p1 = N.rentals.received(APP, 35583.34, { rentalsPaid: 3, rentalsTotal: 24, outstanding: 100 });
  const p2 = N.downPayment.received(APP, 500000, 100000);
  assert.strictEqual(p1.dedupeKey, null, "two identical rentals in one day are two real payments");
  assert.strictEqual(p2.dedupeKey, null, "two identical down payments in one day are two real payments");
  ok("LOAD-BEARING: payment-received notices are NOT deduped — collapsing them would hide money");
}

// --- one-shot milestones are deduped ----------------------------------------
{
  const milestones = [
    N.statusChanged(APP, "approved"),
    N.purchase.dealerPaid(APP),
    N.purchase.registered(APP, "CR-1"),
    N.purchase.activated(APP, { agreement_no: "LSE-1", monthly_rental: 1, term_months: 2 }),
    N.release.issued(APP, "REL-1"),
    N.release.transferred(APP),
    N.rentals.completed(APP),
  ];
  for (const m of milestones) {
    assert.ok(m.dedupeKey, `${m.eventType} is a one-shot milestone and must be deduped`);
  }
  ok("one-shot milestones all carry a dedupe key, so a retried request cannot duplicate them");
}

// --- the message that matters most ------------------------------------------
{
  const approved = N.statusChanged(APP, "approved");
  assert.match(approved.message, /nothing is payable until you accept/i);
  ok("LOAD-BEARING: 'approved' says outright that approval is not the last step");
}

// --- degenerate input --------------------------------------------------------
{
  assert.strictEqual(N.statusChanged(APP, "not_a_status"), null);
  ok("an unrecognised status returns null rather than an empty notification");

  const bare = N.applicationSubmitted.staff({ id: 9 }, null);
  assert.ok(bare.message.includes("A customer"));
  assert.ok(bare.message.includes("your vehicle") || bare.message.includes("vehicle"));
  ok("a missing lessee name and vehicle degrade to readable prose, not 'undefined undefined'");
}

{
  // No builder should ever leak a raw undefined/null into prose.
  for (const [name, notice] of everyNotice()) {
    assert.ok(!/undefined|null|NaN/.test(notice.title), `${name}: title leaks a placeholder`);
    assert.ok(!/undefined|NaN/.test(notice.message), `${name}: message leaks a placeholder`);
    if (notice.dedupeKey) {
      assert.ok(!/undefined|NaN/.test(notice.dedupeKey), `${name}: dedupe key leaks a placeholder`);
    }
  }
  ok("LOAD-BEARING: no notice leaks 'undefined' or 'NaN' into text a customer reads");
}

console.log(`\n${passed} passed`);

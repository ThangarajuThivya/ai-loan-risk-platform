"use strict";

/**
 * Leasing portfolio roll-up (L8.1).
 *   node src/services/__tests__/leasePortfolio.test.js
 *
 * The load-bearing test is that a COMPLETED lease stops counting as an owned
 * asset. Once the release letter is issued the vehicle belongs to the
 * lessee, and carrying it on the asset line would overstate the book.
 */

const assert = require("assert");
const { buildPortfolio } = require("../leasePortfolio.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("leasePortfolio.service — book roll-up");

const FIXTURE = {
  applications: [
    { status: "pending" },
    { status: "pending" },
    { status: "under_review" },
    { status: "accepted" },
    { status: "rejected" },
  ],
  agreements: [
    { id: 1, status: "active", financed_amount: 1000000, total_rentals: 1200000, vehicle_price: 1300000 },
    { id: 2, status: "active", financed_amount: 2000000, total_rentals: 2400000, vehicle_price: 2600000 },
    { id: 3, status: "completed", financed_amount: 500000, total_rentals: 600000, vehicle_price: 700000 },
  ],
  rentals: [
    { agreement_id: 1, total: 600000 },
    { agreement_id: 2, total: 400000 },
  ],
  registrations: [
    { status: "registered", n: 2 },
    { status: "submitted", n: 1 },
    { status: "not_started", n: 3 },
    { status: "transferred", n: 1 },
  ],
};

check("application counts split by status", () => {
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.applications.total, 5);
  assert.strictEqual(p.applications.byStatus.pending, 2);
  assert.strictEqual(p.applications.awaitingReview, 3); // 2 pending + 1 under_review
});

check("agreement counts split by status", () => {
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.agreements.total, 3);
  assert.strictEqual(p.agreements.active, 2);
  assert.strictEqual(p.agreements.completed, 1);
});

check("financed total spans the WHOLE book, live and closed", () => {
  // What has ever been advanced is a different question from what is still
  // out, and both are worth knowing.
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.book.financedTotal, 3500000);
});

check("rentals due and received count only ACTIVE agreements", () => {
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.book.rentalsDue, 3600000); // 1.2m + 2.4m
  assert.strictEqual(p.book.rentalsReceived, 1000000); // 600k + 400k
  assert.strictEqual(p.book.rentalsOutstanding, 2600000);
});

check("LOAD-BEARING: a completed lease is no longer an owned asset", () => {
  // Its release letter has been issued, so the vehicle is the lessee's.
  // Counting it would overstate what the lessor actually owns.
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.book.vehiclesOwned, 2);
  assert.strictEqual(p.book.assetValue, 3900000); // 1.3m + 2.6m, NOT + 0.7m
});

check("collection rate is received over due", () => {
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.book.collectionRate, 27.78);
});

check("collection rate is null rather than zero when nothing is due", () => {
  // 0/0 is not "0% collected" — it is a question with no answer, and showing
  // 0% would read as a total collection failure.
  const p = buildPortfolio({ agreements: [], rentals: [] });
  assert.strictEqual(p.book.collectionRate, null);
});

check("the registration backlog is what has been bought but not titled", () => {
  const p = buildPortfolio(FIXTURE);
  assert.strictEqual(p.title.awaitingRegistration, 4); // 3 not_started + 1 submitted
  assert.strictEqual(p.title.byStatus.registered, 2);
});

check("an empty book does not crash", () => {
  const p = buildPortfolio({});
  assert.strictEqual(p.applications.total, 0);
  assert.strictEqual(p.book.financedTotal, 0);
  assert.strictEqual(p.book.collectionRate, null);
});

console.log(`\n${passed} passed`);

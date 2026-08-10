"use strict";

/**
 * Purchase and title ordering (L6).
 *   node src/services/__tests__/leaseRegistration.test.js
 *
 * The load-bearing tests are the two ordering gates, because both protect
 * real money:
 *   - paying the dealer before the down payment is settled advances the
 *     institution's own funds against a commitment nobody has made;
 *   - registering as absolute owner of a vehicle you have not bought is a
 *     claim to something you do not own.
 */

const assert = require("assert");
const {
  REGISTRATION_STATUSES,
  REGISTRATION_TRANSITIONS,
  checkRegistrationTransition,
  checkPayoutAllowed,
  checkSubmissionAllowed,
  describeNextStep,
} = require("../leaseRegistration.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("leaseRegistration.service — purchase and title ordering");

const READY = {
  applicationStatus: "accepted",
  downPaymentSettled: true,
  alreadyPaid: false,
  supplier: { name: "City Motors" },
  supplierPayable: true,
};

/* --- shape --------------------------------------------------------------- */

check("every transition target is a declared status", () => {
  for (const [from, targets] of Object.entries(REGISTRATION_TRANSITIONS)) {
    assert.ok(REGISTRATION_STATUSES.includes(from), `${from} is not declared`);
    for (const to of targets) {
      assert.ok(REGISTRATION_STATUSES.includes(to), `${from} -> ${to} is not declared`);
    }
  }
});

check("the title lifecycle is strictly linear and ends at transferred", () => {
  assert.deepStrictEqual(REGISTRATION_TRANSITIONS.not_started, ["submitted"]);
  assert.deepStrictEqual(REGISTRATION_TRANSITIONS.submitted, ["registered"]);
  assert.deepStrictEqual(REGISTRATION_TRANSITIONS.registered, ["release_issued"]);
  assert.deepStrictEqual(REGISTRATION_TRANSITIONS.release_issued, ["transferred"]);
  assert.deepStrictEqual(REGISTRATION_TRANSITIONS.transferred, []);
});

check("a CR cannot be issued before the papers are lodged", () => {
  const r = checkRegistrationTransition("not_started", "registered");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Next is submitted/);
});

check("title cannot transfer before a release letter is issued", () => {
  assert.strictEqual(checkRegistrationTransition("registered", "transferred").ok, false);
  assert.strictEqual(checkRegistrationTransition("release_issued", "transferred").ok, true);
});

check("a transferred vehicle is done", () => {
  const r = checkRegistrationTransition("transferred", "registered");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /nothing further/);
});

/* --- the payout gate ----------------------------------------------------- */

check("LOAD-BEARING: the dealer cannot be paid before the down payment settles", () => {
  const r = checkPayoutAllowed({ ...READY, downPaymentSettled: false });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /down payment has not been settled/i);
  // The reason must explain the exposure, not just state the rule.
  assert.match(r.reason, /own money|commitment/i);
});

check("the dealer cannot be paid before the lessee accepts terms", () => {
  for (const status of ["pending", "under_review", "approved", "quoted", "rejected"]) {
    const r = checkPayoutAllowed({ ...READY, applicationStatus: status });
    assert.strictEqual(r.ok, false, `${status} should block payout`);
  }
});

check("a dealer with no bank account on file cannot be paid", () => {
  const r = checkPayoutAllowed({ ...READY, supplierPayable: false });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /bank account/i);
  assert.match(r.reason, /City Motors/);
});

check("a private seller has no dealer to vet, so the payout is allowed", () => {
  // No lease_suppliers row at all. The transfer happens out of band and is
  // only RECORDED here, so there is nothing to validate against.
  const r = checkPayoutAllowed({ ...READY, supplier: null, supplierPayable: false });
  assert.strictEqual(r.ok, true);
});

check("a vehicle cannot be paid for twice", () => {
  const r = checkPayoutAllowed({ ...READY, alreadyPaid: true });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /already been paid/i);
});

check("everything in order means the payout is allowed", () => {
  assert.deepStrictEqual(checkPayoutAllowed(READY), { ok: true });
});

/* --- the registration gate ----------------------------------------------- */

check("LOAD-BEARING: the CR cannot be lodged before the vehicle is paid for", () => {
  const r = checkSubmissionAllowed({ vehiclePaidFor: false, registrationStatus: "not_started" });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /does not own|not been paid/i);
});

check("once paid for, the CR can be lodged", () => {
  assert.strictEqual(
    checkSubmissionAllowed({ vehiclePaidFor: true, registrationStatus: "not_started" }).ok,
    true
  );
});

check("the CR cannot be lodged twice", () => {
  const r = checkSubmissionAllowed({ vehiclePaidFor: true, registrationStatus: "submitted" });
  assert.strictEqual(r.ok, false);
});

/* --- the next-step description ------------------------------------------- */

check("next step walks the whole sequence in order", () => {
  const seq = [
    [{ applicationStatus: "quoted", downPaymentSettled: false, vehiclePaidFor: false, registrationStatus: "not_started" }, "quotation"],
    [{ applicationStatus: "accepted", downPaymentSettled: false, vehiclePaidFor: false, registrationStatus: "not_started" }, "down_payment"],
    [{ applicationStatus: "accepted", downPaymentSettled: true, vehiclePaidFor: false, registrationStatus: "not_started" }, "payout"],
    [{ applicationStatus: "accepted", downPaymentSettled: true, vehiclePaidFor: true, registrationStatus: "not_started" }, "registration"],
    [{ applicationStatus: "accepted", downPaymentSettled: true, vehiclePaidFor: true, registrationStatus: "submitted" }, "registration"],
    [{ applicationStatus: "accepted", downPaymentSettled: true, vehiclePaidFor: true, registrationStatus: "registered" }, "active"],
    [{ applicationStatus: "accepted", downPaymentSettled: true, vehiclePaidFor: true, registrationStatus: "release_issued" }, "transfer"],
    [{ applicationStatus: "accepted", downPaymentSettled: true, vehiclePaidFor: true, registrationStatus: "transferred" }, "done"],
  ];
  for (const [input, expected] of seq) {
    assert.strictEqual(describeNextStep(input).stage, expected, JSON.stringify(input));
  }
});

check("every next step carries a sentence someone could act on", () => {
  const r = describeNextStep({
    applicationStatus: "accepted",
    downPaymentSettled: true,
    vehiclePaidFor: false,
    registrationStatus: "not_started",
  });
  assert.match(r.label, /pay the dealer/i);
});

console.log(`\n${passed} passed`);

"use strict";

/**
 * Lease status machine and valuation gate (L3.1).
 *   node src/services/__tests__/leaseStatus.test.js
 *
 * The load-bearing test is the valuation gate: a used vehicle must be
 * unapprovable until a valuation exists. Without it, loan-to-value — the one
 * check standing between the institution and over-advancing on an asset it
 * is about to own — is being skipped rather than satisfied.
 */

const assert = require("assert");
const {
  LEASE_STATUSES,
  TRANSITIONS,
  isValidStatus,
  isTerminal,
  allowedTransitions,
  canTransition,
  checkTransition,
  targetStatusesForRoles,
  checkValuationGate,
} = require("../leaseStatus.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("leaseStatus.service — transitions and the valuation gate");

/* --- shape ------------------------------------------------------------- */

check("every status in the table is a declared status, and vice versa", () => {
  for (const from of Object.keys(TRANSITIONS)) {
    assert.ok(isValidStatus(from), `${from} is in TRANSITIONS but not LEASE_STATUSES`);
    for (const to of Object.keys(TRANSITIONS[from])) {
      assert.ok(isValidStatus(to), `${from} -> ${to}: ${to} is not a declared status`);
    }
  }
  for (const s of LEASE_STATUSES) {
    assert.ok(TRANSITIONS[s], `${s} has no entry in TRANSITIONS`);
  }
});

check("every transition names at least one role", () => {
  for (const [from, map] of Object.entries(TRANSITIONS)) {
    for (const [to, roles] of Object.entries(map)) {
      assert.ok(Array.isArray(roles) && roles.length > 0, `${from} -> ${to} names no role`);
    }
  }
});

check("no 'system' role exists — leases are never auto-rejected", () => {
  // The loan machine has one, justified by the adverse-action record it
  // writes. The lease spine has no such record yet, so an automated
  // rejection would leave an applicant refused with no logged reason.
  for (const [from, map] of Object.entries(TRANSITIONS)) {
    for (const [to, roles] of Object.entries(map)) {
      assert.ok(!roles.includes("system"), `${from} -> ${to} grants 'system'`);
    }
  }
});

/* --- terminality -------------------------------------------------------- */

check("accepted, declined, rejected and withdrawn are terminal", () => {
  for (const s of ["accepted", "declined", "rejected", "withdrawn"]) {
    assert.strictEqual(isTerminal(s), true, `${s} should be terminal`);
  }
});

check("accepted is terminal because the AGREEMENT takes over, not because nothing follows", () => {
  // The lease continues — as a lease_agreements row with its own status.
  // This application has done its job.
  assert.deepStrictEqual(allowedTransitions("accepted"), []);
});

check("live statuses are not terminal", () => {
  for (const s of ["pending", "under_review", "info_requested", "approved", "quoted"]) {
    assert.strictEqual(isTerminal(s), false, `${s} should not be terminal`);
  }
});

/* --- who may do what ---------------------------------------------------- */

check("only the lessee may withdraw, and never staff", () => {
  assert.ok(canTransition("pending", "withdrawn", "customer"));
  assert.ok(!canTransition("pending", "withdrawn", "staff"));
  assert.ok(!canTransition("pending", "withdrawn", "admin"));
});

check("only the lessee may answer a quotation", () => {
  assert.ok(canTransition("quoted", "accepted", "customer"));
  assert.ok(canTransition("quoted", "declined", "customer"));
  assert.ok(!canTransition("quoted", "accepted", "staff"));
  assert.ok(!canTransition("quoted", "accepted", "admin"));
});

check("staff may reissue a quotation but cannot accept on the lessee's behalf", () => {
  assert.ok(canTransition("quoted", "quoted", "staff"));
  assert.ok(!canTransition("quoted", "accepted", "staff"));
});

check("approval leads only to a quotation — never straight to accepted", () => {
  // Binding someone to terms they were never shown is exactly what the
  // quotation step exists to prevent.
  assert.ok(!canTransition("approved", "accepted", "staff"));
  assert.ok(!canTransition("approved", "accepted", "customer"));
  assert.ok(canTransition("approved", "quoted", "staff"));
});

check("a rejected lease application stays rejected", () => {
  assert.deepStrictEqual(allowedTransitions("rejected"), []);
  const r = checkTransition("rejected", "under_review", "admin");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /cannot be changed further/);
});

/* --- checkTransition messages ------------------------------------------- */

check("a legal move is permitted", () => {
  assert.deepStrictEqual(checkTransition("pending", "under_review", "staff"), { ok: true });
});

check("a move legal for someone else names the role problem, not an impossibility", () => {
  const r = checkTransition("quoted", "accepted", "staff");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Your role may not/);
});

check("an impossible move lists what is actually allowed", () => {
  const r = checkTransition("pending", "quoted", "staff");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /Allowed:/);
});

check("unknown statuses are rejected rather than silently allowed", () => {
  assert.strictEqual(checkTransition("nonsense", "approved", "staff").ok, false);
  assert.strictEqual(checkTransition("pending", "nonsense", "staff").ok, false);
});

check("targetStatusesForRoles covers staff powers without customer-only ones", () => {
  const staffTargets = targetStatusesForRoles("staff", "admin");
  assert.ok(staffTargets.includes("approved") && staffTargets.includes("rejected"));
  assert.ok(!staffTargets.includes("withdrawn"), "withdraw is the lessee's alone");
  assert.ok(!staffTargets.includes("accepted"), "accepting is the lessee's alone");
});

/* --- the valuation gate ------------------------------------------------- */

check("LOAD-BEARING: a used vehicle cannot be approved without a valuation", () => {
  const r = checkValuationGate({
    targetStatus: "approved",
    conditionType: "used",
    hasCompletedValuation: false,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /valuation/i);
  assert.match(r.reason, /loan-to-value/i);
});

check("a reconditioned vehicle is gated the same way", () => {
  assert.strictEqual(
    checkValuationGate({
      targetStatus: "approved",
      conditionType: "reconditioned",
      hasCompletedValuation: false,
    }).ok,
    false
  );
});

check("a brand-new vehicle is gated the same way as any other condition", () => {
  // A franchise invoice is a price the dealer set, not a value anyone here
  // has verified — brand new gets no exemption from the valuation gate.
  assert.strictEqual(
    checkValuationGate({
      targetStatus: "approved",
      conditionType: "brand_new",
      hasCompletedValuation: false,
    }).ok,
    false
  );
  assert.strictEqual(
    checkValuationGate({
      targetStatus: "approved",
      conditionType: "brand_new",
      hasCompletedValuation: true,
    }).ok,
    true
  );
});

check("a completed valuation opens the gate for a used vehicle", () => {
  assert.strictEqual(
    checkValuationGate({
      targetStatus: "approved",
      conditionType: "used",
      hasCompletedValuation: true,
    }).ok,
    true
  );
});

check("the gate only guards approval — rejecting an unvalued lease is always allowed", () => {
  // Refusing to reject something because it has not been valued would trap
  // applications nobody wants to approve either.
  for (const target of ["rejected", "under_review", "info_requested", "withdrawn"]) {
    assert.strictEqual(
      checkValuationGate({
        targetStatus: target,
        conditionType: "used",
        hasCompletedValuation: false,
      }).ok,
      true,
      `${target} should not be gated`
    );
  }
});

console.log(`\n${passed} passed`);

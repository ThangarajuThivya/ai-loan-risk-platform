"use strict";

/**
 * Runnable test script for the loan-application status machine (no test
 * runner needed).
 *   node src/services/__tests__/applicationStatus.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  APPLICATION_STATUSES,
  INITIAL_STATUS,
  TRANSITIONS,
  isValidStatus,
  isTerminal,
  isCreditDecision,
  isInfoRequest,
  isInfoResponse,
  allowedTransitions,
  canTransition,
  checkTransition,
  targetStatusesForRoles,
  buildNotification,
  AWAITING_ACTION_STATUSES,
  needsStaffAction,
  computeProcessingAge,
  EMAIL_NOTIFIED_STATUSES,
  shouldEmailStatusChange,
} = require("../applicationStatus.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("machine integrity");

check("every status has a TRANSITIONS entry and vice versa", () => {
  assert.deepStrictEqual(
    [...APPLICATION_STATUSES].sort(),
    Object.keys(TRANSITIONS).sort()
  );
});

check("every transition target is itself a declared status", () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const to of Object.keys(targets)) {
      assert(isValidStatus(to), `${from} → ${to} targets an unknown status`);
    }
  }
});

check("every transition names at least one role", () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const [to, roles] of Object.entries(targets)) {
      assert(
        Array.isArray(roles) && roles.length > 0,
        `${from} → ${to} is reachable by nobody`
      );
    }
  }
});

check("no transition loops back to its own status", () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    assert(!(from in targets), `${from} transitions to itself`);
  }
});

check("the initial status is a real status and is not terminal", () => {
  assert(isValidStatus(INITIAL_STATUS));
  assert(!isTerminal(INITIAL_STATUS));
});

check("every status is reachable from the initial status", () => {
  // Breadth-first walk of the machine — catches an orphan state added to the
  // ENUM that nothing can ever actually transition into.
  const seen = new Set([INITIAL_STATUS]);
  const queue = [INITIAL_STATUS];
  while (queue.length) {
    for (const to of allowedTransitions(queue.shift())) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  assert.deepStrictEqual(
    [...seen].sort(),
    [...APPLICATION_STATUSES].sort(),
    "some statuses are unreachable from " + INITIAL_STATUS
  );
});

console.log("terminal states");

check("withdrawn / closed are terminal", () => {
  assert(isTerminal("withdrawn"));
  assert(isTerminal("closed"));
});

check("rejected is no longer terminal — an admin can reopen it", () => {
  // D2 lets the decision matrix reject an application with no human
  // involved, so there has to be a way back for a human to reconsider one.
  // See applicationStatus.service.js TRANSITIONS.rejected.
  assert(!isTerminal("rejected"));
  assert.deepStrictEqual(allowedTransitions("rejected"), ["under_review"]);
});

check("pending / under_review / approved / disbursed are not terminal", () => {
  assert(!isTerminal("pending"));
  assert(!isTerminal("under_review"));
  assert(!isTerminal("approved"));
  assert(!isTerminal("disbursed"));
});

check("nothing at all can leave a terminal state", () => {
  for (const role of ["customer", "staff", "admin"]) {
    assert.deepStrictEqual(allowedTransitions("withdrawn", role), []);
    assert.deepStrictEqual(allowedTransitions("closed", role), []);
  }
});

console.log("role permissions");

check("staff and admin can decide a pending application", () => {
  for (const role of ["staff", "admin"]) {
    assert(canTransition("pending", "approved", role));
    assert(canTransition("pending", "rejected", role));
    assert(canTransition("pending", "under_review", role));
  }
});

check("a customer cannot decide their own application", () => {
  assert(!canTransition("pending", "approved", "customer"));
  assert(!canTransition("pending", "rejected", "customer"));
  assert(!canTransition("pending", "under_review", "customer"));
  assert(!canTransition("approved", "disbursed", "customer"));
});

check("only a customer may withdraw", () => {
  assert(canTransition("pending", "withdrawn", "customer"));
  assert(!canTransition("pending", "withdrawn", "staff"));
  assert(!canTransition("pending", "withdrawn", "admin"));
});

check("a customer may withdraw from every state still awaiting an outcome", () => {
  // 'rejected' is non-terminal since D2 (an admin can reopen it) but is NOT
  // awaiting an outcome — it already has one. Withdrawing a decided
  // application would be the applicant re-deciding it, so the exclusion
  // here is the behaviour, not a gap in it.
  for (const from of APPLICATION_STATUSES) {
    if (isTerminal(from) || from === "disbursed" || from === "rejected") continue;
    assert(
      canTransition(from, "withdrawn", "customer"),
      `customer cannot withdraw from ${from}`
    );
  }
});

check("a disbursed loan can no longer be withdrawn — the money is gone", () => {
  assert(!canTransition("disbursed", "withdrawn", "customer"));
});

check("an unknown role gets no permissions anywhere", () => {
  for (const from of APPLICATION_STATUSES) {
    assert.deepStrictEqual(allowedTransitions(from, "auditor"), []);
  }
});

console.log("illegal moves");

check("approved cannot jump straight to closed", () => {
  assert(!canTransition("approved", "closed", "admin"));
});

check("pending cannot jump straight to disbursed", () => {
  assert(!canTransition("pending", "disbursed", "admin"));
});

check("a rejected application cannot leap straight back to approved", () => {
  // Reopening is allowed; skipping the review that reopening exists for is
  // not. B1's "no resurrection into a decision" rule survives D2 intact.
  assert(!canTransition("rejected", "approved", "admin"));
  assert(!canTransition("rejected", "disbursed", "admin"));
});

check("only an admin may reopen a rejection", () => {
  assert(canTransition("rejected", "under_review", "admin"));
  assert(!canTransition("rejected", "under_review", "staff"));
  assert(!canTransition("rejected", "under_review", "customer"));
  assert(!canTransition("rejected", "under_review", "system"));
});

check("approving twice is refused", () => {
  assert(!canTransition("approved", "approved", "admin"));
});

console.log("checkTransition messages");

check("a legal move reports ok with no reason", () => {
  assert.deepStrictEqual(checkTransition("pending", "approved", "staff"), { ok: true });
});

check("leaving a terminal state says so", () => {
  const r = checkTransition("withdrawn", "approved", "admin");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /withdrawn/);
  assert.match(r.reason, /cannot be changed further/);
});

check("a move legal for someone else blames the role, not the move", () => {
  const r = checkTransition("pending", "withdrawn", "staff");
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /role may not/);
});

check("an unknown status is reported rather than silently allowed", () => {
  assert.strictEqual(checkTransition("banana", "approved", "admin").ok, false);
  assert.strictEqual(checkTransition("pending", "banana", "admin").ok, false);
});

console.log("credit decisions");

check("only approved and rejected are credit decisions", () => {
  assert(isCreditDecision("approved"));
  assert(isCreditDecision("rejected"));
  for (const s of ["pending", "under_review", "more_info_required", "withdrawn", "disbursed", "closed"]) {
    assert(!isCreditDecision(s), `${s} must not stamp decided_by`);
  }
});

console.log("targetStatusesForRoles");

check("reviewers can target every status except withdrawn and pending", () => {
  const targets = targetStatusesForRoles("staff", "admin").sort();
  assert.deepStrictEqual(targets, [
    "approved",
    "closed",
    "disbursed",
    "more_info_required",
    "rejected",
    "under_review",
  ]);
});

check("customers can only ever target withdrawn, under_review or accepted", () => {
  assert.deepStrictEqual(
    targetStatusesForRoles("customer").sort(),
    ["accepted", "under_review", "withdrawn"]
  );
});

console.log("offer & acceptance (C1)");

check("approved can NO LONGER jump straight to disbursed", () => {
  // The whole point of the offer flow: funds must not be released against
  // terms the applicant never accepted.
  assert(!canTransition("approved", "disbursed", "staff"));
  assert(!canTransition("approved", "disbursed", "admin"));
  assert(!canTransition("approved", "disbursed", "customer"));
});

check("drawdown is reachable ONLY via accepted", () => {
  const intoDisbursed = APPLICATION_STATUSES.filter((from) =>
    allowedTransitions(from).includes("disbursed")
  );
  assert.deepStrictEqual(intoDisbursed, ["accepted"]);
});

check("only the applicant may accept an offer", () => {
  assert(canTransition("approved", "accepted", "customer"));
  assert(!canTransition("approved", "accepted", "staff"));
  assert(!canTransition("approved", "accepted", "admin"));
});

check("declining an offer is a withdrawal, and only the applicant may do it", () => {
  assert(canTransition("approved", "withdrawn", "customer"));
  assert(!canTransition("approved", "withdrawn", "staff"));
});

check("staff disburse once terms are accepted", () => {
  assert(canTransition("accepted", "disbursed", "staff"));
  assert(canTransition("accepted", "disbursed", "admin"));
});

check("the applicant can still pull out after accepting, before drawdown", () => {
  assert(canTransition("accepted", "withdrawn", "customer"));
});

check("accepting is not a credit decision — it must not restamp decided_by", () => {
  assert(!isCreditDecision("accepted"));
});

check("accepted is neither terminal nor an info step", () => {
  assert(!isTerminal("accepted"));
  assert(!isInfoRequest("accepted"));
  assert(!isInfoResponse("approved", "accepted", "customer"));
});

console.log("info request/response (more_info_required loop)");

check("only more_info_required is an info request", () => {
  assert(isInfoRequest("more_info_required"));
  for (const s of APPLICATION_STATUSES) {
    if (s !== "more_info_required") assert(!isInfoRequest(s));
  }
});

check("a customer answering more_info_required is an info response", () => {
  assert(isInfoResponse("more_info_required", "under_review", "customer"));
});

check("staff making the same move is NOT an info response", () => {
  assert(!isInfoResponse("more_info_required", "under_review", "staff"));
  assert(!isInfoResponse("more_info_required", "under_review", "admin"));
});

check("the same target from a different source is not an info response", () => {
  assert(!isInfoResponse("pending", "under_review", "customer"));
});

check("a customer may answer a more_info_required request", () => {
  assert(canTransition("more_info_required", "under_review", "customer"));
});

check("staff may still close the loop themselves (e.g. phone call)", () => {
  assert(canTransition("more_info_required", "under_review", "staff"));
  assert(canTransition("more_info_required", "under_review", "admin"));
});

check("a customer still cannot decide from more_info_required", () => {
  assert(!canTransition("more_info_required", "rejected", "customer"));
});

console.log("notifications");

check("a decision notification carries the reviewer's note", () => {
  // Approval now announces the OFFER, not just the decision — an approved
  // application is waiting on the applicant, and the copy has to say so.
  const n = buildNotification("approved", 42, "Verified payslips.");
  assert.match(n.title, /Offer/);
  assert.match(n.message, /#42/);
  assert.match(n.message, /acceptance/);
  assert.match(n.message, /Verified payslips\./);
});

check("no note means no dangling 'Note:' suffix", () => {
  const n = buildNotification("rejected", 7);
  assert(!/Note:/.test(n.message));
});

check("a customer withdrawing is not notified about their own action", () => {
  assert.strictEqual(buildNotification("withdrawn", 7), null);
});

check("every reviewer-reachable status has notification copy", () => {
  for (const status of targetStatusesForRoles("staff", "admin")) {
    const n = buildNotification(status, 1);
    assert(n && n.title && n.message, `no notification copy for ${status}`);
  }
});

console.log("needsStaffAction / AWAITING_ACTION_STATUSES (F2)");

check("only pending/under_review/more_info_required need staff action", () => {
  assert.deepStrictEqual(AWAITING_ACTION_STATUSES, [
    "pending",
    "under_review",
    "more_info_required",
  ]);
  for (const status of AWAITING_ACTION_STATUSES) {
    assert.strictEqual(needsStaffAction(status), true, `${status} should need staff action`);
  }
});

check("decided/terminal statuses do not need staff action", () => {
  for (const status of ["approved", "accepted", "rejected", "withdrawn", "disbursed", "closed"]) {
    assert.strictEqual(needsStaffAction(status), false, `${status} should NOT need staff action`);
  }
});

console.log("computeProcessingAge (F2)");

check("zero days since the last status change is on_track", () => {
  const asOf = new Date("2026-06-15T00:00:00Z");
  const age = computeProcessingAge("2026-06-15", { asOf });
  assert.strictEqual(age.days, 0);
  assert.strictEqual(age.sla_status, "on_track");
});

check("one day under the warning threshold is still on_track", () => {
  const asOf = new Date("2026-06-15T00:00:00Z");
  const age = computeProcessingAge("2026-06-14", { asOf, warningDays: 2, breachDays: 4 });
  assert.strictEqual(age.days, 1);
  assert.strictEqual(age.sla_status, "on_track");
});

check("exactly at the warning threshold is due_soon", () => {
  const asOf = new Date("2026-06-15T00:00:00Z");
  const age = computeProcessingAge("2026-06-13", { asOf, warningDays: 2, breachDays: 4 });
  assert.strictEqual(age.days, 2);
  assert.strictEqual(age.sla_status, "due_soon");
});

check("one day under the breach threshold is still due_soon", () => {
  const asOf = new Date("2026-06-15T00:00:00Z");
  const age = computeProcessingAge("2026-06-12", { asOf, warningDays: 2, breachDays: 4 });
  assert.strictEqual(age.days, 3);
  assert.strictEqual(age.sla_status, "due_soon");
});

check("exactly at the breach threshold is overdue", () => {
  const asOf = new Date("2026-06-15T00:00:00Z");
  const age = computeProcessingAge("2026-06-11", { asOf, warningDays: 2, breachDays: 4 });
  assert.strictEqual(age.days, 4);
  assert.strictEqual(age.sla_status, "overdue");
});

check("well past the breach threshold is still just overdue, not a new tier", () => {
  const asOf = new Date("2026-06-15T00:00:00Z");
  const age = computeProcessingAge("2026-05-01", { asOf, warningDays: 2, breachDays: 4 });
  assert(age.days > 30);
  assert.strictEqual(age.sla_status, "overdue");
});

check("defaults to today when asOf is omitted, without crashing", () => {
  const age = computeProcessingAge(new Date().toISOString().slice(0, 10));
  assert.strictEqual(age.days, 0);
  assert.strictEqual(age.sla_status, "on_track");
});

console.log("shouldEmailStatusChange / EMAIL_NOTIFIED_STATUSES (G2)");

check("major transitions (approved/rejected/more_info_required/disbursed/closed) are emailed", () => {
  for (const status of ["approved", "rejected", "more_info_required", "disbursed", "closed"]) {
    assert.strictEqual(shouldEmailStatusChange(status), true, `${status} should be emailed`);
    assert(EMAIL_NOTIFIED_STATUSES.has(status));
  }
});

check("routine/self-action statuses are NOT emailed, only notified in-app", () => {
  for (const status of ["pending", "under_review", "accepted", "withdrawn"]) {
    assert.strictEqual(shouldEmailStatusChange(status), false, `${status} should NOT be emailed`);
  }
});

check("every emailed status still has real notification copy to send", () => {
  for (const status of EMAIL_NOTIFIED_STATUSES) {
    const n = buildNotification(status, 1);
    assert(n && n.title && n.message, `no notification copy for emailed status ${status}`);
  }
});

console.log(`\n${passed} assertions passed.`);

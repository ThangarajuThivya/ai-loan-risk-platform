"use strict";

/**
 * Vehicle purchase and title (L6) — pure, no DB.
 *
 * This module owns the ORDER OF EVENTS between a lessee accepting terms and
 * the institution owning a registered vehicle. That order is not
 * bureaucracy; each step is a precondition for the next in a way that costs
 * real money to get wrong:
 *
 *   1. The DOWN PAYMENT must be settled before the dealer is paid. The
 *      lessee's stake is what makes the institution's exposure acceptable —
 *      buying first and collecting later is an unsecured advance to someone
 *      who has not yet committed anything.
 *   2. The DEALER must be paid before the CR is lodged. You cannot register
 *      yourself as absolute owner of a vehicle you have not bought.
 *   3. The CR must be REGISTERED before rentals begin. Until the title names
 *      the lessor, the institution is a creditor with no asset behind it —
 *      which is precisely the thing a finance lease is not.
 *
 * Each gate returns a REASON rather than a bare boolean, so the caller can
 * say what is missing instead of emitting a generic refusal.
 */

const REGISTRATION_STATUSES = [
  "not_started",
  "submitted",
  "registered",
  "release_issued",
  "transferred",
];

/**
 * The title lifecycle. Linear by nature — a CR cannot be issued before the
 * papers are lodged, and title cannot transfer before a release is issued.
 *
 * `release_issued` and `transferred` are reachable here but are driven by
 * L7 (final settlement), not by this phase.
 */
const REGISTRATION_TRANSITIONS = {
  not_started: ["submitted"],
  submitted: ["registered"],
  registered: ["release_issued"],
  release_issued: ["transferred"],
  transferred: [],
};

function isValidRegistrationStatus(status) {
  return REGISTRATION_STATUSES.includes(status);
}

/**
 * @returns {{ok:boolean, reason?:string}}
 */
function checkRegistrationTransition(from, to) {
  if (!isValidRegistrationStatus(from)) {
    return { ok: false, reason: `Unknown current registration status "${from}".` };
  }
  if (!isValidRegistrationStatus(to)) {
    return { ok: false, reason: `Unknown target registration status "${to}".` };
  }
  const allowed = REGISTRATION_TRANSITIONS[from] || [];
  if (allowed.includes(to)) return { ok: true };
  if (!allowed.length) {
    return { ok: false, reason: `Registration is ${from}; there is nothing further to record.` };
  }
  return {
    ok: false,
    reason: `Registration cannot go from ${from} to ${to}. Next is ${allowed.join(", ")}.`,
  };
}

/**
 * May the dealer be paid?
 *
 * @param {object} p
 * @param {string} p.applicationStatus   the lease application's status
 * @param {boolean} p.downPaymentSettled
 * @param {boolean} p.alreadyPaid
 * @param {object|null} p.supplier       lease_suppliers row, or null for a
 *                                       private seller
 * @param {boolean} p.supplierPayable    leaseModel.supplierIsPayable(supplier)
 * @returns {{ok:boolean, reason?:string}}
 */
function checkPayoutAllowed({
  applicationStatus,
  downPaymentSettled,
  alreadyPaid,
  supplier,
  supplierPayable,
}) {
  if (alreadyPaid) {
    return { ok: false, reason: "The vehicle for this lease has already been paid for." };
  }
  if (applicationStatus !== "accepted") {
    return {
      ok: false,
      reason: `The lessee has not accepted a quotation yet (application is ${applicationStatus}).`,
    };
  }
  if (!downPaymentSettled) {
    return {
      ok: false,
      reason:
        "The down payment has not been settled in full. Paying the dealer first would advance the " +
        "institution's own money against a commitment the lessee has not yet made.",
    };
  }
  // A registered dealer must have somewhere to send the money. A private
  // seller has no lease_suppliers row at all, which is legitimate — that
  // payout is arranged out of band and only RECORDED here.
  if (supplier && !supplierPayable) {
    return {
      ok: false,
      reason: `${supplier.name} has no bank account on file. Add their banking details before paying them.`,
    };
  }
  return { ok: true };
}

/**
 * May the CR papers be lodged with the DMT?
 *
 * @param {object} p
 * @param {boolean} p.vehiclePaidFor
 * @param {string} p.registrationStatus
 * @returns {{ok:boolean, reason?:string}}
 */
function checkSubmissionAllowed({ vehiclePaidFor, registrationStatus }) {
  if (!vehiclePaidFor) {
    return {
      ok: false,
      reason:
        "The vehicle has not been paid for yet. The institution cannot be registered as absolute " +
        "owner of a vehicle it does not own.",
    };
  }
  return checkRegistrationTransition(registrationStatus, "submitted");
}

/**
 * What a lease is waiting on right now, as one human sentence.
 *
 * Exists so the staff queue and the lessee's page can both answer "what
 * happens next?" without either of them reimplementing the ordering rules
 * above and drifting from them.
 *
 * @returns {{stage:string, label:string, blocked:boolean}}
 */
function describeNextStep({
  applicationStatus,
  downPaymentSettled,
  vehiclePaidFor,
  registrationStatus,
}) {
  if (applicationStatus !== "accepted") {
    return { stage: "quotation", label: "Waiting for the lessee to accept a quotation.", blocked: false };
  }
  if (!downPaymentSettled) {
    return { stage: "down_payment", label: "Waiting for the down payment to be settled.", blocked: false };
  }
  if (!vehiclePaidFor) {
    return { stage: "payout", label: "Ready to pay the dealer for the vehicle.", blocked: false };
  }
  switch (registrationStatus) {
    case "not_started":
      return { stage: "registration", label: "Ready to lodge the CR with the DMT.", blocked: false };
    case "submitted":
      return { stage: "registration", label: "Waiting for the DMT to issue the CR.", blocked: false };
    case "registered":
      return { stage: "active", label: "Registered. The lease can be activated.", blocked: false };
    case "release_issued":
      return { stage: "transfer", label: "Release letter issued — awaiting transfer at the DMT.", blocked: false };
    case "transferred":
      return { stage: "done", label: "Ownership transferred. This lease is complete.", blocked: false };
    default:
      return { stage: "unknown", label: "Registration state unknown.", blocked: true };
  }
}

module.exports = {
  REGISTRATION_STATUSES,
  REGISTRATION_TRANSITIONS,
  isValidRegistrationStatus,
  checkRegistrationTransition,
  checkPayoutAllowed,
  checkSubmissionAllowed,
  describeNextStep,
};

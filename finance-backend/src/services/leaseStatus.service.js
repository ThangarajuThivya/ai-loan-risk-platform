"use strict";

/**
 * Lease application status machine (L3.1) — pure, no DB.
 *
 * The lease counterpart of applicationStatus.service.js. A separate machine
 * rather than a shared one because the two lifecycles genuinely differ:
 *
 *   * A loan ends at `disbursed` → `closed`. A lease application ends at
 *     `accepted`, and everything after that belongs to the AGREEMENT
 *     (lease_agreements has its own status), because from that point the
 *     institution owns an asset rather than holding a claim.
 *   * A lease has a `quoted` state a loan does not: the quotation is a
 *     distinct artefact under the Finance Leasing Act, issued after approval
 *     and before signing.
 *
 * THE VALUATION GATE lives here rather than in the controller. Whether a
 * used vehicle may be approved is a rule about the lifecycle, and burying it
 * in one endpoint would mean the next endpoint that approves something has
 * to remember it independently.
 */

const LEASE_STATUSES = [
  "pending",
  "under_review",
  "info_requested",
  "approved",
  "quoted",
  "accepted",
  "declined",
  "rejected",
  "withdrawn",
];

const INITIAL_STATUS = "pending";

/**
 * TRANSITIONS[from][to] = roles permitted to make that move. A `from` with
 * an empty map is terminal; a pair absent from this table is illegal for
 * everyone, whatever their role.
 *
 * Role notes:
 *  - 'customer' (the lessee) may withdraw at any live stage, and accept or
 *    decline a quotation. Ownership is enforced by the caller — this module
 *    knows about roles, not identities.
 *  - staff and admin have identical powers today. Listed separately so
 *    splitting them later is an edit here, not a refactor.
 *  - there is deliberately NO 'system' role: unlike the loan machine, no
 *    automatic rejection exists for leases, because the adverse-action
 *    record that would justify one has no lease parallel yet. See
 *    leaseApplication.model.js.
 */
const TRANSITIONS = {
  pending: {
    under_review: ["staff", "admin"],
    info_requested: ["staff", "admin"],
    approved: ["staff", "admin"],
    rejected: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  under_review: {
    info_requested: ["staff", "admin"],
    approved: ["staff", "admin"],
    rejected: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  info_requested: {
    under_review: ["staff", "admin", "customer"],
    rejected: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  // Approved means the credit decision is made. The commercial terms are
  // still to be issued — that is `quoted`, and it is the only way forward.
  approved: {
    quoted: ["staff", "admin"],
    rejected: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  // A quotation is live. Only the lessee can answer it; staff can reissue,
  // which supersedes the old quotation and lands back here.
  quoted: {
    accepted: ["customer"],
    declined: ["customer"],
    quoted: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  // Terms agreed. The lease AGREEMENT takes over from here (046) — this
  // application has done its job and is terminal.
  accepted: {},
  declined: {},
  rejected: {},
  withdrawn: {},
};

/** Statuses where the application is waiting on the institution, not the lessee. */
const AWAITING_STAFF_STATUSES = ["pending", "under_review"];

function isValidStatus(status) {
  return LEASE_STATUSES.includes(status);
}

function isTerminal(status) {
  return isValidStatus(status) && Object.keys(TRANSITIONS[status] || {}).length === 0;
}

function allowedTransitions(from, role) {
  const map = TRANSITIONS[from] || {};
  return Object.keys(map).filter((to) => !role || map[to].includes(role));
}

function canTransition(from, to, role) {
  const roles = (TRANSITIONS[from] || {})[to];
  return Array.isArray(roles) && roles.includes(role);
}

/**
 * @returns {{ok:boolean, reason?:string}}
 */
function checkTransition(from, to, role) {
  if (!isValidStatus(from)) return { ok: false, reason: `Unknown current status "${from}".` };
  if (!isValidStatus(to)) return { ok: false, reason: `Unknown target status "${to}".` };
  if (canTransition(from, to, role)) return { ok: true };

  if (isTerminal(from)) {
    return { ok: false, reason: `This lease application is ${from}; it cannot be changed further.` };
  }
  // Reachable by someone, just not by this role — say which, rather than
  // claiming the move itself is impossible.
  if (allowedTransitions(from).includes(to)) {
    return { ok: false, reason: `Your role may not move a lease application from ${from} to ${to}.` };
  }
  const options = allowedTransitions(from, role);
  return {
    ok: false,
    reason: options.length
      ? `Cannot move a lease application from ${from} to ${to}. Allowed: ${options.join(", ")}.`
      : `Cannot move a lease application from ${from} to ${to}.`,
  };
}

/** Every status the given roles can ever move TO, for route-level validation. */
function targetStatusesForRoles(...roles) {
  const targets = new Set();
  for (const from of Object.keys(TRANSITIONS)) {
    for (const [to, allowed] of Object.entries(TRANSITIONS[from])) {
      if (allowed.some((r) => roles.includes(r))) targets.add(to);
    }
  }
  return [...targets];
}

/**
 * THE VALUATION GATE.
 *
 * A used or reconditioned vehicle may not be approved until an independent
 * valuation has come back. This is not a nicety: loan-to-value is measured
 * against the LOWER of invoice and valuation, so without one the
 * institution's actual exposure on an asset it is about to own is unknown.
 * Approving anyway would mean approving a number nobody has checked.
 *
 * A brand-new vehicle needs no valuation — a franchise invoice IS the market
 * value — so it passes this gate immediately.
 *
 * Returns a reason rather than a bare boolean so the caller can say WHY
 * rather than emitting a generic refusal.
 *
 * @param {object} p
 * @param {string} p.targetStatus     the status being moved to
 * @param {string} p.conditionType    brand_new | reconditioned | used
 * @param {boolean} p.hasCompletedValuation
 * @returns {{ok:boolean, reason?:string}}
 */
function checkValuationGate({ targetStatus, conditionType, hasCompletedValuation }) {
  if (targetStatus !== "approved") return { ok: true };
  if (conditionType === "brand_new") return { ok: true };
  if (hasCompletedValuation) return { ok: true };
  return {
    ok: false,
    reason:
      `A ${String(conditionType).replace("_", "-")} vehicle cannot be approved until an ` +
      `independent valuation has been completed — loan-to-value is measured against it.`,
  };
}

module.exports = {
  LEASE_STATUSES,
  INITIAL_STATUS,
  TRANSITIONS,
  AWAITING_STAFF_STATUSES,
  isValidStatus,
  isTerminal,
  allowedTransitions,
  canTransition,
  checkTransition,
  targetStatusesForRoles,
  checkValuationGate,
};

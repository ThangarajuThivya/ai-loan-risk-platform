"use strict";

/**
 * Loan-application status machine — pure, deterministic rules.
 *
 * No DB, no I/O, no Express. This module is the single source of truth for
 * two questions the rest of the loan feature keeps asking:
 *
 *   1. Which statuses can an application legally move to from where it is?
 *   2. Which ROLE is allowed to make that particular move?
 *
 * Both answers used to be a single hardcoded line in loanModel
 * (`if (current.status !== "pending")`) plus a hardcoded `isIn(["approved",
 * "rejected"])` in admin.routes.js, which meant the rules were duplicated,
 * partial, and impossible to test on their own. Everything status-related
 * now derives from TRANSITIONS below — the route validator, the model's
 * in-transaction guard, and the `allowed_transitions` the API hands the UI
 * so the frontend never has to mirror this table.
 *
 * See db/migrations/020_loan_application_status_machine.sql for the lifecycle
 * diagram and for why 'draft' and 'active' are deliberately absent.
 */

/** Every legal value of loan_applications.status (matches the 024 ENUM). */
const APPLICATION_STATUSES = [
  "pending",
  "under_review",
  "more_info_required",
  "approved",
  "accepted",
  "rejected",
  "withdrawn",
  "disbursed",
  "closed",
];

/** The status every new application starts in (the 020 ENUM's DEFAULT). */
const INITIAL_STATUS = "pending";

/**
 * The machine: TRANSITIONS[from][to] = roles permitted to make that move.
 * A `from` whose map is empty is terminal. A (from, to) pair absent from
 * this table is illegal for everyone, regardless of role.
 *
 * Role notes:
 *  - 'customer' may only ever withdraw, and only their own application
 *    (ownership is enforced by the caller, not here — this module knows
 *    about roles, not identities).
 *  - staff and admin have identical powers over applications today, with one
 *    exception: reopening a rejection is admin-only (see below). They are
 *    listed separately rather than collapsed into one "reviewer" role so
 *    that splitting them further later is a one-line edit here instead of a
 *    refactor.
 *  - 'system' is the decision matrix acting on its own (D2 — see
 *    decisionMatrix.service.js). It is a first-class role in this table
 *    rather than a bypass around it, so an automatic move is validated by
 *    the same machine as a human one and the audit trail's actor_role is
 *    literally true. It holds exactly one power: rejecting a fresh
 *    application that failed a mandatory credit policy criterion.
 */
const TRANSITIONS = {
  pending: {
    under_review: ["staff", "admin"],
    approved: ["staff", "admin"],
    rejected: ["staff", "admin", "system"],
    withdrawn: ["customer"],
  },
  under_review: {
    more_info_required: ["staff", "admin"],
    approved: ["staff", "admin"],
    rejected: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  // Two different actors can move this back to under_review, for two
  // different reasons: the customer submits their response (self-service,
  // via POST /api/loans/:id/respond — see loan.controller.js
  // respondToInfoRequest), or staff move it themselves after receiving the
  // missing information out of band (phone call, branch visit). Both land
  // on the same target status; only the customer's move stamps
  // info_response/info_responded_at (see isInfoResponse below) because that
  // field means "what the customer typed", not "staff confirms it arrived".
  more_info_required: {
    under_review: ["staff", "admin", "customer"],
    rejected: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  // An approved application carries an OFFER (023) the applicant has not
  // agreed to yet. Note there is deliberately no approved → disbursed edge:
  // releasing funds against terms nobody accepted is exactly the hole the
  // offer/acceptance flow closes. Drawdown is only reachable via 'accepted'.
  approved: {
    accepted: ["customer"],
    withdrawn: ["customer"],
  },
  // Terms agreed, money not yet moved. The applicant can still pull out
  // right up to drawdown; after that only 'closed' remains.
  accepted: {
    disbursed: ["staff", "admin"],
    withdrawn: ["customer"],
  },
  disbursed: {
    closed: ["staff", "admin"],
  },
  // Rejection is no longer absolutely terminal, and that is a deliberate
  // consequence of the decision matrix (D2) being allowed to reject on its
  // own: a verdict a machine can reach without a human must be one a human
  // can reconsider, or "authorised override" is a phrase with nothing
  // behind it. The edge is narrow on purpose —
  //   * admin only, not staff: this is the "authorized" in authorized
  //     override, and it undoes a decision the applicant has already been
  //     notified of;
  //   * back to under_review, never straight to approved: B1's rule that an
  //     application cannot leap from rejected to approved still holds. A
  //     reopened file re-enters the normal review path and is decided there;
  //   * gated behind a mandatory override reason code in the controller
  //     (see decisionMatrix.service.js requiresOverride), so every
  //     reopening carries a stated justification into the audit trail.
  rejected: {
    under_review: ["admin"],
  },
  withdrawn: {},
  closed: {},
};

/**
 * Statuses that represent a credit decision on the application, as opposed
 * to a workflow or operational step. Only these stamp
 * decided_by/decided_at/decision_note (migration 019) — "staff opened it"
 * and "the cashier released the funds" are not credit decisions and must
 * not overwrite who approved or rejected the loan.
 */
const CREDIT_DECISION_STATUSES = new Set(["approved", "rejected"]);

/**
 * Whether transitioning TO `status` is staff/admin asking the applicant for
 * something (migration 021's info_request_note/info_requested_at). Starts a
 * new request/response cycle — see loanModel.updateApplicationStatus, which
 * clears any stale info_response from a previous cycle when this fires.
 */
function isInfoRequest(status) {
  return status === "more_info_required";
}

/**
 * Whether this specific transition is the CUSTOMER answering an info
 * request (migration 021's info_response/info_responded_at). Deliberately
 * narrower than "did the status leave more_info_required": staff can also
 * make this exact move (e.g. after a phone call), and that must not get
 * recorded as if the customer had typed a response.
 */
function isInfoResponse(from, to, role) {
  return from === "more_info_required" && to === "under_review" && role === "customer";
}

/**
 * Customer-facing notification copy per target status, keyed the same way
 * the machine is. `null` means "do not notify": the customer performed the
 * transition themselves, so telling them about it is noise.
 *
 * Kept here rather than in loanModel so the model stays SQL-only, and
 * because this is pure status-keyed data with no I/O of its own.
 */
const NOTIFICATION_BY_STATUS = {
  under_review: {
    title: "Loan Application Under Review",
    body: (id) => `Your loan application #${id} is now being reviewed by our team.`,
  },
  more_info_required: {
    title: "More Information Needed",
    body: (id) =>
      `We need some additional information before we can decide on your loan application #${id}.`,
  },
  approved: {
    title: "Loan Offer Ready",
    body: (id) =>
      `Your loan application #${id} has been approved and an offer is waiting for your acceptance.`,
  },
  // Reached only by the applicant accepting their own offer. Self-actions
  // are otherwise suppressed in loanModel.updateApplicationStatus (telling
  // someone about their own withdraw/info-response a moment ago is noise),
  // but 'accepted' is carved out of that suppression (G2) — an acceptance
  // confirmation is exactly the kind of receipt a customer expects, unlike
  // "you withdrew" which has no copy at all (see withdrawn: null below).
  accepted: {
    title: "Loan Offer Accepted",
    body: (id) => `The offer on your loan application #${id} has been accepted.`,
  },
  rejected: {
    title: "Loan Application Rejected",
    body: (id) => `Your loan application #${id} has been rejected.`,
  },
  disbursed: {
    title: "Loan Disbursed",
    body: (id) => `The funds for your loan application #${id} have been released.`,
  },
  closed: {
    title: "Loan Closed",
    body: (id) => `Your loan from application #${id} has been closed.`,
  },
  withdrawn: null,
};

/** @returns {boolean} whether `status` is a value the ENUM accepts. */
function isValidStatus(status) {
  return APPLICATION_STATUSES.includes(status);
}

/** @returns {boolean} whether no transition at all leads out of `status`. */
function isTerminal(status) {
  return isValidStatus(status) && Object.keys(TRANSITIONS[status]).length === 0;
}

/** @returns {boolean} whether reaching `status` is a credit decision. */
function isCreditDecision(status) {
  return CREDIT_DECISION_STATUSES.has(status);
}

// F2 — the staff work queue. Distinct from isTerminal() above: 'approved'/
// 'rejected'/'disbursed' are not terminal in the state-machine sense (a
// rejection can be reopened, a disbursed loan runs on to 'closed'), but
// staff have already acted on all three — there's nothing to queue. Only
// these three are genuinely awaiting a staff decision or applicant
// response staff are waiting on.
const AWAITING_ACTION_STATUSES = ["pending", "under_review", "more_info_required"];

/** @returns {boolean} whether `status` still needs staff attention. */
function needsStaffAction(status) {
  return AWAITING_ACTION_STATUSES.includes(status);
}

/**
 * How long an application has sat in its current status, and whether
 * that's within SLA. Pure calendar-day arithmetic (no business-day
 * calendar exists anywhere in this codebase — matches
 * repayment.service.js's daysBetween convention).
 *
 * @param {Date|string} lastActionAt when the application entered its
 *   current status (the latest loan_application_events row for it — see
 *   loanModel.js's `evt.last_status_changed_at` join)
 * @param {object} [opts]
 * @param {Date} [opts.asOf] defaults to now — pass it in for tests
 * @param {number} [opts.warningDays=2] days before due_soon
 * @param {number} [opts.breachDays=4] days before overdue
 * @returns {{days:number, sla_status:'on_track'|'due_soon'|'overdue'}}
 */
function computeProcessingAge(lastActionAt, { asOf = new Date(), warningDays = 2, breachDays = 4 } = {}) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const toUtcDay = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const days = Math.round((toUtcDay(asOf) - toUtcDay(lastActionAt)) / MS_PER_DAY);

  let sla_status = "on_track";
  if (days >= breachDays) sla_status = "overdue";
  else if (days >= warningDays) sla_status = "due_soon";

  return { days, sla_status };
}

/**
 * Statuses reachable from `from`, optionally narrowed to those `role` may
 * perform. Used to build the API's `allowed_transitions` (so the UI renders
 * exactly the buttons the server would honour) and to drive route
 * validators.
 * @param {string} from
 * @param {string} [role] omit for "reachable by anyone"
 * @returns {string[]}
 */
function allowedTransitions(from, role) {
  const targets = TRANSITIONS[from];
  if (!targets) return [];
  const all = Object.keys(targets);
  if (!role) return all;
  return all.filter((to) => targets[to].includes(role));
}

/** @returns {boolean} whether `role` may move an application from → to. */
function canTransition(from, to, role) {
  return allowedTransitions(from, role).includes(to);
}

/**
 * Explain a transition attempt — the message-producing counterpart to
 * canTransition, so callers don't have to hand-write the "why not".
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
function checkTransition(from, to, role) {
  if (!isValidStatus(from)) return { ok: false, reason: `Unknown current status "${from}".` };
  if (!isValidStatus(to)) return { ok: false, reason: `Unknown target status "${to}".` };
  if (canTransition(from, to, role)) return { ok: true };

  if (isTerminal(from)) {
    return { ok: false, reason: `This application is ${from}; it cannot be changed further.` };
  }
  // Reachable by someone, just not by this role — say so, rather than
  // claiming the move itself is impossible.
  if (allowedTransitions(from).includes(to)) {
    return { ok: false, reason: `Your role may not move an application from ${from} to ${to}.` };
  }
  const options = allowedTransitions(from, role);
  return {
    ok: false,
    reason: options.length
      ? `Cannot move an application from ${from} to ${to}. Allowed: ${options.join(", ")}.`
      : `Cannot move an application from ${from} to ${to}.`,
  };
}

/**
 * Every status any of the given roles can ever transition *to*, across all
 * source statuses. Used by the route validator to reject nonsense targets
 * up front, without it having to know the shape of the machine.
 * @param {...string} roles
 * @returns {string[]}
 */
function targetStatusesForRoles(...roles) {
  const targets = new Set();
  for (const from of APPLICATION_STATUSES) {
    for (const [to, allowed] of Object.entries(TRANSITIONS[from])) {
      if (allowed.some((r) => roles.includes(r))) targets.add(to);
    }
  }
  return [...targets];
}

/**
 * Build the customer notification for arriving at `status`, or null if this
 * transition shouldn't produce one.
 * @param {string} status
 * @param {number} applicationId
 * @param {string} [note] optional reviewer note, appended when present
 * @returns {{title:string, message:string}|null}
 */
function buildNotification(status, applicationId, note) {
  const spec = NOTIFICATION_BY_STATUS[status];
  if (!spec) return null;
  const base = spec.body(applicationId);
  return {
    title: spec.title,
    message: note ? `${base} Note: ${note}` : base,
  };
}

// G2 — which transitions are worth a real email, not just an in-app
// notification. Routine internal moves (staff picking up a review, an
// applicant's own accept/withdraw receipt) stay in-app only; these are the
// moments a customer genuinely needs to know about away from the app.
const EMAIL_NOTIFIED_STATUSES = new Set([
  "approved",
  "rejected",
  "more_info_required",
  "disbursed",
  "closed",
]);

/** @returns {boolean} whether `status` warrants an email, not just an in-app notification. */
function shouldEmailStatusChange(status) {
  return EMAIL_NOTIFIED_STATUSES.has(status);
}

module.exports = {
  APPLICATION_STATUSES,
  INITIAL_STATUS,
  TRANSITIONS,
  isValidStatus,
  isTerminal,
  isCreditDecision,
  isInfoRequest,
  isInfoResponse,
  AWAITING_ACTION_STATUSES,
  needsStaffAction,
  computeProcessingAge,
  allowedTransitions,
  canTransition,
  checkTransition,
  targetStatusesForRoles,
  buildNotification,
  EMAIL_NOTIFIED_STATUSES,
  shouldEmailStatusChange,
};

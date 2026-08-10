"use strict";

/**
 * Every notification a lease can produce, in one place.
 *
 * PURE — no DB, no I/O. Each builder takes facts and returns a payload for
 * notificationModel. That keeps the wording, the routing and the dedupe
 * rules assertable without a database, and it keeps them OUT of the eight
 * controllers that trigger them: a lease event should be one line at the
 * call site, not five lines of prose inlined into a payment handler.
 *
 * WHO GETS TOLD WHAT. The rule throughout is that a notification goes to
 * whoever has to ACT, plus whoever is waiting on the outcome — and to
 * nobody else. `deriveNextAction` on the frontend already decides whose move
 * each stage is; this mirrors that division deliberately, so the portal's
 * "your turn" badge and the notification a person receives never disagree.
 *
 *   to the lessee  — the decision, the terms, money owed, the vehicle, title
 *   to staff/admin — work arriving, work unblocked, money received, arrears
 *
 * DEDUPE KEYS. Set only where repetition would be wrong:
 *   - reminders, which are true for days and re-evaluated hourly
 *   - one-shot milestones ("approved", "activated") that a retried request
 *     or a double-click could otherwise duplicate
 * A payment received is deliberately NOT deduped — two payments of the same
 * amount on the same day are two real events, and collapsing them would
 * hide money.
 *
 * The messages are English only, matching every other notification in this
 * system. Translating them would mean storing a key plus parameters rather
 * than prose, which is a change to how ALL notifications work, not a
 * leasing one; noted in ARCHITECTURE.md §13 as a known gap rather than half
 * done here.
 */

const CATEGORY = "lease";

const money = (v) =>
  `LKR ${Number(v || 0).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;

const day = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "";

/** Where a lessee goes to act on their lease. */
const lesseeLink = (applicationId) => `/dashboard/leases/${applicationId}`;

/**
 * Where an officer goes.
 *
 * Admin and staff have NO sub-routes — each dashboard is a single component
 * with internal tab state — so there is no `/dashboard/leasing/applications`
 * to link to, and inventing one would 404. Both dashboards now read `?tab=`
 * on first render, which makes this a real destination: the leasing queue,
 * open, with the drawer one click away.
 *
 * Deliberately not per-application: the drawer opens from the list and has
 * no addressable URL of its own, so claiming to link to one lease would be
 * a promise the app cannot keep.
 */
const staffLink = () => `/dashboard?tab=lease-applications`;

/** Common shape for anything addressed to the lessee about one application. */
function forLessee(applicationId, eventType, title, message, dedupeKey = null) {
  return {
    category: CATEGORY,
    eventType,
    title,
    message,
    link: lesseeLink(applicationId),
    referenceType: "lease_application",
    referenceId: applicationId,
    dedupeKey,
  };
}

/** Common shape for anything addressed to the desk. */
function forStaff(applicationId, eventType, title, message, dedupeKey = null) {
  return {
    category: CATEGORY,
    eventType,
    title,
    message,
    link: staffLink(),
    referenceType: "lease_application",
    referenceId: applicationId,
    dedupeKey,
  };
}

/**
 * "Toyota Aqua", or a bare noun when the row was loaded without its vehicle.
 *
 * The fallback is "vehicle", NOT "your vehicle": every call site already
 * supplies its own article or possessive — "to lease a ${…}", "the ${…} on
 * your lease" — so anything starting with a word of its own produces "a your
 * vehicle". Only a row fetched without the vehicle join can reach this, but
 * that is exactly the kind of thing that surfaces in front of a customer
 * rather than in a test.
 */
const vehicleOf = (app) =>
  [app?.make, app?.model].filter(Boolean).join(" ") || "vehicle";

/* ------------------------------------------------------------------ *
 * Intake and the credit decision
 * ------------------------------------------------------------------ */

const applicationSubmitted = {
  /** Confirms receipt, and sets the expectation that documents are needed. */
  lessee: (app) =>
    forLessee(
      app.id,
      "lease_application_submitted",
      "Lease application received",
      `We've received your application to lease a ${vehicleOf(app)} (#${app.id}). ` +
        `Upload your supporting documents so we can start the review.`,
      `lease_application_submitted:app=${app.id}`
    ),

  staff: (app, lesseeName) =>
    forStaff(
      app.id,
      "lease_application_submitted",
      "New lease application",
      `${lesseeName || "A customer"} has applied to lease a ${vehicleOf(app)} ` +
        `for ${money(app.financed_amount)} over ${app.term_months} months (#${app.id}).`,
      `lease_application_submitted:app=${app.id}`
    ),
};

/**
 * A credit decision, or a request for more information.
 *
 * 'approved' says outright that approval is not the last step. That single
 * sentence is the whole reason this notification is worth sending: an
 * approved lease with no quotation looks finished to a lessee, and the
 * portal had to be corrected for saying the same thing.
 */
function statusChanged(app, status, note) {
  const map = {
    approved: [
      "Lease application approved",
      `Good news — your application to lease a ${vehicleOf(app)} (#${app.id}) has been approved. ` +
        `We're preparing your quotation now; nothing is payable until you accept it.`,
    ],
    rejected: [
      "Lease application declined",
      `We're sorry — we're unable to approve your application to lease a ${vehicleOf(app)} ` +
        `(#${app.id}).`,
    ],
    info_requested: [
      "More information needed",
      `We need a little more from you before we can decide on your lease application ` +
        `(#${app.id}). Please check your documents.`,
    ],
    under_review: [
      "Lease application under review",
      `Your application to lease a ${vehicleOf(app)} (#${app.id}) is being reviewed by our team.`,
    ],
    withdrawn: [
      "Lease application withdrawn",
      `Your application to lease a ${vehicleOf(app)} (#${app.id}) has been withdrawn.`,
    ],
  };
  const entry = map[status];
  if (!entry) return null;

  const [title, base] = entry;
  return forLessee(
    app.id,
    `lease_status_${status}`,
    title,
    note ? `${base} Note from our team: "${note}"` : base,
    // One-shot: a re-decision to the same status is not news.
    `lease_status:${status}:app=${app.id}`
  );
}

/* ------------------------------------------------------------------ *
 * Valuation
 * ------------------------------------------------------------------ */

const valuation = {
  requested: (app) =>
    forLessee(
      app.id,
      "lease_valuation_requested",
      "Vehicle valuation arranged",
      `We've arranged an independent valuation of the ${vehicleOf(app)} on your lease ` +
        `application (#${app.id}). We'll be in touch once the report is in.`,
      `lease_valuation_requested:app=${app.id}`
    ),

  completed: (app, amount) =>
    forLessee(
      app.id,
      "lease_valuation_completed",
      "Valuation complete",
      `The independent valuation of your ${vehicleOf(app)} came back at ${money(amount)}. ` +
        `Your application (#${app.id}) can now be decided.`,
      `lease_valuation_completed:app=${app.id}`
    ),
};

/* ------------------------------------------------------------------ *
 * Quotation
 * ------------------------------------------------------------------ */

const quotation = {
  /** Not deduped by quotation id alone — a REISSUED quotation is new terms
   *  and the lessee must be told again, so the key carries the quotation. */
  issued: (app, quote) =>
    forLessee(
      app.id,
      "lease_quotation_issued",
      "Your lease quotation is ready",
      `Your terms for the ${vehicleOf(app)} are ready: ${money(quote.monthly_rental)} a month ` +
        `for ${quote.term_months} months, with ${money(quote.down_payment_amount)} payable at ` +
        `signing. Review and accept them to go ahead.` +
        (quote.expires_at ? ` This quotation lapses on ${day(quote.expires_at)}.` : ""),
      `lease_quotation_issued:q=${quote.id}`
    ),

  accepted: (app, quote, lesseeName) =>
    forStaff(
      app.id,
      "lease_quotation_accepted",
      "Lease terms accepted",
      `${lesseeName || "The lessee"} has accepted the terms on lease #${app.id}. ` +
        `${money(quote.down_payment_amount)} is now due at signing before the vehicle can be bought.`,
      `lease_quotation_accepted:q=${quote.id}`
    ),

  declined: (app, quote, lesseeName) =>
    forStaff(
      app.id,
      "lease_quotation_declined",
      "Lease terms declined",
      `${lesseeName || "The lessee"} has declined the terms on lease #${app.id}.`,
      `lease_quotation_declined:q=${quote.id}`
    ),

  /** Reminder — the D-marker keys it to the day, so one goes out per
   *  threshold rather than one per sweep. */
  expiringSoon: (app, quote, daysLeft) =>
    forLessee(
      app.id,
      "lease_quotation_expiring",
      "Your lease quotation is about to lapse",
      `Your quotation for the ${vehicleOf(app)} (#${app.id}) lapses ` +
        `${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}` +
        `. Accept it before ${day(quote.expires_at)} to keep these terms.`,
      `lease_quotation_expiring:q=${quote.id}:d=${daysLeft}`
    ),
};

/* ------------------------------------------------------------------ *
 * Down payment
 * ------------------------------------------------------------------ */

const downPayment = {
  /** NOT deduped: each receipt is a distinct event, and two part payments
   *  of the same amount on one day are two real things that happened. */
  received: (app, amount, outstanding) =>
    forLessee(
      app.id,
      "lease_down_payment_received",
      "Down payment received",
      outstanding > 0
        ? `We've received ${money(amount)} towards the signing amount on lease #${app.id}. ` +
          `${money(outstanding)} is still outstanding.`
        : `We've received ${money(amount)} — your signing amount on lease #${app.id} is now ` +
          `paid in full. We'll purchase the vehicle next.`
    ),

  settledStaff: (app, lesseeName) =>
    forStaff(
      app.id,
      "lease_down_payment_settled",
      "Down payment settled — ready to purchase",
      `${lesseeName || "The lessee"} has settled the signing amount on lease #${app.id}. ` +
        `The vehicle can now be bought from the supplier.`,
      `lease_down_payment_settled:app=${app.id}`
    ),

  /** Reminder, keyed per day-bucket. */
  outstandingReminder: (app, outstanding, daysWaiting) =>
    forLessee(
      app.id,
      "lease_down_payment_due",
      "Your down payment is still outstanding",
      `${money(outstanding)} is still due at signing on your lease (#${app.id}). ` +
        `We can't purchase the ${vehicleOf(app)} until it clears — you can pay by card in the portal.`,
      `lease_down_payment_due:app=${app.id}:d=${daysWaiting}`
    ),
};

/* ------------------------------------------------------------------ *
 * Purchase, title, activation
 * ------------------------------------------------------------------ */

const purchase = {
  dealerPaid: (app) =>
    forLessee(
      app.id,
      "lease_vehicle_purchased",
      "We've bought your vehicle",
      `We've paid the supplier for your ${vehicleOf(app)} (#${app.id}). ` +
        `Next we'll register it with the DMT.`,
      `lease_vehicle_purchased:app=${app.id}`
    ),

  registered: (app, crNumber) =>
    forLessee(
      app.id,
      "lease_vehicle_registered",
      "Your vehicle is registered",
      `The ${vehicleOf(app)} on lease #${app.id} is now registered` +
        `${crNumber ? ` under CR ${crNumber}` : ""}. We are the absolute owner and you are the ` +
        `registered user until your final rental is paid.`,
      `lease_vehicle_registered:app=${app.id}`
    ),

  activated: (app, agreement) =>
    forLessee(
      app.id,
      "lease_activated",
      "Your lease has started",
      `Your lease ${agreement?.agreement_no || `#${app.id}`} is now active. ` +
        `${money(agreement?.monthly_rental)} is due each month for ${agreement?.term_months} months` +
        `${agreement?.first_rental_date ? `, starting ${day(agreement.first_rental_date)}` : ""}.`,
      `lease_activated:app=${app.id}`
    ),
};

/* ------------------------------------------------------------------ *
 * Rentals — the part a lessee lives with for years
 * ------------------------------------------------------------------ */

const rentals = {
  /** NOT deduped — every payment is its own event. */
  received: (app, amount, position) =>
    forLessee(
      app.id,
      "lease_rental_received",
      "Rental payment received",
      `Thank you — we've received ${money(amount)} on lease #${app.id}. ` +
        `${position?.rentalsPaid ?? 0} of ${position?.rentalsTotal ?? 0} rentals paid` +
        `${position?.outstanding > 0 ? `, ${money(position.outstanding)} outstanding` : ""}.`
    ),

  /** Ahead of the due date. Keyed to the rental AND the day-marker so a
   *  D-7 and a D-3 notice for the same rental are both allowed, but a
   *  second D-3 is not. */
  dueSoon: (app, rentalNo, dueDate, amount, daysAhead) =>
    forLessee(
      app.id,
      "lease_rental_due",
      "Rental due soon",
      `Rental ${rentalNo} of ${money(amount)} on lease #${app.id} is due ` +
        `${daysAhead === 0 ? "today" : `in ${daysAhead} day${daysAhead === 1 ? "" : "s"}`} ` +
        `(${day(dueDate)}). You can pay it in the portal.`,
      `lease_rental_due:app=${app.id}:r=${rentalNo}:d=${daysAhead}`
    ),

  /** Past the due date. Keyed by how overdue, in buckets, so a lessee gets
   *  escalating notices rather than a daily drip. */
  overdue: (app, rentalNo, dueDate, amount, daysLate, bucket) =>
    forLessee(
      app.id,
      "lease_rental_overdue",
      "Rental overdue",
      `Rental ${rentalNo} of ${money(amount)} on lease #${app.id} was due on ${day(dueDate)} ` +
        `and is now ${daysLate} day${daysLate === 1 ? "" : "s"} late. Please pay as soon as you can.`,
      `lease_rental_overdue:app=${app.id}:r=${rentalNo}:b=${bucket}`
    ),

  /** Arrears the desk should chase. Only at the escalation bucket — staff
   *  do not need a notice the day after a rental slips. */
  arrearsStaff: (app, lesseeName, count, amount, daysLate) =>
    forStaff(
      app.id,
      "lease_arrears",
      "Lease in arrears",
      `Lease #${app.id} (${lesseeName || "lessee"}) has ${count} rental${count === 1 ? "" : "s"} ` +
        `overdue totalling ${money(amount)}, the oldest ${daysLate} days late.`,
      `lease_arrears:app=${app.id}:b=${Math.floor(daysLate / 30)}`
    ),

  settled: (app) =>
    forLessee(
      app.id,
      "lease_settled_early",
      "Your lease is settled",
      `Your lease #${app.id} has been settled in full and is now closed. ` +
        `We'll issue your letter of release so you can transfer the ${vehicleOf(app)} into your name.`,
      `lease_settled_early:app=${app.id}`
    ),

  completed: (app) =>
    forLessee(
      app.id,
      "lease_completed",
      "Final rental paid",
      `That's your last rental on lease #${app.id} — thank you. ` +
        `We'll issue your letter of release so you can transfer the ${vehicleOf(app)} into your name.`,
      `lease_completed:app=${app.id}`
    ),

  completedStaff: (app, lesseeName) =>
    forStaff(
      app.id,
      "lease_completed",
      "Lease fully paid — release due",
      `Lease #${app.id} (${lesseeName || "lessee"}) is fully paid. A letter of release is now due.`,
      `lease_completed_staff:app=${app.id}`
    ),
};

/* ------------------------------------------------------------------ *
 * Release of title — what the whole module builds towards
 * ------------------------------------------------------------------ */

const release = {
  issued: (app, releaseNo) =>
    forLessee(
      app.id,
      "lease_release_issued",
      "Your letter of release is ready",
      `Your letter of release (${releaseNo}) for the ${vehicleOf(app)} is ready to download. ` +
        `Take it to the DMT to transfer the vehicle into your own name.`,
      `lease_release_issued:app=${app.id}`
    ),

  transferred: (app) =>
    forLessee(
      app.id,
      "lease_title_transferred",
      "The vehicle is yours",
      `The ${vehicleOf(app)} from lease #${app.id} has been transferred into your name. ` +
        `Congratulations, and thank you for leasing with us.`,
      `lease_title_transferred:app=${app.id}`
    ),
};

/* ------------------------------------------------------------------ *
 * Stalled work — the "progress status" nudge, aimed at the desk
 * ------------------------------------------------------------------ */

/**
 * A lease sitting on a STAFF-owned stage for too long.
 *
 * The counterpart to the lessee-facing reminders: those chase a customer,
 * this chases us. Without it the only thing keeping a lease moving is
 * somebody remembering to look at the queue — and the approved-with-no-
 * quotation case, where both sides waited on each other, is exactly what
 * that failure looks like.
 */
function stalled(app, stageLabel, daysWaiting, lesseeName) {
  return forStaff(
    app.id,
    "lease_stalled",
    "Lease waiting on us",
    `Lease #${app.id} (${lesseeName || "lessee"}) has been waiting at "${stageLabel}" for ` +
      `${daysWaiting} days. The lessee can't move it forward until we do.`,
    `lease_stalled:app=${app.id}:stage=${stageLabel}:b=${Math.floor(daysWaiting / 7)}`
  );
}

module.exports = {
  CATEGORY,
  lesseeLink,
  staffLink,
  applicationSubmitted,
  statusChanged,
  valuation,
  quotation,
  downPayment,
  purchase,
  rentals,
  release,
  stalled,
};

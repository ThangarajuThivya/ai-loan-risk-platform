"use strict";

/**
 * The bridge between lease controllers and the notification store.
 *
 * leaseNotification.service decides WHAT to say (pure, testable);
 * notificationModel decides HOW to store it. This is the thin layer that
 * puts the two together and resolves the one fact the catalogue needs but a
 * controller rarely has to hand — the lessee's name.
 *
 * EVERY FUNCTION HERE IS FIRE-AND-FORGET AND CANNOT THROW. A notification is
 * always a side effect of something that already succeeded: the payment
 * cleared, the CR came back, the lease activated. If writing the notice
 * fails, the correct behaviour is to log it and carry on — a lessee whose
 * money moved must never see an error because a row in `notifications`
 * could not be inserted. Call sites therefore do not need `await` or a
 * try/catch, and are one line.
 */

const notificationModel = require("../models/notificationModel");
const db = require("../config/db");
const N = require("./leaseNotification.service");

const pool = db.promise();

/**
 * Best-effort display name for a staff-facing notice.
 *
 * Read from `users`, NOT from `customer_profiles`. That distinction is the
 * whole reason this exists: `loanModel.findProfileByUserId` — the obvious
 * function to reach for, and the one the PDF path uses — selects only
 * profile columns, and a name is not among them. Using it here produced
 * "Lease #95 (lessee)" on every notice sent to the desk, which is exactly
 * the kind of thing that looks fine in code and useless on screen.
 *
 * Some rows carry a lessee name already (the queue query joins it), so that
 * is preferred over a second round trip.
 */
async function lesseeNameOf(application) {
  const joined = [application?.lessee_first_name, application?.lessee_last_name]
    .filter(Boolean)
    .join(" ");
  if (joined) return joined;

  try {
    const [rows] = await pool.query(
      `SELECT first_name, last_name FROM users WHERE user_id = ? LIMIT 1`,
      [application.lessee_id]
    );
    return [rows[0]?.first_name, rows[0]?.last_name].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}

/** Send one prebuilt notice to the lessee. Never throws. */
function toLessee(application, notice) {
  if (!notice) return Promise.resolve();
  return notificationModel
    .safeCreate({ ...notice, userId: application.lessee_id })
    .catch(() => {});
}

/** Send one prebuilt notice to every active admin and staff member. */
function toDesk(notice) {
  if (!notice) return Promise.resolve();
  return notificationModel.createForRoles(notice).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * One function per lease event. Controllers call exactly one of these.
 * ------------------------------------------------------------------ */

async function applicationSubmitted(application) {
  await toLessee(application, N.applicationSubmitted.lessee(application));
  await toDesk(N.applicationSubmitted.staff(application, await lesseeNameOf(application)));
}

async function statusChanged(application, status, note) {
  await toLessee(application, N.statusChanged(application, status, note));
}

async function valuationRequested(application) {
  await toLessee(application, N.valuation.requested(application));
}

async function valuationCompleted(application, amount) {
  await toLessee(application, N.valuation.completed(application, amount));
}

async function quotationIssued(application, quotation) {
  await toLessee(application, N.quotation.issued(application, quotation));
}

async function quotationAnswered(application, quotation, decision) {
  const name = await lesseeNameOf(application);
  await toDesk(
    decision === "accept"
      ? N.quotation.accepted(application, quotation, name)
      : N.quotation.declined(application, quotation, name)
  );
}

async function downPaymentReceived(application, amount, position) {
  await toLessee(application, N.downPayment.received(application, amount, position?.outstanding ?? 0));
  // The desk only needs telling once the whole signing amount is in — that
  // is the moment their work is unblocked. A part payment changes nothing
  // they can act on.
  if (position?.settled) {
    await toDesk(N.downPayment.settledStaff(application, await lesseeNameOf(application)));
  }
}

async function dealerPaid(application) {
  await toLessee(application, N.purchase.dealerPaid(application));
}

async function vehicleRegistered(application, crNumber) {
  await toLessee(application, N.purchase.registered(application, crNumber));
}

async function leaseActivated(application, agreement) {
  await toLessee(application, N.purchase.activated(application, agreement));
}

/**
 * A rental landed. Three distinct outcomes, and the lessee should hear the
 * most significant one rather than all three.
 */
async function rentalReceived(application, amount, position, { settlement = false } = {}) {
  await toLessee(application, N.rentals.received(application, amount, position));

  if (position?.fullyPaid) {
    await toLessee(
      application,
      settlement ? N.rentals.settled(application) : N.rentals.completed(application)
    );
    await toDesk(N.rentals.completedStaff(application, await lesseeNameOf(application)));
  }
}

async function releaseIssued(application, releaseNo) {
  await toLessee(application, N.release.issued(application, releaseNo));
}

async function titleTransferred(application) {
  await toLessee(application, N.release.transferred(application));
}

module.exports = {
  lesseeNameOf,
  toLessee,
  toDesk,
  applicationSubmitted,
  statusChanged,
  valuationRequested,
  valuationCompleted,
  quotationIssued,
  quotationAnswered,
  downPaymentReceived,
  dealerPaid,
  vehicleRegistered,
  leaseActivated,
  rentalReceived,
  releaseIssued,
  titleTransferred,
};

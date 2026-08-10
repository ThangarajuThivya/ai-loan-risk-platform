"use strict";

/**
 * The background sweep that actually sends lease reminders — same
 * setInterval shape as lateFeeSweep / offerExpiry / fxExpirySweep.
 *
 * DIVISION OF LABOUR. leaseReminders.service decides WHICH reminders are due
 * (pure, tested against injected dates); leaseNotification.service decides
 * WHAT they say (pure, tested); notificationModel decides whether one has
 * already been sent (UNIQUE index on dedupe_key). This file only does the
 * I/O that joins them, which is why it can afford to be as dumb as it is:
 * re-evaluate everything, try to send everything, let the schema throw away
 * what has already gone out.
 *
 * That dumbness is deliberate and is the whole design. The sweep keeps no
 * state, remembers nothing between runs, and is safe to run at any
 * frequency — including twice at once, or immediately after a crash. Any
 * cleverness about "what did I already send?" would be a second source of
 * truth to get wrong.
 *
 * Reminders exist because the passage of time is the only trigger for them:
 * nothing in a request/response cycle knows that a rental fell due
 * yesterday, because nobody made a request.
 */

const leaseAppModel = require("../models/leaseApplication.model");
const agreementModel = require("../models/leaseAgreement.model");
const dpModel = require("../models/leaseDownPayment.model");
const notificationModel = require("../models/notificationModel");
const N = require("./leaseNotification.service");
const leaseNotifier = require("./leaseNotifier.service");
const reminders = require("./leaseReminders.service");
const { toIsoDate, todayIso } = require("./leaseRentalQuote.service");

const DEFAULT_SWEEP_INTERVAL_MS =
  Number(process.env.LEASE_REMINDER_SWEEP_INTERVAL_MS) || 6 * 60 * 60 * 1000;

let intervalHandle = null;

/** Stages a lease can sit at while waiting on US, for the stalled nudge. */
const STAFF_OWNED_STAGES = {
  pending: "Awaiting review",
  under_review: "Under review",
  approved: "Approved — quotation not yet issued",
};

/**
 * Send one notice, swallowing anything that goes wrong with it.
 * A single bad application must not stop the sweep for everyone else.
 */
async function send(userId, notice, counters, key) {
  if (!notice) return;
  try {
    const res = await notificationModel.create({ ...notice, userId });
    if (res.created) counters[key] = (counters[key] || 0) + 1;
  } catch (err) {
    console.error(`[leaseReminderSweep] ${key} failed:`, err.message);
  }
}

async function sendToDesk(notice, counters, key) {
  if (!notice) return;
  try {
    const n = await notificationModel.createForRoles(notice);
    if (n) counters[key] = (counters[key] || 0) + n;
  } catch (err) {
    console.error(`[leaseReminderSweep] ${key} failed:`, err.message);
  }
}

/**
 * One pass over every lease that could need reminding.
 *
 * @param {object} [opts]
 * @param {string} [opts.today] ISO date; injectable so a test does not have
 *                              to wait for the calendar
 * @returns {Promise<object>} counts of what was newly sent
 */
async function sweepLeaseReminders({ today } = {}) {
  const asOf = today || todayIso();
  const counters = {};

  const applications = await leaseAppModel.findAllLeaseApplications();

  for (const app of applications) {
    try {
      // --- live leases: rentals due and overdue --------------------------
      const agreement = await agreementModel.findAgreementByApplication(app.id);
      if (agreement && agreement.status === "active") {
        const schedule = await agreementModel.findRentalSchedule(agreement.id);
        const due = reminders.rentalRemindersFor({ schedule, today: asOf });

        for (const r of due) {
          if (r.kind === "due_soon") {
            await send(
              app.lessee_id,
              N.rentals.dueSoon(app, r.rentalNo, r.dueDate, r.amount, r.daysAhead),
              counters,
              "rental_due_soon"
            );
          } else {
            await send(
              app.lessee_id,
              N.rentals.overdue(app, r.rentalNo, r.dueDate, r.amount, r.daysLate, r.bucket),
              counters,
              "rental_overdue"
            );

            // Escalate to the desk only once arrears are real — the 3-day
            // bucket is a customer nudge, not a collections matter.
            if (r.bucket >= 14) {
              const position = await agreementModel.getRentalPosition(agreement.id);
              await sendToDesk(
                N.rentals.arrearsStaff(
                  app,
                  await leaseNotifier.lesseeNameOf(app),
                  position?.arrears?.count ?? 1,
                  position?.arrears?.amount ?? r.amount,
                  r.daysLate
                ),
                counters,
                "arrears_desk"
              );
            }
          }
        }
        // A live lease has nothing else to be reminded about.
        continue;
      }

      // --- a live quotation about to lapse --------------------------------
      const quotations = await leaseAppModel.findQuotationsByApplication(app.id);
      const live = quotations.find((q) => q.status === "pending");
      if (live) {
        const expiry = reminders.quotationExpiryReminder({ quotation: live, today: asOf });
        if (expiry) {
          await send(
            app.lessee_id,
            N.quotation.expiringSoon(app, live, expiry.daysLeft),
            counters,
            "quotation_expiring"
          );
        }
      }

      // --- an accepted quotation whose signing amount has not arrived -----
      const accepted = quotations.find((q) => q.status === "accepted");
      if (accepted) {
        const position = await dpModel.getSigningPosition(app.id);
        const chase = reminders.downPaymentReminder({
          position,
          acceptedAt: accepted.responded_at,
          today: asOf,
        });
        if (chase) {
          await send(
            app.lessee_id,
            N.downPayment.outstandingReminder(app, chase.outstanding, chase.daysWaiting),
            counters,
            "down_payment_due"
          );
        }
      }

      // --- work sitting on OUR side of the fence ---------------------------
      const stageLabel = STAFF_OWNED_STAGES[app.status];
      if (stageLabel) {
        const stalled = reminders.stalledReminder({
          nextActionActor: "staff",
          stageLabel,
          // updated_at moves on every transition, so this measures time at
          // the CURRENT stage rather than the age of the application.
          lastMovedAt: toIsoDate(app.updated_at || app.created_at),
          today: asOf,
        });
        if (stalled) {
          await sendToDesk(
            N.stalled(app, stalled.stageLabel, stalled.daysWaiting, await leaseNotifier.lesseeNameOf(app)),
            counters,
            "stalled_desk"
          );
        }
      }
    } catch (err) {
      console.error(`[leaseReminderSweep] application ${app.id} failed:`, err.message);
    }
  }

  return counters;
}

/**
 * Run one sweep immediately, then on an interval. Never throws.
 * @param {number} [intervalMs]
 */
function scheduleLeaseReminderSweep(intervalMs = DEFAULT_SWEEP_INTERVAL_MS) {
  sweepLeaseReminders().catch((err) =>
    console.error("[leaseReminderSweep] initial sweep failed:", err.message)
  );

  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    sweepLeaseReminders().catch((err) =>
      console.error("[leaseReminderSweep] scheduled sweep failed:", err.message)
    );
  }, intervalMs);
  // unref so a pending timer never keeps the process alive on shutdown —
  // same as every other sweep in this codebase.
  if (intervalHandle.unref) intervalHandle.unref();
}

module.exports = { sweepLeaseReminders, scheduleLeaseReminderSweep, STAFF_OWNED_STAGES };

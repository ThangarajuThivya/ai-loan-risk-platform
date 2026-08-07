"use strict";

/**
 * Background sweep that lapses un-actioned loan offers (migration 023) —
 * same setInterval shape as fxExpirySweep.service.js and rateFeed.service.js.
 *
 * An offer carries its own expires_at, and the accept path already refuses
 * to act on a lapsed one (loanModel.respondToOfferWithin guards on
 * `expires_at > CURRENT_TIMESTAMP` in SQL, which is what actually enforces
 * expiry). This sweep exists so the stored STATUS matches reality too:
 * without it a dead offer sits at 'pending' forever, staff queues show work
 * that can't be actioned, and the applicant sees an Accept button that will
 * only ever 409.
 *
 * Note what this does NOT do: the APPLICATION stays 'approved'. A lapsed
 * offer doesn't kill the application — staff simply issue a fresh one via
 * POST /api/admin/applications/:id/offer, which supersedes the old row.
 * That mirrors how a real facility letter expiring means "re-issue", not
 * "start again".
 */

const loanModel = require("../models/loanModel");
const notificationModel = require("../models/notificationModel");

const DEFAULT_SWEEP_INTERVAL_MS =
  Number(process.env.LOAN_OFFER_SWEEP_INTERVAL_MS) || 60 * 60 * 1000;

let intervalHandle = null;

/**
 * Lapse every pending offer past its expiry and tell the applicants.
 * @returns {Promise<{expired:number}>}
 */
async function sweepExpiredOffers() {
  const { expired, applicationIds } = await loanModel.expireLapsedOffers();
  if (!expired) return { expired: 0 };

  // Notifications are best-effort and deliberately outside the status
  // update: a notification failure must not leave the offer un-expired,
  // which would make the sweep retry it forever.
  for (const applicationId of applicationIds) {
    try {
      const row = await loanModel.findApplicationById(applicationId);
      if (!row) continue;
      await notificationModel.create({
        userId: row.user_id,
        title: "Loan Offer Expired",
        message:
          `The offer on your loan application #${applicationId} has expired. ` +
          `Contact us if you would still like to proceed and we can issue a new one.`,
      });
    } catch (err) {
      console.error("[offerExpiry] notification failed:", err.message);
    }
  }

  return { expired };
}

/**
 * Run one sweep immediately, then on an interval. Never throws — a failing
 * sweep logs and waits for the next tick rather than taking the server down.
 * @param {number} [intervalMs]
 */
function scheduleOfferExpirySweep(intervalMs = DEFAULT_SWEEP_INTERVAL_MS) {
  sweepExpiredOffers().catch((err) =>
    console.error("[offerExpiry] initial sweep failed:", err.message)
  );

  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    sweepExpiredOffers().catch((err) =>
      console.error("[offerExpiry] scheduled sweep failed:", err.message)
    );
  }, intervalMs);
  // Don't hold the event loop open just for the sweep.
  if (intervalHandle.unref) intervalHandle.unref();
}

module.exports = { sweepExpiredOffers, scheduleOfferExpirySweep };

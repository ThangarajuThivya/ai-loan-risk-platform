"use strict";

/**
 * Background sweep that auto-expires stale 'pending_review' FX exchange
 * requests (Phase 10, CURRENCY_FEATURE.md §12) — same setInterval shape as
 * rateFeed.service.js. A request no staff member has actioned within
 * FX_REQUEST_REVIEW_SLA_MS is moved to 'expired' rather than left pending
 * forever; the customer is notified so they know to submit a fresh request
 * (with a fresh quote) if they still want the exchange.
 *
 * This is distinct from the pre-submission quote TTL
 * (fxQuote.service.js's QUOTE_TTL_SECONDS, ~15 minutes) — that one governs
 * how long a customer has to redeem a quote into a request at all. Once
 * submitted, the request's own review SLA is a much longer, operational
 * window (default 3 days), since real staff review isn't instant.
 */

const fxExchangeModel = require("../models/fxExchangeModel");
const notificationModel = require("../models/notificationModel");

const DEFAULT_SLA_MS = Number(process.env.FX_REQUEST_REVIEW_SLA_MS) || 3 * 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

let intervalHandle = null;

/**
 * Expire every 'pending_review' request created before the SLA cutoff.
 * @param {number} [slaMs]
 * @returns {Promise<{checked:number, expired:number}>}
 */
async function sweepExpiredRequests(slaMs = DEFAULT_SLA_MS) {
  const cutoff = new Date(Date.now() - slaMs);
  const ids = await fxExchangeModel.findStalePendingIds(cutoff);

  let expiredCount = 0;
  for (const id of ids) {
    const result = await fxExchangeModel.transitionStatus({
      id,
      fromStatuses: ["pending_review"],
      toStatus: "expired",
      actorUserId: null,
      note: "Auto-expired: exceeded the review SLA without a staff decision.",
    });
    if (!result.ok) continue;
    expiredCount += 1;

    const row = await fxExchangeModel.findById(id);
    await notificationModel
      .create({
        userId: result.userId,
        title: "FX Exchange Request Expired",
        message: `Your request ${row.reference_no} expired without review and was automatically closed. Please submit a new request (with a fresh quote) if you still wish to exchange currency.`,
      })
      .catch((err) => console.error("[fxExpirySweep] notification failed:", err.message));
  }

  return { checked: ids.length, expired: expiredCount };
}

/**
 * Start the background sweep loop. Safe to call once at server boot.
 * @param {number} [intervalMs]
 */
function scheduleExpirySweep(intervalMs = DEFAULT_SWEEP_INTERVAL_MS) {
  if (intervalHandle) return intervalHandle;

  sweepExpiredRequests().catch((err) =>
    console.error("[fxExpirySweep] initial sweep failed:", err.message)
  );

  intervalHandle = setInterval(() => {
    sweepExpiredRequests().catch((err) =>
      console.error("[fxExpirySweep] scheduled sweep failed:", err.message)
    );
  }, intervalMs);
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();

  return intervalHandle;
}

function stopExpirySweep() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  sweepExpiredRequests,
  scheduleExpirySweep,
  stopExpirySweep,
  DEFAULT_SLA_MS,
};

"use strict";

/**
 * Background sweep that charges late fees on overdue installments —
 * same setInterval shape as offerExpiry.service.js / fxExpirySweep.service.js.
 *
 * repayment.service.js computeLateFeeAssessments decides WHICH installments
 * are eligible (overdue past grace, unpaid, never charged before); this
 * sweep is what actually runs that check periodically and writes the result,
 * since nothing else in the request/response cycle would ever trigger it —
 * a fee accrues from the passage of time, not from a customer or staff
 * action.
 */

const loanModel = require("../models/loanModel");
const notificationModel = require("../models/notificationModel");

const DEFAULT_SWEEP_INTERVAL_MS =
  Number(process.env.LOAN_LATE_FEE_SWEEP_INTERVAL_MS) || 6 * 60 * 60 * 1000;

let intervalHandle = null;

/**
 * Assess late fees across every active loan and notify affected borrowers.
 * @returns {Promise<{charged:number}>}
 */
async function sweepLateFees() {
  const { charged, applicationIds } = await loanModel.assessLateFees();
  if (!charged) return { charged: 0 };

  // Best-effort and outside the fee write itself, same reasoning as
  // offerExpiry.service.js: a notification failure must not leave a fee
  // unassessed, which would make the sweep retry it forever.
  for (const applicationId of applicationIds) {
    try {
      const row = await loanModel.findApplicationById(applicationId);
      if (!row) continue;
      await notificationModel.create({
        userId: row.user_id,
        title: "Late Fee Charged",
        message:
          `A late fee has been added to your loan for application #${applicationId} ` +
          `because an instalment is overdue. Please check your repayment schedule.`,
      });
    } catch (err) {
      console.error("[lateFeeSweep] notification failed:", err.message);
    }
  }

  return { charged };
}

/**
 * Run one sweep immediately, then on an interval. Never throws.
 * @param {number} [intervalMs]
 */
function scheduleLateFeeSweep(intervalMs = DEFAULT_SWEEP_INTERVAL_MS) {
  sweepLateFees().catch((err) =>
    console.error("[lateFeeSweep] initial sweep failed:", err.message)
  );

  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    sweepLateFees().catch((err) =>
      console.error("[lateFeeSweep] scheduled sweep failed:", err.message)
    );
  }, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref();
}

module.exports = { sweepLateFees, scheduleLateFeeSweep };

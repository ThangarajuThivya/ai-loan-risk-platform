"use strict";

/**
 * Collateral and guarantor summarization (D5) — pure, deterministic. No DB,
 * no I/O.
 *
 * Two entities back a loan beyond the applicant's own figures: a GUARANTOR
 * (a real person, migration 033's `guarantors`/`loan_guarantors`) and
 * COLLATERAL (an asset pledged against it, `collateral_items`). Both are
 * fetched from the database by loanModel.js and turned into a small,
 * already-summarized shape here — creditPolicy.service.js's
 * COLLATERAL_COVERAGE and GUARANTOR_RELIABILITY rules consume that summary
 * and never touch a raw row, the same "precomputed input, no DB" boundary
 * every other rule in that module already respects (it takes a precomputed
 * EMI rather than a rate, for exactly this reason).
 *
 * Keeping the summarization HERE rather than inline in the controller
 * means the arithmetic — a coverage ratio, "is any guarantor distressed
 * elsewhere" — is unit-testable without a database and without touching
 * creditPolicy.service.js at all.
 */

/** Sri Lankan National Identity Card — old (9 digits + V/X) or new (12 digits) format. */
const NIC_PATTERN = /^([0-9]{9}[VvXx]|[0-9]{12})$/;

/** Collateral asset categories a customer can pledge. */
const COLLATERAL_TYPES = ["property", "vehicle", "gold_jewellery", "fixed_deposit", "other"];

/**
 * Whether `value` is a well-formed Sri Lankan NIC. Format only — this does
 * not (and cannot) confirm the number belongs to a real person; it exists
 * so a typo is caught before a guarantor record is created under it.
 * @param {string} value
 * @returns {boolean}
 */
function isValidNic(value) {
  return typeof value === "string" && NIC_PATTERN.test(value.trim());
}

/**
 * Summarize the collateral pledged on ONE application into the numbers
 * COLLATERAL_COVERAGE needs. Only application-scoped (no cross-application
 * aggregation) — unlike a guarantor, the same physical asset being pledged
 * twice is a fraud question this module makes no attempt to detect.
 *
 * `totalDeclaredValue` is the full claimed total regardless of verification
 * outcome — an honest record of what the applicant said, including anything
 * staff have since rejected. `totalVerifiedValue` is the only one
 * COLLATERAL_COVERAGE may treat as real security.
 *
 * @param {object[]} items  collateral_items rows (or equivalent), each with
 *   `estimated_value` and `verification_status`
 * @returns {{itemCount:number, totalDeclaredValue:number,
 *            totalVerifiedValue:number, hasUnverified:boolean}}
 */
function summarizeCollateral(items = []) {
  let totalDeclaredValue = 0;
  let totalVerifiedValue = 0;
  let hasUnverified = false;

  for (const item of items) {
    const value = Number(item.estimated_value) || 0;
    totalDeclaredValue += value;
    if (item.verification_status === "verified") {
      totalVerifiedValue += value;
    } else if (item.verification_status !== "rejected") {
      // 'self_declared' — counted toward totalDeclaredValue above, but not
      // trusted for coverage (totalVerifiedValue) until a human confirms it.
      hasUnverified = true;
    }
    // 'rejected' items still count toward totalDeclaredValue — that total is
    // an honest record of what was CLAIMED, not a running coverage figure —
    // but never toward totalVerifiedValue: staff have already said this one
    // doesn't hold up, and it must not silently offset risk.
  }

  return {
    itemCount: items.length,
    totalDeclaredValue: Math.round(totalDeclaredValue * 100) / 100,
    totalVerifiedValue: Math.round(totalVerifiedValue * 100) / 100,
    hasUnverified,
  };
}

/**
 * What fraction of the requested amount is covered by VERIFIED collateral.
 * null (not 0) when there is nothing to divide by — an unrequested loan
 * amount of zero is a caller bug, not "zero coverage".
 * @param {number} totalVerifiedValue
 * @param {number} requestedAmount
 * @returns {number|null}
 */
function computeCoverageRatio(totalVerifiedValue, requestedAmount) {
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((Number(totalVerifiedValue) / amount) * 10000) / 10000;
}

/**
 * Summarize each linked guarantor's exposure ELSEWHERE in the system into
 * what GUARANTOR_RELIABILITY needs: are they already backing another
 * facility, and is any of that in arrears right now.
 *
 * Takes the ALREADY-QUERIED per-guarantor rows (loanModel.js
 * findGuarantorExposureByNic does the join across loan_guarantors →
 * loan_applications → loan_accounts → repayment_schedule) — this function
 * only reshapes and totals them, so the "what counts as distressed" query
 * logic lives in exactly one place (the SQL) and this stays a pure
 * transform of its result.
 *
 * @param {object[]} rows  one row per guarantor, each with `full_name`,
 *   `other_active_guarantees` (count), `other_active_exposure` (sum),
 *   `other_distressed_guarantees` (count)
 * @returns {{fullName:string, otherActiveGuaranteeCount:number,
 *            otherActiveExposure:number, isDistressedElsewhere:boolean}[]}
 */
function summarizeGuarantorFindings(rows = []) {
  return rows.map((row) => ({
    fullName: row.full_name,
    otherActiveGuaranteeCount: Number(row.other_active_guarantees) || 0,
    otherActiveExposure: Number(row.other_active_exposure) || 0,
    isDistressedElsewhere: (Number(row.other_distressed_guarantees) || 0) > 0,
  }));
}

module.exports = {
  NIC_PATTERN,
  COLLATERAL_TYPES,
  isValidNic,
  summarizeCollateral,
  computeCoverageRatio,
  summarizeGuarantorFindings,
};

"use strict";

/**
 * Lease fees (L4.2) — pure, no DB.
 *
 * Fee RESOLUTION (percentage vs fixed, min/max clamping, waivers) and the
 * IRR solver are reused verbatim from loanFees.service. Those functions take
 * a config object and an amount; nothing about them is loan-specific, and
 * writing a second copy would be how the two silently diverge.
 *
 * What IS lease-specific and lives here:
 *
 *   1. A different fee vocabulary — a lease has an inspection fee and stamp
 *      duty; it has no loan processing fee.
 *   2. A different cost model. A loan's fees come out of the disbursement,
 *      so the borrower RECEIVES LESS than they owe. A lease disburses
 *      nothing to the lessee — the money goes to the dealer — so lease fees
 *      are simply payable UP FRONT alongside the down payment. They change
 *      the cash needed at signing and nothing else: financed amount, rental
 *      and schedule are untouched.
 *   3. The inspection-fee rule: charged only where an inspection actually
 *      happens, which is never for a brand-new vehicle.
 */

const {
  round2,
  resolveFees,
  applyWaivers,
  computeEffectiveApr,
} = require("./loanFees.service");

const LEASE_FEE_TYPES = [
  "documentation",
  "vehicle_inspection",
  "stamp_duty",
  "credit_life_insurance",
  "other",
];

/**
 * Fees that only apply when the vehicle is physically inspected.
 *
 * A brand-new vehicle is bought from a franchise dealer against a printed
 * invoice and is never inspected or valued, so charging an inspection fee
 * would be charging for work nobody did. Enforced here rather than left to
 * an admin to remember to waive per quotation.
 */
const INSPECTION_ONLY_FEES = ["vehicle_inspection"];

/**
 * @param {object[]} configs   lease_product_fees rows
 * @param {string} condition   brand_new | reconditioned | used
 * @returns {object[]} the configs that actually apply to this vehicle
 */
function applicableFeeConfigs(configs, condition) {
  if (condition !== "brand_new") return configs;
  return configs.filter((c) => !INSPECTION_ONLY_FEES.includes(c.fee_type));
}

/**
 * Resolve a product's fee schedule against one quotation.
 *
 * @param {object} p
 * @param {object[]} p.configs        lease_product_fees rows
 * @param {number} p.financedAmount   what percentage fees are charged on
 * @param {string} p.condition        vehicle condition
 * @param {object[]} [p.waivers]      [{ fee_type, reason }]
 * @returns {object[]} resolved fee lines
 */
function resolveLeaseFees({ configs = [], financedAmount, condition, waivers = [] }) {
  const applicable = applicableFeeConfigs(configs, condition);
  const resolved = resolveFees(applicable, financedAmount);
  return applyWaivers(resolved, waivers);
}

/**
 * What the lessee actually has to find at signing, and what the lease truly
 * costs them once fees are counted.
 *
 * `upfrontTotal` is the number that matters to a lessee standing at the
 * counter: their down payment plus every fee. It is deliberately NOT netted
 * off anything, because unlike a loan there is no disbursement to net it
 * against.
 *
 * `effectiveApr` treats the fees as what they are — cash out of pocket at
 * signing — so the borrower is modelled as receiving `financedAmount` worth
 * of vehicle but being out `fees` on day one, then paying rentals. That is
 * the same IRR question loanFees answers, asked with the right numbers.
 * Returns null rather than a wrong figure when no rate exists.
 *
 * @returns {{lines:object[], totalFees:number, upfrontTotal:number,
 *            totalCost:number, effectiveApr:number|null}}
 */
function summarizeLeaseFees({ fees = [], downPaymentAmount = 0, financedAmount, rental, termMonths }) {
  const totalFees = round2(
    fees.reduce((sum, f) => sum + (f.waived ? 0 : Number(f.amount) || 0), 0)
  );
  const upfrontTotal = round2(Number(downPaymentAmount || 0) + totalFees);
  const totalRentals = round2(Number(rental || 0) * Number(termMonths || 0));

  return {
    lines: fees,
    totalFees,
    upfrontTotal,
    // Everything the lessee parts with across the whole lease.
    totalCost: round2(upfrontTotal + totalRentals),
    effectiveApr: computeEffectiveApr({
      netDisbursed: round2(Number(financedAmount || 0) - totalFees),
      emi: Number(rental || 0),
      tenureMonths: Number(termMonths || 0),
    }),
  };
}

module.exports = {
  LEASE_FEE_TYPES,
  INSPECTION_ONLY_FEES,
  applicableFeeConfigs,
  resolveLeaseFees,
  summarizeLeaseFees,
};

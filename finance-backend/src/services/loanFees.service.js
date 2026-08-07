"use strict";

/**
 * Loan fees, net disbursement, and effective APR (I1) — pure, deterministic.
 * No DB, no I/O.
 *
 * FEES ARE DEDUCTED FROM THE DISBURSEMENT, NOT CAPITALISED (see migration
 * 041's header). The borrower is approved for X, repays against X, and
 * receives X minus fees. Nothing in this module touches principal, EMI, the
 * amortization schedule or the affordability check — it computes what is
 * withheld at payout and what the loan therefore really costs.
 *
 * The APR is the point of the whole feature. A 14% loan with 2.5% of fees
 * taken off the top is not a 14% loan, and saying so is the difference
 * between disclosing fees and merely listing them.
 */

/** Round money to 2dp without accumulating binary-float drift. Matches amortization.service.js. */
function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** The fee types migration 041's ENUM allows. */
const FEE_TYPES = Object.freeze([
  "processing",
  "documentation",
  "credit_life_insurance",
  "other",
]);

const CALC_METHODS = Object.freeze(["percentage", "fixed"]);

/**
 * Resolve one configured fee against an approved amount.
 *
 * A percentage fee is a percent OF THE APPROVED AMOUNT (not of the net, which
 * would be circular), then clamped to the configured floor/ceiling. A fixed
 * fee ignores the amount entirely and ignores min/max too — it is already its
 * own answer, and clamping a flat fee to a range would be a way of silently
 * configuring two different fixed fees.
 *
 * @param {object} config a loan_product_fees row
 * @param {number} approvedAmount
 * @returns {{fee_type:string, label:string, calc_method:string,
 *            rate_or_amount:number, amount:number, waived:false,
 *            waived_reason:null}}
 */
function resolveFee(config, approvedAmount) {
  const rateOrAmount = Number(config.rate_or_amount) || 0;
  let amount;

  if (config.calc_method === "fixed") {
    amount = round2(rateOrAmount);
  } else {
    amount = round2((Number(approvedAmount) || 0) * (rateOrAmount / 100));
    const min = config.min_amount === null || config.min_amount === undefined
      ? null
      : Number(config.min_amount);
    const max = config.max_amount === null || config.max_amount === undefined
      ? null
      : Number(config.max_amount);
    if (min !== null && amount < min) amount = round2(min);
    if (max !== null && amount > max) amount = round2(max);
  }

  return {
    fee_type: config.fee_type,
    label: config.label,
    calc_method: config.calc_method,
    rate_or_amount: rateOrAmount,
    amount: Math.max(0, amount),
    waived: false,
    waived_reason: null,
  };
}

/**
 * Resolve every active configured fee for a product against an approved
 * amount. Inactive fees are dropped here rather than filtered by the caller,
 * so no call site can forget to.
 *
 * @param {object[]} configs loan_product_fees rows
 * @param {number} approvedAmount
 * @returns {object[]} resolved fee lines
 */
function resolveFees(configs = [], approvedAmount) {
  return configs
    .filter((c) => c && c.active !== 0 && c.active !== false)
    .map((c) => resolveFee(c, approvedAmount));
}

/**
 * Apply staff waivers to resolved fee lines.
 *
 * A waived fee's `amount` goes to zero but the LINE IS KEPT, carrying its
 * original figure and the reason — the offer must still show what was waived
 * and why, which is the whole point of requiring a reason. Same shape as the
 * late-fee waiver on repayment_schedule (028).
 *
 * A waiver naming a fee that isn't on this offer is ignored rather than
 * throwing: staff shouldn't be able to break offer issuance with a stale
 * fee_type from a product that has since been reconfigured.
 *
 * @param {object[]} fees resolveFees() output
 * @param {Array<{fee_type:string, reason:string}>} waivers
 * @returns {object[]} new array; the input is not mutated
 */
function applyWaivers(fees = [], waivers = []) {
  const byType = new Map();
  for (const w of waivers || []) {
    if (w && w.fee_type) byType.set(w.fee_type, String(w.reason || "").trim());
  }
  return fees.map((fee) => {
    if (!byType.has(fee.fee_type)) return { ...fee };
    return {
      ...fee,
      // original_amount preserves what WOULD have been charged, so the UI
      // can show "Processing fee 10,000 — waived" rather than a bare zero.
      original_amount: fee.amount,
      amount: 0,
      waived: true,
      waived_reason: byType.get(fee.fee_type) || null,
    };
  });
}

/**
 * Totals for a set of resolved (possibly waived) fee lines.
 * @param {object[]} fees
 * @param {number} approvedAmount
 * @returns {{lines:object[], total_fees:number, net_disbursed:number}}
 */
function summarizeFees(fees = [], approvedAmount) {
  const total = round2(fees.reduce((sum, f) => sum + (Number(f.amount) || 0), 0));
  return {
    lines: fees,
    total_fees: total,
    // What actually reaches the customer's account. Never negative, even if
    // a misconfigured fee schedule somehow exceeded the loan.
    net_disbursed: round2(Math.max(0, (Number(approvedAmount) || 0) - total)),
  };
}

/** Iterations of bisection. 200 halvings of a 0–1 bracket is far past double precision. */
const APR_MAX_ITERATIONS = 200;
/** Upper bracket for the monthly rate: 100%/month. No real loan approaches this. */
const APR_MAX_MONTHLY_RATE = 1;

/**
 * The present value of `tenureMonths` payments of `emi` at monthly rate `r`,
 * minus what the borrower actually received. The APR is the `r` where this
 * is zero.
 */
function netPresentValue(r, { netDisbursed, emi, tenureMonths }) {
  if (r === 0) return emi * tenureMonths - netDisbursed;
  // Standard annuity present value: emi × (1 − (1+r)^−n) / r
  const pv = emi * (1 - Math.pow(1 + r, -tenureMonths)) / r;
  return pv - netDisbursed;
}

/**
 * The effective annual percentage rate: the true cost of the loan once fees
 * are taken into account.
 *
 * The borrower receives `netDisbursed` today and pays `emi` every month for
 * `tenureMonths`. The rate that makes those cash flows balance is an internal
 * rate of return, which has no closed form — it must be solved numerically.
 *
 * BISECTION, NOT NEWTON-RAPHSON, DELIBERATELY. Newton converges faster but
 * can diverge or oscillate on a badly-conditioned input, and would then
 * return a confidently wrong interest rate to a customer. Bisection on a
 * bracket where the function is known to change sign cannot do that: it is
 * monotonic here (higher rate ⇒ lower present value), so every halving
 * strictly narrows the answer. Slower by microseconds, and this runs once
 * per offer.
 *
 * @param {object} p
 * @param {number} p.netDisbursed what the customer actually receives
 * @param {number} p.emi
 * @param {number} p.tenureMonths
 * @returns {number|null} annual percentage rate to 2dp, or null when no
 *   meaningful rate exists (see below) — null rather than 0, because
 *   "we could not determine this" and "this loan is free" are different
 *   claims and only one of them is safe to show a borrower.
 */
function computeEffectiveApr({ netDisbursed, emi, tenureMonths }) {
  const net = Number(netDisbursed);
  const payment = Number(emi);
  const n = Math.round(Number(tenureMonths));

  if (!Number.isFinite(net) || !Number.isFinite(payment) || !Number.isFinite(n)) return null;
  if (net <= 0 || payment <= 0 || n < 1) return null;

  const totalRepaid = payment * n;
  // Repaying no more than was received means a zero (or negative) rate —
  // there is no positive APR to find, and the bracket below would not
  // contain a root.
  if (totalRepaid <= net) return null;

  let lo = 0;
  let hi = APR_MAX_MONTHLY_RATE;

  // At r=0 the NPV is (totalRepaid − net) > 0, and it falls monotonically
  // with r. If it is still positive at the top of the bracket the true rate
  // is beyond anything this system should quote — refuse rather than clamp
  // to a misleading ceiling.
  if (netPresentValue(hi, { netDisbursed: net, emi: payment, tenureMonths: n }) > 0) {
    return null;
  }

  for (let i = 0; i < APR_MAX_ITERATIONS; i += 1) {
    const mid = (lo + hi) / 2;
    const npv = netPresentValue(mid, { netDisbursed: net, emi: payment, tenureMonths: n });
    if (npv > 0) lo = mid;
    else hi = mid;
  }

  const monthlyRate = (lo + hi) / 2;
  // Simple annualisation (× 12), matching how the nominal rate this is
  // compared against is itself quoted (recommendation.service.js computeEmi
  // divides the annual rate by 12). Compounding it instead would make the
  // two figures incomparable, which defeats the purpose of showing both.
  return round2(monthlyRate * 12 * 100);
}

/**
 * Everything an offer needs to know about its own fees, in one call.
 *
 * @param {object} p
 * @param {object[]} p.feeConfigs loan_product_fees rows for the product
 * @param {number} p.approvedAmount
 * @param {number} p.emi
 * @param {number} p.tenureMonths
 * @param {Array<{fee_type:string, reason:string}>} [p.waivers]
 * @returns {{lines:object[], total_fees:number, net_disbursed:number,
 *            effective_apr:number|null}}
 */
function buildOfferFees({ feeConfigs, approvedAmount, emi, tenureMonths, waivers = [] }) {
  const resolved = applyWaivers(resolveFees(feeConfigs, approvedAmount), waivers);
  const summary = summarizeFees(resolved, approvedAmount);
  return {
    ...summary,
    effective_apr: computeEffectiveApr({
      netDisbursed: summary.net_disbursed,
      emi,
      tenureMonths,
    }),
  };
}

module.exports = {
  FEE_TYPES,
  CALC_METHODS,
  round2,
  resolveFee,
  resolveFees,
  applyWaivers,
  summarizeFees,
  computeEffectiveApr,
  buildOfferFees,
};

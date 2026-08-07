"use strict";

/**
 * Loan portfolio dashboard aggregation (F1) — pure, deterministic. No DB, no
 * I/O. Mirrors collateralGuarantor.service.js's role: loanModel.js fetches
 * raw rows (getPortfolioApplications/getPortfolioAccounts/
 * getActivePortfolioScheduleRows), this module turns them into the four
 * things the roadmap asks for — approval rates, disbursement volumes,
 * portfolio-at-risk, product/risk distribution — and
 * loanReports.controller.js only wires the two together.
 *
 * Follows the same "fetch rows in bulk, aggregate in plain JS" house style
 * fxExchange.controller.js#getReports already uses for FX reporting, rather
 * than complex SQL GROUP BY — reasonable at demo-scale data volume, and it
 * lets PAR reuse repayment.service.js's existing, already-tested
 * computeOutstanding/computeArrears instead of re-deriving arrears math in
 * SQL.
 */

const { computeOutstanding, computeArrears, round2 } = require("./repayment.service");

/**
 * Every status loan_applications.status can hold, mirrored from
 * applicationStatus.service.js's APPLICATION_STATUSES so by_status always
 * reports a full, stable set of keys (zero for statuses with no rows)
 * rather than only whatever happens to appear in the data.
 */
const ALL_APPLICATION_STATUSES = [
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

// The only path to accepted/disbursed/closed is through approved (see
// applicationStatus.service.js TRANSITIONS) — so an application CURRENTLY
// in any of these has, at some point, been approved. This is what makes
// "approval rate" meaningful across the full lifecycle rather than just a
// snapshot of whoever happens to be sitting in the 'approved' status today.
const EVER_APPROVED_STATUSES = new Set(["approved", "accepted", "disbursed", "closed"]);

/**
 * Approval/rejection rates across the whole portfolio.
 *
 * KNOWN SIMPLIFICATION: an application rejected and later reopened back to
 * under_review (D2/B1 allow this) is still counted as "rejected" here,
 * since only the CURRENT status is available without walking the full
 * loan_application_events audit trail. Acceptable for a portfolio-level
 * rate; a per-application view should use the real event history instead.
 *
 * @param {object[]} applications rows from loanModel.getPortfolioApplications
 * @returns {{total:number, by_status:object, decidable:number,
 *   approved_count:number, rejected_count:number,
 *   approval_rate_pct:number|null, rejection_rate_pct:number|null}}
 */
function summarizeApprovalRates(applications = []) {
  const by_status = Object.fromEntries(ALL_APPLICATION_STATUSES.map((s) => [s, 0]));
  for (const app of applications) {
    if (Object.prototype.hasOwnProperty.call(by_status, app.status)) {
      by_status[app.status] += 1;
    }
  }

  const approved_count = ALL_APPLICATION_STATUSES.filter((s) => EVER_APPROVED_STATUSES.has(s)).reduce(
    (sum, s) => sum + by_status[s],
    0
  );
  const rejected_count = by_status.rejected;
  // withdrawn (a customer action, not a bank outcome) and still-in-flight
  // statuses are excluded from the denominator — same reasoning as FX's
  // getReports excluding 'cancelled' from its rate().
  const decidable = approved_count + rejected_count;
  const rate = (n) => (decidable > 0 ? round2((n / decidable) * 100) : null);

  return {
    total: applications.length,
    by_status,
    decidable,
    approved_count,
    rejected_count,
    approval_rate_pct: rate(approved_count),
    rejection_rate_pct: rate(rejected_count),
  };
}

/**
 * Applications grouped by product.
 * @param {object[]} applications
 * @returns {Array<{product_id:number|null, product_name:string,
 *   count:number, total_requested_amount:number}>}
 */
function summarizeProductDistribution(applications = []) {
  const map = new Map();
  for (const app of applications) {
    const key = app.product_id ?? "none";
    if (!map.has(key)) {
      map.set(key, {
        product_id: app.product_id ?? null,
        product_name: app.product_name || "Unknown product",
        count: 0,
        total_requested_amount: 0,
      });
    }
    const entry = map.get(key);
    entry.count += 1;
    entry.total_requested_amount = round2(entry.total_requested_amount + Number(app.requested_amount || 0));
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * Applications grouped by risk category. Applications never assessed (no
 * risk_assessments row — e.g. an admin-created draft) group under
 * "Not assessed" rather than being silently dropped.
 * @param {object[]} applications
 * @returns {Array<{risk_category:string, count:number}>}
 */
function summarizeRiskDistribution(applications = []) {
  const map = new Map();
  for (const app of applications) {
    const key = app.risk_category || "Not assessed";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries()).map(([risk_category, count]) => ({ risk_category, count }));
}

/** 'YYYY-MM' for a date, in UTC (matches repayment.service.js's UTC-day convention). */
function monthKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Disbursement volume — totals plus a trailing-N-month trend.
 * @param {object[]} accounts rows from loanModel.getPortfolioAccounts
 * @param {object} [opts]
 * @param {number} [opts.months=12]
 * @param {Date} [opts.asOf] defaults to now — pass it in for tests
 * @returns {{total_accounts:number, active_count:number, closed_count:number,
 *   written_off_count:number, total_principal_disbursed:number,
 *   by_month: Array<{month:string, count:number, principal:number}>}}
 */
function summarizeDisbursement(accounts = [], { months = 12, asOf = new Date() } = {}) {
  const counts = { active: 0, closed: 0, written_off: 0 };
  let totalPrincipal = 0;
  for (const acc of accounts) {
    if (Object.prototype.hasOwnProperty.call(counts, acc.status)) counts[acc.status] += 1;
    totalPrincipal = round2(totalPrincipal + Number(acc.principal || 0));
  }

  // Build the trailing-N-month scaffold first so months with zero
  // disbursements still appear (a trend chart with gaps is misleading).
  const buckets = new Map();
  const cursor = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    buckets.set(monthKey(d), { month: monthKey(d), count: 0, principal: 0 });
  }

  for (const acc of accounts) {
    if (!acc.disbursed_at) continue;
    const key = monthKey(acc.disbursed_at);
    if (!buckets.has(key)) continue; // outside the requested trailing window
    const bucket = buckets.get(key);
    bucket.count += 1;
    bucket.principal = round2(bucket.principal + Number(acc.principal || 0));
  }

  return {
    total_accounts: accounts.length,
    active_count: counts.active,
    closed_count: counts.closed,
    written_off_count: counts.written_off,
    total_principal_disbursed: totalPrincipal,
    by_month: Array.from(buckets.values()),
  };
}

/**
 * Portfolio-at-risk over the currently ACTIVE book, bucketed PAR30/60/90.
 * A loan's outstanding principal counts toward every bucket its
 * daysPastDue clears (a 45-day-late loan is in PAR30 AND PAR60, not PAR30
 * alone) — the standard PAR convention.
 *
 * @param {object[]} scheduleRows rows from
 *   loanModel.getActivePortfolioScheduleRows (already scoped to active
 *   accounts; each row must carry account_id)
 * @param {Date|string} [asOf] defaults to now — pass it in for tests
 * @returns {{total_outstanding_principal:number,
 *   par30:{principal:number, pct:number|null},
 *   par60:{principal:number, pct:number|null},
 *   par90:{principal:number, pct:number|null}}}
 */
function summarizePortfolioAtRisk(scheduleRows = [], asOf = new Date()) {
  const byAccount = new Map();
  for (const row of scheduleRows) {
    if (!byAccount.has(row.account_id)) byAccount.set(row.account_id, []);
    byAccount.get(row.account_id).push(row);
  }

  let totalOutstandingPrincipal = 0;
  let par30Principal = 0;
  let par60Principal = 0;
  let par90Principal = 0;

  for (const rows of byAccount.values()) {
    const outstanding = computeOutstanding(rows);
    const arrears = computeArrears(rows, asOf);
    totalOutstandingPrincipal = round2(totalOutstandingPrincipal + outstanding.principal);
    if (arrears.daysPastDue >= 30) par30Principal = round2(par30Principal + outstanding.principal);
    if (arrears.daysPastDue >= 60) par60Principal = round2(par60Principal + outstanding.principal);
    if (arrears.daysPastDue >= 90) par90Principal = round2(par90Principal + outstanding.principal);
  }

  const pct = (n) => (totalOutstandingPrincipal > 0 ? round2((n / totalOutstandingPrincipal) * 100) : null);

  return {
    total_outstanding_principal: totalOutstandingPrincipal,
    par30: { principal: par30Principal, pct: pct(par30Principal) },
    par60: { principal: par60Principal, pct: pct(par60Principal) },
    par90: { principal: par90Principal, pct: pct(par90Principal) },
  };
}

module.exports = {
  ALL_APPLICATION_STATUSES,
  summarizeApprovalRates,
  summarizeProductDistribution,
  summarizeRiskDistribution,
  summarizeDisbursement,
  summarizePortfolioAtRisk,
};

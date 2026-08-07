"use strict";

/**
 * Runnable test script for loan portfolio dashboard aggregation (F1).
 *   node src/services/__tests__/loanReports.test.js
 * Exits non-zero on the first failed assertion.
 */

const assert = require("assert");
const {
  ALL_APPLICATION_STATUSES,
  summarizeApprovalRates,
  summarizeProductDistribution,
  summarizeRiskDistribution,
  summarizeDisbursement,
  summarizePortfolioAtRisk,
} = require("../loanReports.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("summarizeApprovalRates");

check("counts every status into by_status, zero-filled for absent ones", () => {
  const s = summarizeApprovalRates([
    { status: "pending" },
    { status: "pending" },
    { status: "approved" },
  ]);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.by_status.pending, 2);
  assert.strictEqual(s.by_status.approved, 1);
  assert.strictEqual(s.by_status.rejected, 0);
  // Every known status has a key, even with zero rows.
  for (const status of ALL_APPLICATION_STATUSES) {
    assert(Object.prototype.hasOwnProperty.call(s.by_status, status));
  }
});

check("accepted/disbursed/closed all count as EVER approved, not just 'approved'", () => {
  const s = summarizeApprovalRates([
    { status: "approved" },
    { status: "accepted" },
    { status: "disbursed" },
    { status: "closed" },
    { status: "rejected" },
  ]);
  assert.strictEqual(s.approved_count, 4);
  assert.strictEqual(s.rejected_count, 1);
  assert.strictEqual(s.decidable, 5);
  assert.strictEqual(s.approval_rate_pct, 80);
  assert.strictEqual(s.rejection_rate_pct, 20);
});

check("withdrawn and still-in-flight statuses are excluded from the denominator", () => {
  const s = summarizeApprovalRates([
    { status: "approved" },
    { status: "withdrawn" },
    { status: "pending" },
    { status: "under_review" },
    { status: "more_info_required" },
  ]);
  assert.strictEqual(s.decidable, 1);
  assert.strictEqual(s.approval_rate_pct, 100);
});

check("no decidable applications yields null rates, not a division error", () => {
  const s = summarizeApprovalRates([{ status: "pending" }, { status: "withdrawn" }]);
  assert.strictEqual(s.decidable, 0);
  assert.strictEqual(s.approval_rate_pct, null);
  assert.strictEqual(s.rejection_rate_pct, null);
});

check("an empty portfolio summarizes without crashing", () => {
  const s = summarizeApprovalRates([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.approval_rate_pct, null);
});

console.log("summarizeProductDistribution");

check("groups by product_id, summing requested amounts", () => {
  const dist = summarizeProductDistribution([
    { product_id: 1, product_name: "Personal Loan", requested_amount: 100000 },
    { product_id: 1, product_name: "Personal Loan", requested_amount: 50000 },
    { product_id: 2, product_name: "Business Loan", requested_amount: 200000 },
  ]);
  const personal = dist.find((d) => d.product_id === 1);
  const business = dist.find((d) => d.product_id === 2);
  assert.strictEqual(personal.count, 2);
  assert.strictEqual(personal.total_requested_amount, 150000);
  assert.strictEqual(business.count, 1);
  assert.strictEqual(business.total_requested_amount, 200000);
});

check("a missing product_id/name groups under its own bucket rather than crashing", () => {
  const dist = summarizeProductDistribution([
    { product_id: null, product_name: null, requested_amount: 1000 },
  ]);
  assert.strictEqual(dist.length, 1);
  assert.strictEqual(dist[0].product_id, null);
  assert.strictEqual(dist[0].product_name, "Unknown product");
  assert.strictEqual(dist[0].total_requested_amount, 1000);
});

console.log("summarizeRiskDistribution");

check("groups by risk_category, with nulls under 'Not assessed'", () => {
  const dist = summarizeRiskDistribution([
    { risk_category: "Low Risk" },
    { risk_category: "Low Risk" },
    { risk_category: "High Risk" },
    { risk_category: null },
  ]);
  const byCategory = Object.fromEntries(dist.map((d) => [d.risk_category, d.count]));
  assert.strictEqual(byCategory["Low Risk"], 2);
  assert.strictEqual(byCategory["High Risk"], 1);
  assert.strictEqual(byCategory["Not assessed"], 1);
});

console.log("summarizeDisbursement");

check("zero-fills every trailing month, including ones with no disbursements", () => {
  const asOf = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
  const s = summarizeDisbursement(
    [
      { id: 1, principal: 100000, status: "active", disbursed_at: "2026-04-10" },
      { id: 2, principal: 50000, status: "active", disbursed_at: "2026-06-01" },
      // Outside the trailing-3-month window — still counted in totals, not in by_month.
      { id: 3, principal: 999999, status: "closed", disbursed_at: "2026-01-01" },
    ],
    { months: 3, asOf }
  );
  assert.strictEqual(s.by_month.length, 3);
  assert.deepStrictEqual(
    s.by_month.map((b) => b.month),
    ["2026-04", "2026-05", "2026-06"]
  );
  assert.strictEqual(s.by_month.find((b) => b.month === "2026-04").count, 1);
  assert.strictEqual(s.by_month.find((b) => b.month === "2026-04").principal, 100000);
  assert.strictEqual(s.by_month.find((b) => b.month === "2026-05").count, 0);
  assert.strictEqual(s.by_month.find((b) => b.month === "2026-06").principal, 50000);
  // Totals still include the out-of-window account.
  assert.strictEqual(s.total_accounts, 3);
  assert.strictEqual(s.total_principal_disbursed, 100000 + 50000 + 999999);
  assert.strictEqual(s.active_count, 2);
  assert.strictEqual(s.closed_count, 1);
  assert.strictEqual(s.written_off_count, 0);
});

console.log("summarizePortfolioAtRisk");

check("buckets by daysPastDue, cumulatively, weighted by outstanding principal", () => {
  const asOf = "2026-06-01";
  const daysBefore = (n) => {
    const d = new Date(Date.UTC(2026, 5, 1) - n * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const unpaidRow = (accountId, dueDate, principal) => ({
    account_id: accountId,
    due_date: dueDate,
    installment_no: 1,
    principal_component: principal,
    principal_paid: 0,
    interest_component: 0,
    interest_paid: 0,
    interest_waived: 0,
    late_fee_amount: 0,
    late_fee_paid: 0,
    late_fee_waived: 0,
  });

  const rows = [
    unpaidRow("A", daysBefore(65), 1000), // PAR30 + PAR60, not PAR90
    unpaidRow("B", daysBefore(30), 500), // exactly at the PAR30 boundary
    unpaidRow("C", daysBefore(29), 700), // one day short of PAR30
    unpaidRow("D", daysBefore(90), 200), // exactly at the PAR90 boundary — in all three
    // Fully repaid — outstanding is zero, must be excluded entirely (not
    // just from arrears, from total_outstanding_principal too).
    { ...unpaidRow("E", daysBefore(200), 9999), principal_paid: 9999 },
    // Not yet due — counts toward the total, but no bucket.
    unpaidRow("F", "2026-12-01", 300),
  ];

  const par = summarizePortfolioAtRisk(rows, asOf);

  assert.strictEqual(par.total_outstanding_principal, 1000 + 500 + 700 + 200 + 300);
  assert.strictEqual(par.par30.principal, 1000 + 500 + 200);
  assert.strictEqual(par.par60.principal, 1000 + 200);
  assert.strictEqual(par.par90.principal, 200);
  assert.strictEqual(par.par30.pct, 62.96);
  assert.strictEqual(par.par60.pct, 44.44);
  assert.strictEqual(par.par90.pct, 7.41);
});

check("an entirely current (no overdue) active portfolio has zero PAR everywhere", () => {
  const par = summarizePortfolioAtRisk([
    {
      account_id: 1,
      due_date: "2099-01-01",
      installment_no: 1,
      principal_component: 5000,
      principal_paid: 0,
      interest_component: 0,
      interest_paid: 0,
      interest_waived: 0,
      late_fee_amount: 0,
      late_fee_paid: 0,
      late_fee_waived: 0,
    },
  ]);
  assert.strictEqual(par.par30.principal, 0);
  assert.strictEqual(par.par30.pct, 0);
});

check("no active accounts at all yields null percentages, not a division error", () => {
  const par = summarizePortfolioAtRisk([]);
  assert.strictEqual(par.total_outstanding_principal, 0);
  assert.strictEqual(par.par30.pct, null);
});

console.log(`\n${passed} assertions passed.`);

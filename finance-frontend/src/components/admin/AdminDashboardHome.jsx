import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Users,
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  DollarSign,
  Percent,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Eye,
  Loader2,
} from "lucide-react";
import api from "../../api/axios";

// Same shape/colours as AdminApplications.jsx's RISK_STYLES/STATUS_STYLES —
// kept as a local copy rather than a shared import since neither file
// exports anything today; if a third admin screen needs these, that's the
// point to actually extract a shared module.
const RISK_BADGE = {
  "Low Risk": "bg-emerald-50 text-emerald-700 border-emerald-100",
  "Medium Risk": "bg-amber-50 text-amber-700 border-amber-100",
  "High Risk": "bg-rose-50 text-rose-700 border-rose-100",
  "Not assessed": "bg-slate-50 text-slate-500 border-slate-200",
};
const RISK_DONUT_COLOR = {
  "Low Risk": "#00A86B",
  "Medium Risk": "#f59e0b",
  "High Risk": "#ef4444",
  "Not assessed": "#94a3b8",
};
const STATUS_BADGE = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  under_review: "bg-amber-50 text-amber-700 border-amber-100",
  more_info_required: "bg-sky-50 text-sky-700 border-sky-100",
  approved: "bg-sky-50 text-sky-700 border-sky-100",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-100",
  disbursed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rejected: "bg-rose-50 text-rose-700 border-rose-100",
  withdrawn: "bg-slate-50 text-slate-600 border-slate-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
};

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const formatStatus = (status) => String(status || "").replace(/_/g, " ");
const formatUpdatedAt = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit" })
    : null;
/** "2026-08" -> "Aug" for the trend chart's x-axis. */
const monthLabel = (yyyyMm) =>
  new Date(`${yyyyMm}-01T00:00:00`).toLocaleDateString("en-LK", { month: "short" });

export default function AdminDashboardHome({ onNavigate, onViewApplication }) {
  const [customersDetails, setCustomersDetails] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [recentApplications, setRecentApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeChartTab, setActiveChartTab] = useState("volume");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        // Three real, independent sources — no mock data anywhere. The
        // portfolio-dashboard endpoint (F1) already aggregates approval
        // rates, disbursement volume, portfolio-at-risk, and risk/product
        // distribution from the actual applications/accounts/schedule
        // tables, which is exactly what a landing page's stat cards need.
        const [customersRes, portfolioRes, applicationsRes] = await Promise.all([
          api.get("/admin/getAllCustomer"),
          api.get("/admin/portfolio-dashboard?months=6"),
          api.get("/admin/applications"),
        ]);
        if (cancelled) return;
        setCustomersDetails(customersRes.data);
        setPortfolio(portfolioRes.data);
        // Already newest-first from the API (ORDER BY created_at DESC).
        setRecentApplications((applicationsRes.data?.applications || []).slice(0, 8));
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Couldn't load the dashboard.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-100 text-rose-700 rounded-2xl p-6 text-sm">
        {error}
      </div>
    );
  }

  const approval = portfolio?.approval || {
    total: 0,
    by_status: {},
    approved_count: 0,
    rejected_count: 0,
    approval_rate_pct: null,
  };
  const disbursement = portfolio?.disbursement || {
    total_principal_disbursed: 0,
    by_month: [],
  };
  const riskDistribution = portfolio?.risk_distribution || [];
  const productDistribution = portfolio?.product_distribution || [];

  // Matches applicationStatus.service.js's AWAITING_ACTION_STATUSES — the
  // same definition the staff work queue (F2) uses for "still needs a
  // human to look at it".
  const pendingReviews =
    (approval.by_status.pending || 0) +
    (approval.by_status.under_review || 0) +
    (approval.by_status.more_info_required || 0);
  const highRiskCount =
    riskDistribution.find((r) => r.risk_category === "High Risk")?.count || 0;

  const stats = [
    {
      title: "Total Customers",
      value: customersDetails?.totalCustomers ?? 0,
      icon: Users,
      // The only stat card with a real month-over-month comparison
      // available (admin.controller.js#getAllCustomers computes it from
      // actual registration dates) — every other card below states a
      // current figure only, rather than inventing a trend to match.
      trend: customersDetails?.growth?.value,
      isPositive: customersDetails?.growth?.isPositive,
      color: "border-blue-500 bg-blue-50/50 text-blue-600",
    },
    {
      title: "Loan Applications",
      value: approval.total,
      icon: FileText,
      color: "border-indigo-500 bg-indigo-50/50 text-indigo-600",
    },
    {
      title: "Approved Loans",
      value: approval.approved_count,
      icon: CheckCircle,
      color: "border-emerald-500 bg-emerald-50/50 text-emerald-600",
    },
    {
      title: "Pending Reviews",
      value: pendingReviews,
      icon: Clock,
      color: "border-amber-500 bg-amber-50/50 text-amber-600",
    },
    {
      title: "Rejected Loans",
      value: approval.rejected_count,
      icon: XCircle,
      color: "border-rose-500 bg-rose-50/50 text-rose-600",
    },
    {
      title: "High Risk Flagged",
      value: highRiskCount,
      icon: AlertTriangle,
      color: "border-red-500 bg-red-50/50 text-red-600",
    },
    {
      title: "Total Disbursed",
      value: formatCurrency(disbursement.total_principal_disbursed),
      icon: DollarSign,
      color: "border-teal-500 bg-teal-50/50 text-teal-600",
    },
    {
      title: "Approval Rate",
      value: approval.approval_rate_pct != null ? `${approval.approval_rate_pct}%` : "—",
      icon: Percent,
      color: "border-cyan-500 bg-cyan-50/50 text-cyan-600",
    },
  ];

  const monthlyDisbursement = disbursement.by_month || [];
  const maxMonthlyPrincipal = Math.max(1, ...monthlyDisbursement.map((m) => m.principal));
  const maxProductCount = Math.max(1, ...productDistribution.map((p) => p.count));

  const totalRiskAssessed = riskDistribution.reduce((sum, r) => sum + r.count, 0);
  let riskCursor = 0;

  return (
    <div className="space-y-8">
      {/* Page Title Panel */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            Executive Command Dashboard
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Live portfolio overview across every application, loan account, and customer.
          </p>
        </div>
        {portfolio?.generated_at && (
          <div className="flex items-center gap-2 text-xs bg-slate-100 border border-slate-200 text-slate-600 rounded-lg px-3 py-2 font-mono shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            UPDATED {formatUpdatedAt(portfolio.generated_at)}
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.04 }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all group relative overflow-hidden"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                    {stat.title}
                  </p>
                  <h3 className="text-2xl font-extrabold text-slate-800 tracking-tight">
                    {stat.value}
                  </h3>
                </div>
                <div
                  className={`p-3 rounded-xl border ${stat.color} transition-transform group-hover:scale-110`}
                >
                  <Icon className="w-5 h-5" />
                </div>
              </div>

              {/* Only rendered when a real comparison exists (Total
                  Customers) — every other card states its current figure
                  only, rather than a fabricated delta. */}
              {stat.trend && (
                <div className="flex items-center gap-1.5 mt-4 text-xs font-medium">
                  {stat.isPositive ? (
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                  )}
                  <span className={stat.isPositive ? "text-emerald-600" : "text-rose-500"}>
                    {stat.trend}
                  </span>
                  <span className="text-slate-400 font-normal">vs last month</span>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </motion.div>
          );
        })}
      </div>

      {/* Analytical Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Trend Chart Card */}
        <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                {activeChartTab === "volume" ? "Disbursement Trend" : "Product Mix"}
              </h3>
              <p className="text-slate-400 text-xs">
                {activeChartTab === "volume"
                  ? "Principal disbursed, by month"
                  : "Applications received, by loan product"}
              </p>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveChartTab("volume")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${activeChartTab === "volume" ? "bg-white text-indigo-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                Disbursement
              </button>
              <button
                onClick={() => setActiveChartTab("categories")}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${activeChartTab === "categories" ? "bg-white text-indigo-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                Product Mix
              </button>
            </div>
          </div>

          <div className="h-64 flex items-end justify-between px-2 pt-6 relative">
            {activeChartTab === "volume" ? (
              monthlyDisbursement.length === 0 ? (
                <p className="w-full text-center text-sm text-slate-400 self-center">
                  No disbursements recorded yet.
                </p>
              ) : (
                <>
                  <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                  <div className="absolute inset-x-0 top-2/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                  <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-slate-100 pointer-events-none"></div>

                  {monthlyDisbursement.map((m, i) => {
                    const heightPercent = (m.principal / maxMonthlyPrincipal) * 100;
                    return (
                      <div
                        key={m.month}
                        className="flex-1 flex flex-col items-center group relative h-full"
                      >
                        <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none whitespace-nowrap text-center shadow-lg font-mono">
                          <div>
                            Disbursed: <span className="text-emerald-400 font-bold">{m.count}</span>
                          </div>
                          <div>
                            Principal:{" "}
                            <span className="text-sky-300 font-bold">
                              {formatCurrency(m.principal)}
                            </span>
                          </div>
                        </div>

                        <div className="w-12 h-full flex items-end justify-center relative">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${heightPercent}%` }}
                            transition={{ duration: 0.8, delay: i * 0.06 }}
                            className="w-8 bg-indigo-900 group-hover:bg-indigo-800 rounded-t-sm transition-colors cursor-pointer"
                          />
                        </div>

                        <span className="text-xs font-mono text-slate-400 mt-2">
                          {monthLabel(m.month)}
                        </span>
                      </div>
                    );
                  })}
                </>
              )
            ) : productDistribution.length === 0 ? (
              <p className="w-full text-center text-sm text-slate-400 self-center">
                No applications recorded yet.
              </p>
            ) : (
              <>
                <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                <div className="absolute inset-x-0 top-2/4 border-t border-dashed border-slate-100 pointer-events-none"></div>
                <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-slate-100 pointer-events-none"></div>

                {productDistribution.map((p, i) => {
                  const heightPercent = (p.count / maxProductCount) * 100;
                  const colors = [
                    "bg-sky-500 hover:bg-sky-600",
                    "bg-indigo-900 hover:bg-indigo-950",
                    "bg-emerald-500 hover:bg-emerald-600",
                    "bg-amber-500 hover:bg-amber-600",
                    "bg-purple-600 hover:bg-purple-700",
                    "bg-rose-500 hover:bg-rose-600",
                  ];

                  return (
                    <div
                      key={p.product_id ?? p.product_name}
                      className="flex-1 flex flex-col items-center group relative h-full"
                    >
                      <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[10px] rounded px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none text-center shadow-lg font-mono whitespace-nowrap">
                        <span className="font-bold text-emerald-400">{p.count} applications</span>
                        <div className="text-slate-400 text-[9px]">
                          {formatCurrency(p.total_requested_amount)} requested
                        </div>
                      </div>

                      <div className="w-16 h-full flex items-end justify-center relative">
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${heightPercent}%` }}
                          transition={{ duration: 0.8, delay: i * 0.08 }}
                          className={`w-8 ${colors[i % colors.length]} rounded-t-md cursor-pointer`}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-slate-500 mt-2 truncate max-w-[80px]">
                        {p.product_name}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Risk Distribution Doughnut Card */}
        <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">AI Risk Distribution</h3>
            <p className="text-slate-400 text-xs">Every assessed application, by risk category</p>
          </div>

          <div className="my-6 flex justify-center relative">
            <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="3" />
              {totalRiskAssessed > 0 &&
                (() => {
                  riskCursor = 0;
                  return riskDistribution.map((r) => {
                    const pct = (r.count / totalRiskAssessed) * 100;
                    const dash = `${pct} ${100 - pct}`;
                    const offset = 100 - riskCursor;
                    riskCursor += pct;
                    return (
                      <circle
                        key={r.risk_category}
                        cx="18"
                        cy="18"
                        r="15.915"
                        fill="none"
                        stroke={RISK_DONUT_COLOR[r.risk_category] || "#94a3b8"}
                        strokeWidth="3.5"
                        strokeDasharray={dash}
                        strokeDashoffset={offset}
                      />
                    );
                  });
                })()}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-black text-indigo-950 font-mono">
                {totalRiskAssessed}
              </span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                Assessed
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {riskDistribution.length === 0 && (
              <p className="text-center text-xs text-slate-400">No applications assessed yet.</p>
            )}
            {riskDistribution.map((r) => (
              <div
                key={r.risk_category}
                className="flex justify-between items-center text-xs text-slate-600 bg-slate-50/50 px-3 py-2 rounded-xl border border-slate-100"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: RISK_DONUT_COLOR[r.risk_category] || "#94a3b8" }}
                  ></span>
                  {r.risk_category}
                </span>
                <span className="font-mono font-bold text-slate-800">
                  {r.count}{" "}
                  <span className="text-slate-400 font-normal">
                    ({totalRiskAssessed > 0 ? Math.round((r.count / totalRiskAssessed) * 100) : 0}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Applications Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/40">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Recent Applications</h3>
            <p className="text-xs text-slate-500">The 8 most recently submitted applications</p>
          </div>
          <button
            onClick={() => onNavigate("applications")}
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 flex items-center gap-1"
          >
            Manage Queue <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                <th className="px-6 py-3.5">ID</th>
                <th className="px-6 py-3.5">Applicant</th>
                <th className="px-6 py-3.5">Loan Type</th>
                <th className="px-6 py-3.5">Requested Amount</th>
                <th className="px-6 py-3.5 text-center">AI Risk</th>
                <th className="px-6 py-3.5 text-center">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recentApplications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    No applications yet.
                  </td>
                </tr>
              ) : (
                recentApplications.map((app) => {
                  const riskCategory = app.risk?.category || "Not assessed";
                  const applicantName = [app.applicant?.first_name, app.applicant?.last_name]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <tr
                      key={app.application_id}
                      className="hover:bg-slate-50/80 transition-colors group"
                    >
                      <td className="px-6 py-4 font-mono text-xs font-semibold text-indigo-950">
                        #{app.application_id}
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-800">{applicantName}</div>
                        <div className="text-[11px] text-slate-400">{app.applicant?.email}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-medium text-xs">
                          {app.product_name || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-slate-800">
                        {formatCurrency(app.requested_amount)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${RISK_BADGE[riskCategory]}`}
                        >
                          {riskCategory}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-full border capitalize ${STATUS_BADGE[app.status] || "bg-slate-50 text-slate-600 border-slate-200"}`}
                        >
                          {formatStatus(app.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => onViewApplication(app.application_id)}
                          className="p-1.5 hover:bg-indigo-50 hover:text-indigo-900 text-slate-400 rounded-lg transition-colors inline-flex items-center justify-center"
                          title="View application"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

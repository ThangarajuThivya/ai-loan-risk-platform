import { useEffect, useState } from "react";
import {
  FileBarChart,
  Loader2,
  AlertTriangle,
  Download,
  TrendingUp,
  TrendingDown,
  Clock,
  Hourglass,
  Coins,
  Wallet,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../toast/useToast";

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPct = (value) => (value === null || value === undefined ? "—" : `${value}%`);

const todayDateString = () => new Date().toISOString().slice(0, 10);
const daysAgoDateString = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const STATUS_LABELS = {
  pending_review: "Pending Review",
  ready_for_settlement: "Ready for Settlement",
  settled: "Settled",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

const STATUS_COLORS = {
  pending_review: "bg-amber-100 text-amber-800",
  ready_for_settlement: "bg-blue-100 text-blue-800",
  settled: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-600",
  expired: "bg-slate-100 text-slate-500",
};

function StatCard({ icon: Icon, label, value, tone = "slate" }) {
  const toneClass = {
    slate: "bg-slate-50 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
  }[tone];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${toneClass}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{label}</p>
        <p className="text-lg font-bold text-slate-900 font-mono">{value}</p>
      </div>
    </div>
  );
}

/**
 * FX exchange reports: status-rate, volume-by-currency and spread-revenue
 * aggregates for a submission-date range, plus a CSV export of the
 * underlying request rows. All three come from the same server-side query
 * (fxExchangeModel.getReportRows via fxExchange.controller.js's
 * getReports/exportReportsCsv) so the on-screen numbers and the exported
 * file can never disagree with each other.
 */
export default function AdminReports() {
  const { showToast } = useToast();

  const [from, setFrom] = useState(daysAgoDateString(29));
  const [to, setTo] = useState(todayDateString());
  const [currency, setCurrency] = useState("");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = { from, to };
      if (currency) params.currency = currency.toUpperCase();
      const res = await api.get("/currency/exchange/admin/reports", { params });
      setReport(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load the FX report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = { from, to };
      if (currency) params.currency = currency.toUpperCase();
      // Downloaded as a blob rather than a plain link: the export route is
      // Bearer-token authenticated like every other admin endpoint, and a
      // bare <a href> has no way to attach that header.
      const res = await api.get("/currency/exchange/admin/reports/export", {
        params,
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fx-exchange-report_${from}_to_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      showToast({
        type: "error",
        title: "Export Failed",
        message: err.response?.data?.message || "Couldn't export the CSV.",
      });
    } finally {
      setExporting(false);
    }
  };

  const summary = report?.status_summary;
  const byStatus = summary?.by_status || {};

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-3">
          <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
            <FileBarChart className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Currency</p>
            <h1 className="font-display font-bold text-lg text-slate-900">FX Exchange Reports</h1>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-50 transition-colors"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">From</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-brand-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={todayDateString()}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-brand-primary"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Currency</label>
          <input
            type="text"
            maxLength={3}
            placeholder="All"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="w-20 px-3 py-2 border border-slate-200 rounded-xl text-xs uppercase focus:outline-none focus:border-brand-primary"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && report && (
        <>
          {/* Status-rate cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Hourglass} label="Total Requests" value={summary.total_requests} />
            <StatCard icon={TrendingUp} label="Approval Rate" value={formatPct(summary.approval_rate_pct)} tone="emerald" />
            <StatCard icon={TrendingDown} label="Rejection Rate" value={formatPct(summary.rejection_rate_pct)} tone="rose" />
            <StatCard icon={Clock} label="Expiry Rate" value={formatPct(summary.expiry_rate_pct)} tone="amber" />
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">
            Rates are computed against decidable requests (total minus cancelled) for {report.period.from} to{" "}
            {report.period.to}
            {report.currency_filter ? ` · ${report.currency_filter} only` : ""}. A dash means there was nothing
            decidable in this period.
          </p>

          {/* Status breakdown chips */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-3">
              Requests by Status
            </h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <span
                  key={key}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${STATUS_COLORS[key]}`}
                >
                  {label}: {byStatus[key] ?? 0}
                </span>
              ))}
            </div>
          </div>

          {/* Volume by currency (settled only) */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5 text-slate-400" />
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Settled Volume by Currency
              </h2>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                    <th className="px-4 py-2.5">Currency</th>
                    <th className="px-4 py-2.5">Direction</th>
                    <th className="px-4 py-2.5">Settled Count</th>
                    <th className="px-4 py-2.5">Total Foreign Amount</th>
                    <th className="px-4 py-2.5">Total LKR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.volume_by_currency.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-400">
                        No settled requests in this period.
                      </td>
                    </tr>
                  )}
                  {report.volume_by_currency.map((v) => (
                    <tr key={`${v.currency_code}-${v.direction}`} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-bold text-slate-800">{v.currency_code}</td>
                      <td className="px-4 py-2.5 text-slate-600 capitalize">{v.direction}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{v.count}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {Number(v.total_foreign_amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-800">
                        {formatLkr(v.total_lkr_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="h-2" />
          </div>

          {/* Spread revenue */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Spread Revenue (Settled Requests)
                </h2>
              </div>
              <span className="text-sm font-bold text-brand-primary font-mono">
                {formatLkr(report.spread_revenue.total_lkr)}
              </span>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                    <th className="px-4 py-2.5">Currency</th>
                    <th className="px-4 py-2.5">Settled Count</th>
                    <th className="px-4 py-2.5">Revenue (LKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.spread_revenue.by_currency.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-xs text-slate-400">
                        No settled requests in this period.
                      </td>
                    </tr>
                  )}
                  {report.spread_revenue.by_currency.map((r) => (
                    <tr key={r.currency_code} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-bold text-slate-800">{r.currency_code}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{r.settled_count}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-800">
                        {formatLkr(r.revenue_lkr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 px-4 pb-4 pt-2 leading-relaxed">
              Revenue is the bank's spread margin on each settled request, derived from the rate actually
              charged and the spread applied at quote time — not a live mid-rate lookup, so it reflects what
              was really charged even if spreads changed since.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  BarChart3,
  Loader2,
  AlertTriangle,
  FileStack,
  CheckCircle2,
  Landmark,
  Wallet,
  ShieldAlert,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
  PieChart,
  Pie,
} from "recharts";

import api from "../../api/axios";

// --- validated chart palette (dataviz skill reference instance) ---------
// Status roles: fixed meaning, never reused as a plain categorical series.
const STATUS_GOOD = "#0ca30c";
const STATUS_WARNING = "#fab219";
const STATUS_SERIOUS = "#ec835a";
const STATUS_CRITICAL = "#d03b3b";
const MUTED = "#898781";
// Categorical slots, fixed order (adjacent-pairlist validated for bars/lines).
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
// Sequential blue ramp, ordinal steps (300/500/700) for increasing PAR severity.
const PAR_RAMP = ["#6da7ec", "#256abf", "#0d366b"];

const GRID = "#e1e0d9";
const AXIS = "#c3c2b7";
const INK_SECONDARY = "#52514e";

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const formatPct = (value) => (value === null || value === undefined ? "—" : `${value}%`);

function StatTile({ icon: Icon, label, value, tone = "slate" }) {
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

function ChartCard({ title, hint, children }) {
  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 mb-3">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2 text-xs">
      {label && <p className="font-semibold text-slate-700 mb-1">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey} className="text-slate-600">
          {p.name}: <span className="font-mono font-semibold text-slate-800">{formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
};

// Lifecycle order (applicationStatus.service.js APPLICATION_STATUSES),
// grouped by status-role color: routine in-progress (muted), needs
// applicant action (serious), successful path (good), rejected (critical),
// withdrawn (warning).
const STATUS_META = [
  { key: "pending", label: "Pending", color: MUTED },
  { key: "under_review", label: "Under Review", color: MUTED },
  { key: "more_info_required", label: "Info Requested", color: STATUS_SERIOUS },
  { key: "approved", label: "Approved", color: STATUS_GOOD },
  { key: "accepted", label: "Accepted", color: STATUS_GOOD },
  { key: "disbursed", label: "Disbursed", color: STATUS_GOOD },
  { key: "closed", label: "Closed", color: STATUS_GOOD },
  { key: "rejected", label: "Rejected", color: STATUS_CRITICAL },
  { key: "withdrawn", label: "Withdrawn", color: STATUS_WARNING },
];

const RISK_META = {
  "Low Risk": STATUS_GOOD,
  "Medium Risk": STATUS_WARNING,
  "High Risk": STATUS_CRITICAL,
  "Not assessed": MUTED,
};

/**
 * F1 — real portfolio metrics (approval rates, disbursement volumes,
 * portfolio-at-risk, product/risk distribution), backed by
 * GET /admin/portfolio-dashboard. A separate tab from the existing (mock
 * data) Dashboard home — see the plan for why that page is untouched here.
 */
export default function AdminPortfolioDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/admin/portfolio-dashboard", { params: { months: 12 } });
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || "Couldn't load the portfolio dashboard.");
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
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-2xl p-4 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  const { approval, product_distribution, risk_distribution, disbursement, portfolio_at_risk } = data;

  const statusData = STATUS_META.map((s) => ({ ...s, count: approval.by_status[s.key] || 0 }));
  const monthData = disbursement.by_month.map((b) => ({ ...b, label: b.month.slice(2) }));
  const parData = [
    { key: "PAR30", label: "30+ days", pct: portfolio_at_risk.par30.pct ?? 0, principal: portfolio_at_risk.par30.principal },
    { key: "PAR60", label: "60+ days", pct: portfolio_at_risk.par60.pct ?? 0, principal: portfolio_at_risk.par60.principal },
    { key: "PAR90", label: "90+ days", pct: portfolio_at_risk.par90.pct ?? 0, principal: portfolio_at_risk.par90.principal },
  ];
  const productData = product_distribution.slice(0, CATEGORICAL.length);
  const riskData = risk_distribution;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
          <BarChart3 className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Loan Management</p>
          <p className="text-sm font-bold text-slate-800">Portfolio Dashboard</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile icon={FileStack} label="Total Applications" value={approval.total} />
        <StatTile
          icon={CheckCircle2}
          label="Approval Rate"
          value={formatPct(approval.approval_rate_pct)}
          tone="emerald"
        />
        <StatTile
          icon={Landmark}
          label="Total Disbursed"
          value={formatLkr(disbursement.total_principal_disbursed)}
        />
        <StatTile icon={Wallet} label="Active Loans" value={disbursement.active_count} tone="slate" />
        <StatTile
          icon={ShieldAlert}
          label="PAR30"
          value={formatPct(portfolio_at_risk.par30.pct)}
          tone={portfolio_at_risk.par30.pct > 0 ? "rose" : "emerald"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Application Status Breakdown"
          hint={`${approval.decidable} decided (${approval.approved_count} approved, ${approval.rejected_count} rejected) of ${approval.total} total`}
        >
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: AXIS }} />
              <YAxis
                type="category"
                dataKey="label"
                width={100}
                tick={{ fill: INK_SECONDARY, fontSize: 11 }}
                axisLine={{ stroke: AXIS }}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar dataKey="count" name="Applications" radius={[0, 4, 4, 0]} maxBarSize={22}>
                {statusData.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
                <LabelList dataKey="count" position="right" style={{ fill: INK_SECONDARY, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Disbursement Volume" hint="Principal disbursed, trailing 12 months">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} axisLine={{ stroke: AXIS }} />
              <YAxis
                tick={{ fill: AXIS, fontSize: 10 }}
                axisLine={{ stroke: AXIS }}
                tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
              />
              <Tooltip
                content={<CustomTooltip formatter={formatLkr} />}
                cursor={{ fill: "rgba(0,0,0,0.03)" }}
              />
              <Bar dataKey="principal" name="Principal (LKR)" fill={CATEGORICAL[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Portfolio at Risk"
          hint={`% of active-portfolio outstanding principal (${formatLkr(portfolio_at_risk.total_outstanding_principal)}) overdue by bucket`}
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={parData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={{ fill: INK_SECONDARY, fontSize: 11 }} axisLine={{ stroke: AXIS }} />
              <YAxis
                tick={{ fill: AXIS, fontSize: 10 }}
                axisLine={{ stroke: AXIS }}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<CustomTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar dataKey="pct" name="Portfolio at risk" radius={[4, 4, 0, 0]} maxBarSize={60}>
                {parData.map((d, i) => (
                  <Cell key={d.key} fill={PAR_RAMP[i]} />
                ))}
                <LabelList dataKey="pct" position="top" formatter={(v) => `${v}%`} style={{ fill: INK_SECONDARY, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Product Distribution" hint="Applications and requested amount by product">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={productData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="product_name"
                tick={{ fill: INK_SECONDARY, fontSize: 10 }}
                axisLine={{ stroke: AXIS }}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={50}
              />
              <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 10 }} axisLine={{ stroke: AXIS }} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar dataKey="count" name="Applications" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {productData.map((p, i) => (
                  <Cell key={p.product_id ?? "none"} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Risk Distribution" hint="Applications by assessed risk category">
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="60%" height={220}>
              <PieChart>
                <Pie
                  data={riskData}
                  dataKey="count"
                  nameKey="risk_category"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  stroke="#fcfcfb"
                  strokeWidth={2}
                >
                  {riskData.map((r) => (
                    <Cell key={r.risk_category} fill={RISK_META[r.risk_category] || MUTED} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-2 text-xs">
              {riskData.map((r) => (
                <li key={r.risk_category} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: RISK_META[r.risk_category] || MUTED }}
                  />
                  <span className="text-slate-600">{r.risk_category}</span>
                  <span className="font-mono font-semibold text-slate-800">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

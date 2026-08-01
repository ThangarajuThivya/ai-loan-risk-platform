import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell } from "recharts";
import { Loader2, AlertTriangle, ScaleIcon } from "lucide-react";

// Diverging pair reused from the app's existing positive/negative convention
// (StaffCurrency's trend chips, AdminCurrency's volatility bands) rather
// than a new palette decision — net_lkr_amount is a signed exposure figure
// (CURRENCY_FEATURE.md §12's getPosition), so this is a polarity job: one
// hue either side of a zero baseline, never a rainbow. Emerald = the bank
// holds a net surplus of that currency (customers sold it to us more than
// they bought); rose = a net commitment the bank has sold out more than it
// holds, both only counting ready_for_settlement/settled requests (real
// commitments), never pending_review — see the API's own `note` field,
// surfaced verbatim below rather than re-worded.
const COLOR_LONG = "#059669"; // emerald-600
const COLOR_SHORT = "#e11d48"; // rose-600
const COLOR_GRID = "#e2e8f0";
const COLOR_AXIS = "#94a3b8";

const formatLkrCompact = (value) =>
  new Intl.NumberFormat("en-LK", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;

function PositionTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const isLong = row.net_lkr_amount >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-[11px] leading-relaxed">
      <p className="font-bold text-slate-800 mb-1">{row.currency_code}</p>
      <p className={isLong ? "text-emerald-700" : "text-rose-700"}>
        Net {isLong ? "long (surplus)" : "short (committed)"}: {formatLkr(row.net_lkr_amount)}
      </p>
      <p className="text-slate-500 mt-0.5">
        {Math.abs(row.net_foreign_amount).toLocaleString()} {row.currency_code} equivalent
      </p>
    </div>
  );
}

/**
 * Net FX exposure by currency (GET /admin/position, CURRENCY_FEATURE.md
 * §12) — a bar per currency, diverging around a zero baseline. This is a
 * grouped-count/sum shape, not a rate time series, so it doesn't fit
 * CurrencyChart/CurrencyCompareChart's props (historyRows/forecast/
 * volatility/anomalies keyed to a date axis) — those stay untouched and
 * unduplicated; this reuses the same charting library Phase 9 already
 * added (Recharts, no new dependency) rather than forcing the position
 * report through a component built for a different data shape.
 */
export default function FxPositionChart({ data, loading, error, note, className = "" }) {
  if (loading) {
    return (
      <div className={`flex items-center justify-center py-16 text-slate-400 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs ${className}`}
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className={`text-center py-16 text-slate-400 ${className}`}>
        <ScaleIcon className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">No exchange requests yet</p>
        <p className="text-xs text-slate-400 mt-1">Net exposure appears once requests reach settlement.</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {note && (
        <p className="text-[11px] text-slate-400 mb-3 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-300" />
          {note}
        </p>
      )}

      <div className="flex items-center gap-4 mb-3 text-[11px] font-semibold">
        <span className="flex items-center gap-1.5 text-emerald-700">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_LONG }} />
          Net long (bank holds a surplus)
        </span>
        <span className="flex items-center gap-1.5 text-rose-700">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_SHORT }} />
          Net short (bank has committed more than it holds)
        </span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLOR_GRID} vertical={false} />
          <XAxis
            dataKey="currency_code"
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={{ stroke: COLOR_GRID }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatLkrCompact}
            tick={{ fontSize: 11, fill: COLOR_AXIS }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <ReferenceLine y={0} stroke={COLOR_AXIS} />
          <Tooltip content={<PositionTooltip />} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
          <Bar dataKey="net_lkr_amount" radius={[4, 4, 4, 4]} maxBarSize={56}>
            {data.map((row) => (
              <Cell key={row.currency_code} fill={row.net_lkr_amount >= 0 ? COLOR_LONG : COLOR_SHORT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Activity, AlertTriangle, Loader2, Scale } from "lucide-react";
import { formatAxisDate, formatTooltipDate, formatRate, toTs } from "./chartUtils";

// First 5 slots of the dataviz skill's validated 8-hue categorical order —
// a prefix of a sequence whose *adjacent* pairs all clear the CVD/contrast
// gates (validated for this exact set via the skill's validator), which is
// what matters for a line chart (viewers compare neighboring lines, not
// arbitrary pairs the way they would in a scatter plot). Three of the five
// (aqua/yellow/magenta) are sub-3:1 on the light chart surface, so the
// bottom legend below always shows the currency code as text, never color
// alone.
const COMPARE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const COLOR_GRID = "#e1e0d9";
const COLOR_MUTED = "#898781";
const COLOR_AXIS = "#c3c2b7";

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-[11px] leading-relaxed">
      <p className="font-semibold text-slate-700 mb-1">{formatTooltipDate(label)}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.stroke }}>
          {entry.name}: {entry.value?.toFixed?.(2)}
        </p>
      ))}
    </div>
  );
}

/**
 * Multi-currency compare chart (staff/admin only, role matrix
 * CURRENCY_FEATURE.md §6) — plots several currencies' historical/live rate
 * series on one axis. Since raw rates live on wildly different scales
 * (JPY ~110, LKR ~330, EUR ~0.85 per USD), `normalize` rescales every
 * series to start at 100 at the first point inside the current range, so
 * relative movement is comparable on one y-axis without a second scale
 * (a dual y-axis is a documented anti-pattern the dataviz skill flags).
 *
 * @param {{code:string, rows:object[]}[]} seriesList rows are
 *   GET /api/currency/rates/:code's `{ rate_date, mid_rate, source }[]`
 * @param {boolean} normalize
 */
export default function CurrencyCompareChart({
  seriesList = [],
  normalize = true,
  loading = false,
  error = "",
  height = 340,
}) {
  const lines = useMemo(() => {
    return seriesList
      .map(({ code, rows }, i) => {
        const points = rows
          .map((r) => ({ ts: toTs(r.rate_date), value: Number(r.mid_rate) }))
          .filter((p) => p.ts != null && Number.isFinite(p.value))
          .sort((a, b) => a.ts - b.ts);
        if (points.length === 0) return { code, color: COMPARE_COLORS[i % COMPARE_COLORS.length], points: [] };
        const base = points[0].value;
        const scaled = normalize && base
          ? points.map((p) => ({ ts: p.ts, value: (p.value / base) * 100 }))
          : points;
        return { code, color: COMPARE_COLORS[i % COMPARE_COLORS.length], points: scaled };
      })
      .filter((l) => l.points.length > 0);
  }, [seriesList, normalize]);

  const xDomain = useMemo(() => {
    const allTs = lines.flatMap((l) => l.points.map((p) => p.ts));
    if (allTs.length === 0) return [0, 1];
    return [Math.min(...allTs), Math.max(...allTs)];
  }, [lines]);

  const yDomain = useMemo(() => {
    const allVals = lines.flatMap((l) => l.points.map((p) => p.value));
    if (allVals.length === 0) return ["auto", "auto"];
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    // A floor on the padding, not just a percentage of the observed
    // spread — a range backed by only a couple of live-only points (e.g.
    // "1Y" selected when h10-historical stops in 2017, so only 1-2 live
    // rows exist) can have a real spread under 0.2% of the index/rate
    // value, which would otherwise auto-zoom hard enough to draw normal
    // day-to-day noise as a dramatic-looking move.
    const minPad = normalize ? 0.5 : max * 0.01 || 1;
    const pad = Math.max((max - min) * 0.08, minPad);
    return [min - pad, max + pad];
  }, [lines, normalize]);

  // toFixed(0) on a tight, near-100 normalized range collapses every tick
  // to the same rounded label — scale precision to how tight the range is.
  const tickFormatter = useMemo(() => {
    if (!normalize) return formatRate;
    const allVals = lines.flatMap((l) => l.points.map((p) => p.value));
    const span = allVals.length ? Math.max(...allVals) - Math.min(...allVals) : 0;
    const decimals = span < 1 ? 2 : span < 10 ? 1 : 0;
    return (v) => v.toFixed(decimals);
  }, [normalize, lines]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  if (seriesList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10" style={{ minHeight: height }}>
        <Scale className="w-8 h-8 text-slate-300 mb-2" />
        <p className="text-sm font-bold text-slate-700">Pick currencies to compare</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          Select two or more currencies above to plot them on one chart.
        </p>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10" style={{ minHeight: height }}>
        <Activity className="w-8 h-8 text-slate-300 mb-2" />
        <p className="text-sm font-bold text-slate-700">No data in this range</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          None of the selected currencies have rate rows in the current date range. Try a wider preset.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={COLOR_GRID} vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={formatAxisDate}
            tick={{ fontSize: 10, fill: COLOR_MUTED }}
            stroke={COLOR_AXIS}
            allowDuplicatedCategory={false}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={tickFormatter}
            tick={{ fontSize: 10, fill: COLOR_MUTED }}
            stroke={COLOR_AXIS}
            width={50}
            label={
              normalize
                ? { value: "Indexed (100 = range start)", angle: -90, position: "insideLeft", fontSize: 10, fill: COLOR_MUTED }
                : undefined
            }
          />
          <Tooltip content={<CustomTooltip />} />
          {lines.map((l) => (
            <Line
              key={l.code}
              data={l.points}
              dataKey="value"
              name={l.code}
              stroke={l.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 px-1">
        {lines.map((l) => (
          <div key={l.code} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ backgroundColor: l.color }} />
            <span>{l.code}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

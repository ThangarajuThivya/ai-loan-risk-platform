import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from "recharts";
import { Activity, AlertTriangle, History, Loader2, Radio } from "lucide-react";
import {
  formatAxisDate,
  formatTooltipDate,
  formatRate,
  toTs,
  isLiveSource,
  isDemoSeedSource,
  COLOR_LIVE_TREND,
} from "./chartUtils";

// Series colors — validated for CVD/contrast as a 5-slot categorical set
// (historical/forecast/live/demo-seed/live-trend) via the dataviz skill's
// validator (`node scripts/validate_palette.js
// "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4" --mode light` — all hard gates
// pass; the sub-3:1-contrast slots carry a WARN that requires visible
// labels, satisfied by the legend + tooltip names below), plus the app's
// existing "critical" red for anomaly markers (a status color, not a
// categorical slot, per the skill's rule that status colors are reserved
// and shown with an icon/label rather than relying on hue alone).
const COLOR_HISTORICAL = "#2a78d6"; // blue
const COLOR_FORECAST = "#eb6834"; // orange — also used for the volatility band fill
const COLOR_LIVE = "#1baf7a"; // aqua — sub-3:1 on light surface, so always paired with a visible label (legend), never color alone
const COLOR_DEMO_SEED = "#eda100"; // yellow (palette slot 4) — sub-3:1 on light surface, same relief as live
// COLOR_LIVE_TREND (slot 5, magenta) is imported from chartUtils.js, not
// defined here — LiveTrendBadge.jsx needs the same swatch outside the chart,
// so it lives in the one file both already share.
const COLOR_ANOMALY = "#d03b3b"; // status/critical red
const COLOR_GRID = "#e1e0d9";
const COLOR_MUTED = "#898781";
const COLOR_AXIS = "#c3c2b7";

const DAY_MS = 24 * 60 * 60 * 1000;

function DiamondDot({ cx, cy, fill }) {
  if (cx == null || cy == null) return null;
  const r = 4;
  return (
    <path
      d={`M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`}
      fill={fill}
      stroke="#fff"
      strokeWidth={1}
    />
  );
}

function AnomalyMarker({ cx, cy, fill }) {
  if (cx == null || cy == null) return null;
  const r = 5;
  return (
    <path
      d={`M${cx} ${cy - r} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z`}
      fill={fill}
      stroke="#fff"
      strokeWidth={1}
    />
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-[11px] leading-relaxed">
      <p className="font-semibold text-slate-700 mb-1">{formatTooltipDate(label)}</p>
      {payload.map((entry, i) => {
        const raw = entry.payload || {};
        if (entry.dataKey === "band" || entry.name === "Volatility band") {
          return (
            <p key={i} style={{ color: COLOR_FORECAST }}>
              Volatility band: {formatRate(raw.lower)} – {formatRate(raw.upper)}
            </p>
          );
        }
        if (entry.name === "Anomaly flagged") {
          return (
            <p key={i} style={{ color: COLOR_ANOMALY }}>
              Anomaly flagged (score {raw.score?.toFixed?.(3) ?? "—"})
            </p>
          );
        }
        return (
          <p key={i} style={{ color: entry.color || entry.stroke }}>
            {entry.name}: {formatRate(entry.value)}
          </p>
        );
      })}
    </div>
  );
}

function LegendRow({ items }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 px-1">
      {items.map(({ label, color, lineStyle, muted }) => (
        <div
          key={label}
          className={`flex items-center gap-1.5 text-[11px] ${muted ? "text-slate-400" : "text-slate-500"}`}
        >
          <span
            className="inline-block w-3 h-0.5 rounded-full"
            style={{
              backgroundColor: lineStyle ? "transparent" : color,
              borderTop:
                lineStyle === "dashed"
                  ? `2px dashed ${color}`
                  : lineStyle === "dotted"
                    ? `2px dotted ${color}`
                    : undefined,
              opacity: muted ? 0.7 : 1,
            }}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Shared rate-history chart (Phase 9) — replaces the old inline-SVG
 * RateHistoryChart. Renders as many of seven independently-toggleable
 * series as the caller supplies data + visibility for:
 *   - historical actual rates (source='h10-historical')
 *   - live actual rates (source='live-*')
 *   - demo-only bridging rates (source='demo-seed' — finance-backend/
 *     scripts/seedDemoData.js, Phase 13), kept as its own series rather than
 *     folded into historical or live so the chart never misrepresents its
 *     provenance (CURRENCY_FEATURE.md §10.2)
 *   - LSTM forecast points (1/7/30/90d), anchored to the forecast's own
 *     `data_vintage.last_observed_date` — never "today" (CURRENCY_FEATURE.md §9.2/§10.2)
 *   - a GARCH volatility band around the forecast, anchored to *its own*
 *     `data_vintage.last_observed_date` (which can genuinely differ from the
 *     forecast's — see the Python README's volatility provenance note)
 *   - Isolation Forest anomaly markers, at the `as_of_date` each flagged run covered
 *   - a live-only trend estimate (GET /live-forecast/:code, Phase 15/16 —
 *     CURRENCY_FEATURE.md §16/§17), rendered dotted/muted/desaturated-looking
 *     (opacity, not a lower-chroma hex — see chartUtils.js's COLOR_LIVE_TREND
 *     comment) so it visually reads as LOWER confidence than the ML forecast's
 *     dashed orange line, never as an equivalent or upgraded signal. Anchored
 *     to its own `basis.to_date` (the live series' own last point), never to
 *     the ML forecast's anchor — a wholly separate, much simpler statistical
 *     method (see liveForecast.service.js) that never touches the trained
 *     models or their data.
 *
 * Uses a real numeric time x-axis (not a category axis), so a genuine gap in
 * the actual-rate series (e.g. 2017-08-25 -> the first bridging/live point)
 * renders as actual empty space, not a compressed tick — each series is
 * passed its own `data` array (a Recharts-supported pattern for series that
 * don't share x-values), so nothing interpolates across dates a series has
 * no row for.
 */
export default function CurrencyChart({
  currency,
  historyRows = [],
  historyLoading = false,
  historyError = "",
  forecast = null,
  volatility = null,
  anomalies = [],
  // The raw GET /api/currency/live-forecast/:code response (useLiveForecast)
  // — either the insufficient-data shape or the projection shape. A
  // deliberately separate, much simpler signal from `forecast` above (the
  // trained model) — see CURRENCY_FEATURE.md §16/§17 and LiveTrendBadge,
  // which renders this same object's provenance note outside the chart.
  liveTrend = null,
  visibleSeries = {
    historical: true,
    live: true,
    demoSeed: true,
    forecast: true,
    liveTrend: true,
    volatility: true,
    anomalies: true,
  },
  // `{ from, to }` (ISO dates) for a bounded preset/custom range, or `null`
  // for MAX — bounds the x-axis to what was actually asked for. Without
  // this, the forecast/volatility anchors (permanently fixed to the
  // model's own cutoff — 2017-08-25 / 2011-12-30 — regardless of the
  // selected range) would stretch the axis to include them even when the
  // user picked e.g. "1Y", squashing the real historical/live data into a
  // sliver. See CURRENCY_FEATURE.md §10.2 on why those anchors can't just
  // be moved to "today" instead.
  rangeBounds = null,
  height = 320,
}) {
  const historicalPoints = useMemo(
    () =>
      historyRows
        .filter((r) => r.source === "h10-historical")
        .map((r) => ({ ts: toTs(r.rate_date), mid_rate: Number(r.mid_rate), rate_date: r.rate_date }))
        .filter((p) => p.ts != null)
        .sort((a, b) => a.ts - b.ts),
    [historyRows]
  );

  const livePoints = useMemo(
    () =>
      historyRows
        .filter((r) => isLiveSource(r.source))
        .map((r) => ({ ts: toTs(r.rate_date), mid_rate: Number(r.mid_rate), rate_date: r.rate_date }))
        .filter((p) => p.ts != null)
        .sort((a, b) => a.ts - b.ts),
    [historyRows]
  );

  const demoSeedPoints = useMemo(
    () =>
      historyRows
        .filter((r) => isDemoSeedSource(r.source))
        .map((r) => ({ ts: toTs(r.rate_date), mid_rate: Number(r.mid_rate), rate_date: r.rate_date }))
        .filter((p) => p.ts != null)
        .sort((a, b) => a.ts - b.ts),
    [historyRows]
  );

  const forecastAnchor = forecast?.data_vintage?.last_observed_date || forecast?.as_of_date || null;
  const forecastAnchorTs = toTs(forecastAnchor);

  const forecastPointsAll = useMemo(() => {
    if (!forecast || forecastAnchorTs == null) return [];
    const points = [{ ts: forecastAnchorTs, value: forecast.last_known_rate, horizon_days: 0 }];
    (forecast.forecasts || []).forEach((f) => {
      points.push({
        ts: forecastAnchorTs + f.horizon_days * DAY_MS,
        value: f.predicted_rate,
        horizon_days: f.horizon_days,
      });
    });
    return points.sort((a, b) => a.ts - b.ts);
  }, [forecast, forecastAnchorTs]);

  // Live-trend points (GET /live-forecast/:code) — anchored to the SAME
  // last-observed live point the chart's own `livePoints` series ends on
  // (liveTrend.basis.to_date), never to "today" and never to the ML
  // forecast's anchor. If for some reason the trend's basis end date
  // doesn't match the last live point actually rendered (e.g. the live
  // series is filtered out, or a race between the two independent fetches),
  // the line starts from its first projected point with no anchor segment
  // rather than fabricating a starting value.
  const liveTrendAnchorDate = liveTrend?.insufficient_data ? null : liveTrend?.basis?.to_date || null;
  const liveTrendAnchorTs = toTs(liveTrendAnchorDate);
  const liveTrendAnchorValue =
    livePoints.length > 0 && livePoints[livePoints.length - 1].rate_date === liveTrendAnchorDate
      ? livePoints[livePoints.length - 1].mid_rate
      : null;

  const liveTrendPointsAll = useMemo(() => {
    if (!liveTrend || liveTrend.insufficient_data || !Array.isArray(liveTrend.points)) return [];
    const points = [];
    if (liveTrendAnchorTs != null && liveTrendAnchorValue != null) {
      points.push({ ts: liveTrendAnchorTs, value: liveTrendAnchorValue });
    }
    liveTrend.points.forEach((p) => {
      const ts = toTs(p.date);
      if (ts != null) points.push({ ts, value: Number(p.projected_rate) });
    });
    return points.sort((a, b) => a.ts - b.ts);
  }, [liveTrend, liveTrendAnchorTs, liveTrendAnchorValue]);

  const volatilityAnchor = volatility?.data_vintage?.last_observed_date || forecastAnchor;
  const volatilityAnchorTs = toTs(volatilityAnchor);
  const volatilityAnchorDiffers = volatilityAnchor && forecastAnchor && volatilityAnchor !== forecastAnchor;

  const bandPointsAll = useMemo(() => {
    if (!forecast || !volatility?.forecast_volatility_pct?.length || volatilityAnchorTs == null) return [];
    const pctByDay = volatility.forecast_volatility_pct;
    return (forecast.forecasts || [])
      .filter((f) => f.horizon_days > 0 && f.horizon_days <= pctByDay.length)
      .map((f) => {
        const pct = pctByDay[f.horizon_days - 1] / 100;
        return {
          ts: volatilityAnchorTs + f.horizon_days * DAY_MS,
          lower: f.predicted_rate * (1 - pct),
          upper: f.predicted_rate * (1 + pct),
        };
      })
      .sort((a, b) => a.ts - b.ts);
  }, [forecast, volatility, volatilityAnchorTs]);

  // Anomaly log rows can accumulate several entries at the same `as_of_date`
  // (one per cache-refresh cycle that re-flagged it) — dedupe to one marker
  // per date, keeping the highest score seen, since the score is what the
  // marker actually communicates.
  const anomalyPointsAll = useMemo(() => {
    const byDate = new Map();
    for (const a of anomalies) {
      if (!a.as_of_date) continue;
      const existing = byDate.get(a.as_of_date);
      if (!existing || Number(a.anomaly_score) > existing.score) {
        byDate.set(a.as_of_date, { score: Number(a.anomaly_score), as_of_date: a.as_of_date });
      }
    }
    // Placed on the historical/demo-seed/live line where a row for that
    // exact date exists; otherwise (the common case — as_of_date is the
    // model's fixed vintage date) fall back to the forecast anchor's last
    // known rate, since that IS the value the 60-day anomaly window ended on.
    const rateByDate = new Map(
      [...historicalPoints, ...demoSeedPoints, ...livePoints].map((p) => [p.rate_date, p.mid_rate])
    );
    return [...byDate.values()]
      .map((a) => ({
        ts: toTs(a.as_of_date),
        value: rateByDate.get(a.as_of_date) ?? forecast?.last_known_rate ?? null,
        score: a.score,
      }))
      .filter((p) => p.ts != null && p.value != null);
  }, [anomalies, historicalPoints, demoSeedPoints, livePoints, forecast]);

  // rangeBounds scopes the WHOLE chart to what the user actually asked for
  // (a preset/custom range) — forecast/volatility/anomaly points outside it
  // are excluded from both rendering and the axis domain rather than
  // stretching the axis out to their fixed model-anchor dates (see the
  // `rangeBounds` prop doc above).
  const boundedTs = useMemo(
    () => (rangeBounds ? [toTs(rangeBounds.from), toTs(rangeBounds.to)] : null),
    [rangeBounds]
  );

  const forecastPoints = useMemo(
    () => (boundedTs ? forecastPointsAll.filter((p) => p.ts >= boundedTs[0] && p.ts <= boundedTs[1]) : forecastPointsAll),
    [forecastPointsAll, boundedTs]
  );
  const bandPoints = useMemo(
    () => (boundedTs ? bandPointsAll.filter((p) => p.ts >= boundedTs[0] && p.ts <= boundedTs[1]) : bandPointsAll),
    [bandPointsAll, boundedTs]
  );
  const liveTrendPoints = useMemo(
    () =>
      boundedTs
        ? liveTrendPointsAll.filter((p) => p.ts >= boundedTs[0] && p.ts <= boundedTs[1])
        : liveTrendPointsAll,
    [liveTrendPointsAll, boundedTs]
  );
  const anomalyPoints = useMemo(
    () => (boundedTs ? anomalyPointsAll.filter((p) => p.ts >= boundedTs[0] && p.ts <= boundedTs[1]) : anomalyPointsAll),
    [anomalyPointsAll, boundedTs]
  );

  const showHistorical = visibleSeries.historical && historicalPoints.length > 0;
  const showLive = visibleSeries.live && livePoints.length > 0;
  const showDemoSeed = visibleSeries.demoSeed && demoSeedPoints.length > 0;
  const showForecast = visibleSeries.forecast && forecastPoints.length > 0;
  const showLiveTrend = visibleSeries.liveTrend && liveTrendPoints.length > 0;
  const showVolatility = visibleSeries.volatility && bandPoints.length > 0;
  const showAnomalies = visibleSeries.anomalies && anomalyPoints.length > 0;

  const forecastHiddenByRange = visibleSeries.forecast && forecastPointsAll.length > 0 && forecastPoints.length === 0;
  const liveTrendHiddenByRange =
    visibleSeries.liveTrend && liveTrendPointsAll.length > 0 && liveTrendPoints.length === 0;
  const volatilityHiddenByRange = visibleSeries.volatility && bandPointsAll.length > 0 && bandPoints.length === 0;

  // The gap is between the last historical point and whichever visible
  // "bridging" series (demo-seed, then live) has the earliest point after
  // it — not hardcoded to live's start — so when demo-seed is visible it
  // honestly shrinks the shaded "no data" span to the real remaining gap
  // (2017-08-25 -> demo-seed's start) instead of shading over 3 months of
  // data that's actually there.
  const firstBridgingTs = Math.min(
    ...[showDemoSeed ? demoSeedPoints[0].ts : null, showLive ? livePoints[0].ts : null].filter(
      (ts) => ts != null
    )
  );
  const showGap =
    showHistorical &&
    (showDemoSeed || showLive) &&
    Number.isFinite(firstBridgingTs) &&
    firstBridgingTs - historicalPoints[historicalPoints.length - 1].ts > 30 * DAY_MS;

  const { domain: xDomain, hasAnyPoints } = useMemo(() => {
    if (boundedTs) {
      const anyInBounds =
        (showHistorical && historicalPoints.length > 0) ||
        (showLive && livePoints.length > 0) ||
        (showDemoSeed && demoSeedPoints.length > 0) ||
        showForecast ||
        showLiveTrend ||
        showVolatility ||
        showAnomalies;
      return { domain: boundedTs, hasAnyPoints: anyInBounds };
    }
    const allTs = [
      ...(showHistorical ? historicalPoints.map((p) => p.ts) : []),
      ...(showLive ? livePoints.map((p) => p.ts) : []),
      ...(showDemoSeed ? demoSeedPoints.map((p) => p.ts) : []),
      ...(showForecast ? forecastPoints.map((p) => p.ts) : []),
      ...(showLiveTrend ? liveTrendPoints.map((p) => p.ts) : []),
      ...(showVolatility ? bandPoints.map((p) => p.ts) : []),
      ...(showAnomalies ? anomalyPoints.map((p) => p.ts) : []),
    ];
    if (allTs.length === 0) return { domain: [0, 1], hasAnyPoints: false };
    return { domain: [Math.min(...allTs), Math.max(...allTs)], hasAnyPoints: true };
  }, [
    boundedTs, showHistorical, showLive, showDemoSeed, showForecast, showLiveTrend, showVolatility, showAnomalies,
    historicalPoints, livePoints, demoSeedPoints, forecastPoints, liveTrendPoints, bandPoints, anomalyPoints,
  ]);

  const yDomain = useMemo(() => {
    const vals = [
      ...(showHistorical ? historicalPoints.map((p) => p.mid_rate) : []),
      ...(showLive ? livePoints.map((p) => p.mid_rate) : []),
      ...(showDemoSeed ? demoSeedPoints.map((p) => p.mid_rate) : []),
      ...(showForecast ? forecastPoints.map((p) => p.value) : []),
      ...(showLiveTrend ? liveTrendPoints.map((p) => p.value) : []),
      ...(showVolatility ? bandPoints.flatMap((p) => [p.lower, p.upper]) : []),
    ];
    if (vals.length === 0) return ["auto", "auto"];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || max * 0.05 || 1;
    return [min - pad, max + pad];
  }, [
    showHistorical, showLive, showDemoSeed, showForecast, showLiveTrend, showVolatility,
    historicalPoints, livePoints, demoSeedPoints, forecastPoints, liveTrendPoints, bandPoints,
  ]);

  const legendItems = [
    showHistorical && { label: "Historical (Fed H.10)", color: COLOR_HISTORICAL },
    showDemoSeed && { label: "Demo bridge data (not real)", color: COLOR_DEMO_SEED },
    showLive && { label: "Live (er-api)", color: COLOR_LIVE },
    showForecast && { label: "Forecast (1/7/30/90d)", color: COLOR_FORECAST, lineStyle: "dashed" },
    showLiveTrend && {
      label: "Live trend estimate (not the model)",
      color: COLOR_LIVE_TREND,
      lineStyle: "dotted",
      muted: true,
    },
    showVolatility && { label: "GARCH volatility band", color: COLOR_FORECAST },
    showAnomalies && { label: "Anomaly flagged", color: COLOR_ANOMALY },
  ].filter(Boolean);

  if (historyLoading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (historyError) {
    return (
      <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{historyError}</span>
      </div>
    );
  }

  if (!hasAnyPoints) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10" style={{ minHeight: height }}>
        <Activity className="w-8 h-8 text-slate-300 mb-2" />
        <p className="text-sm font-bold text-slate-700">No data for {currency} in this range</p>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          Nothing matches the current date range / series filters. Try a wider range preset, switch the
          source filter to "Both", or enable another series.
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
            tickFormatter={formatRate}
            tick={{ fontSize: 10, fill: COLOR_MUTED }}
            stroke={COLOR_AXIS}
            width={58}
          />
          <Tooltip content={<CustomTooltip />} />

          {showGap && (
            <ReferenceArea
              x1={historicalPoints[historicalPoints.length - 1].ts}
              x2={firstBridgingTs}
              fill={COLOR_MUTED}
              fillOpacity={0.08}
              ifOverflow="visible"
              label={{
                value: "No data collected",
                position: "insideTop",
                fontSize: 10,
                fill: COLOR_MUTED,
              }}
            />
          )}

          {showVolatility && (
            <Area
              data={bandPoints}
              dataKey={(d) => [d.lower, d.upper]}
              name="Volatility band"
              stroke="none"
              fill={COLOR_FORECAST}
              fillOpacity={0.16}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}

          {showHistorical && (
            <Line
              data={historicalPoints}
              dataKey="mid_rate"
              name="Historical (Fed H.10)"
              stroke={COLOR_HISTORICAL}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}

          {showDemoSeed && (
            <Line
              data={demoSeedPoints}
              dataKey="mid_rate"
              name="Demo bridge data (not real)"
              stroke={COLOR_DEMO_SEED}
              strokeWidth={2}
              strokeDasharray="2 3"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}

          {showLive && (
            <Line
              data={livePoints}
              dataKey="mid_rate"
              name="Live (er-api)"
              stroke={COLOR_LIVE}
              strokeWidth={2}
              dot={{ r: 2.5, fill: COLOR_LIVE, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}

          {showForecast && (
            <Line
              data={forecastPoints}
              dataKey="value"
              name="Forecast"
              stroke={COLOR_FORECAST}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={<DiamondDot fill={COLOR_FORECAST} />}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {showLiveTrend && (
            <Line
              data={liveTrendPoints}
              dataKey="value"
              name="Live trend estimate (not the model)"
              stroke={COLOR_LIVE_TREND}
              strokeWidth={1.5}
              strokeOpacity={0.65}
              strokeDasharray="1 4"
              dot={{ r: 2, fill: COLOR_LIVE_TREND, fillOpacity: 0.65, strokeWidth: 0 }}
              activeDot={{ r: 4, fillOpacity: 0.85 }}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {showAnomalies && (
            <Scatter
              data={anomalyPoints}
              dataKey="value"
              name="Anomaly flagged"
              shape={<AnomalyMarker fill={COLOR_ANOMALY} />}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <LegendRow items={legendItems} />

      {showVolatility && volatilityAnchorDiffers && (
        <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
          <History className="w-3 h-3 shrink-0" />
          Volatility band anchored to the GARCH model's own cutoff ({volatilityAnchor}), which differs from
          the forecast's ({forecastAnchor}) — see the volatility stat's data-vintage note.
        </p>
      )}

      {(forecastHiddenByRange || volatilityHiddenByRange) && (
        <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
          <History className="w-3 h-3 shrink-0" />
          {forecastHiddenByRange && volatilityHiddenByRange
            ? "Forecast and volatility band"
            : forecastHiddenByRange
              ? "Forecast"
              : "Volatility band"}{" "}
          anchored to {forecastAnchor} — outside the selected date range. Pick MAX or widen the range to see it.
        </p>
      )}

      {/* Live-trend messaging — kept as its own paragraph, never folded into
          the forecast/volatility note above (§10.2 point 2: a live value and
          a model value are never merged into one flat field/message). */}
      {visibleSeries.liveTrend && liveTrend?.insufficient_data && (
        <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
          <Radio className="w-3 h-3 shrink-0" style={{ color: COLOR_LIVE_TREND }} />
          Not enough live history yet for a trend estimate ({liveTrend.n_points_available}/
          {liveTrend.min_points_required} days collected).
        </p>
      )}
      {liveTrendHiddenByRange && (
        <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
          <Radio className="w-3 h-3 shrink-0" style={{ color: COLOR_LIVE_TREND }} />
          Live trend estimate is outside the selected date range. Pick MAX or widen the range to see it.
        </p>
      )}
    </div>
  );
}

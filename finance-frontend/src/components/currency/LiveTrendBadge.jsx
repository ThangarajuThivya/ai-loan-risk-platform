import { Radio } from "lucide-react";
import { COLOR_LIVE_TREND } from "./chartUtils";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/**
 * The provenance/disclaimer badge for the live-forecast trend series (GET
 * /api/currency/live-forecast/:code, CURRENCY_FEATURE.md §16/§17).
 * Deliberately a SEPARATE component from DataVintageBadge — different icon
 * (Radio, not History), a distinct magenta tint tied to the chart's
 * COLOR_LIVE_TREND swatch (not slate), and its own block with no shared
 * tooltip — so the two provenance notices are never visually or textually
 * merged (§10.2 point 2: a live value and a model value are never merged
 * into one flat field/badge/tooltip; §16.2 restates this for this endpoint
 * specifically).
 *
 * `liveForecast` is the raw GET /live-forecast/:code response — either the
 * insufficient-data shape (`{ insufficient_data: true, n_points_available,
 * min_points_required }`) or the projection shape (`{ method, horizon_days,
 * points, basis, disclaimer }`). `null`/`undefined` (not yet loaded) renders
 * nothing, same as DataVintageBadge.
 */
export default function LiveTrendBadge({ liveForecast, compact = false, className = "" }) {
  if (!liveForecast) return null;

  if (liveForecast.insufficient_data) {
    return (
      <div
        className={`flex items-start gap-2 bg-slate-50 border border-slate-200 text-slate-500 rounded-xl px-3 py-2 text-[11px] leading-relaxed ${className}`}
      >
        <Radio className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: COLOR_LIVE_TREND }} />
        <span>
          Not enough live history yet for a trend estimate ({liveForecast.n_points_available}/
          {liveForecast.min_points_required} days collected for {liveForecast.currency}). Check back once the
          live feed has accumulated more daily rates.
        </span>
      </div>
    );
  }

  if (compact) {
    return (
      <p className={`text-[10px] text-slate-400 mt-1 flex items-center gap-1 ${className}`}>
        <Radio className="w-3 h-3 shrink-0" style={{ color: COLOR_LIVE_TREND }} />
        Short-term trend estimate ({liveForecast.horizon_days}d) — from live rates, not the trained model.
      </p>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed ${className}`}
      style={{ backgroundColor: "#fbeef4", borderWidth: 1, borderStyle: "solid", borderColor: "#f5d6e5", color: "#52514e" }}
    >
      <Radio className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: COLOR_LIVE_TREND }} />
      <span>
        <strong className="text-slate-700">Short-term trend estimate</strong> — based on recent live rates
        ({liveForecast.basis?.n_points_used} days, {formatDate(liveForecast.basis?.from_date)} to{" "}
        {formatDate(liveForecast.basis?.to_date)}), <strong>not the trained forecasting model</strong>. Naive
        statistical extrapolation only — not a market prediction and not financial advice.
      </span>
    </div>
  );
}

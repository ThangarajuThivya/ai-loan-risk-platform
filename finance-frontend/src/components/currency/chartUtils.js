/**
 * Shared date-range/formatting helpers for the currency chart stack
 * (CurrencyChart, CurrencyCompareChart, ChartControls). Kept here instead of
 * duplicated across the three role views that render them.
 */

export const RANGE_PRESETS = [
  { id: "1M", label: "1M", months: 1 },
  { id: "3M", label: "3M", months: 3 },
  { id: "6M", label: "6M", months: 6 },
  { id: "1Y", label: "1Y", months: 12 },
  { id: "5Y", label: "5Y", months: 60 },
  { id: "MAX", label: "MAX", months: null },
  { id: "CUSTOM", label: "Custom", months: undefined },
];

const toIsoDate = (date) => date.toISOString().slice(0, 10);

/**
 * Resolve a preset id to `{ from, to }` (both `undefined`) or `{ limit }` for
 * MAX — GET /api/currency/rates/:code supports either mode (Phase 5's
 * `?limit=` or Phase 7's `?from=&to=`), so MAX reuses the row-count mode
 * with a cap comfortably above any trained currency's full history
 * (largest is LKR at ~10,850 h10-historical rows) rather than guessing an
 * arbitrarily early `from` date per currency.
 */
export function resolvePresetParams(presetId) {
  if (presetId === "MAX") return { limit: 20000 };
  if (presetId === "CUSTOM") return null; // caller supplies from/to directly
  const preset = RANGE_PRESETS.find((p) => p.id === presetId);
  if (!preset || preset.months == null) return { limit: 20000 };
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - preset.months);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/**
 * Resolve a ChartControls filter object to `{ from, to }` bounds for
 * CurrencyChart's `rangeBounds` prop, or `null` for "unbounded" (MAX, or an
 * incomplete custom range) — the same resolution `useRateHistory` applies
 * for the actual fetch, kept in sync here so the chart's x-axis always
 * reflects exactly what was asked for.
 */
export function resolveRangeBounds({ preset, from, to }) {
  if (preset === "MAX") return null;
  if (preset === "CUSTOM") return from && to ? { from, to } : null;
  const params = resolvePresetParams(preset);
  return params && params.from ? { from: params.from, to: params.to } : null;
}

export const formatAxisDate = (ts) =>
  new Date(ts).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "2-digit" });

export const formatTooltipDate = (ts) =>
  new Date(ts).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" });

export const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** `"2017-08-25"` (or a Date) -> epoch ms at UTC midnight, for a numeric time x-axis. */
export function toTs(dateLike) {
  if (!dateLike) return null;
  const s = typeof dateLike === "string" ? dateLike : dateLike.toISOString().slice(0, 10);
  const ts = new Date(`${s}T00:00:00Z`).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Add `days` calendar days to a `YYYY-MM-DD` date string, returning a new `YYYY-MM-DD` string. */
export function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Live-forecast trend series color — dataviz skill's validated categorical
// slot 5 (magenta), the next fixed hue after CurrencyChart's existing
// slots 1-4 (historical/forecast/live/demo-seed). Adjacency re-validated
// with the skill's validator alongside those four:
//   node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4" --mode light
// all hard gates pass (contrast WARN carries the same "visible label"
// relief the live/demo-seed slots already require). The "muted, reads as
// lower-confidence than the ML forecast" treatment the live-trend series
// needs comes from the MARK (dotted stroke, reduced opacity, thinner line
// in CurrencyChart.jsx), not from hand-desaturating this hex — doing that
// would drop the hue below the chroma floor and make it stop doing
// identity work (see the dataviz skill's color-formula.md).
export const COLOR_LIVE_TREND = "#e87ba4";

export const SOURCE_LIVE_PREFIX = "live-";
export const isLiveSource = (source) => typeof source === "string" && source.startsWith(SOURCE_LIVE_PREFIX);

// Demo-only bridging data (finance-backend/scripts/seedDemoData.js, Phase 13)
// that fills the 2017 h10-historical -> live-feed gap so the app is
// demonstrable without waiting on real activity. Deliberately its own source
// value, never folded into 'h10-historical' (it isn't Fed H.10 data) or
// 'live-*' (it isn't a real-time provider pull) — see CURRENCY_FEATURE.md
// §10.2's "never merge a live value and a model value into one flat field"
// rule, applied here to provenance labelling in general.
export const DEMO_SEED_SOURCE = "demo-seed";
export const isDemoSeedSource = (source) => source === DEMO_SEED_SOURCE;

// Maps ChartControls' UI source-filter choice to the exact `?source=` value
// the gateway's validator accepts (`h10-historical` | `live-er-api` |
// `demo-seed`) — see finance-backend/src/routes/currency.routes.js. "both"
// omits the param (returns every source, demo-seed included).
const SOURCE_PARAM_BY_ID = {
  both: undefined,
  historical: "h10-historical",
  live: "live-er-api",
  demo: DEMO_SEED_SOURCE,
};
export const sourceParamFor = (sourceFilterId) => SOURCE_PARAM_BY_ID[sourceFilterId];

import { useEffect, useState } from "react";
import { SlidersHorizontal, Scale } from "lucide-react";
import { RANGE_PRESETS } from "./chartUtils";

// Customer range pills. Previously restricted to 1M/3M/6M because anything
// longer ran into the 2017→present dead zone: the H.10 backfill stopped at
// 2017-08-25 and only a shallow live feed existed after it, so 1Y/5Y/MAX drew
// a mostly-empty panel. The v3 data refresh extended H.10 to 2026-07-24 and
// the backfill now covers the whole span continuously, so every range has
// real data behind it and the full set is offered.
const CUSTOMER_RANGE_PRESET_IDS = ["1M", "3M", "6M", "1Y", "5Y", "MAX"];

// CUSTOM is still omitted from the customer variant: a raw date-range picker
// is a developer control, and the six pills above cover the real use cases.

// "Demo bridge only" is gone — those rows existed solely to paper over the
// 2017→present gap and were deleted from currency_rate_history once the v3
// refresh filled that span with real H.10 data. Keeping a filter that can
// only ever return zero rows would be a trap.
const SOURCE_OPTIONS = [
  { id: "both", label: "Both", source: undefined },
  { id: "historical", label: "Historical only", source: "h10-historical" },
  { id: "live", label: "Live only", source: "live-er-api" },
];

const SERIES_TOGGLES = [
  { key: "historical", label: "Historical" },
  { key: "live", label: "Live" },
  { key: "forecast", label: "Forecast" },
  // Same access level as "forecast" above — no new role logic, see
  // CURRENCY_FEATURE.md §17. Deliberately its own toggle, never merged with
  // "forecast" — they are two different signals (§10.2 point 2 / §16.2).
  { key: "liveTrend", label: "Live trend estimate" },
  { key: "volatility", label: "Volatility band", staffOnly: true },
  { key: "anomalies", label: "Anomalies", staffOnly: true },
];

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
        active
          ? "bg-brand-primary text-white border-brand-primary shadow-sm"
          : "bg-white text-slate-600 border-slate-200 hover:border-brand-primary/40"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A real `<button role="switch">`, not a styled span (fixed Phase 24, §25).
 *
 * It used to be a `<span role="checkbox" onClick>` inside a `<label>` with
 * no `tabIndex` and no `onKeyDown` — an element that announces itself as a
 * checkbox to assistive tech but cannot be focused or activated by
 * keyboard, and whose wrapping `<label>` had no associated form control, so
 * the text beside the switch wasn't clickable either.
 *
 * A `<button>` gets focusability, Enter/Space activation and disabled/focus
 * semantics from the platform rather than from hand-rolled key handlers.
 * `role="switch"` is the accurate role for an on/off control (the previous
 * `checkbox` role also implies a possible mixed state, which this has not).
 * The track and knob are `aria-hidden` decoration — the button's own
 * `aria-checked` plus its text label carry the state.
 *
 * Appearance is unchanged: the same flex row, same 4×7 track, same knob
 * translation. Tailwind's preflight already strips the button's default
 * background/border/font, so the only visible addition is a focus ring,
 * which is the point.
 */
function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0 ${
          checked ? "bg-brand-primary" : "bg-slate-200"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

/**
 * Shared filter bar for CurrencyChart / CurrencyCompareChart — date range
 * presets + a debounced custom picker (mirrors EmiCalculator's debounce),
 * series visibility, source filter, and (when `allowCompare`) the
 * compare-mode + normalize switches. Currency selection itself stays with
 * each view's existing CurrencyPicker — this bar only owns range/series/
 * source/compare, so it composes with whatever picker each role already has.
 *
 * `filters`/`onChange` come from useChartFilters (localStorage-persisted
 * per role) — this component is a controlled view over that state.
 *
 * `variant` (Phase 21, CURRENCY_FEATURE.md §22):
 *  - `"full"` (default) — everything above. Staff and admin, unchanged.
 *  - `"customer"` — the six range pills, and nothing else. The series
 *    toggles and source filters stay hidden: they are developer/analyst
 *    controls, and a customer has no way to tell which combinations produce
 *    a meaningful chart. The historical-study toggle that used to live here
 *    is gone — it existed only to reach the pre-2017 plane across the data
 *    gap, and with one continuous series to today the range pills alone do
 *    that job.
 */
export default function ChartControls({
  filters,
  onChange,
  allowVolatility = false,
  allowAnomalies = false,
  showSeriesToggles = true,
  showNormalizeToggle = false,
  variant = "full",
}) {
  const isCustomer = variant === "customer";
  const [customFrom, setCustomFrom] = useState(filters.from || "");
  const [customTo, setCustomTo] = useState(filters.to || "");

  // Debounced the same way EmiCalculator debounces its sliders — typing in
  // the custom date inputs shouldn't push a new filters value (and thus a
  // new fetch + localStorage write) on every keystroke.
  useEffect(() => {
    if (filters.preset !== "CUSTOM") return;
    const timer = setTimeout(() => {
      if (customFrom !== filters.from || customTo !== filters.to) {
        onChange({ from: customFrom || undefined, to: customTo || undefined });
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFrom, customTo, filters.preset]);

  // A range change is now just a range change. The customer variant used to
  // force historical+forecast off on every preset click, because those series
  // only existed pre-2017 and would sit out of range in any live window. With
  // one continuous real series from 1971 to today, the historical data IS the
  // chart at every range, so clearing it would blank the panel.
  const setPreset = (id) => onChange({ preset: id });
  const setSource = (id) => onChange({ sourceFilterId: id });
  const toggleSeries = (key) =>
    onChange((prev) => ({ series: { ...prev.series, [key]: !prev.series?.[key] } }));

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">
      <div className="flex items-center gap-2 text-slate-400">
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <p className="text-[10px] font-bold uppercase tracking-wider">
          {isCustomer ? "Chart Range" : "Chart Filters"}
        </p>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-2">
        {(isCustomer ? RANGE_PRESETS.filter((p) => CUSTOMER_RANGE_PRESET_IDS.includes(p.id)) : RANGE_PRESETS).map(
          (p) => (
            <Pill key={p.id} active={filters.preset === p.id} onClick={() => setPreset(p.id)}>
              {p.label}
            </Pill>
          )
        )}

        {!isCustomer && filters.preset === "CUSTOM" && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              max={customTo || undefined}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600"
            />
            <span className="text-slate-300 text-xs">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom || undefined}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600"
            />
          </div>
        )}
      </div>

      {/* Series visibility — never in the customer variant. */}
      {showSeriesToggles && !isCustomer && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {SERIES_TOGGLES.filter(
            (t) => (!t.staffOnly) || (t.key === "volatility" ? allowVolatility : allowAnomalies)
          ).map((t) => (
            <Toggle
              key={t.key}
              checked={!!filters.series?.[t.key]}
              onChange={() => toggleSeries(t.key)}
              label={t.label}
            />
          ))}
        </div>
      )}

      {/* Source + normalize — never in the customer variant. "Demo bridge
          only" names an internal seed script; none of these four belong on
          a customer page. */}
      {!isCustomer && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((s) => (
              <Pill key={s.id} active={filters.sourceFilterId === s.id} onClick={() => setSource(s.id)}>
                {s.label}
              </Pill>
            ))}
          </div>

          {showNormalizeToggle && (
            <Toggle
              checked={!!filters.normalize}
              onChange={() => onChange({ normalize: !filters.normalize })}
              label={
                <span className="flex items-center gap-1">
                  <Scale className="w-3 h-3" /> Normalize to 100
                </span>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

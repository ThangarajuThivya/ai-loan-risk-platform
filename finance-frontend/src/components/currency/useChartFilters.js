import { useEffect, useState } from "react";

const STORAGE_PREFIX = "currency-chart-filters:";

/**
 * Persists a role's chart filter choices (range preset, custom dates,
 * series visibility, source filter, compare/normalize settings) in
 * localStorage, restored on revisit — one key per role so a customer's
 * choices never leak into staff/admin's (or vice versa) and each role only
 * ever writes the subset of fields its own view actually uses. No DB table,
 * per the Phase 9 brief.
 *
 * @param {string} role e.g. "customer" | "staff" | "admin"
 * @param {object} defaults shape of the filter object this view needs
 */
export default function useChartFilters(role, defaults) {
  const storageKey = `${STORAGE_PREFIX}${role}`;

  const [filters, setFilters] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      // `series` is merged key-by-key (not replaced wholesale): a filter
      // object persisted before a new series toggle existed (e.g. `demoSeed`,
      // added when the chart learned to render demo-bridge data) must still
      // pick up that new key's default rather than silently omitting it —
      // otherwise a returning user's stale localStorage would keep a newly
      // introduced series permanently hidden.
      return { ...defaults, ...saved, series: { ...defaults.series, ...saved.series } };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      // Storage full/unavailable (private browsing etc.) — filters still
      // work for this session, they just won't persist across visits.
    }
  }, [storageKey, filters]);

  // Both forms are treated as a *patch* merged over the previous state. The
  // function form used to have its result replace the state wholesale, which
  // silently broke the only caller that uses it: ChartControls' series
  // toggle returns `{ series: {...} }`, so flipping any series checkbox
  // dropped `preset`/`from`/`to`/`sourceFilterId` off the filter object —
  // resetting the range to unbounded and clearing the source filter on every
  // toggle, for all three roles. Fixed in Phase 20 (CURRENCY_FEATURE.md §21).
  const updateFilters = (patch) =>
    setFilters((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));

  return [filters, updateFilters];
}

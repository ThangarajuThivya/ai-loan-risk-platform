import { useEffect, useState } from "react";
import api from "../../api/axios";
import { resolvePresetParams } from "./chartUtils";

/**
 * Fetches GET /api/currency/rates/:code for several currencies at once —
 * backs the multi-currency compare chart (staff/admin only). Same 250ms
 * debounce as useRateHistory so switching the compare set or dragging the
 * custom date pickers doesn't fire a request burst.
 *
 * @param {string[]} codes
 * @param {{ preset: string, from?: string, to?: string, source?: string }} range
 * @returns {{ seriesByCode: Record<string, object[]>, loading: boolean, error: string }}
 */
export default function useMultiRateHistory(codes, { preset, from, to, source }) {
  const [seriesByCode, setSeriesByCode] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const codesKey = [...codes].sort().join(",");

  useEffect(() => {
    const params = preset === "CUSTOM" ? (from && to ? { from, to } : null) : resolvePresetParams(preset);
    if (!params) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (codes.length === 0) {
        setSeriesByCode({});
        return;
      }
      setLoading(true);
      setError("");
      try {
        const settled = await Promise.allSettled(
          codes.map((code) =>
            api
              .get(`/currency/rates/${code}`, { params: { ...params, source }, signal: controller.signal })
              .then((res) => [code, res.data?.rates || []])
          )
        );
        const next = {};
        let anyFailed = false;
        settled.forEach((outcome) => {
          if (outcome.status === "fulfilled") {
            const [code, rows] = outcome.value;
            next[code] = rows;
          } else {
            anyFailed = true;
          }
        });
        setSeriesByCode(next);
        if (anyFailed) setError("Some currencies couldn't be loaded. Showing the ones that succeeded.");
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey, preset, from, to, source]);

  return { seriesByCode, loading, error };
}

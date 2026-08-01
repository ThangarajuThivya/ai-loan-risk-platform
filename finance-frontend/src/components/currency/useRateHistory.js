import { useEffect, useState } from "react";
import api from "../../api/axios";
import { resolvePresetParams } from "./chartUtils";

/**
 * Fetches GET /api/currency/rates/:code for the chart, debounced the same
 * way the EMI calculator debounces its inputs (250ms + AbortController) so
 * dragging the custom date pickers or flipping through currencies quickly
 * doesn't fire a burst of requests.
 *
 * @param {string} code
 * @param {{ preset: string, from?: string, to?: string, source?: string }} range
 *   `source` is `undefined` for "both", or a real `source` value
 *   (`h10-historical` | `live-*`) to narrow the query.
 */
export default function useRateHistory(code, { preset, from, to, source }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    const params = preset === "CUSTOM" ? (from && to ? { from, to } : null) : resolvePresetParams(preset);
    if (!params) return; // custom range not fully picked yet — wait rather than fetch a partial range

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/currency/rates/${code}`, {
          params: { ...params, source },
          signal: controller.signal,
        });
        setRows(res.data?.rates || []);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") {
          setError(err.response?.data?.message || "Couldn't load rate history for this currency.");
          setRows([]);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, preset, from, to, source]);

  return { rows, loading, error };
}

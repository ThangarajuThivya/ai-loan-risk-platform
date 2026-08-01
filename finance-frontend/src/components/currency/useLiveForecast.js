import { useEffect, useState } from "react";
import api from "../../api/axios";

/**
 * Fetches GET /api/currency/live-forecast/:code?horizon= — the naive
 * live-only trend projection (finance-backend/src/services/
 * liveForecast.service.js, CURRENCY_FEATURE.md §16). A SEPARATE signal from
 * useRateHistory's rows and from the trained model's /analyze forecast —
 * never merge this hook's data into either of those (§10.2 point 2, §16.2).
 *
 * The response is either the insufficient-data shape
 * (`{ insufficient_data: true, n_points_available, min_points_required,
 * message }`) or the projection shape (`{ method, horizon_days, points,
 * basis, disclaimer }`) — callers branch on `data.insufficient_data`, same
 * as useRateHistory's callers branch on `rows.length`.
 *
 * @param {string} code
 * @param {{ horizonDays?: number }} [opts]
 */
export default function useLiveForecast(code, { horizonDays = 7 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/currency/live-forecast/${code}`, {
          params: { horizon: horizonDays },
          signal: controller.signal,
        });
        setData(res.data);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") {
          setError(err.response?.data?.message || "Couldn't load the live trend estimate.");
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, horizonDays]);

  return { data, loading, error };
}

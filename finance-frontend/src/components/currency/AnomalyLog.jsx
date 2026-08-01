import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Inbox, RefreshCw, Radio, History } from "lucide-react";
import api from "../../api/axios";
import CurrencyPicker from "./CurrencyPicker";

/**
 * Which data plane a logged anomaly came from (Phase 29, §30). Reuses the
 * icons the rest of the currency stack already assigns to the two planes —
 * Radio for live (LiveRateBadge, LiveTrendBadge) and History for the model's
 * 2017-anchored series (DataVintageBadge) — so the distinction reads the
 * same here as everywhere else rather than inventing a third vocabulary.
 *
 * Rows written before migration 009 default to 'model-series', which is
 * accurate: /analyze's historical-series check was the only writer then.
 */
function PlaneChip({ plane }) {
  const isLive = plane === "live-feed";
  const Icon = isLive ? Radio : History;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
        isLive
          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
          : "bg-slate-100 text-slate-600 border-slate-200"
      }`}
      title={
        isLive
          ? "Detected on the live rate feed — recent market data."
          : "Detected on the model's historical Fed H.10 series (through 2017), not live data."
      }
    >
      <Icon className="w-3 h-3 shrink-0" />
      {isLive ? "Live feed" : "Model series"}
    </span>
  );
}

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Flagged-anomaly history (GET /api/currency/anomalies), shared between the
 * staff and admin currency views — staff sees the same feed to advise
 * customers, admin sees it system-wide (role matrix, CURRENCY_FEATURE.md §6).
 */
export default function AnomalyLog({ currencies }) {
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAnomalies = async (filter) => {
    const res = await api.get("/currency/anomalies", {
      params: { currency: filter || undefined, limit: 50 },
    });
    return res.data?.anomalies || [];
  };

  const loadAnomalies = async () => {
    setLoading(true);
    setError("");
    try {
      setAnomalies(await fetchAnomalies(currencyFilter));
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load the anomaly log. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await fetchAnomalies(currencyFilter);
        if (!cancelled) setAnomalies(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Couldn't load the anomaly log. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currencyFilter]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Filter by currency</p>
          <button
            type="button"
            onClick={loadAnomalies}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:text-brand-primary/80"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCurrencyFilter("")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              currencyFilter === ""
                ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                : "bg-white text-slate-600 border-slate-200 hover:border-brand-primary/40"
            }`}
          >
            All
          </button>
          <CurrencyPicker currencies={currencies} selected={currencyFilter} onSelect={setCurrencyFilter} />
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && anomalies.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No anomalies flagged</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            No unusual rate movements have been detected{currencyFilter ? ` for ${currencyFilter}` : ""} yet.
          </p>
        </div>
      )}

      {!loading && !error && anomalies.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-3">Currency</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">As Of</th>
                  <th className="px-4 py-3">Anomaly Score</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Detected At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {anomalies.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-bold text-slate-800">{a.currency_code}</td>
                    {/* Which data plane the flagged window came from (Phase
                        29, CURRENCY_FEATURE.md §30). A live-feed detection
                        describes rates from days ago; a model-series one
                        describes the 2017-anchored H.10 history. Same
                        detector, wholly different windows — never merged
                        into one undifferentiated row (§10.2). */}
                    <td className="px-4 py-3">
                      <PlaneChip plane={a.data_plane} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(a.as_of_date)}</td>
                    <td className="px-4 py-3 font-mono text-rose-600">{Number(a.anomaly_score).toFixed(3)}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{a.model_version || "—"}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{formatDateTime(a.detected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

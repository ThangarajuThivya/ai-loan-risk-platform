import { useEffect, useState } from "react";
import { Radio, RefreshCw, Loader2 } from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

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

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/**
 * Live rate-feed status + manual refresh (Phase 7's POST
 * /admin/rates/refresh) — extracted out of AdminCurrency.jsx's Model Status
 * tab, which had this exact block first, so the FX exchange admin console
 * (CURRENCY_FEATURE.md §12's spread/limits/position oversight) can show the
 * same provider-health/last-refresh view without a second copy of the
 * fetch-and-render logic. Self-contained (fetches its own board state) so
 * either call site can drop it in with no prop wiring.
 */
export default function LiveRateFeedPanel({ className = "" }) {
  const { showToast } = useToast();
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBoard = async () => {
    try {
      const res = await api.get("/currency/board");
      setBoard(res.data);
    } catch {
      setBoard(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadBoard();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post("/currency/admin/rates/refresh");
      await loadBoard();
      showToast({
        type: "success",
        title: "Live Rates Refreshed",
        message: `${res.data?.currencies_updated ?? 0} currencies updated from the live provider.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Refresh Failed",
        message: err.response?.data?.message || "Couldn't refresh live rates from the provider.",
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Live Rate Feed</h2>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:text-brand-primary/80 disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Force Refresh
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      )}

      {!loading && board && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded-full font-bold border ${
              board.is_stale
                ? "bg-amber-100 text-amber-800 border-amber-200"
                : "bg-emerald-100 text-emerald-800 border-emerald-200"
            }`}
          >
            {board.is_stale ? "Stale — provider may be behind" : "Live"}
          </span>
          Provider: {board.source || "unknown"} · Last refreshed {formatDateTime(board.as_of)} ·{" "}
          {board.rates?.length ?? 0} currencies tradable
        </p>
      )}

      {!loading && !board && (
        <p className="text-xs text-slate-400">
          Not populated yet — trigger a refresh or wait for the next scheduled hourly pull.
        </p>
      )}

      {!loading && board?.rates?.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 text-left">
                <th className="py-1.5 pr-4">Currency</th>
                <th className="py-1.5 pr-4">Mid (LKR)</th>
                <th className="py-1.5 pr-4">We Buy</th>
                <th className="py-1.5">We Sell</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {board.rates.map((r) => (
                <tr key={r.currency}>
                  <td className="py-1.5 pr-4 font-semibold text-slate-700">{r.currency}</td>
                  <td className="py-1.5 pr-4 font-mono text-slate-600">{formatRate(r.mid_rate)}</td>
                  <td className="py-1.5 pr-4 font-mono text-slate-600">{formatRate(r.buy_rate)}</td>
                  <td className="py-1.5 font-mono text-slate-600">{formatRate(r.sell_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

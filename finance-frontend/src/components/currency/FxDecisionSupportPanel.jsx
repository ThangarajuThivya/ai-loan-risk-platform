import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, TrendingUp, TrendingDown, Gauge, ShieldAlert, ShieldCheck, Info } from "lucide-react";
import api from "../../api/axios";
import DataVintageBadge from "./DataVintageBadge";

const VOLATILITY_STYLES = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-rose-100 text-rose-800 border-rose-200",
};

const formatPercent = (value) =>
  value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;

const formatPct1dp = (value) =>
  value === null || value === undefined ? "—" : `${Number(value).toFixed(2)}%`;

/**
 * Read-only context for a staff member reviewing an FX exchange request —
 * the currency's 90-day trend, GARCH volatility band, and any Isolation
 * Forest anomaly flag from GET /currency/analyze/:code (staff/admin gets
 * the full breakdown, per CURRENCY_FEATURE.md §4.2's role-shaping). Per the
 * brief: this is context for the staff member's own judgement, never a
 * recommendation — there is no "approve"/"reject" language anywhere here,
 * and every stat carries its own §10.2 data-vintage badge so it's never
 * mistaken for a live signal about the trade itself. Forecast/trend output
 * is never consulted by the quote/review endpoints themselves
 * (CURRENCY_FEATURE.md §12.1) — this panel is purely advisory reading
 * material shown alongside the decision, not an input to it.
 */
export default function FxDecisionSupportPanel({ currencyCode, className = "" }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The trained models cover LKR/INR/EUR/GBP/JPY, not USD itself — USD is
  // the H.10 convention's implicit base, so /analyze/USD is a 400 (verified
  // live against the running service). The closest match for a USD trade is
  // the LKR model's own LKR-per-USD forecast, which IS the board's USD/LKR
  // pair — the same mapping ExchangeForecastPanel.jsx (Phase 11, customer
  // side) already uses. For every other traded currency (EUR/GBP/JPY/INR),
  // /analyze/<code> forecasts that currency against USD, not against the
  // LKR-denominated trade being reviewed here, so it needs the same
  // different-pair caveat Phase 11 already established (CURRENCY_FEATURE.md
  // §13.2) rather than being shown as if it were the trade's own currency.
  const analyzeCode = currencyCode === "USD" ? "LKR" : currencyCode;
  const isDirectPair = currencyCode === "USD" || currencyCode === "LKR";

  useEffect(() => {
    if (!analyzeCode) return undefined;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/currency/analyze/${analyzeCode}`, { signal: controller.signal });
        setAnalysis(res.data);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") {
          setError(err.response?.data?.message || "Decision-support data unavailable right now.");
          setAnalysis(null);
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [analyzeCode]);

  const weakening = analysis?.trend?.trend_label === "up";
  const isAnomalous = analysis?.anomaly?.is_anomalous;

  return (
    <div className={`bg-slate-50 rounded-2xl border border-slate-100 p-4 ${className}`}>
      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-3 flex items-center gap-1.5">
        <Info className="w-3 h-3" />
        Decision Support — context only, not a recommendation
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-xs py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading market context…
        </div>
      )}

      {!loading && error && <p className="text-xs text-slate-400 py-2">{error}</p>}

      {!loading && !error && analysis && (
        <>
          {!isDirectPair && (
            <div className="flex items-start gap-1.5 mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2 leading-relaxed">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                This tracks {analyzeCode}'s rate against the <strong>US Dollar</strong>, not the{" "}
                {currencyCode}/LKR rate on this request — a different pair, shown for background context only.
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
                90-Day Trend
              </p>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                  weakening
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : "bg-emerald-100 text-emerald-800 border-emerald-200"
                }`}
              >
                {weakening ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                {weakening ? "Weakening" : "Strengthening"}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Confidence: {formatPercent(analysis.trend?.confidence)}
              </p>
            </div>

            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
                Volatility Band
              </p>
              {analysis.volatility?.band ? (
                <>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border capitalize ${
                      VOLATILITY_STYLES[analysis.volatility.band] || "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    <Gauge className="w-3 h-3" />
                    {analysis.volatility.band}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {formatPct1dp(analysis.volatility.average_forecast_volatility_pct)} avg /{" "}
                    {analysis.volatility.horizon_days}d
                  </p>
                </>
              ) : (
                <span className="text-xs text-slate-400">Not available</span>
              )}
            </div>

            <div>
              <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
                Anomaly Flag
              </p>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                  isAnomalous
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : "bg-emerald-100 text-emerald-800 border-emerald-200"
                }`}
              >
                {isAnomalous ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                {isAnomalous ? "Flagged" : "Normal"}
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Score: {analysis.anomaly?.anomaly_score?.toFixed?.(3) ?? "—"}
              </p>
            </div>
          </div>

          <DataVintageBadge vintage={analysis.data_vintage} technical className="mt-3" />

          <p className="text-[11px] text-slate-500 mt-3 leading-relaxed border-t border-slate-200 pt-3">
            This is historical statistical output shown for context. It does not gate, suggest, or influence
            the review decision in any way — approve, reject, or counter based on your own judgement of the
            customer, the request, and bank policy.
          </p>
        </>
      )}

      {!loading && !error && !analysis && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>No decision-support data available for {currencyCode}.</span>
        </div>
      )}
    </div>
  );
}

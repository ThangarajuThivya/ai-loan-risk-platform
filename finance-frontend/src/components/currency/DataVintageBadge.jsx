import { History } from "lucide-react";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

/**
 * The provenance badge every forecast/trend/volatility/anomaly panel must
 * show (Phase 8, CURRENCY_FEATURE.md §10.2) — makes it unmissable that a
 * prediction is a historical projection from the Fed H.10 series, not a
 * live market forecast, so it's never mistaken for current-market output
 * when shown next to a genuinely live rate (see LiveRateBadge).
 *
 * `vintage` is a data_vintage object from the gateway/Python API:
 * { training_data_source, training_data_end, last_observed_rate,
 *   last_observed_date, is_live, model_version, trained_at }.
 * `technical`, when true (staff/admin), additionally shows model_version
 * and the exact last-observed date/rate this specific prediction used.
 */
export default function DataVintageBadge({ vintage, technical = false, compact = false, className = "" }) {
  if (!vintage) return null;

  if (compact) {
    return (
      <p className={`text-[10px] text-slate-400 mt-1 flex items-center gap-1 ${className}`}>
        <History className="w-3 h-3 shrink-0" />
        Historical (Fed H.10) as of {formatDate(vintage.training_data_end)}
        {technical && ` · model ${vintage.model_version}`}
      </p>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl px-3 py-2 text-[11px] leading-relaxed ${className}`}
    >
      <History className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
      <span>
        Model trained on {vintage.training_data_source} data through{" "}
        <strong className="text-slate-700">{formatDate(vintage.training_data_end)}</strong> — historical
        projection, not a live market forecast.
        {technical && (
          <>
            {" "}
            <span className="text-slate-400">
              Last observed {formatDate(vintage.last_observed_date)}
              {vintage.last_observed_rate !== null && vintage.last_observed_rate !== undefined
                ? ` (${Number(vintage.last_observed_rate).toLocaleString("en-US", { maximumFractionDigits: 4 })})`
                : ""}
              {" · model "}
              {vintage.model_version}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { Radio, AlertTriangle, Loader2, Info } from "lucide-react";

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function formatRelativeTime(value, t) {
  if (!value) return t("rateBoard.unknownTime");
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return t("rateBoard.momentsAgo");
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return t("rateBoard.justNow");
  if (minutes < 60) return t("rateBoard.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("rateBoard.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("rateBoard.daysAgo", { count: days });
}

/**
 * The bank's published buy/sell rate board — LKR per unit of foreign
 * currency (CURRENCY_FEATURE.md §12.1). "We Buy" is the rate the bank pays
 * the customer for their foreign currency (always the lower number); "We
 * Sell" is the rate the bank charges a customer buying foreign currency
 * (always the higher number). That gap is the bank's spread, and it's the
 * single most common source of customer confusion about this feature — the
 * two columns are deliberately never merged into one "the rate" number.
 *
 * `highlightCurrency` + `highlightDirection` (customer's own direction: 'buy'
 * foreign currency or 'sell' foreign currency) bold the one column that
 * actually applies to the customer's own request, when this table is shown
 * next to the exchange form rather than as a standalone reference.
 */
export default function RateBoardTable({
  board,
  loading,
  error,
  highlightCurrency,
  highlightDirection,
  onSelectCurrency,
  className = "",
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-10 text-slate-400 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs ${className}`}
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  if (!board || !board.rates || board.rates.length === 0) {
    return (
      <div
        className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center text-xs text-slate-400 ${className}`}
      >
        {t("rateBoard.noCurrenciesTradable")}
      </div>
    );
  }

  // Bank buys the customer's FX -> priced off "We Buy"; customer buying FX
  // from the bank -> priced off "We Sell". See fxQuote.service.js's
  // rateForDirection, mirrored here for the highlight only (not the math).
  const highlightCol = highlightDirection === "buy" ? "sell" : highlightDirection === "sell" ? "buy" : null;

  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Radio className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>
            {t("rateBoard.ratesInLkr", {
              source: board.source || t("rateBoard.defaultSource"),
              time: formatRelativeTime(board.as_of, t),
            })}
          </span>
        </div>
        {board.is_stale && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-amber-100 text-amber-800 border-amber-200">
            <AlertTriangle className="w-3 h-3" />
            {t("rateBoard.feedMayBeBehind")}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="px-4 sm:px-5 py-2.5 font-semibold">{t("rateBoard.currency")}</th>
              <th
                className={`px-4 py-2.5 font-semibold text-right ${highlightCol === "buy" ? "text-brand-primary" : ""}`}
              >
                {t("rateBoard.weBuy")}
              </th>
              <th
                className={`px-4 sm:px-5 py-2.5 font-semibold text-right ${highlightCol === "sell" ? "text-brand-primary" : ""}`}
              >
                {t("rateBoard.weSell")}
              </th>
            </tr>
          </thead>
          <tbody>
            {board.rates.map((r) => {
              const isSelected = highlightCurrency === r.currency;
              return (
                <tr
                  key={r.currency}
                  onClick={onSelectCurrency ? () => onSelectCurrency(r.currency) : undefined}
                  className={`border-b border-slate-50 last:border-0 ${
                    onSelectCurrency ? "cursor-pointer hover:bg-slate-50" : ""
                  } ${isSelected ? "bg-brand-primary/5" : ""}`}
                >
                  <td className="px-4 sm:px-5 py-3">
                    <span className="font-semibold text-slate-800">{r.currency}</span>
                    <span className="hidden sm:inline text-xs text-slate-400"> · {r.name}</span>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      highlightCol === "buy" && isSelected
                        ? "font-bold text-brand-primary"
                        : "text-slate-700"
                    }`}
                  >
                    {formatRate(r.buy_rate)}
                  </td>
                  <td
                    className={`px-4 sm:px-5 py-3 text-right font-mono ${
                      highlightCol === "sell" && isSelected
                        ? "font-bold text-brand-primary"
                        : "text-slate-700"
                    }`}
                  >
                    {formatRate(r.sell_rate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        <span>
          {t("rateBoard.spreadExplanationPrefix")} <strong>{t("rateBoard.weSell")}</strong>{" "}
          {t("rateBoard.spreadExplanationMiddle")} <strong>{t("rateBoard.weBuy")}</strong>{" "}
          {t("rateBoard.spreadExplanationSuffix")}
        </span>
      </div>
    </div>
  );
}

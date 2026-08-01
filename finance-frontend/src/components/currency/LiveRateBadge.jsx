import { Radio, AlertTriangle } from "lucide-react";

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function formatRelativeTime(value) {
  if (!value) return "unknown time";
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return "moments ago";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * The "this is genuinely live" counterpart to DataVintageBadge (Phase 8,
 * CURRENCY_FEATURE.md §10.2) — provider name + timestamp + a stale flag, so a
 * live rate is never confused with (or silently conflated into) a model
 * prediction. Deliberately a separate component/object from the model's
 * badge — see currency.controller.js's file header on the two data planes.
 *
 * The live rate board quotes LKR-per-unit-of-foreign-currency (a retail
 * bank convention); the AI models quote foreign-currency-per-1-USD (the Fed
 * H.10 convention). These are the SAME pair only when the selected currency
 * is LKR (board's USD row = USD/LKR = exactly the pair the LKR model
 * forecasts). For every other currency they are different pairs entirely,
 * so this component says so explicitly rather than implying a comparison
 * that isn't valid.
 *
 * `showPairingNote` (Phase 23, §24) opts out of that sub-note only. It
 * exists for the customer page, where the model's figures now sit behind a
 * collapsed section whose own summary already says "not comparable to the
 * figure above" — the same statement from the other side, and a duplicate
 * once both are on screen. Defaults to `true`, so staff's call site
 * (StaffCurrency.jsx) keeps the note with no change.
 */
export default function LiveRateBadge({ board, row, selectedCode, showPairingNote = true, className = "" }) {
  if (!board || !row) {
    return (
      <div
        className={`flex items-center gap-2 bg-slate-50 border border-slate-200 text-slate-400 rounded-xl px-3 py-2 text-[11px] ${className}`}
      >
        <Radio className="w-3.5 h-3.5 shrink-0" />
        <span>No live rate available for this currency yet.</span>
      </div>
    );
  }

  const isUsdForLkr = selectedCode === "LKR" && row.currency === "USD";
  const pairLabel = isUsdForLkr ? `1 USD = ${formatRate(row.mid_rate)} LKR` : `1 ${row.currency} = ${formatRate(row.mid_rate)} LKR`;

  return (
    <div
      className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed border ${
        board.is_stale
          ? "bg-amber-50 border-amber-200 text-amber-800"
          : "bg-emerald-50 border-emerald-200 text-emerald-800"
      } ${className}`}
    >
      {board.is_stale ? (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      ) : (
        <Radio className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      )}
      <span>
        <strong>Live rate</strong> · {pairLabel} · {board.source || "provider"} ·{" "}
        {formatRelativeTime(board.as_of)}
        {board.is_stale && " · feed may be behind"}
        {showPairingNote && !isUsdForLkr && (
          <>
            {" "}
            <span className="block text-slate-500 mt-0.5">
              Bank board rate against LKR — a different quote than the model's
              {` ${selectedCode}-per-USD `}
              forecast below, not directly comparable.
            </span>
          </>
        )}
      </span>
    </div>
  );
}

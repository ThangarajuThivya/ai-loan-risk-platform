import { useEffect, useState } from "react";
import { Lock, TimerReset, RefreshCw } from "lucide-react";

function secondsRemaining(quote) {
  if (!quote?.quote_expires_at) return 0;
  return Math.max(0, Math.floor((new Date(quote.quote_expires_at).getTime() - Date.now()) / 1000));
}

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The visible countdown for a locked FX quote (CURRENCY_FEATURE.md §12.3 —
 * a signed, short-TTL token, not a database row; `FX_QUOTE_TTL_SECONDS`,
 * 15 min by default). When it hits zero, submission must be refused and a
 * re-quote offered — never let a stale rate submit silently, since the
 * server itself throws a 410 on an expired quote.
 *
 * `remaining` is never stored as its own state — it's computed fresh every
 * render from `quote` (the actual source of truth) plus a `tick` counter
 * that exists only to force a re-render once a second; storing a derived
 * copy of it would just be two numbers that could drift apart.
 */
export default function QuoteLockTimer({ quote, onExpire, onRequote, requoting, className = "" }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!quote) return undefined;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [quote]);

  const remaining = secondsRemaining(quote);
  const isExpired = Boolean(quote) && remaining <= 0;

  useEffect(() => {
    if (isExpired) onExpire?.();
  }, [isExpired, onExpire]);

  if (!quote) return null;

  const isWarning = !isExpired && remaining <= 60;

  if (isExpired) {
    return (
      <div
        className={`flex items-center justify-between gap-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-xs ${className}`}
      >
        <span className="flex items-center gap-2 font-semibold">
          <TimerReset className="w-4 h-4 shrink-0" />
          This quote has expired — rates may have moved.
        </span>
        <button
          type="button"
          onClick={onRequote}
          disabled={requoting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${requoting ? "animate-spin" : ""}`} />
          {requoting ? "Re-quoting…" : "Get a new quote"}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs border ${
        isWarning ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"
      } ${className}`}
    >
      <span className="flex items-center gap-2 font-semibold">
        <Lock className="w-4 h-4 shrink-0" />
        Rate locked for <span className="font-mono">{formatMMSS(remaining)}</span>
      </span>
      {isWarning && (
        <button
          type="button"
          onClick={onRequote}
          disabled={requoting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${requoting ? "animate-spin" : ""}`} />
          Refresh quote
        </button>
      )}
    </div>
  );
}

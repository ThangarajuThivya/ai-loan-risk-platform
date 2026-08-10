import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildLeaseTiles } from "./leaseTiles";

/**
 * The dashboard furniture for a lessee's lease page.
 *
 * Three pieces, all in service of one idea: exactly ONE stage is full size
 * at a time, and everything finished shrinks to a line. The page used to
 * show nine full-width cards on a live lease, of which one was actionable —
 * a lessee scrolled past two large money tables that were pure receipts to
 * reach the panel they came for.
 */

const TONE = {
  slate: "text-slate-900",
  amber: "text-amber-700",
  emerald: "text-emerald-700",
};

/**
 * Four figures across the top, chosen for the stage the lease is at.
 *
 * Always four, so the row does not reflow as a lease progresses — a grid
 * that changes shape under you reads as a different page.
 */
export function LeaseTiles(props) {
  const { t } = useTranslation();
  const tiles = buildLeaseTiles(props);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((tile) => {
        const label = t(tile.labelKey);
        const value = tile.valueKey ? t(tile.valueKey, tile.valueParams) : tile.value;
        const hint = tile.hintKey ? t(tile.hintKey, tile.hintParams) : tile.hint;
        return (
          <div
            key={tile.labelKey}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3.5"
          >
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
              {label}
            </p>
            <p
              className={`font-mono font-bold text-base mt-1 truncate ${TONE[tile.tone] || TONE.slate}`}
              title={value}
            >
              {value}
            </p>
            {hint && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A finished stage: one line, expanding to the card it used to be.
 *
 * `<details>` rather than React state on purpose — it is open/closed
 * behaviour with no cross-component consequence, and the browser's own
 * element keeps it keyboard-accessible and findable by in-page search
 * without any of that being reimplemented.
 */
export function HistoryEntry({ title, summary, children }) {
  return (
    <details className="group border-b border-slate-100 last:border-b-0">
      <summary className="cursor-pointer list-none flex items-center gap-2 px-4 py-3 hover:bg-slate-50/70 select-none">
        <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0 transition-transform group-open:rotate-90" />
        <span className="text-xs font-bold text-slate-700 shrink-0">{title}</span>
        <span className="text-[11px] text-slate-400 truncate ml-auto text-right">{summary}</span>
      </summary>
      <div className="px-2 pb-3">{children}</div>
    </details>
  );
}

/** A titled block in the right-hand rail. */
export function RailCard({ title, icon: Icon, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-4 ${className}`}>
      {title && (
        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
          {Icon && <Icon className="w-3 h-3" />}
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

/** A label/value row inside a rail card. */
export function RailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-[11px] py-1">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className="text-slate-700 font-semibold text-right truncate">{value}</span>
    </div>
  );
}

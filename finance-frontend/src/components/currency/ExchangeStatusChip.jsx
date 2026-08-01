import { STATUS_META } from "../../constants/fxExchange";

/** Status chip for an FX exchange request — colors match the Phase 10 state machine (CURRENCY_FEATURE.md §12.2). */
export default function ExchangeStatusChip({ status, className = "" }) {
  const meta = STATUS_META[status] || {
    label: status || "Unknown",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${meta.className} ${className}`}
    >
      {meta.label}
    </span>
  );
}

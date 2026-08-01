import { History } from "lucide-react";
import { STATUS_META } from "../../constants/fxExchange";

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
 * The append-only fx_request_events audit trail (CURRENCY_FEATURE.md §12.2),
 * oldest-first (matching the model's own ORDER BY). Shared between the
 * staff review drawer and the admin audit view rather than duplicated —
 * customer/ExchangeRequestDetail.jsx has its own small inline copy (Phase
 * 11, pre-existing) left as-is since it isn't part of this phase's scope.
 */
function EventRow({ event, isLast }) {
  const fromLabel = event.from_status ? STATUS_META[event.from_status]?.label || event.from_status : "Submitted";
  const toLabel = STATUS_META[event.to_status]?.label || event.to_status;
  const isCounter = event.from_status === event.to_status;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-brand-primary shrink-0 mt-1" />
        {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
      </div>
      <div className="pb-5">
        <p className="text-xs font-semibold text-slate-800">
          {isCounter ? "Counter-quote issued" : `${fromLabel} → ${toLabel}`}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">{formatDateTime(event.created_at)}</p>
        {event.note && <p className="text-xs text-slate-600 mt-1.5 bg-slate-50 rounded-lg p-2.5">{event.note}</p>}
      </div>
    </div>
  );
}

export default function FxRequestEventTimeline({ events, className = "" }) {
  return (
    <div className={className}>
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" />
        Audit Timeline
      </h3>
      {(!events || events.length === 0) && <p className="text-xs text-slate-400">No events recorded yet.</p>}
      {events && events.length > 0 && (
        <div>
          {events.map((event, idx) => (
            <EventRow key={event.id} event={event} isLast={idx === events.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

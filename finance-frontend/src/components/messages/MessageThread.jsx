import { formatDate } from "../../pages/customer/dashboardFormat";

function labelFor(reply, viewerIsCustomer) {
  if (reply.sender_role === "customer") {
    return viewerIsCustomer ? "You" : reply.sender_name || "Customer";
  }
  // Staff/admin identity is hidden from the customer — shown as a generic
  // "Support Team" — but visible internally so agents have context.
  if (viewerIsCustomer) return "Support Team";
  return `${reply.sender_name || "Support"} (${reply.sender_role === "admin" ? "Admin" : "Staff"})`;
}

/**
 * Chat-style reply history, shared by the customer thread page and the
 * admin/staff inbox modal. `viewerIsCustomer` controls alignment (the
 * viewer's own messages on the right) and whether staff/admin identity is
 * masked to a generic "Support Team" label.
 */
export default function MessageThread({ replies, viewerIsCustomer }) {
  if (!replies || replies.length === 0) {
    return <p className="text-xs text-slate-400 text-center py-6">No messages yet.</p>;
  }

  return (
    <div className="space-y-3">
      {replies.map((reply) => {
        const isMine = viewerIsCustomer
          ? reply.sender_role === "customer"
          : reply.sender_role !== "customer";
        return (
          <div key={reply.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl p-4 border ${
                isMine
                  ? "bg-brand-primary/10 border-brand-primary/10"
                  : "bg-slate-50 border-slate-100"
              }`}
            >
              <div className="flex items-center justify-between gap-4 mb-1">
                <span className="text-[11px] font-bold text-slate-600">
                  {labelFor(reply, viewerIsCustomer)}
                </span>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {formatDate(reply.created_at)}
                </span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {reply.body}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

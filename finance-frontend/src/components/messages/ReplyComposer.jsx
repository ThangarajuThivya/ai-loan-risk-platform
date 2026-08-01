import { useState } from "react";
import { Send, Loader2 } from "lucide-react";

/** Reply textarea + send button, shared by the customer thread page and the admin/staff inbox modal. */
export default function ReplyComposer({ onSubmit, disabled, placeholder = "Type a reply..." }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSubmit(trimmed);
      setBody("");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        disabled={disabled || sending}
        className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors resize-none disabled:bg-slate-50"
      />
      <button
        type="submit"
        disabled={disabled || sending || !body.trim()}
        className="shrink-0 flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-primary/95 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl text-sm font-semibold transition-colors shadow-sm"
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        <span className="hidden sm:inline">Send</span>
      </button>
    </form>
  );
}

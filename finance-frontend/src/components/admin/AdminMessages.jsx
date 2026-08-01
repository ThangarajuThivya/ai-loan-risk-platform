import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Eye,
  X,
  Loader2,
  AlertTriangle,
  Inbox,
  MessageSquare,
} from "lucide-react";
import api from "../../api/axios";
import ContactStatusChip from "../messages/ContactStatusChip";
import MessageThread from "../messages/MessageThread";
import ReplyComposer from "../messages/ReplyComposer";
import { STATUS_FILTER_OPTIONS, STATUS_META } from "../../constants/contactMessages";

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

function ThreadDetailModal({ threadId, onClose, onChanged }) {
  const [thread, setThread] = useState(null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusChoice, setStatusChoice] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/contact-messages/${threadId}`);
      setThread(res.data.thread);
      setReplies(res.data.replies || []);
      setStatusChoice(res.data.thread.status);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load this message.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const handleReply = async (body) => {
    const res = await api.post(`/contact-messages/${threadId}/replies`, { body });
    setThread(res.data.thread);
    setReplies(res.data.replies || []);
    setStatusChoice(res.data.thread.status);
    onChanged();
  };

  const handleUpdateStatus = async () => {
    if (!thread || statusChoice === thread.status) return;
    setUpdatingStatus(true);
    try {
      const res = await api.patch(`/contact-messages/${threadId}/status`, { status: statusChoice });
      setThread(res.data.thread);
      onChanged();
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-800 truncate">
                {thread?.subject || "Loading..."}
              </h3>
              {thread?.customer && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {thread.customer.first_name} {thread.customer.last_name} · {thread.customer.email}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loading && (
            <div className="flex-1 flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="p-6">
              <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {!loading && !error && thread && (
            <>
              <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
                <select
                  value={statusChoice}
                  onChange={(e) => setStatusChoice(e.target.value)}
                  className="text-xs font-semibold px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-brand-primary"
                >
                  {STATUS_FILTER_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleUpdateStatus}
                  disabled={updatingStatus || statusChoice === thread.status}
                  type="button"
                  className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {updatingStatus ? "Updating..." : "Update Status"}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <MessageThread replies={replies} viewerIsCustomer={false} />
              </div>

              <div className="p-5 border-t border-slate-100 bg-slate-50/50 shrink-0">
                <ReplyComposer onSubmit={handleReply} placeholder="Reply to the customer..." />
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function AdminMessages() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/contact-messages", {
        params: statusFilter === "all" ? {} : { status: statusFilter },
      });
      setThreads(res.data?.threads || []);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load messages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filteredThreads = threads.filter((t) => {
    const term = searchTerm.toLowerCase();
    if (!term) return true;
    return (
      t.subject.toLowerCase().includes(term) ||
      t.customer?.first_name?.toLowerCase().includes(term) ||
      t.customer?.last_name?.toLowerCase().includes(term) ||
      t.customer?.email?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contact Messages</h1>
          <p className="text-slate-500 text-sm mt-1">Support inbox — every customer message thread.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            placeholder="Search by subject, name, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
        >
          <option value="all">All Statuses</option>
          {STATUS_FILTER_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {!loading && !error && filteredThreads.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No messages found</p>
        </div>
      )}

      {!loading && !error && filteredThreads.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-6 py-3.5">Customer</th>
                  <th className="px-6 py-3.5">Subject</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Last Activity</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredThreads.map((thread) => (
                  <tr key={thread.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">
                        {thread.customer?.first_name} {thread.customer?.last_name}
                      </div>
                      <div className="text-[11px] text-slate-400">{thread.customer?.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-slate-700 font-medium">
                        <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[220px]">{thread.subject}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <ContactStatusChip status={thread.status} />
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 font-mono">
                      {formatDateTime(thread.last_message_at)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedThreadId(thread.id)}
                        className="p-1.5 hover:bg-indigo-50 hover:text-indigo-900 text-slate-400 rounded-lg transition-colors inline-flex items-center justify-center"
                        title="View thread"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedThreadId && (
        <ThreadDetailModal
          threadId={selectedThreadId}
          onClose={() => setSelectedThreadId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageSquare,
  Plus,
  X,
  Loader2,
  AlertTriangle,
  Inbox,
  ChevronRight,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import ContactStatusChip from "../../components/messages/ContactStatusChip";
import { formatDate } from "./dashboardFormat";

function NewMessageModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (subject.trim().length < 3 || body.trim().length < 10) {
      showToast({
        type: "error",
        title: t("customer.messages.incompleteTitle"),
        message: t("customer.messages.incompleteMessage"),
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post("/contact-messages", { subject: subject.trim(), body: body.trim() });
      showToast({
        type: "success",
        title: t("customer.messages.sentTitle"),
        message: t("customer.messages.sentMessage"),
      });
      onCreated(res.data.thread);
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.messages.sendFailedTitle"),
        message: err.response?.data?.message || t("customer.messages.sendFailedDefault"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="bg-white rounded-3xl w-full max-w-lg shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800">{t("customer.messages.newMessageModalTitle")}</h3>
            <button
              onClick={onClose}
              type="button"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                {t("customer.messages.subjectLabel")}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={150}
                placeholder={t("customer.messages.subjectPlaceholder")}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                {t("customer.messages.messageLabel")}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                rows={5}
                placeholder={t("customer.messages.messagePlaceholder")}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-primary/95 disabled:opacity-60 text-white py-3.5 rounded-xl font-semibold transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>{submitting ? t("customer.messages.sending") : t("customer.messages.sendMessage")}</span>
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ThreadRow({ thread, onClick }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-4 p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50/60 transition-colors text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="bg-brand-primary/10 text-brand-primary p-2 rounded-xl shrink-0">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">{thread.subject}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {t("customer.messages.lastActivity", { date: formatDate(thread.last_message_at) })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <ContactStatusChip status={thread.status} />
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </div>
    </button>
  );
}

function CustomerMessages() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/contact-messages/mine");
      setThreads(res.data?.threads || []);
    } catch (err) {
      setError(err.response?.data?.message || t("customer.messages.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t("customer.messages.supportEyebrow")}</p>
              <p className="text-sm font-bold text-slate-800">{t("customer.messages.pageTitle")}</p>
            </div>
          </div>

          <button
            onClick={() => setShowNewModal(true)}
            type="button"
            className="flex items-center justify-center space-x-2 bg-brand-primary hover:bg-brand-primary/95 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>{t("customer.messages.newMessage")}</span>
          </button>
        </div>

        {loading && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 flex items-center justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!loading && !error && threads.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">{t("customer.messages.noMessagesTitle")}</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {t("customer.messages.noMessagesHint")}
            </p>
            <button
              onClick={() => setShowNewModal(true)}
              type="button"
              className="mt-5 inline-flex items-center space-x-2 bg-brand-primary hover:bg-brand-primary/95 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{t("customer.messages.newMessage")}</span>
            </button>
          </div>
        )}

        {!loading && !error && threads.length > 0 && (
          <div className="space-y-3">
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                onClick={() => navigate(`/dashboard/messages/${thread.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {showNewModal && (
        <NewMessageModal
          onClose={() => setShowNewModal(false)}
          onCreated={(thread) => {
            setShowNewModal(false);
            navigate(`/dashboard/messages/${thread.id}`);
          }}
        />
      )}
    </div>
  );
}

export default CustomerMessages;

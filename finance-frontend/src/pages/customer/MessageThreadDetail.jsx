import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, AlertTriangle, MessageSquare } from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import ContactStatusChip from "../../components/messages/ContactStatusChip";
import MessageThread from "../../components/messages/MessageThread";
import ReplyComposer from "../../components/messages/ReplyComposer";
import { formatDate } from "./dashboardFormat";

function MessageThreadDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { showToast } = useToast();

  const [thread, setThread] = useState(null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/contact-messages/${id}`);
      setThread(res.data.thread);
      setReplies(res.data.replies || []);
    } catch (err) {
      setError(err.response?.data?.message || t("customer.messageThread.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReply = async (body) => {
    try {
      const res = await api.post(`/contact-messages/${id}/replies`, { body });
      setThread(res.data.thread);
      setReplies(res.data.replies || []);
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.messageThread.replyFailedTitle"),
        message: err.response?.data?.message || t("customer.messageThread.replyFailedDefault"),
      });
    }
  };

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-3xl mx-auto">
        <Link
          to="/dashboard/messages"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-primary mb-5 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t("customer.messageThread.backToMessages")}</span>
        </Link>

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

        {!loading && !error && thread && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-4 p-5 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="bg-brand-primary/10 text-brand-primary p-2 rounded-xl shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{thread.subject}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t("customer.messageThread.startedOn", { date: formatDate(thread.created_at) })}
                  </p>
                </div>
              </div>
              <ContactStatusChip status={thread.status} />
            </div>

            <div className="p-5">
              <MessageThread replies={replies} viewerIsCustomer />
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50/50">
              <ReplyComposer onSubmit={handleReply} placeholder={t("customer.messageThread.replyPlaceholder")} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageThreadDetail;

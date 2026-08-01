import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  XCircle,
  History,
  Banknote,
  MapPin,
  CalendarDays,
  FileText,
  Printer,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import ExchangeStatusChip from "../../components/currency/ExchangeStatusChip";
import SettlementSlip from "../../components/currency/SettlementSlip";
import FxDocumentPanel from "../../components/currency/FxDocumentPanel";
import { PURPOSE_CODE_OPTIONS, STATUS_META } from "../../constants/fxExchange";

const PRINTABLE_STATUSES = new Set(["ready_for_settlement", "settled"]);

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

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function EventRow({ event, isLast }) {
  const { t } = useTranslation();
  const fromLabel = event.from_status
    ? STATUS_META[event.from_status]?.label || event.from_status
    : t("customer.exchangeRequestDetail.submitted");
  const toLabel = STATUS_META[event.to_status]?.label || event.to_status;
  const isCounter = event.from_status === event.to_status;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-2.5 h-2.5 rounded-full bg-brand-primary shrink-0 mt-1" />
        {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
      </div>
      <div className={`pb-5 ${isLast ? "" : ""}`}>
        <p className="text-xs font-semibold text-slate-800">
          {isCounter ? t("customer.exchangeRequestDetail.counterQuoteIssued") : `${fromLabel} → ${toLabel}`}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">{formatDateTime(event.created_at)}</p>
        {event.note && <p className="text-xs text-slate-600 mt-1.5 bg-slate-50 rounded-lg p-2.5">{event.note}</p>}
      </div>
    </div>
  );
}

export default function ExchangeRequestDetail() {
  const { t } = useTranslation();
  const { ref } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/currency/exchange/requests/${ref}`);
      setRequest(res.data);
    } catch (err) {
      setError(err.response?.data?.message || t("customer.exchangeRequestDetail.loadErrorDefault"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await api.post(`/currency/exchange/requests/${ref}/cancel`);
      setRequest((prev) => ({ ...prev, ...res.data }));
      setConfirmCancel(false);
      showToast({
        type: "success",
        title: t("customer.exchangeRequestDetail.cancelledToastTitle"),
        message: t("customer.exchangeRequestDetail.cancelledToastMessage", { ref }),
      });
      load();
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.exchangeRequestDetail.cancelFailedTitle"),
        message: err.response?.data?.message || t("customer.exchangeRequestDetail.cancelFailedDefault"),
      });
      setConfirmCancel(false);
    } finally {
      setCancelling(false);
    }
  };

  const purposeLabel = request
    ? PURPOSE_CODE_OPTIONS.find((p) => p.value === request.purpose_code)?.label || request.purpose_code
    : null;

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => navigate("/dashboard/currency/exchange/requests")}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-primary transition-colors mb-5 print:hidden"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("customer.exchangeRequestDetail.backToRequests")}
        </button>

        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400 print:hidden">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs print:hidden">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && request && (
          <div className="space-y-5 print:hidden">
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">
              <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">
                    {t("customer.exchangeRequestDetail.exchangeRequestEyebrow")}
                  </p>
                  <h1 className="font-mono text-xl font-bold text-slate-900">{request.reference_no}</h1>
                </div>
                <ExchangeStatusChip status={request.status} className="text-xs px-3 py-1.5" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-primary/10 flex items-center justify-center shrink-0">
                    <Banknote className="w-4.5 h-4.5 text-brand-primary" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                      {request.direction === "buy"
                        ? t("customer.exchangeRequestDetail.buying")
                        : t("customer.exchangeRequestDetail.selling")}
                    </p>
                    <p className="text-sm font-bold text-slate-800">
                      {Number(request.foreign_amount).toLocaleString()} {request.currency_code}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("customer.exchangeRequestDetail.rateAndSpread", {
                        rate: formatRate(request.quoted_rate),
                        code: request.currency_code,
                        spread: (request.spread_bps_applied / 100).toFixed(2),
                      })}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-accent/10 flex items-center justify-center shrink-0">
                    <Banknote className="w-4.5 h-4.5 text-brand-accent" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("customer.exchangeRequestDetail.lkrAmount")}</p>
                    <p className="text-sm font-bold text-slate-800">{formatLkr(request.quoted_lkr_amount)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("customer.exchangeRequestDetail.rateSource", { source: request.rate_source || "—" })}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                    <FileText className="w-4.5 h-4.5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("customer.exchangeRequestDetail.purpose")}</p>
                    <p className="text-sm font-bold text-slate-800">{purposeLabel}</p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                    <MapPin className="w-4.5 h-4.5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">{t("customer.exchangeRequestDetail.branch")}</p>
                    <p className="text-sm font-bold text-slate-800">{request.branch}</p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3 sm:col-span-2">
                  <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-4.5 h-4.5 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                      {t("customer.exchangeRequestDetail.settlementDate")}
                    </p>
                    <p className="text-sm font-bold text-slate-800">{formatDate(request.settlement_date)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {t("customer.exchangeRequestDetail.submittedUpdated", {
                        submitted: formatDateTime(request.created_at),
                        updated: formatDateTime(request.updated_at),
                      })}
                    </p>
                  </div>
                </div>
              </div>

              {request.status === "rejected" && request.review_note && (
                <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs mb-4">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>{t("customer.exchangeRequestDetail.rejectedLabel")}</strong> {request.review_note}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap gap-2.5">
                {request.status === "pending_review" && (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {t("customer.exchangeRequestDetail.cancelRequest")}
                  </button>
                )}
                {PRINTABLE_STATUSES.has(request.status) && (
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/5 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    {t("customer.exchangeRequestDetail.printSettlementSlip")}
                  </button>
                )}
              </div>
            </div>

            {/* Supporting documents. Shown whenever the request was flagged
                at submission, and also once anything has been uploaded, so
                the evidence stays visible after staff have actioned it. */}
            {(request.requires_documents || request.document_count > 0) && (
              <FxDocumentPanel
                referenceNo={request.reference_no}
                requiresDocuments={request.requires_documents}
                canUpload={request.status === "pending_review"}
                onCountChange={(count) =>
                  setRequest((prev) => (prev ? { ...prev, document_count: count } : prev))
                }
              />
            )}

            {/* Audit timeline */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-5 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                {t("customer.exchangeRequestDetail.auditTimeline")}
              </h2>
              {(!request.events || request.events.length === 0) && (
                <p className="text-xs text-slate-400">{t("customer.exchangeRequestDetail.noEventsRecorded")}</p>
              )}
              {request.events && request.events.length > 0 && (
                <div>
                  {request.events.map((event, idx) => (
                    <EventRow key={event.id} event={event} isLast={idx === request.events.length - 1} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && !error && !request && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center text-xs text-slate-400 print:hidden">
            {t("customer.exchangeRequestDetail.notFound")}{" "}
            <Link to="/dashboard/currency/exchange/requests" className="text-brand-primary font-semibold">
              {t("customer.exchangeRequestDetail.backToRequests")}
            </Link>
          </div>
        )}

        {!loading && !error && request && <SettlementSlip request={request} />}
      </div>

      {/* Cancel confirmation */}
      <AnimatePresence>
        {confirmCancel && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs print:hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <XCircle className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900">{t("customer.exchangeRequestDetail.cancelModalTitle")}</h3>
              </div>

              <p className="text-sm text-slate-600 mb-6">
                {t("customer.exchangeRequestDetail.cancelModalBody", { ref })}
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmCancel(false)}
                  disabled={cancelling}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  {t("customer.exchangeRequestDetail.keepRequest")}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                >
                  {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t("customer.exchangeRequestDetail.confirmCancel")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

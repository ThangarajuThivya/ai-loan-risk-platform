import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Loader2,
  AlertTriangle,
  FilePlus2,
  ArrowRight,
  Sparkles,
  FileSignature,
} from "lucide-react";
import {
  RISK_STYLES,
  STATUS_STYLES,
  formatStatus,
  formatCurrency,
  formatDate,
  getAttention,
} from "./dashboardFormat";

/**
 * A compact, single-row summary — everything this used to expand into
 * inline (risk breakdown, offer, repayment schedule, documents, history...)
 * now lives on its own page (LoanApplicationDetail.jsx). Cramming all of
 * that into an accordion inside a list meant a customer with more than one
 * or two applications had to scroll past everything else just to find one
 * thing; this card's only job is to be scannable, and to say clearly
 * whether it needs the customer's attention right now.
 */
export function ApplicationSummaryCard({ application }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const riskStyle = RISK_STYLES[application.risk?.label];
  const RiskIcon = riskStyle?.icon;
  const attention = getAttention(application);

  return (
    <button
      type="button"
      onClick={() => navigate(`/dashboard/applications/${application.application_id}`)}
      className="w-full flex items-center justify-between gap-4 p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:border-brand-primary/30 hover:shadow-md transition-all text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`p-2 rounded-xl shrink-0 ${
            riskStyle
              ? riskStyle.badge.replace("border-", "border ")
              : "bg-slate-50 text-slate-400 border border-slate-100"
          }`}
        >
          {RiskIcon ? (
            <RiskIcon className="w-5 h-5" />
          ) : (
            <FilePlus2 className="w-5 h-5" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">
            {application.product_name || t("customer.widgets.loanApplicationFallback")} · #
            {application.application_id}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {formatCurrency(application.requested_amount)} ·{" "}
            {application.tenure_months} mo · {formatDate(application.created_at)}
          </p>
          {attention && (
            <span
              className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                attention.type === "offer"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-sky-50 text-sky-700 border border-sky-200"
              }`}
            >
              {attention.type === "offer" ? (
                <FileSignature className="w-3 h-3" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              {t(
                attention.type === "offer"
                  ? "customer.widgets.chipOfferReady"
                  : "customer.widgets.chipResponseNeeded"
              )}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {application.risk?.category && (
          <span
            className={`hidden sm:inline-block px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border ${riskStyle?.badge}`}
          >
            {application.risk.category}
          </span>
        )}
        <span
          className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border ${
            STATUS_STYLES[application.status] ||
            "bg-slate-50 text-slate-600 border-slate-100"
          }`}
        >
          {formatStatus(application.status)}
        </span>
        <span className="hidden sm:flex items-center gap-1 text-xs font-semibold text-brand-primary">
          {t("customer.widgets.viewDetails")}
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
}

export function NotificationsPanel({ notifications, loading, error, limit }) {
  const { t } = useTranslation();
  const items = limit ? notifications.slice(0, limit) : notifications;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center space-x-2 mb-4">
        <Bell className="w-4 h-4 text-slate-400" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {t("customer.widgets.notifications")}
        </h3>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-xs">
          {t("customer.widgets.noNotifications")}
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-3 max-h-96 overflow-y-auto">
          {items.map((n) => (
            <li
              key={n.id}
              className={`p-3 rounded-xl border text-xs ${
                n.is_read
                  ? "bg-white border-slate-100"
                  : "bg-brand-primary/5 border-brand-primary/10"
              }`}
            >
              {n.title && (
                <p className="font-bold text-slate-800 mb-0.5">{n.title}</p>
              )}
              <p className="text-slate-600 leading-relaxed">{n.message}</p>
              <p className="text-[10px] text-slate-400 mt-1.5">
                {formatDate(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, accent }) {
  const ACCENTS = {
    slate: "bg-slate-50 text-slate-500",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
      <div className={`p-2.5 rounded-xl shrink-0 ${ACCENTS[accent] || ACCENTS.slate}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-slate-900 leading-none">{value}</p>
        <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-1">
          {label}
        </p>
      </div>
    </div>
  );
}

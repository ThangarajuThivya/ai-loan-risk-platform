import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Bell,
  Sparkles,
  Wallet,
  Percent,
  Loader2,
  AlertTriangle,
  FilePlus2,
} from "lucide-react";
import { RISK_STYLES, STATUS_STYLES, formatCurrency, formatPercent, formatDate } from "./dashboardFormat";

export function ApplicationCard({ application, expanded, onToggle }) {
  const { t } = useTranslation();
  const riskStyle = RISK_STYLES[application.risk?.label];
  const RiskIcon = riskStyle?.icon;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-slate-50/60 transition-colors"
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
            {application.status}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-slate-100"
          >
            <div className="p-5 space-y-5">
              {application.risk?.probabilities && (
                <div className="space-y-3">
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold tracking-wider">
                    {t("customer.widgets.riskProbabilities")}
                  </span>
                  {Object.entries(application.risk.probabilities).map(
                    ([label, prob]) => {
                      const idx =
                        label === "Low Risk" ? 0 : label === "Medium Risk" ? 1 : 2;
                      return (
                        <div key={label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-600">{label}</span>
                            <span className="font-mono font-semibold text-slate-800">
                              {formatPercent(prob)}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              style={{ width: `${Math.round(Number(prob || 0) * 100)}%` }}
                              className={`h-full ${RISK_STYLES[idx].bar}`}
                            />
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}

              {application.recommendation && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                      <Wallet className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-semibold tracking-wider">
                        {t("customer.widgets.recommendedAmount")}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-slate-800 font-mono">
                      {formatCurrency(application.recommendation.recommended_amount)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                      <Percent className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-semibold tracking-wider">
                        {t("customer.widgets.recommendedEmi")}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-slate-800 font-mono">
                      {formatCurrency(application.recommendation.recommended_emi)} {t("customer.widgets.perMonth")}
                    </span>
                  </div>
                </div>
              )}

              {application.purpose && (
                <div className="text-xs text-slate-500">
                  {t("customer.widgets.purposeLabel")}{" "}
                  <span className="font-semibold text-slate-700">
                    {application.purpose}
                  </span>
                </div>
              )}

              {application.explanation && (
                <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-4 flex items-start space-x-3">
                  <Sparkles className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wider">
                      {t("customer.widgets.aiExplanation")}
                    </h4>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      {application.explanation}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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

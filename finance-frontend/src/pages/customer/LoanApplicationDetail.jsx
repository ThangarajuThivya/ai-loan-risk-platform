import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Sparkles,
  Wallet,
  Percent,
  FileSignature,
  MessageCircleQuestion,
  History,
  FileDown,
  Undo2,
  Landmark,
  FileStack,
  CreditCard,
  FileText,
  Info,
  Table2,
  X,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import CreditPolicyPanel from "../../components/CreditPolicyPanel";
import AdverseActionPanel from "../../components/AdverseActionPanel";
import LoanDocumentPanel from "../../components/loans/LoanDocumentPanel";
import RepaymentPanel from "../../components/loans/RepaymentPanel";
import { creditPolicyLabels } from "./creditPolicyLabels";
import { adverseActionLabels } from "./adverseActionLabels";
import downloadFile from "../../utils/downloadFile";
import {
  RISK_STYLES,
  STATUS_STYLES,
  formatStatus,
  formatCurrency,
  formatPercent,
  formatDate,
  getAttention,
} from "./dashboardFormat";

function SectionCard({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 ${className}`}>
      {children}
    </div>
  );
}

function OverviewTab({ application, onDownloadLetter, downloadingLetter, onRespond }) {
  const { t } = useTranslation();
  const [responseText, setResponseText] = useState("");
  const [responding, setResponding] = useState(false);

  const canRespond = (application.allowed_transitions || []).includes("under_review");

  const submitResponse = async () => {
    if (responding || !responseText.trim()) return;
    setResponding(true);
    try {
      await onRespond(responseText.trim());
      setResponseText("");
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="space-y-4">
      {application.info_request && (
        <SectionCard className="bg-sky-50 border-sky-100">
          <div className="flex items-start gap-3">
            <MessageCircleQuestion className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-sky-700 uppercase tracking-wider">
                  {t("customer.widgets.infoRequestTitle")}
                </h4>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                  {application.info_request.note}
                </p>
              </div>
              {application.info_request.response ? (
                <div className="pt-3 border-t border-sky-100">
                  <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                    {t("customer.widgets.yourResponseLabel")}
                  </h4>
                  <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                    {application.info_request.response}
                  </p>
                </div>
              ) : (
                canRespond && (
                  <div className="pt-3 border-t border-sky-100 space-y-2">
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder={t("customer.widgets.responsePlaceholder")}
                      maxLength={1000}
                      rows={3}
                      className="w-full px-3 py-2 border border-sky-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-sky-400 resize-none"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={submitResponse}
                        disabled={responding || !responseText.trim()}
                        className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg disabled:opacity-50"
                      >
                        {responding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {t("customer.widgets.responseSubmit")}
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Independent panels auto-flow two-per-row on wide screens instead
          of stacking full-height one after another — the same technique
          used on the admin Risk Calculator — so a typical application
          (risk + recommendation + policy check) fits without scrolling
          instead of needing five separate full-width sections read down
          the page one at a time. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {application.risk?.probabilities && (
          <SectionCard>
            <span className="text-[10px] text-slate-400 block uppercase font-semibold tracking-wider mb-3">
              {t("customer.widgets.riskProbabilities")}
            </span>
            <div className="space-y-3">
              {Object.entries(application.risk.probabilities).map(([label, prob]) => {
                const idx = label === "Low Risk" ? 0 : label === "Medium Risk" ? 1 : 2;
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
              })}
            </div>
          </SectionCard>
        )}

        {(application.recommendation || application.pricing) && (
          <div className="space-y-4">
            {application.recommendation && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SectionCard>
                  <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                    <Wallet className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase font-semibold tracking-wider">
                      {t("customer.widgets.recommendedAmount")}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-slate-800 font-mono">
                    {formatCurrency(application.recommendation.recommended_amount)}
                  </span>
                </SectionCard>
                <SectionCard>
                  <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                    <Percent className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase font-semibold tracking-wider">
                      {t("customer.widgets.recommendedEmi")}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-slate-800 font-mono">
                    {formatCurrency(application.recommendation.recommended_emi)}{" "}
                    {t("customer.widgets.perMonth")}
                  </span>
                </SectionCard>
              </div>
            )}
            {application.pricing && (
              <SectionCard className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-slate-400">
                  <Percent className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase font-semibold tracking-wider">
                    {t("customer.pricing.rateLabel")}
                  </span>
                </div>
                <span className="text-sm font-bold text-slate-800 font-mono flex items-center gap-1.5">
                  {Number(application.pricing.interest_rate).toFixed(2)}%
                  {application.pricing.risk_based && application.pricing.tier && (
                    <span className="px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-[9px] font-bold uppercase tracking-wide text-slate-600">
                      {
                        {
                          preferential: t("customer.pricing.tierPreferential"),
                          standard: t("customer.pricing.tierStandard"),
                          premium: t("customer.pricing.tierPremium"),
                        }[application.pricing.tier]
                      }
                    </span>
                  )}
                </span>
              </SectionCard>
            )}
          </div>
        )}

        {application.purpose && (
          <SectionCard>
            <span className="text-xs text-slate-500">
              {t("customer.widgets.purposeLabel")}{" "}
              <span className="font-semibold text-slate-700">{application.purpose}</span>
            </span>
          </SectionCard>
        )}

        {application.decision && (
          <SectionCard className="text-xs text-slate-500 space-y-1">
            <p className="text-slate-400">
              {t("customer.widgets.decisionReviewedOn", {
                date: formatDate(application.decision.decided_at),
              })}
            </p>
            {application.decision.source === "system" && (
              <p className="text-slate-500 italic">{t("customer.widgets.decisionAutomated")}</p>
            )}
            {application.decision.note && (
              <p>
                <span className="font-semibold text-slate-700">
                  {t("customer.widgets.decisionNoteLabel")}
                </span>{" "}
                {application.decision.note}
              </p>
            )}
            <button
              type="button"
              onClick={onDownloadLetter}
              disabled={downloadingLetter}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:underline disabled:opacity-50 pt-1"
            >
              {downloadingLetter ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              {t("customer.widgets.downloadDecisionLetter")}
            </button>
          </SectionCard>
        )}

        <AdverseActionPanel
          adverseAction={application.adverse_action}
          labels={adverseActionLabels(t)}
        />

        <CreditPolicyPanel policy={application.policy} labels={creditPolicyLabels(t)} />
      </div>

      {application.explanation && (
        <SectionCard className="bg-brand-primary/5 border-brand-primary/10">
          <div className="flex items-start space-x-3">
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
        </SectionCard>
      )}
    </div>
  );
}

function OfferTab({ application, onAnswerOffer, offerActing }) {
  const { t } = useTranslation();
  const offer = application.offer;
  const canAnswerOffer =
    Boolean(offer?.is_actionable) &&
    (application.allowed_transitions || []).includes("accepted");

  return (
    <SectionCard className={canAnswerOffer ? "bg-emerald-50 border-emerald-200" : ""}>
      <div className="flex items-start gap-3">
        <FileSignature
          className={`w-5 h-5 shrink-0 mt-0.5 ${canAnswerOffer ? "text-emerald-600" : "text-slate-400"}`}
        />
        <div className="flex-1 min-w-0">
          <h4
            className={`text-xs font-bold uppercase tracking-wider ${
              canAnswerOffer ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {t("customer.widgets.offerTitle")}
            {offer.status !== "pending" && (
              <span className="ml-2 font-semibold normal-case text-slate-400">
                · {formatStatus(offer.status)}
              </span>
            )}
          </h4>

          <dl className="mt-3 grid grid-cols-2 gap-3">
            {[
              ["offerAmount", formatCurrency(offer.amount)],
              ["offerEmi", `${formatCurrency(offer.emi)} ${t("customer.widgets.perMonth")}`],
              [
                "offerTenure",
                t("customer.loanApplication.valueMonths", { count: offer.tenure_months }),
              ],
              [
                "offerRate",
                `${offer.interest_rate}% ${t(`customer.widgets.rateType_${offer.rate_type}`)}`,
              ],
              ["offerTotalRepayable", formatCurrency(offer.total_repayable)],
            ].map(([key, value]) => (
              <div key={key}>
                <dt className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                  {t(`customer.widgets.${key}`)}
                </dt>
                <dd className="text-sm font-bold text-slate-800 font-mono">{value}</dd>
              </div>
            ))}
          </dl>

          {Array.isArray(offer.fees) && offer.fees.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-1.5">
                {t("customer.widgets.offerFeesHeading")}
              </p>
              <p className="text-[10px] text-slate-400 mb-2">
                {t("customer.widgets.offerFeesHint")}
              </p>
              <ul className="space-y-1 text-xs">
                {offer.fees.map((fee) => (
                  <li key={fee.fee_type} className="flex justify-between gap-2">
                    <span className="text-slate-500">
                      {fee.label}
                      {fee.calc_method === "percentage" ? ` (${fee.rate_or_amount}%)` : ""}
                      {fee.waived && (
                        <span className="text-emerald-700 font-semibold">
                          {" "}
                          · {t("customer.widgets.offerFeeWaived")}
                        </span>
                      )}
                    </span>
                    <span
                      className={`font-mono shrink-0 ${fee.waived ? "line-through text-slate-400" : "text-slate-700"}`}
                    >
                      {formatCurrency(fee.amount)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between gap-2 mt-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-600">
                  {t("customer.widgets.offerNetDisbursed")}
                </span>
                <span className="text-sm font-bold font-mono text-emerald-700">
                  {formatCurrency(offer.net_disbursed)}
                </span>
              </div>
              {offer.effective_apr != null && (
                <div className="flex justify-between gap-2 mt-1">
                  <span className="text-[11px] text-slate-500">
                    {t("customer.widgets.offerEffectiveApr")}
                  </span>
                  <span className="text-[11px] font-bold font-mono text-slate-700">
                    {offer.effective_apr}%
                  </span>
                </div>
              )}
            </div>
          )}

          {offer.note && <p className="text-xs text-slate-600 mt-3 italic">"{offer.note}"</p>}

          {canAnswerOffer ? (
            <>
              <p className="text-[11px] text-slate-500 mt-3">
                {t("customer.widgets.offerExpiresOn", { date: formatDate(offer.expires_at) })}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => onAnswerOffer("accept")}
                  disabled={Boolean(offerActing)}
                  className="px-4 py-2 flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
                >
                  {offerActing === "accept" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("customer.widgets.offerAccept")}
                </button>
                <button
                  type="button"
                  onClick={() => onAnswerOffer("decline")}
                  disabled={Boolean(offerActing)}
                  className="px-4 py-2 flex items-center gap-1.5 text-xs font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg disabled:opacity-50"
                >
                  {offerActing === "decline" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("customer.widgets.offerDecline")}
                </button>
              </div>
            </>
          ) : (
            offer.status === "expired" && (
              <p className="text-[11px] text-slate-500 mt-3">
                {t("customer.widgets.offerExpiredHint")}
              </p>
            )
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function RepaymentTab({ application, onDownloadStatement, downloadingStatement }) {
  const { t } = useTranslation();
  const account = application.account;
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loanPosition, setLoanPosition] = useState(null);
  // The full installment-by-installment table used to always render inline —
  // fine for a 12-month loan, unusable for a 60-month one, since every row
  // rendered regardless of tenure. It now opens in a modal on demand instead,
  // with only the next unpaid installment surfaced by default.
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/loans/${application.application_id}/schedule`);
        if (cancelled) return;
        setSchedule(res.data?.schedule || []);
        setLoanPosition({
          outstanding: res.data?.outstanding,
          arrears: res.data?.arrears,
          settlement: res.data?.settlement,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.widgets.scheduleLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [application.application_id, t]);

  const nextInstallment = useMemo(
    () => (schedule || []).find((row) => row.status !== "paid") || null,
    [schedule]
  );

  return (
    <div className="space-y-4">
      <SectionCard className="bg-emerald-50 border-emerald-200">
        <div className="flex items-start space-x-3">
          <Landmark className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
              {t("customer.widgets.accountTitle")}
              <span className="ml-2 font-mono normal-case text-slate-500">{account.account_no}</span>
            </h4>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {[
                ["accountPrincipal", formatCurrency(account.principal)],
                ["offerEmi", `${formatCurrency(account.emi)} ${t("customer.widgets.perMonth")}`],
                ["accountFirstDue", formatDate(account.first_due_date)],
                ["accountMaturity", formatDate(account.maturity_date)],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                    {t(`customer.widgets.${key}`)}
                  </dt>
                  <dd className="text-sm font-bold text-slate-800 font-mono">{value}</dd>
                </div>
              ))}
            </dl>
            {account.status !== "active" && (
              <p className="text-[11px] text-slate-500 mt-3">
                {t("customer.widgets.accountClosedOn", { date: formatDate(account.closed_at) })}
              </p>
            )}
            <button
              type="button"
              onClick={onDownloadStatement}
              disabled={downloadingStatement}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors disabled:opacity-50"
            >
              {downloadingStatement ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              {t("customer.widgets.downloadStatement")}
            </button>
          </div>
        </div>
      </SectionCard>

      {loading && (
        <SectionCard className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </SectionCard>
      )}

      {!loading && error && (
        <SectionCard>
          <p className="text-xs text-rose-600">{error}</p>
        </SectionCard>
      )}

      {!loading && !error && loanPosition && (
        <SectionCard className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                {t("customer.widgets.outstandingLabel")}
              </span>
              <span className="text-sm font-bold text-slate-800 font-mono">
                {formatCurrency(loanPosition.outstanding?.total)}
              </span>
            </div>
            {loanPosition.settlement && (
              <div>
                <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                  {t("customer.widgets.settleTodayLabel")}
                </span>
                <span className="text-sm font-bold text-slate-800 font-mono">
                  {formatCurrency(loanPosition.settlement.total)}
                </span>
              </div>
            )}
          </div>
          {loanPosition.arrears?.isInArrears && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-rose-700">
                {t("customer.widgets.arrearsWarning", {
                  amount: formatCurrency(loanPosition.arrears.arrearsAmount),
                  days: loanPosition.arrears.daysPastDue,
                })}
              </p>
            </div>
          )}
          {!loanPosition.arrears?.isInArrears && loanPosition.arrears?.nextDueDate && (
            <p className="text-[11px] text-slate-500">
              {t("customer.widgets.nextDueHint", {
                amount: formatCurrency(loanPosition.arrears.nextDueAmount),
                date: formatDate(loanPosition.arrears.nextDueDate),
              })}
            </p>
          )}
        </SectionCard>
      )}

      {!loading && !error && schedule && schedule.length > 0 && (
        <SectionCard className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            {nextInstallment ? (
              <>
                <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block mb-1">
                  {t("customer.repayment.nextInstallmentLabel", { no: nextInstallment.installment_no })}
                </span>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-base font-bold font-mono text-slate-800">
                    {formatCurrency(
                      Number(nextInstallment.principal_component) +
                        Number(nextInstallment.interest_component)
                    )}
                  </span>
                  <span className="text-xs text-slate-400">
                    {t("customer.repayment.dueOn", { date: formatDate(nextInstallment.due_date) })}
                  </span>
                </div>
              </>
            ) : (
              <span className="text-sm font-bold text-emerald-700">
                {t("customer.repayment.nothingOwed")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowSchedule(true)}
            className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-brand-primary hover:underline"
          >
            <Table2 className="w-3.5 h-3.5" />
            {t("customer.widgets.viewSchedule")}
          </button>
        </SectionCard>
      )}

      {!loading && !error && (
        <RepaymentPanel applicationId={application.application_id} />
      )}

      {/* Full schedule — every installment for the loan's whole tenure,
          which for a 60-month loan is 60 rows nobody needs to see just to
          check their next due date. Moved into a modal with its own bounded,
          internally-scrolling body instead of always rendering inline, so
          the tab itself never grows past one screen because of it. */}
      <AnimatePresence>
        {showSchedule && (
          <motion.div
            key="schedule-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowSchedule(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                  <Table2 className="w-4.5 h-4.5 text-brand-primary" />
                  {t("customer.widgets.scheduleModalTitle")}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowSchedule(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 py-5 overflow-y-auto overflow-x-auto">
                <table className="w-full text-[11px] min-w-[480px]">
                  <thead>
                    <tr className="text-slate-400 uppercase text-[9px] tracking-wider">
                      <th className="text-left font-semibold px-1 py-1">{t("customer.widgets.scheduleNo")}</th>
                      <th className="text-left font-semibold px-1 py-1">{t("customer.widgets.scheduleDueDate")}</th>
                      <th className="text-right font-semibold px-1 py-1">{t("customer.widgets.schedulePrincipal")}</th>
                      <th className="text-right font-semibold px-1 py-1">{t("customer.widgets.scheduleInterest")}</th>
                      <th className="text-right font-semibold px-1 py-1">{t("customer.widgets.scheduleBalance")}</th>
                      <th className="text-right font-semibold px-1 py-1">{t("customer.widgets.scheduleLateFee")}</th>
                      <th className="text-right font-semibold px-1 py-1">{t("customer.widgets.scheduleStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((row) => (
                      <tr key={row.installment_no} className="border-t border-slate-100 font-mono text-slate-700">
                        <td className="px-1 py-1">{row.installment_no}</td>
                        <td className="px-1 py-1 whitespace-nowrap">{formatDate(row.due_date)}</td>
                        <td className="px-1 py-1 text-right">{formatCurrency(row.principal_component)}</td>
                        <td className="px-1 py-1 text-right">{formatCurrency(row.interest_component)}</td>
                        <td className="px-1 py-1 text-right">{formatCurrency(row.closing_balance)}</td>
                        <td className="px-1 py-1 text-right">
                          {row.late_fee_amount - row.late_fee_paid - row.late_fee_waived > 0 ? (
                            <span className="text-rose-600 font-bold">
                              {formatCurrency(row.late_fee_amount - row.late_fee_paid - row.late_fee_waived)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-1 py-1 text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase ${
                              row.status === "paid"
                                ? "bg-emerald-100 text-emerald-700"
                                : row.status === "partial"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {t(`customer.widgets.installment_${row.status}`)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSchedule(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  {t("common.close")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryTab({ applicationId }) {
  const { t } = useTranslation();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/loans/${applicationId}/history`);
        if (!cancelled) setHistory(res.data?.events || []);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.widgets.historyLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, t]);

  return (
    <SectionCard>
      {loading && (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}
      {!loading && error && <p className="text-xs text-rose-600">{error}</p>}
      {!loading && !error && history && (
        <ol className="space-y-3">
          {history.map((ev) => (
            <li key={ev.id} className="flex gap-2.5 text-xs">
              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300" />
              <div className="min-w-0">
                <p className="text-slate-700 font-semibold">{formatStatus(ev.to_status)}</p>
                <p className="text-slate-400">{formatDate(ev.created_at)}</p>
                {ev.note && <p className="text-slate-600 mt-0.5 italic">"{ev.note}"</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

export default function LoanApplicationDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  const [downloadingLetter, setDownloadingLetter] = useState(false);
  const [downloadingStatement, setDownloadingStatement] = useState(false);
  const [offerActing, setOfferActing] = useState("");
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [docCount, setDocCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/loans/${id}`);
        if (cancelled) return;
        setApplication(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.applicationDetail.loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const attention = useMemo(
    () => (application ? getAttention(application) : null),
    [application]
  );

  const tabs = useMemo(() => {
    if (!application) return [];
    const list = [{ id: "overview", labelKey: "customer.applicationDetail.tabOverview", icon: Info }];
    if (application.offer) {
      list.push({ id: "offer", labelKey: "customer.applicationDetail.tabOffer", icon: FileSignature });
    }
    if (application.account) {
      list.push({ id: "repayment", labelKey: "customer.applicationDetail.tabRepayment", icon: CreditCard });
    }
    list.push({
      id: "documents",
      labelKey: "customer.applicationDetail.tabDocuments",
      icon: FileText,
      count: docCount,
    });
    list.push({ id: "history", labelKey: "customer.applicationDetail.tabHistory", icon: History });
    return list;
  }, [application, docCount]);

  const handleDownloadLetter = async () => {
    if (downloadingLetter) return;
    setDownloadingLetter(true);
    try {
      await downloadFile(
        `/loans/${id}/decision-letter`,
        `decision-letter-app-${id}.pdf`
      );
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.widgets.decisionLetterFailedTitle"),
        message: err.response?.data?.message || t("customer.widgets.decisionLetterFailedDefault"),
      });
    } finally {
      setDownloadingLetter(false);
    }
  };

  const handleDownloadStatement = async () => {
    if (downloadingStatement) return;
    setDownloadingStatement(true);
    try {
      await downloadFile(`/loans/${id}/statement.csv`, `loan-statement-app-${id}.csv`);
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.widgets.statementFailedTitle"),
        message: err.response?.data?.message || t("customer.widgets.statementFailedDefault"),
      });
    } finally {
      setDownloadingStatement(false);
    }
  };

  const handleAnswerOffer = async (decision) => {
    if (offerActing) return;
    setOfferActing(decision);
    try {
      const res = await api.patch(`/loans/${id}/offer/${decision}`, {});
      setApplication(res.data);
      const account = res.data?.disbursement_account;
      showToast({
        type: "success",
        title: t(`customer.widgets.offer${decision === "accept" ? "Accepted" : "Declined"}Title`),
        message:
          decision === "accept" && account?.account_number
            ? t(
                account.opened
                  ? "customer.widgets.offerAcceptedAccountOpened"
                  : "customer.widgets.offerAcceptedAccountReused",
                { id, account: account.account_number, branch: account.branch }
              )
            : t(`customer.widgets.offer${decision === "accept" ? "Accepted" : "Declined"}Message`, { id }),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.widgets.offerActionFailedTitle"),
        message: err.response?.data?.message || t("customer.widgets.offerActionFailedDefault"),
      });
    } finally {
      setOfferActing("");
    }
  };

  const handleRespond = async (note) => {
    try {
      const res = await api.patch(`/loans/${id}/respond`, { note });
      setApplication(res.data);
      showToast({
        type: "success",
        title: t("customer.widgets.responseSentToastTitle"),
        message: t("customer.widgets.responseSentToastMessage", { id }),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.widgets.responseFailedTitle"),
        message: err.response?.data?.message || t("customer.widgets.responseFailedDefault"),
      });
      throw err;
    }
  };

  const submitWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      const res = await api.patch(`/loans/${id}/withdraw`, {
        note: withdrawNote.trim() || undefined,
      });
      setApplication(res.data);
      setConfirmingWithdraw(false);
      setWithdrawNote("");
      showToast({
        type: "success",
        title: t("customer.widgets.withdrawnToastTitle"),
        message: t("customer.widgets.withdrawnToastMessage", { id }),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.widgets.withdrawFailedTitle"),
        message: err.response?.data?.message || t("customer.widgets.withdrawFailedDefault"),
      });
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
        <div className="max-w-6xl mx-auto">
          <Link
            to="/dashboard/applications"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-primary mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("customer.applicationDetail.backToApplications")}
          </Link>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error || t("customer.applicationDetail.notFound")}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const riskStyle = RISK_STYLES[application.risk?.label];
  const RiskIcon = riskStyle?.icon;
  const canWithdraw = (application.allowed_transitions || []).includes("withdrawn");

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-6xl mx-auto">
        <Link
          to="/dashboard/applications"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-primary mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("customer.applicationDetail.backToApplications")}
        </Link>

        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`p-2.5 rounded-xl shrink-0 ${
                  riskStyle
                    ? riskStyle.badge.replace("border-", "border ")
                    : "bg-slate-50 text-slate-400 border border-slate-100"
                }`}
              >
                {RiskIcon ? <RiskIcon className="w-5 h-5" /> : <FileStack className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">
                  {application.product_name || t("customer.widgets.loanApplicationFallback")} · #
                  {application.application_id}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatCurrency(application.requested_amount)} · {application.tenure_months} mo ·{" "}
                  {t("customer.applicationDetail.appliedOn", {
                    date: formatDate(application.created_at),
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {application.risk?.category && (
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border ${riskStyle?.badge}`}
                >
                  {application.risk.category}
                </span>
              )}
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border ${
                  STATUS_STYLES[application.status] || "bg-slate-50 text-slate-600 border-slate-100"
                }`}
              >
                {formatStatus(application.status)}
              </span>
            </div>
          </div>

          {canWithdraw && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              {!confirmingWithdraw ? (
                <button
                  type="button"
                  onClick={() => setConfirmingWithdraw(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  {t("customer.widgets.withdrawAction")}
                </button>
              ) : (
                <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-rose-700">
                    {t("customer.widgets.withdrawConfirmPrompt")}
                  </p>
                  <textarea
                    value={withdrawNote}
                    onChange={(e) => setWithdrawNote(e.target.value)}
                    placeholder={t("customer.widgets.withdrawNotePlaceholder")}
                    maxLength={500}
                    rows={2}
                    className="w-full px-3 py-2 border border-rose-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-rose-400 resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingWithdraw(false);
                        setWithdrawNote("");
                      }}
                      disabled={withdrawing}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white rounded-lg disabled:opacity-50"
                    >
                      {t("customer.widgets.withdrawCancel")}
                    </button>
                    <button
                      type="button"
                      onClick={submitWithdraw}
                      disabled={withdrawing}
                      className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50"
                    >
                      {withdrawing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {t("customer.widgets.withdrawConfirm")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Attention banner — the single most important thing to surface,
            so a customer never has to hunt across tabs to find out
            something needs them. */}
        {attention && (
          <button
            type="button"
            onClick={() => setActiveTab(attention.type === "offer" ? "offer" : "overview")}
            className="w-full flex items-center justify-between gap-3 bg-brand-primary text-white rounded-2xl p-4 mb-4 text-left hover:bg-brand-primary/95 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              {attention.type === "offer" ? (
                <FileSignature className="w-5 h-5 shrink-0" />
              ) : (
                <Sparkles className="w-5 h-5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {t(
                    attention.type === "offer"
                      ? "customer.applicationDetail.attentionOfferTitle"
                      : "customer.applicationDetail.attentionInfoTitle"
                  )}
                </p>
                <p className="text-xs text-white/80 truncate">
                  {t(
                    attention.type === "offer"
                      ? "customer.applicationDetail.attentionOfferBody"
                      : "customer.applicationDetail.attentionInfoBody"
                  )}
                </p>
              </div>
            </div>
            <span className="text-xs font-bold whitespace-nowrap">
              {t("customer.applicationDetail.attentionCta")}
            </span>
          </button>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-1.5">
          {tabs.map(({ id: tabId, labelKey, icon: Icon, count }) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                activeTab === tabId
                  ? "bg-brand-primary text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t(labelKey)}
              {typeof count === "number" && count > 0 && (
                <span
                  className={`ml-0.5 px-1.5 rounded-full text-[10px] ${
                    activeTab === tabId ? "bg-white/20" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <OverviewTab
            application={application}
            onDownloadLetter={handleDownloadLetter}
            downloadingLetter={downloadingLetter}
            onRespond={handleRespond}
          />
        )}
        {activeTab === "offer" && application.offer && (
          <OfferTab
            application={application}
            onAnswerOffer={handleAnswerOffer}
            offerActing={offerActing}
          />
        )}
        {activeTab === "repayment" && application.account && (
          <RepaymentTab
            application={application}
            onDownloadStatement={handleDownloadStatement}
            downloadingStatement={downloadingStatement}
          />
        )}
        {activeTab === "documents" && (
          <SectionCard>
            <LoanDocumentPanel
              applicationId={application.application_id}
              canUpload={!["rejected", "withdrawn", "closed"].includes(application.status)}
              onCountChange={setDocCount}
            />
          </SectionCard>
        )}
        {activeTab === "history" && <HistoryTab applicationId={application.application_id} />}
      </div>
    </div>
  );
}

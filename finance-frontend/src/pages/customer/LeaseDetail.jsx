import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import {
  Car,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  FileSignature,
  FileDown,
  CheckCircle2,
  Wallet,
  KeyRound,
  CalendarClock,
  X,
  Info,
  FileText,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import LeaseDocumentPanel from "../../components/leasing/LeaseDocumentPanel";
import LeaseRentalPanel from "../../components/leasing/LeaseRentalPanel";
import LeaseProgressTracker from "../../components/leasing/LeaseProgressTracker";
import LeaseNextAction from "../../components/leasing/LeaseNextAction";
import { LeaseTiles, RailRow, HistoryEntry } from "../../components/leasing/LeaseDashboardParts";
import { deriveNextAction } from "../../components/leasing/leaseProgress";
import downloadFile from "../../utils/downloadFile";

/**
 * One lease application, from the lessee's side — and the place they accept
 * or decline a quotation.
 *
 * Accepting is the act that makes the terms binding, so the page leads with
 * what it will cost rather than with status chrome: the rental, what is
 * payable at signing, and the total. The ownership consequence is stated
 * plainly next to the button, because that is the part of a finance lease
 * people most often misunderstand.
 */

const STATUS_STYLES = {
  pending: "bg-slate-50 text-slate-600 border-slate-200",
  under_review: "bg-sky-50 text-sky-700 border-sky-200",
  info_requested: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  quoted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  declined: "bg-slate-100 text-slate-500 border-slate-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  withdrawn: "bg-slate-100 text-slate-500 border-slate-200",
};

// Resolved via customer.leaseApplication's condition keys — same source
// MyLeases.jsx uses, so the three vehicle-condition labels are translated
// and spelled identically everywhere they appear.
const CONDITION_KEYS = {
  brand_new: "conditionBrandNew",
  reconditioned: "conditionReconditioned",
  used: "conditionUsed",
};

const lkr = (v) =>
  v === null || v === undefined
    ? "—"
    : `LKR ${Number(v).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" }) : "—";
const humanize = (s) => String(s || "").replace(/_/g, " ");

export default function LeaseDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [application, setApplication] = useState(null);
  const [quotations, setQuotations] = useState([]);
  const [valuations, setValuations] = useState([]);
  const [downPayment, setDownPayment] = useState(null);
  const [purchase, setPurchase] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [showSchedule, setShowSchedule] = useState(false);
  // Reported up by the document panel, so the page can prompt for evidence
  // before an officer has to ask for it. null = not counted yet, which is
  // NOT the same as zero — showing "no documents" while the list is still
  // loading would nag someone who has already uploaded.
  const [docCount, setDocCount] = useState(null);
  // Bumped once a returning rental payment has settled, so the panel
  // re-reads the new balance without needing to know anything about
  // redirects or query strings.
  const [rentalRefreshKey, setRentalRefreshKey] = useState(0);
  // null until the customer picks a tab themselves. While it is null the
  // page follows the derived live stage, so a lease that moves on between
  // visits opens where the work is — but the moment someone navigates, their
  // choice sticks and the page stops second-guessing them.
  const [tab, setTab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");

  const load = useCallback(async () => {
    const [a, q, v, d, pu, ag] = await Promise.all([
      api.get(`/leases/${id}`),
      api.get(`/leases/${id}/quotations`),
      api.get(`/leases/${id}/valuations`).catch(() => ({ data: { valuations: [] } })),
      api.get(`/leases/${id}/down-payment`).catch(() => ({ data: null })),
      api.get(`/leases/${id}/purchase`).catch(() => ({ data: null })),
      api.get(`/leases/${id}/agreement`).catch(() => ({ data: null })),
    ]);
    setApplication(a.data);
    setQuotations(q.data?.quotations || []);
    setValuations(v.data?.valuations || []);
    setDownPayment(d.data);
    setPurchase(pu.data);
    setAgreement(ag.data?.agreement ? ag.data : null);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Returning from the gateway. Hitting the status endpoint makes the
        // server ask the gateway directly whether the session was paid and
        // settle it if so — belt and braces for a webhook that is slow, or
        // was never configured. It goes through the same exactly-once gate,
        // so if the webhook already landed this is a no-op.
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get("session_id");
        if (sessionId && params.get("payment") === "success") {
          // The gateway's return URL carries no hint of WHICH payment this
          // was, so both reconcilers are offered the session and the one it
          // does not belong to answers 404. Cheaper and less fragile than
          // threading a second parameter through the redirect, and each is
          // idempotent behind its own exactly-once gate.
          const encoded = encodeURIComponent(sessionId);
          await Promise.all([
            api.get(`/leases/${id}/down-payment/status?session_id=${encoded}`).catch(() => null),
            api.get(`/leases/${id}/rentals/status?session_id=${encoded}`).catch(() => null),
          ]);
          setRentalRefreshKey((k) => k + 1);
          // Drop the query string so a refresh does not look like a fresh
          // return from the gateway.
          window.history.replaceState({}, "", `/dashboard/leases/${id}`);
        }
        await load();
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || t("customer.leasing.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, id, t]);

  const live = quotations.find((q) => q.status === "pending");
  const accepted = quotations.find((q) => q.status === "accepted");
  const shown = accepted || live;

  const feeTotal = (shown?.fees || []).reduce(
    (sum, f) => sum + (f.waived ? 0 : Number(f.amount) || 0),
    0
  );
  const upfront = shown ? Number(shown.down_payment_amount) + feeTotal : 0;

  const answer = async (decision) => {
    setActing(decision);
    try {
      await api.patch(`/leases/${id}/quotations/${live.id}`, { decision });
      await load();
      showToast({
        type: "success",
        title:
          decision === "accept"
            ? t("customer.leasing.quotationAcceptedToastTitle")
            : t("customer.leasing.quotationDeclinedToastTitle"),
        message:
          decision === "accept"
            ? t("customer.leasing.quotationAcceptedToastMsg")
            : t("customer.leasing.quotationDeclinedToastMsg"),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.leasing.couldNotRecordResponseTitle"),
        message: err.response?.data?.message || t("customer.leasing.tryAgain"),
      });
    } finally {
      setActing("");
    }
  };

  const payNow = async () => {
    setActing("pay");
    try {
      const res = await api.post(`/leases/${id}/down-payment/checkout`);
      // Hand off to the gateway's hosted page. No card data ever passes
      // through this app.
      window.location.assign(res.data.checkout_url);
    } catch (err) {
      setActing("");
      showToast({
        type: "error",
        title: t("customer.leasing.couldNotStartPaymentTitle"),
        message: err.response?.data?.message || t("customer.leasing.tryAgainShortly"),
      });
    }
  };

  // These PDFs sit behind verifyToken, and the app authenticates with a
  // bearer token held in memory — never a cookie. A plain <a href> straight
  // at the API sends no Authorization header at all, so the request 401s
  // and the "download" opens a near-blank tab holding a two-line JSON error.
  // downloadFile() re-fetches it as an authenticated blob instead, the same
  // way the loan side's decision letter already does — see its own header
  // comment. `acting` doubles as the busy flag so the link visibly does
  // something while the PDF is generated, rather than sitting inert.
  const downloadPdf = async (key, path, filename) => {
    if (acting) return;
    setActing(key);
    try {
      await downloadFile(path, filename);
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.leasing.couldNotDownloadTitle"),
        message: err.response?.data?.message || t("customer.leasing.tryAgainShortly"),
      });
    } finally {
      setActing("");
    }
  };

  if (loading) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error || !application) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
        <div className="max-w-3xl mx-auto flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error || t("customer.leasing.notFound")}</span>
        </div>
      </div>
    );
  }


  // Which single stage gets the full-size panel. Everything else that has
  // already happened collapses into the history accordion below it — a
  // quotation card mattered enormously for one day and is a receipt for the
  // next five years, so it should not go on occupying the top of the page.
  // Which of the five tabs the lease is actually LIVE at. deriveNextAction
  // already knows which surface holds the controls; this only collapses its
  // finer-grained answer onto the tabs a customer is offered — the down
  // payment and the rentals share one "Payments" tab because they are both
  // "money I owe on this lease" and are never live at the same time.
  const nextAction = deriveNextAction({
    application,
    quotations,
    downPayment,
    purchase,
    agreement,
    valuationCompleted: valuations.some((v) => v.status === "completed"),
  });

  const hasQuotation = Boolean(shown);
  const hasPayments = (downPayment && downPayment.dueTotal !== undefined) || Boolean(agreement?.agreement);

  const ACTION_TAB = {
    quotation: "quotation",
    money: "payments",
    rentals: "payments",
    // Buying the vehicle and getting the CR is something WE do; for the
    // lessee it is status, not a surface to act on, so it lives in Overview.
    title: "overview",
    documents: "documents",
    valuation: "overview",
    decision: "overview",
    overview: "overview",
  };

  // Mirrors the loan page's shape exactly — Overview / Offer / Repayment /
  // Documents / History becomes Overview / Quotation / Payments / Documents
  // / History — so a customer who has used both products learns ONE
  // navigation model rather than two.
  const tabs = [
    { id: "overview", label: t("customer.leaseTabs.overview"), icon: Info },
    hasQuotation && {
      id: "quotation",
      label: t("customer.leaseTabs.quotation"),
      icon: FileSignature,
    },
    hasPayments && { id: "payments", label: t("customer.leaseTabs.payments"), icon: Wallet },
    {
      id: "documents",
      label: t("customer.leaseTabs.documents"),
      icon: FileText,
      count: docCount ?? undefined,
    },
    application.events?.length > 0 && {
      id: "history",
      label: t("customer.leaseTabs.history"),
      icon: CalendarClock,
    },
  ].filter(Boolean);

  // Land on the live stage. Falls back to Overview if that tab does not
  // exist yet — a quotation tab cannot be opened before one is issued.
  const desiredTab = ACTION_TAB[nextAction.tab] || "overview";
  const resolvedTab = tabs.some((x) => x.id === desiredTab) ? desiredTab : "overview";
  const activeTab = tabs.some((x) => x.id === tab) ? tab : resolvedTab;

  const quotationCard = (
    <>
          {/* The quotation */}
          {shown ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <FileSignature className="w-3.5 h-3.5" /> {t("customer.leasing.quotationHeading")}
                </h2>
                {live && (
                  <span className="text-[11px] text-slate-400">
                    {t("customer.leasing.validUntil", { date: fmtDate(live.expires_at) })}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  [t("customer.leaseDash.monthlyRental"), lkr(shown.monthly_rental)],
                  [
                    t("customer.leaseDash.downPaymentLabel"),
                    `${lkr(shown.down_payment_amount)} (${shown.down_payment_percent}%)`,
                  ],
                  [t("customer.leaseDash.term"), t("customer.leaseDash.termMonthsValue", { term: shown.term_months })],
                  [t("customer.leaseDash.rate"), `${Number(shown.interest_rate).toFixed(2)}% ${shown.rate_type}`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{k}</p>
                    <p className="font-mono font-bold text-slate-800">{v}</p>
                  </div>
                ))}
              </div>

              {shown.fees?.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">
                    {t("customer.leasing.feesHeading")}
                  </p>
                  <ul className="space-y-1 text-xs">
                    {shown.fees.map((f) => (
                      <li key={f.fee_type} className="flex justify-between gap-2">
                        <span className="text-slate-500">
                          {f.label}
                          {/* Boolean(): `waived` arrives from MySQL as the
                              TINYINT 0, and `{0 && <jsx/>}` renders a literal
                              "0" — every fee read "Documentation Fee0". */}
                          {Boolean(f.waived) && (
                            <span className="text-emerald-700 font-semibold">
                              {" "}
                              · {t("customer.leasing.waivedTag")}
                            </span>
                          )}
                        </span>
                        <span
                          className={`font-mono shrink-0 ${
                            f.waived ? "line-through text-slate-400" : "text-slate-700"
                          }`}
                        >
                          {lkr(f.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The figure that actually matters to someone deciding. */}
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-xs font-bold text-slate-600">{t("customer.leasing.payableAtSigning")}</span>
                  <span className="text-base font-bold font-mono text-slate-900">{lkr(upfront)}</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {t("customer.leasing.payableAtSigningSummary", {
                    amount: lkr(shown.down_payment_amount),
                    feesClause:
                      feeTotal > 0
                        ? t("customer.leasing.feesClauseSuffix", { amount: lkr(feeTotal) })
                        : "",
                    rental: lkr(shown.monthly_rental),
                    term: shown.term_months,
                  })}
                </p>
              </div>

              <div className="flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-[11px] text-slate-500">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                {t("customer.leasing.ownershipNote")}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    downloadPdf(
                      "agreement-pdf",
                      `/leases/${application.id}/agreement.pdf`,
                      `lease-agreement-${application.id}.pdf`
                    )
                  }
                  disabled={Boolean(acting) && acting !== "agreement-pdf"}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:border-brand-primary hover:text-brand-primary transition-colors disabled:opacity-50"
                >
                  {acting === "agreement-pdf" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  {t("customer.leasing.readFullTerms")}
                </button>

                {live && (
                  <>
                    <button
                      type="button"
                      onClick={() => answer("accept")}
                      disabled={Boolean(acting)}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {acting === "accept" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      {t("customer.leasing.acceptTerms")}
                    </button>
                    <button
                      type="button"
                      onClick={() => answer("decline")}
                      disabled={Boolean(acting)}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {t("customer.leasing.decline")}
                    </button>
                  </>
                )}
              </div>

              {accepted && (
                <p className="text-[11px] text-emerald-700 font-semibold">
                  {t("customer.leasing.acceptedOn", { date: fmtDate(accepted.responded_at) })}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
              <FileSignature className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              {/* An APPROVED application with no quotation is the one case the
                  generic "once it's been reviewed" line gets wrong — it has
                  been reviewed, and saying otherwise reads as though nothing
                  is happening. Approval is not the last gate: terms are quoted
                  next, and only an accepted quotation opens payment. */}
              <p className="text-sm font-bold text-slate-700">
                {application.status === "approved"
                  ? t("customer.leasing.approvedAwaitingQuotationTitle")
                  : t("customer.leasing.noQuotationTitle")}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {application.status === "approved"
                  ? t("customer.leasing.approvedAwaitingQuotationHint")
                  : t("customer.leasing.noQuotationHint")}
              </p>
            </div>
          )}
    </>
  );

  const downPaymentCard = (
    <>
          {/* Payable at signing (L5) — only once terms are agreed. */}
          {downPayment && downPayment.dueTotal !== undefined && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" /> {t("customer.leasing.payableAtSigning")}
              </h2>

              <div className="grid grid-cols-3 gap-4">
                {[
                  [t("customer.leaseDash.totalDue"), lkr(downPayment.dueTotal)],
                  [t("customer.leaseDash.received"), lkr(downPayment.received)],
                  [t("customer.leaseDash.outstanding"), lkr(downPayment.outstanding)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{k}</p>
                    <p className="font-mono font-bold text-slate-800">{v}</p>
                  </div>
                ))}
              </div>

              {downPayment.settled ? (
                <p className="flex items-start gap-2 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {t("customer.leasing.downPaymentPaidInFull")}
                </p>
              ) : (
                <>
                  <p className="text-[11px] text-slate-500">{t("customer.leasing.downPaymentPayHint")}</p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={payNow}
                      disabled={Boolean(acting) || !downPayment.gateway_available}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50"
                    >
                      {acting === "pay" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wallet className="w-3.5 h-3.5" />
                      )}
                      {t("customer.leasing.payByCard", { amount: lkr(downPayment.outstanding) })}
                    </button>
                  </div>
                  {!downPayment.gateway_available && (
                    <p className="text-[11px] text-amber-800">{t("customer.leasing.gatewayUnavailable")}</p>
                  )}
                </>
              )}

              {downPayment.receipts?.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">
                    {t("customer.leasing.receiptsHeading")}
                  </p>
                  <ul className="space-y-1 text-[11px]">
                    {downPayment.receipts.map((r) => (
                      <li key={r.id} className="flex justify-between gap-2">
                        <span className="text-slate-500">
                          {fmtDate(r.paid_on)} · {humanize(r.method)}
                          {r.reference_no ? ` · ${r.reference_no}` : ""}
                        </span>
                        <span className="font-mono text-slate-700 shrink-0">{lkr(r.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
    </>
  );

  const purchaseCard = (
    <>
          {/* Where the purchase has got to (L6). Only meaningful once the
              lessee has committed — before that the answer is just "we're
              still deciding", which the status badge already says. */}
          {purchase && application.status === "accepted" && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-3">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> {t("customer.leasing.yourVehicle")}
              </h2>
              <p className="text-sm text-slate-700">{purchase.nextStep?.label}</p>

              {purchase.payout && (
                <p className="text-[11px] text-slate-500">
                  {t("customer.leasing.purchasedOn", { date: fmtDate(purchase.payout.paid_on) })}
                </p>
              )}

              {purchase.registration?.status === "registered" && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-800 space-y-0.5">
                  <p className="font-semibold">
                    {t("customer.leasing.registeredWithCr", { number: purchase.registration.cr_number })}
                  </p>
                  <p>
                    {t("customer.leasing.absoluteOwnerNote", {
                      owner: purchase.registration.absolute_owner,
                    })}
                  </p>
                </div>
              )}
            </div>
          )}
    </>
  );

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <Link
          to="/dashboard/leases"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-primary"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("customer.leasing.backToLeases")}
        </Link>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <Car className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display font-bold text-lg text-slate-900 truncate">
                {application.make} {application.model} {application.year_of_manufacture}
              </h1>
              <p className="text-xs text-slate-400">
                #{application.id} ·{" "}
                {CONDITION_KEYS[application.condition_type]
                  ? t(`customer.leaseApplication.${CONDITION_KEYS[application.condition_type]}`)
                  : application.condition_type}
              </p>
            </div>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border shrink-0 ${
              STATUS_STYLES[application.status] || "bg-slate-50 text-slate-600 border-slate-100"
            }`}
          >
            {humanize(application.status)}
          </span>
        </div>

        {/* Above the tabs, like the loan page's attention banner — these two
            stay true whichever tab is open, which is exactly why they belong
            outside the tab strip rather than inside Overview. */}
        <LeaseTiles
          application={application}
          quotations={quotations}
          downPayment={downPayment}
          purchase={purchase}
          agreement={agreement}
        />

        <LeaseNextAction
          application={application}
          quotations={quotations}
          downPayment={downPayment}
          purchase={purchase}
          agreement={agreement}
          valuationCompleted={valuations.some((v) => v.status === "completed")}
          audience="customer"
          // Suppressed when the live stage IS the open tab — a button that
          // takes you where you already are is noise.
          onGo={
            ACTION_TAB[nextAction.tab] === activeTab
              ? undefined
              : (target) => setTab(ACTION_TAB[target] || "overview")
          }
          goLabel={t("customer.leaseTabs.takeMeThere")}
        />

        {docCount === 0 &&
          !["rejected", "withdrawn", "declined"].includes(application.status) && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-900">
              <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("customer.leasing.documentsOutstanding")}
            </div>
          )}

        {/* Tabs — same markup as LoanApplicationDetail, deliberately. */}
        <div className="flex items-center gap-1 overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-1.5">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                activeTab === id
                  ? "bg-brand-primary text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {typeof count === "number" && count > 0 && (
                <span
                  className={`ml-0.5 px-1.5 rounded-full text-[10px] ${
                    activeTab === id ? "bg-white/20" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ---- Overview: the facts, the vehicle's status, the sequence --- */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Info className="w-3 h-3" /> {t("customer.leaseDash.atAGlance")}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                <RailRow label={t("customer.leaseDash.vehiclePrice")} value={lkr(application.invoice_price)} />
                <RailRow label={t("customer.leaseDash.financed")} value={lkr(application.financed_amount)} />
                <RailRow label={t("customer.leaseDash.term")} value={`${application.term_months} mo`} />
                {application.registration_no && (
                  <RailRow label={t("customer.leaseDash.registrationNo")} value={application.registration_no} />
                )}
                {agreement?.agreement?.agreement_no && (
                  <RailRow label={t("customer.leaseDash.agreementNo")} value={agreement.agreement.agreement_no} />
                )}
                {purchase?.registration?.cr_number && (
                  <RailRow label="CR" value={purchase.registration.cr_number} />
                )}
              </div>

              {(accepted || purchase?.registration?.release_letter_no) && (
                <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-100">
                  {accepted && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadPdf(
                          "agreement-pdf",
                          `/leases/${application.id}/agreement.pdf`,
                          `lease-agreement-${application.id}.pdf`
                        )
                      }
                      disabled={Boolean(acting) && acting !== "agreement-pdf"}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-primary hover:underline disabled:opacity-50"
                    >
                      {acting === "agreement-pdf" ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {t("customer.leasing.readFullTerms")}
                    </button>
                  )}
                  {purchase?.registration?.release_letter_no && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadPdf(
                          "release-pdf",
                          `/leases/${application.id}/release-letter.pdf`,
                          `release-letter-${application.id}.pdf`
                        )
                      }
                      disabled={Boolean(acting) && acting !== "release-pdf"}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                    >
                      {acting === "release-pdf" ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {t("customer.leasing.downloadRelease")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* The vehicle's own status — ours to do, theirs to watch. */}
            {purchase && application.status === "accepted" && purchaseCard}

            <LeaseProgressTracker
              application={application}
              quotations={quotations}
              downPayment={downPayment}
              purchase={purchase}
              agreement={agreement}
              audience="customer"
            />
          </div>
        )}

        {/* ---- Quotation ------------------------------------------------- */}
        {activeTab === "quotation" && quotationCard}

        {/* ---- Payments: the down payment AND the rentals ----------------- */}
        {activeTab === "payments" && (
          <div className="space-y-4">
            {/* A settled down payment is a receipt, not a task. Once rentals
                are running it collapses to a line so the live panel is what
                you land on — the same rule the Payments tab exists to serve. */}
            {downPayment &&
              downPayment.dueTotal !== undefined &&
              (downPayment.settled && agreement?.agreement ? (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <HistoryEntry
                    title={t("customer.leasing.payableAtSigning")}
                    summary={`${t("customer.leaseDash.settled")} · ${lkr(downPayment.dueTotal)}`}
                  >
                    {downPaymentCard}
                  </HistoryEntry>
                </div>
              ) : (
                downPaymentCard
              ))}
            {agreement?.agreement && (
              <LeaseRentalPanel
                applicationId={application.id}
                onShowSchedule={() => setShowSchedule(true)}
                refreshKey={rentalRefreshKey}
                showSummary={false}
              />
            )}
          </div>
        )}

        {/* ---- Documents -------------------------------------------------- */}
        {activeTab === "documents" && (
          <LeaseDocumentPanel
            applicationId={application.id}
            canUpload={!["rejected", "withdrawn", "declined"].includes(application.status)}
            onCountChange={setDocCount}
          />
        )}

        {/* ---- History ---------------------------------------------------- */}
        {activeTab === "history" && (
          <>
          {/* History */}
          {application.events?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">
                {t("customer.leasing.progressHeading")}
              </p>
              <ol className="space-y-1.5">
                {application.events.map((e) => (
                  <li key={e.id} className="text-[11px] flex gap-2">
                    <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300" />
                    <span className="text-slate-600">
                      <span className="font-semibold text-slate-700">{humanize(e.to_status)}</span> ·{" "}
                      {fmtDate(e.created_at)}
                      {e.note && <span className="block text-slate-500 italic">"{e.note}"</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          </>
        )}
      </div>


      {/* Full rental schedule — every rental for the whole term, which for a
          60-month lease is 60 rows nobody needs just to check the next due
          date. Same modal pattern the loan schedule uses. */}
      {showSchedule && agreement?.schedule && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowSchedule(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
              <h3 className="font-display font-bold text-base text-slate-900">{t("customer.leasing.rentalSchedule")}</h3>
              <button
                type="button"
                onClick={() => setShowSchedule(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700"
                aria-label={t("common.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 overflow-y-auto overflow-x-auto">
              <table className="w-full text-[11px] min-w-[480px]">
                <thead>
                  <tr className="text-slate-400 uppercase text-[9px] tracking-wider">
                    <th className="text-left font-semibold px-1 py-1">#</th>
                    <th className="text-left font-semibold px-1 py-1">{t("customer.leaseDash.tableDue")}</th>
                    <th className="text-right font-semibold px-1 py-1">{t("customer.leaseDash.tableCapital")}</th>
                    <th className="text-right font-semibold px-1 py-1">{t("customer.leaseDash.tableFinance")}</th>
                    <th className="text-right font-semibold px-1 py-1">{t("customer.leaseDash.tableRental")}</th>
                    <th className="text-right font-semibold px-1 py-1">{t("customer.leaseDash.tableBalance")}</th>
                    <th className="text-right font-semibold px-1 py-1">{t("customer.leaseDash.tableStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {agreement.schedule.map((r) => (
                    <tr key={r.rental_no} className="border-t border-slate-100 font-mono text-slate-700">
                      <td className="px-1 py-1">{r.rental_no}</td>
                      <td className="px-1 py-1 whitespace-nowrap">{fmtDate(r.due_date)}</td>
                      <td className="px-1 py-1 text-right">{lkr(r.capital_component)}</td>
                      <td className="px-1 py-1 text-right">{lkr(r.finance_component)}</td>
                      <td className="px-1 py-1 text-right">{lkr(r.rental_amount)}</td>
                      <td className="px-1 py-1 text-right">{lkr(r.closing_balance)}</td>
                      <td className="px-1 py-1 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold uppercase ${
                            r.status === "paid"
                              ? "bg-emerald-100 text-emerald-700"
                              : r.status === "partial"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => setShowSchedule(false)}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

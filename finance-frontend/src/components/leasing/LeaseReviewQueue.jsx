import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Car,
  Loader2,
  AlertTriangle,
  X,
  ClipboardCheck,
  Gavel,
  FileSignature,
  Wallet,
  KeyRound,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Info,
  Store,
  BanknoteX,
  BadgeCheck,
} from "lucide-react";
import api from "../../api/axios";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../toast/useToast";
import QuickAddCounterparty from "./QuickAddCounterparty";
import LeaseDocumentPanel from "./LeaseDocumentPanel";
import LeaseProgressTracker, { LeaseProgressBar } from "./LeaseProgressTracker";
import LeaseNextAction from "./LeaseNextAction";
import { deriveNextAction } from "./leaseProgress";
import downloadFile from "../../utils/downloadFile";

/**
 * The drawer's sections, in workflow order.
 *
 * `enabled` decides whether a stage is reachable YET. A tab with nothing
 * behind it is disabled rather than hidden, so the sequence is legible from
 * the first application an officer ever opens — and so a tab does not
 * materialise out of nowhere three clicks later.
 *
 * These keys match `deriveNextAction().tab` exactly; that is what lets the
 * action banner route straight to the right controls.
 */
const TABS = [
  {
    key: "overview",
    label: "Overview",
    enabled: () => true,
  },
  {
    key: "documents",
    label: "Documents",
    enabled: () => true,
  },
  {
    key: "valuation",
    label: "Valuation",
    // Every condition — brand new included — needs an independent
    // valuation before approval, so this tab is never condition-gated.
    enabled: () => true,
  },
  {
    key: "decision",
    label: "Decision",
    enabled: ({ detail }) => ["pending", "under_review", "info_requested"].includes(detail?.status),
    lockedHint: "This application has already been decided.",
  },
  {
    key: "quotation",
    label: "Quotation",
    enabled: ({ detail }) =>
      ["approved", "quoted", "accepted", "declined"].includes(detail?.status),
    lockedHint: "Terms can only be quoted once the application is approved.",
  },
  {
    key: "money",
    label: "Down payment",
    enabled: ({ downPayment }) => downPayment?.dueTotal !== undefined,
    lockedHint: "Nothing is payable until the lessee accepts a quotation.",
  },
  {
    key: "title",
    label: "Vehicle & title",
    enabled: ({ purchase }) => Boolean(purchase),
    lockedHint: "The vehicle is bought once the down payment has cleared.",
  },
  {
    key: "rentals",
    label: "Rentals",
    enabled: ({ purchase, agreement }) =>
      Boolean(agreement?.agreement) || purchase?.registrationStatus === "registered",
    lockedHint: "Rentals begin once the vehicle is registered to us.",
  },
];

/**
 * Staff/admin lease review (L3.2).
 *
 * The panel exists to make one thing obvious: whether this lease can be
 * decided yet. A used or reconditioned vehicle cannot be approved until an
 * independent valuation is back, because loan-to-value is measured against
 * that valuation — so the queue shows valuation state per row, and the
 * drawer's Approve button is disabled with the reason spelled out rather
 * than failing on click.
 *
 * The server enforces all of this regardless (leaseStatus.service). Nothing
 * here is the real gate; it just stops the reviewer discovering it the hard
 * way.
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

const OUTCOME_STYLES = {
  pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  refer: "bg-amber-50 text-amber-800 border-amber-200",
  decline: "bg-rose-50 text-rose-700 border-rose-200",
};

const RULE_STATUS_STYLES = {
  pass: "text-emerald-700",
  refer: "text-amber-700",
  fail: "text-rose-700",
  skipped: "text-slate-400",
};

const CONDITION_LABELS = {
  brand_new: "Brand new",
  reconditioned: "Reconditioned",
  used: "Used",
};

const lkr = (v) =>
  v === null || v === undefined
    ? "—"
    : `LKR ${Number(v).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" }) : "—";
const humanize = (s) => String(s || "").replace(/_/g, " ");

export default function LeaseReviewQueue() {
  const { showToast } = useToast();

  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [applications, setApplications] = useState([]);
  const [valuers, setValuers] = useState([]);
  // The approved dealer register (L17). Loaded here rather than on demand
  // because the purchase step needs it and a dropdown that populates after
  // you have already looked at it is worse than one that is simply there.
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState("");

  // Valuation form
  const [valuerId, setValuerId] = useState("");
  const [valuationAmount, setValuationAmount] = useState("");
  const [valuationDate, setValuationDate] = useState("");
  const [reportReference, setReportReference] = useState("");
  const [decisionNote, setDecisionNote] = useState("");

  // Quotation
  const [quotations, setQuotations] = useState([]);
  const [quotePreview, setQuotePreview] = useState(null);
  const [quoteFinanced, setQuoteFinanced] = useState("");
  const [quoteTerm, setQuoteTerm] = useState("");
  const [quoteNote, setQuoteNote] = useState("");

  // Down payment (L5)
  const [downPayment, setDownPayment] = useState(null);
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMethod, setReceiptMethod] = useState("cash");
  const [receiptRef, setReceiptRef] = useState("");

  // Purchase & title (L6)
  const [purchase, setPurchase] = useState(null);
  const [payoutRef, setPayoutRef] = useState("");
  const [dmtRef, setDmtRef] = useState("");
  const [crNumber, setCrNumber] = useState("");
  const [newRegNo, setNewRegNo] = useState("");

  // Which stage the drawer is showing. Set from the derived next action
  // when a lease is opened, so the officer lands on the work rather than on
  // a summary they have to read past.
  const [activeTab, setActiveTab] = useState("overview");

  // Agreement & rentals (L7)
  const [agreement, setAgreement] = useState(null);
  const [rentalAmount, setRentalAmount] = useState("");
  const [rentalMethod, setRentalMethod] = useState("bank_transfer");

  // Refresh only — the FIRST load happens in the effect below. Kept separate
  // so neither path sets state synchronously inside an effect body, which
  // triggers the cascading-render lint rule (and the renders it warns about).
  const loadQueue = useCallback(async () => {
    try {
      const res = await api.get("/leases/review/queue");
      setApplications(res.data?.applications || []);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load the lease queue.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [q, v, d] = await Promise.all([
          api.get("/leases/review/queue"),
          // Both registers are optional context for the assign dropdowns; a
          // failure here must not stop the queue rendering.
          api.get("/admin/lease/valuers?active=true").catch(() => ({ data: { valuers: [] } })),
          api.get("/admin/lease/suppliers").catch(() => ({ data: { suppliers: [] } })),
        ]);
        if (cancelled) return;
        setApplications(q.data?.applications || []);
        setValuers(v.data?.valuers || []);
        setDealers((d.data?.suppliers || []).filter((s) => s.status === "active"));
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || "Couldn't load the lease queue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openDetail = async (app) => {
    setSelected(app);
    setDetailLoading(true);
    setDetail(null);
    setValuations([]);
    setQuotations([]);
    setQuotePreview(null);
    setQuoteFinanced("");
    setQuoteTerm("");
    setQuoteNote("");
    setDownPayment(null);
    setReceiptAmount("");
    setReceiptMethod("cash");
    setReceiptRef("");
    setPurchase(null);
    setPayoutRef("");
    setDmtRef("");
    setCrNumber("");
    setNewRegNo("");
    setAgreement(null);
    setRentalAmount("");
    setRentalMethod("bank_transfer");
    setValuationAmount("");
    setValuationDate("");
    setReportReference("");
    setDecisionNote("");
    try {
      const [d, v, q, dp, pu, ag] = await Promise.all([
        api.get(`/leases/${app.id}`),
        api.get(`/leases/${app.id}/valuations`),
        api.get(`/leases/${app.id}/quotations`),
        api.get(`/leases/${app.id}/down-payment`).catch(() => ({ data: null })),
        api.get(`/leases/${app.id}/purchase`).catch(() => ({ data: null })),
        api.get(`/leases/${app.id}/agreement`).catch(() => ({ data: null })),
      ]);
      setDetail(d.data);
      setValuations(v.data?.valuations || []);
      setQuotations(q.data?.quotations || []);
      setDownPayment(dp.data);
      setPurchase(pu.data);
      setAgreement(ag.data?.agreement ? ag.data : null);

      // Land on the work. Done ONLY here, on first open — refreshDetail
      // deliberately leaves the tab alone, because recording a payout moves
      // the next action to "lodge the CR" and yanking the officer to another
      // tab mid-task is disorienting. The banner and the badge move; the
      // view stays where they put it.
      const opened = deriveNextAction({
        application: d.data,
        quotations: q.data?.quotations || [],
        downPayment: dp.data,
        purchase: pu.data,
        agreement: ag.data?.agreement ? ag.data : null,
        valuationCompleted: (v.data?.valuations || []).some((x) => x.status === "completed"),
      });
      const target = TABS.find((tb) => tb.key === opened.tab);
      const reachable =
        target &&
        target.enabled({
          detail: d.data,
          quotations: q.data?.quotations || [],
          downPayment: dp.data,
          purchase: pu.data,
          agreement: ag.data?.agreement ? ag.data : null,
        });
      setActiveTab(reachable ? opened.tab : "overview");
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Load Application",
        message: err.response?.data?.message || "Please try again.",
      });
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id) => {
    const [d, v, q, dp, pu, ag] = await Promise.all([
      api.get(`/leases/${id}`),
      api.get(`/leases/${id}/valuations`),
      api.get(`/leases/${id}/quotations`),
      api.get(`/leases/${id}/down-payment`).catch(() => ({ data: null })),
      api.get(`/leases/${id}/purchase`).catch(() => ({ data: null })),
      api.get(`/leases/${id}/agreement`).catch(() => ({ data: null })),
    ]);
    setDetail(d.data);
    setValuations(v.data?.valuations || []);
    setQuotations(q.data?.quotations || []);
    setDownPayment(dp.data);
    setPurchase(pu.data);
    setAgreement(ag.data?.agreement ? ag.data : null);
    loadQueue();
  };

  /** The overrides staff typed, omitting anything left blank. */
  // Recomputed on every render so the banner and the tab badge follow the
  // data the moment an action lands, without a second source of truth.
  const nextAction = deriveNextAction({
    application: detail,
    quotations,
    downPayment,
    purchase,
    agreement,
    valuationCompleted: valuations.some((v) => v.status === "completed"),
  });

  const quoteOverrides = () => ({
    financed_amount: quoteFinanced !== "" ? Number(quoteFinanced) : undefined,
    term_months: quoteTerm !== "" ? Number(quoteTerm) : undefined,
    note: quoteNote.trim() || undefined,
  });

  // The agreement PDF sits behind verifyToken, and this app authenticates
  // with a bearer token held in memory rather than a cookie — a plain
  // <a href> straight at the API sends no Authorization header, 401s, and
  // "View Agreement" opens a near-blank tab holding a two-line JSON error.
  // downloadFile() re-fetches it as an authenticated blob instead, same as
  // the loan side's decision letter.
  const downloadAgreement = async (applicationId) => {
    if (acting) return;
    setActing("agreement-pdf");
    try {
      await downloadFile(
        `/leases/${applicationId}/agreement.pdf`,
        `lease-agreement-${applicationId}.pdf`
      );
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Download That",
        message: err.response?.data?.message || "Please try again shortly.",
      });
    } finally {
      setActing("");
    }
  };

  const previewQuotation = async () => {
    setActing("preview");
    try {
      const res = await api.post(`/leases/${selected.id}/quotations/preview`, quoteOverrides());
      setQuotePreview(res.data);
    } catch (err) {
      setQuotePreview(null);
      showToast({
        type: "error",
        title: "Couldn't Build Quotation",
        message: err.response?.data?.message || "Please check the figures.",
      });
    } finally {
      setActing("");
    }
  };

  const issueQuotation = async () => {
    setActing("issue");
    try {
      await api.post(`/leases/${selected.id}/quotations`, quoteOverrides());
      await refreshDetail(selected.id);
      setQuotePreview(null);
      showToast({
        type: "success",
        title: "Quotation Issued",
        message: "The applicant can now accept or decline it.",
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Issue Quotation",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const requestValuation = async () => {
    setActing("request");
    try {
      await api.post(`/leases/${selected.id}/valuations`, {
        valuer_id: valuerId ? Number(valuerId) : undefined,
      });
      await refreshDetail(selected.id);
      showToast({ type: "success", title: "Valuation Requested", message: "The valuer has been assigned." });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Request Valuation",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const recordValuation = async (valuationId, status) => {
    if (status === "completed" && !(Number(valuationAmount) > 0)) {
      showToast({
        type: "error",
        title: "Valuation Amount Required",
        message: "Enter the valued amount before recording the report.",
      });
      return;
    }
    setActing("record" + valuationId);
    try {
      const res = await api.patch(`/leases/${selected.id}/valuations/${valuationId}`, {
        status,
        valuation_amount: status === "completed" ? Number(valuationAmount) : undefined,
        valuation_date: valuationDate || undefined,
        report_reference: reportReference || undefined,
      });
      await refreshDetail(selected.id);
      // Recording a valuation re-runs the credit policy, so say what it did
      // rather than leaving the reviewer to spot the change themselves.
      const outcome = res.data?.policy?.outcome;
      showToast({
        type: outcome === "decline" ? "error" : "success",
        title: "Valuation Recorded",
        message:
          status === "completed"
            ? `Credit policy re-evaluated — outcome is now "${outcome}".`
            : "The valuation was marked rejected.",
      });
      setValuationAmount("");
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Record Valuation",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const recordReceipt = async () => {
    if (!(Number(receiptAmount) > 0)) {
      showToast({ type: "error", title: "Amount Required", message: "Enter the amount received." });
      return;
    }
    setActing("receipt");
    try {
      await api.post(`/leases/${selected.id}/down-payment/receipts`, {
        amount: Number(receiptAmount),
        method: receiptMethod,
        reference_no: receiptRef.trim() || undefined,
      });
      await refreshDetail(selected.id);
      setReceiptAmount("");
      setReceiptRef("");
      showToast({ type: "success", title: "Receipt Recorded", message: "The signing balance has been updated." });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Record Receipt",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  /**
   * Attach or detach the approved dealer supplying this vehicle.
   *
   * The lessee picks one on the application form, but the field is optional
   * and the register was empty until L17, so in practice every lease arrived
   * with no dealer and was booked as a private seller. Staff have the invoice
   * in front of them and are the ones who actually know; the server refuses
   * the change once the payout exists.
   */
  const assignDealer = async (value, { alreadyWarned = false } = {}) => {
    setActing("dealer");
    try {
      const res = await api.patch(`/leases/${selected.id}/purchase/supplier`, {
        supplier_id: value === "" ? null : Number(value),
      });
      await refreshDetail(selected.id);
      // `alreadyWarned` is set when this assignment follows a quick-add: the
      // creation toast has just said the same thing, and repeating the
      // readiness sentence verbatim two toasts in a row reads as a glitch.
      const notice = alreadyWarned ? null : res.data.notice;
      showToast({
        type: notice ? "info" : "success",
        title: res.data.supplier ? "Dealer set" : "Private seller",
        message:
          notice ||
          (res.data.supplier
            ? `The vehicle will be bought from ${res.data.supplier.name}.`
            : "This purchase is recorded as a private sale."),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't set the dealer",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const payDealer = async () => {
    setActing("payout");
    try {
      await api.post(`/leases/${selected.id}/purchase/payout`, {
        reference_no: payoutRef.trim() || undefined,
      });
      await refreshDetail(selected.id);
      setPayoutRef("");
      showToast({ type: "success", title: "Vehicle Purchased", message: "The dealer payout has been recorded." });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Record Payout",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const advanceRegistration = async (status) => {
    setActing(status);
    try {
      await api.patch(`/leases/${selected.id}/purchase/registration`, {
        status,
        reference: dmtRef.trim() || undefined,
        cr_number: crNumber.trim() || undefined,
        registration_no: newRegNo.trim() || undefined,
        // From the QUEUE row, not `detail` — findLeaseApplicationById does
        // not join the lessee's name, and this is the name printed on the CR.
        registered_user: selected
          ? `${selected.lessee_first_name || ""} ${selected.lessee_last_name || ""}`.trim() || undefined
          : undefined,
      });
      await refreshDetail(selected.id);
      setDmtRef("");
      setCrNumber("");
      setNewRegNo("");
      showToast({
        type: "success",
        title: status === "submitted" ? "Lodged with the DMT" : "Registration Recorded",
        message:
          status === "submitted"
            ? "Waiting for the CR to be issued."
            : "The vehicle is now registered to us as absolute owner.",
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Update Registration",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const logDuplicateKey = async (event) => {
    setActing(`key-${event}`);
    try {
      await api.patch(`/leases/${selected.id}/purchase/duplicate-key`, { event });
      await refreshDetail(selected.id);
      showToast({
        type: "success",
        title: event === "received" ? "Duplicate Key Logged" : "Duplicate Key Returned",
        message:
          event === "received"
            ? "Recorded as held in our custody."
            : "Recorded as returned to the lessee.",
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Log the Duplicate Key",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const leaseAction = async (key, fn, successTitle, successMessage) => {
    setActing(key);
    try {
      await fn();
      await refreshDetail(selected.id);
      showToast({ type: "success", title: successTitle, message: successMessage });
    } catch (err) {
      showToast({
        type: "error",
        title: "Action Failed",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setActing("");
    }
  };

  const decide = async (status, { overrideReason } = {}) => {
    if (status === "rejected" && !decisionNote.trim()) {
      showToast({
        type: "error",
        title: "Reason Required",
        message: "A rejection needs a reason the applicant can act on.",
      });
      return;
    }
    setActing(status);
    try {
      await api.patch(`/leases/${selected.id}/status`, {
        status,
        note: decisionNote.trim() || undefined,
        override_reason: overrideReason,
      });
      await refreshDetail(selected.id);
      showToast({ type: "success", title: "Application Updated", message: `Moved to ${humanize(status)}.` });
    } catch (err) {
      const msg = err.response?.data?.message || "Please try again.";
      // The server refuses an approval that the refreshed policy declines,
      // and says so. Offer the override rather than dead-ending.
      if (/declines this lease/i.test(msg) && status === "approved") {
        const reason = window.prompt(
          "Credit policy declines this lease on the current figures.\n\nTo approve anyway, state the authorised reason:"
        );
        if (reason && reason.trim()) {
          setActing("");
          return decide("approved", { overrideReason: reason.trim() });
        }
      }
      showToast({ type: "error", title: "Couldn't Update Application", message: msg });
    } finally {
      setActing("");
    }
  };

  // Every condition needs an independent valuation before approval — brand
  // new included, since a franchise invoice is a price the dealer set, not
  // a value anyone here has verified.
  const hasCompletedValuation = valuations.some((v) => v.status === "completed");
  const approvalBlockedReason =
    detail && !hasCompletedValuation
      ? "An independent valuation must be completed before this vehicle can be approved."
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-2xl text-slate-900">Lease Applications</h2>
        <p className="text-slate-500 text-sm mt-1.5">
          Review vehicle lease applications, arrange valuations, and decide.
        </p>
      </div>

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && applications.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <Car className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No lease applications yet</p>
        </div>
      )}

      {!loading && !error && applications.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-xs min-w-[1080px]">
            <thead>
              <tr className="text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-100">
                <th className="text-left font-semibold px-4 py-3">#</th>
                <th className="text-left font-semibold px-4 py-3">Lessee</th>
                <th className="text-left font-semibold px-4 py-3">Vehicle</th>
                <th className="text-right font-semibold px-4 py-3">Financed</th>
                <th className="text-left font-semibold px-4 py-3">Valuation</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                <th className="text-left font-semibold px-4 py-3 w-44">Progress</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {applications.map((a) => {
                const done = Number(a.completed_valuations) > 0;
                const pendingVal = Number(a.pending_valuations) > 0;
                return (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-slate-500">{a.id}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-800">
                        {a.lessee_first_name} {a.lessee_last_name}
                      </span>
                      <span className="block text-[11px] text-slate-400">{a.lessee_email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-700">
                        {a.make} {a.model} {a.year_of_manufacture}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {CONDITION_LABELS[a.condition_type] || a.condition_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                      {lkr(a.financed_amount)}
                    </td>
                    <td className="px-4 py-3">
                      {done ? (
                        <span className="text-emerald-700 font-semibold">Completed</span>
                      ) : pendingVal ? (
                        <span className="text-amber-700 font-semibold">Awaiting report</span>
                      ) : (
                        <span className="text-rose-700 font-semibold">Not requested</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          STATUS_STYLES[a.status] || "bg-slate-50 text-slate-600 border-slate-100"
                        }`}
                      >
                        {humanize(a.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {/* The status column names ONE state; this says where
                          that sits in the sequence, so a queue can be
                          scanned for "who is waiting on us". */}
                      <LeaseProgressBar row={a} audience="staff" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(a)}
                        className="text-brand-primary font-bold hover:underline"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Review drawer --------------------------------------------- */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-base text-slate-900">
                    Lease Application #{selected.id}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selected.make} {selected.model} · {selected.lessee_first_name}{" "}
                    {selected.lessee_last_name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 py-5 space-y-5 overflow-y-auto text-sm">
                {detailLoading && (
                  <div className="flex justify-center py-8 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}

                {detail && (
                  <>
                    {/* What to do now — before anything else, because the
                        answer used to be buried somewhere in nine stacked
                        panels. Its button routes to the tab that holds the
                        controls, so nobody has to know where they live. */}
                    <LeaseNextAction
                      application={detail}
                      quotations={quotations}
                      downPayment={downPayment}
                      purchase={purchase}
                      agreement={agreement}
                      valuationCompleted={valuations.some((v) => v.status === "completed")}
                      audience="staff"
                      onGo={setActiveTab}
                      goLabel="Open"
                    />

                    {/* One stage at a time. Tabs that have nothing to show
                        yet are disabled rather than hidden: an officer
                        learning the workflow can see the whole sequence,
                        and a tab that appears out of nowhere later is more
                        disorienting than one that was greyed out. */}
                    <div className="flex gap-1 overflow-x-auto -mx-1 px-1 border-b border-slate-100 pb-px">
                      {TABS.map((tabDef) => {
                        const enabled = tabDef.enabled({
                          detail,
                          quotations,
                          downPayment,
                          purchase,
                          agreement,
                        });
                        const isActive = activeTab === tabDef.key;
                        const needsAttention = enabled && nextAction.tab === tabDef.key;
                        return (
                          <button
                            key={tabDef.key}
                            type="button"
                            onClick={() => enabled && setActiveTab(tabDef.key)}
                            disabled={!enabled}
                            title={enabled ? undefined : tabDef.lockedHint}
                            className={`relative shrink-0 px-3 py-2 text-[11px] font-bold rounded-t-lg border-b-2 transition-colors ${
                              isActive
                                ? "border-brand-primary text-brand-primary bg-brand-primary/5"
                                : enabled
                                  ? "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                                  : "border-transparent text-slate-300 cursor-not-allowed"
                            }`}
                          >
                            {tabDef.label}
                            {needsAttention && !isActive && (
                              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {activeTab === "overview" && (
                      <>
                    {/* The same tracker the lessee sees, from the same
                        derivation. An officer answering "where is my lease?"
                        should be reading the lessee's own answer, not a
                        second description of the workflow that can drift
                        from it. */}
                    <LeaseProgressTracker
                      application={detail}
                      quotations={quotations}
                      downPayment={downPayment}
                      purchase={purchase}
                      agreement={agreement}
                      audience="staff"
                    />

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {[
                        ["Vehicle price", lkr(detail.invoice_price)],
                        ["Financed", lkr(detail.financed_amount)],
                        ["Term", `${detail.term_months} mo`],
                        ["Rate", `${detail.priced_interest_rate ?? detail.interest_rate}%`],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{k}</p>
                          <p className="font-mono font-bold text-slate-800">{v}</p>
                        </div>
                      ))}
                    </div>

                    {/* Policy verdict */}
                    {detail.policy && (
                      <div className="rounded-2xl border border-slate-100 p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                            Credit Policy
                          </p>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                              OUTCOME_STYLES[detail.policy.outcome] || ""
                            }`}
                          >
                            {detail.policy.outcome}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                          <span className="text-slate-500">
                            LTV:{" "}
                            <span className="font-mono font-bold text-slate-800">
                              {detail.policy.ltv ?? "—"}
                              {detail.policy.ltv ? "%" : ""}
                            </span>
                            {detail.policy.ltv_base_source && (
                              <span className="text-slate-400"> (vs {detail.policy.ltv_base_source})</span>
                            )}
                          </span>
                          <span className="text-slate-500">
                            Down payment:{" "}
                            <span className="font-mono font-bold text-slate-800">
                              {detail.policy.down_payment_percent ?? "—"}%
                            </span>
                          </span>
                        </div>
                        {Array.isArray(detail.policy.rules) && (
                          <ul className="space-y-0.5 pt-1">
                            {detail.policy.rules
                              .filter((r) => r.status !== "pass")
                              .map((r) => (
                                <li key={r.code} className="text-[11px]">
                                  <span className={`font-bold ${RULE_STATUS_STYLES[r.status]}`}>
                                    {r.status.toUpperCase()}
                                  </span>{" "}
                                  <span className="text-slate-600">{r.detail}</span>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Audit trail */}
                    {Array.isArray(detail.events) && detail.events.length > 0 && (
                      <div className="rounded-2xl border border-slate-100 p-4">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">
                          History
                        </p>
                        <ol className="space-y-1.5">
                          {detail.events.map((e) => (
                            <li key={e.id} className="text-[11px] flex gap-2">
                              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300" />
                              <span className="text-slate-600">
                                <span className="font-semibold text-slate-700">{humanize(e.to_status)}</span>{" "}
                                · {fmtDate(e.created_at)}
                                {e.actor_first_name ? ` · ${e.actor_first_name} ${e.actor_last_name || ""}` : ""}
                                {e.note ? <span className="block text-slate-500 italic">"{e.note}"</span> : null}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                      </>
                    )}
                    {activeTab === "documents" && (
                      <>
                    {/* The evidence behind the decision, verifiable in the
                        same drawer it is being decided in. */}
                    <LeaseDocumentPanel applicationId={detail.id} canVerify />

                      </>
                    )}
                    {activeTab === "valuation" && (
                      <>
                    {/* Valuations */}
                    <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                        <ClipboardCheck className="w-3.5 h-3.5" /> Valuation
                      </p>

                      {valuations.length > 0 && (
                        <ul className="space-y-2">
                          {valuations.map((v) => (
                            <li
                              key={v.id}
                              className="border border-slate-100 rounded-xl p-3 bg-slate-50/60 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-700">
                                  {v.valuer_name || "Unassigned valuer"}
                                  {v.valuer_license_no && (
                                    <span className="text-slate-400 font-normal"> · {v.valuer_license_no}</span>
                                  )}
                                </span>
                                <span
                                  className={`text-[10px] font-bold uppercase ${
                                    v.status === "completed"
                                      ? "text-emerald-700"
                                      : v.status === "rejected"
                                        ? "text-rose-700"
                                        : "text-amber-700"
                                  }`}
                                >
                                  {v.status}
                                </span>
                              </div>
                              {v.status === "completed" && (
                                <p className="text-[11px] text-slate-600 font-mono">
                                  {lkr(v.valuation_amount)} · {fmtDate(v.valuation_date)}
                                  {v.report_reference ? ` · ${v.report_reference}` : ""}
                                </p>
                              )}
                              {v.status === "requested" && (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <input
                                      type="number"
                                      min="0"
                                      step="any"
                                      placeholder="Valued amount"
                                      value={valuationAmount}
                                      onChange={(e) => setValuationAmount(e.target.value)}
                                      className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white"
                                    />
                                    <input
                                      type="date"
                                      value={valuationDate}
                                      onChange={(e) => setValuationDate(e.target.value)}
                                      className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Report ref."
                                      value={reportReference}
                                      onChange={(e) => setReportReference(e.target.value)}
                                      className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => recordValuation(v.id, "completed")}
                                      disabled={Boolean(acting)}
                                      className="px-3 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                      {acting === "record" + v.id && <Loader2 className="w-3 h-3 animate-spin" />}
                                      Record Report
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => recordValuation(v.id, "rejected")}
                                      disabled={Boolean(acting)}
                                      className="px-3 py-1.5 text-[11px] font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg disabled:opacity-50"
                                    >
                                      Mark Rejected
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <select
                          value={valuerId}
                          onChange={(e) => setValuerId(e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                        >
                          <option value="">Assign a valuer (optional)</option>
                          {valuers.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                              {v.license_no ? ` · ${v.license_no}` : ""}
                            </option>
                          ))}
                        </select>
                        {/* Selected on creation, not merely added to the list:
                            you only open this because you want THIS valuer. */}
                        <QuickAddCounterparty
                          kind="valuer"
                          isAdmin={isAdmin}
                          onAdded={(created) => {
                            setValuers((prev) =>
                              [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
                            );
                            setValuerId(String(created.id));
                          }}
                        />
                        <button
                          type="button"
                          onClick={requestValuation}
                          disabled={Boolean(acting)}
                          className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {acting === "request" && <Loader2 className="w-3 h-3 animate-spin" />}
                          Request Valuation
                        </button>
                      </div>

                      {valuers.length === 0 && (
                        <p className="text-[11px] text-slate-500">
                          No valuers on the register yet — add one above, or leave this unassigned
                          and record the report when it comes back.
                        </p>
                      )}
                    </div>

                      </>
                    )}
                    {activeTab === "quotation" && (
                      <>
                    {/* Quotation (L4.1) — only once the credit decision is
                        made; the status machine refuses it before then, and
                        showing the controls anyway would just invite a
                        rejected click. */}
                    {["approved", "quoted", "accepted", "declined"].includes(detail.status) && (
                      <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                          <FileSignature className="w-3.5 h-3.5" /> Quotation
                        </p>

                        {/* Approval is NOT the last gate: nothing is payable
                            until terms are quoted and accepted. Without this
                            line an approved lease looks finished, and both
                            sides sit waiting for the other. */}
                        {detail.status === "approved" && quotations.length === 0 && (
                          <p className="flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            Approved, but no quotation has been issued. The lessee cannot accept
                            terms or pay their down payment until you issue one.
                          </p>
                        )}

                        {quotations.length > 0 && (
                          <ul className="space-y-2">
                            {quotations.map((q) => (
                              <li
                                key={q.id}
                                className={`border rounded-xl p-3 space-y-1.5 ${
                                  q.status === "pending"
                                    ? "border-indigo-200 bg-indigo-50/50"
                                    : "border-slate-100 bg-slate-50/60 opacity-80"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-700">
                                    #{q.id} · {lkr(q.monthly_rental)}/mo × {q.term_months}
                                  </span>
                                  <span className="text-[10px] font-bold uppercase text-slate-500">
                                    {humanize(q.status)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 font-mono">
                                  Down {lkr(q.down_payment_amount)} ({q.down_payment_percent}%) · financed{" "}
                                  {lkr(q.financed_amount)} @ {Number(q.interest_rate).toFixed(2)}% {q.rate_type}
                                </p>
                                {q.fees?.length > 0 && (
                                  <p className="text-[11px] text-slate-500">
                                    {q.fees
                                      .map((f) => `${f.label}: ${f.waived ? "waived" : lkr(f.amount)}`)
                                      .join(" · ")}
                                  </p>
                                )}
                                {q.response_note && (
                                  <p className="text-[11px] text-slate-500 italic">"{q.response_note}"</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {["approved", "quoted"].includes(detail.status) && (
                          <>
                            {quotePreview && (
                              <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] space-y-1">
                                <p className="font-bold text-slate-700">
                                  Preview: {lkr(quotePreview.terms.monthlyRental)}/mo ×{" "}
                                  {quotePreview.terms.termMonths}
                                </p>
                                <p className="text-slate-500 font-mono">
                                  Down {lkr(quotePreview.terms.downPaymentAmount)} (
                                  {quotePreview.terms.downPaymentPercent}%) · fees{" "}
                                  {lkr(quotePreview.summary.totalFees)} · payable at signing{" "}
                                  {lkr(quotePreview.summary.upfrontTotal)}
                                </p>
                                {quotePreview.summary.effectiveApr != null && (
                                  <p className="text-slate-500">
                                    Effective APR including fees:{" "}
                                    <span className="font-mono font-bold">
                                      {quotePreview.summary.effectiveApr}%
                                    </span>
                                  </p>
                                )}
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                type="number"
                                min="1"
                                step="any"
                                placeholder={`Financed amount (${detail.financed_amount})`}
                                value={quoteFinanced}
                                onChange={(e) => setQuoteFinanced(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white"
                              />
                              <input
                                type="number"
                                min="1"
                                step="1"
                                placeholder={`Term months (${detail.term_months})`}
                                value={quoteTerm}
                                onChange={(e) => setQuoteTerm(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white"
                              />
                            </div>
                            <input
                              type="text"
                              placeholder="Note to the applicant (optional)"
                              value={quoteNote}
                              onChange={(e) => setQuoteNote(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={previewQuotation}
                                disabled={Boolean(acting)}
                                className="px-3 py-2 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {acting === "preview" && <Loader2 className="w-3 h-3 animate-spin" />}
                                Preview Figures
                              </button>
                              <button
                                type="button"
                                onClick={issueQuotation}
                                disabled={Boolean(acting)}
                                className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {acting === "issue" && <Loader2 className="w-3 h-3 animate-spin" />}
                                {detail.status === "quoted" ? "Reissue Quotation" : "Issue Quotation"}
                              </button>
                              {quotations.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => downloadAgreement(detail.id)}
                                  disabled={Boolean(acting) && acting !== "agreement-pdf"}
                                  className="px-3 py-2 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {acting === "agreement-pdf" && (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  )}
                                  View Agreement
                                </button>
                              )}
                            </div>
                            {detail.status === "quoted" && (
                              <p className="text-[10px] text-slate-400">
                                Reissuing supersedes the live quotation — only the newest can be accepted.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}

                      </>
                    )}
                    {activeTab === "money" && (
                      <>
                    {/* Down payment (L5) — only meaningful once terms are
                        agreed, which is when the server starts quoting a
                        figure at all. */}
                    {downPayment && downPayment.dueTotal !== undefined && (
                      <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Wallet className="w-3.5 h-3.5" /> Payable at Signing
                        </p>

                        <div className="grid grid-cols-3 gap-3 text-[11px]">
                          {[
                            ["Due", lkr(downPayment.dueTotal)],
                            ["Received", lkr(downPayment.received)],
                            ["Outstanding", lkr(downPayment.outstanding)],
                          ].map(([k, v]) => (
                            <div key={k}>
                              <p className="uppercase font-bold tracking-wider text-slate-400">{k}</p>
                              <p className="font-mono font-bold text-slate-800">{v}</p>
                            </div>
                          ))}
                        </div>

                        {downPayment.receipts?.length > 0 && (
                          <ul className="space-y-1 text-[11px] border-t border-slate-100 pt-2">
                            {downPayment.receipts.map((r) => (
                              <li key={r.id} className="flex justify-between gap-2">
                                <span className="text-slate-500">
                                  {fmtDate(r.paid_on)} · {humanize(r.method)}
                                  {r.reference_no ? ` · ${r.reference_no}` : ""}
                                  {/* NULL recorder means the gateway confirmed
                                      it; nobody keyed it in. */}
                                  {r.recorded_by_first_name
                                    ? ` · ${r.recorded_by_first_name} ${r.recorded_by_last_name || ""}`
                                    : " · online"}
                                </span>
                                <span className="font-mono text-slate-700 shrink-0">{lkr(r.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {downPayment.settled ? (
                          <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Settled in full — the vehicle can
                            now be purchased.
                          </p>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                placeholder="Amount received"
                                value={receiptAmount}
                                onChange={(e) => setReceiptAmount(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white"
                              />
                              <select
                                value={receiptMethod}
                                onChange={(e) => setReceiptMethod(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                              >
                                <option value="cash">Cash</option>
                                <option value="bank_transfer">Bank transfer</option>
                                <option value="cheque">Cheque</option>
                                <option value="other">Other</option>
                              </select>
                              <input
                                type="text"
                                placeholder="Receipt / slip ref."
                                value={receiptRef}
                                onChange={(e) => setReceiptRef(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={recordReceipt}
                              disabled={Boolean(acting)}
                              className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {acting === "receipt" && <Loader2 className="w-3 h-3 animate-spin" />}
                              Record Receipt
                            </button>
                            <p className="text-[10px] text-slate-400">
                              Recording a receipt is you confirming money arrived — your name is
                              attached to it. Card payments post themselves.
                            </p>
                          </>
                        )}
                      </div>
                    )}

                      </>
                    )}
                    {activeTab === "title" && (
                      <>
                    {/* Purchase & title (L6). The ordering rules live on the
                        server; this shows where the lease has got to and
                        offers only the step that is actually available. */}
                    {purchase && detail.status === "accepted" && (
                      <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5" /> Purchase &amp; Title
                        </p>

                        <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                          {purchase.nextStep?.label}
                        </p>

                        {/* Duplicate (spare) key custody — Sri Lankan lease
                            practice requires it alongside the CR, valuation
                            report and supplier invoice as part of the
                            application paperwork, so it belongs here from
                            the moment this tab is reachable, not gated
                            behind the payout below. A recorded fact, not a
                            gate: it secures the asset DURING the lease and
                            has no bearing on whether the lessee has EARNED
                            release, so it never blocks approval, activation,
                            or the release letter. */}
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                            <KeyRound className="w-3 h-3" /> Duplicate key
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {purchase.registration?.duplicate_key_returned ? (
                              <>Returned to the lessee {fmtDate(purchase.registration.duplicate_key_returned_at)}.</>
                            ) : purchase.registration?.duplicate_key_received ? (
                              <>In our custody since {fmtDate(purchase.registration.duplicate_key_received_at)}.</>
                            ) : (
                              "Not yet logged as received."
                            )}
                          </p>
                          {!purchase.registration?.duplicate_key_received && (
                            <button
                              type="button"
                              onClick={() => logDuplicateKey("received")}
                              disabled={Boolean(acting)}
                              className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                            >
                              {acting === "key-received" && <Loader2 className="w-3 h-3 animate-spin" />}
                              Log Key Received
                            </button>
                          )}
                          {purchase.registration?.duplicate_key_received &&
                            !purchase.registration?.duplicate_key_returned && (
                              <button
                                type="button"
                                onClick={() => logDuplicateKey("returned")}
                                disabled={Boolean(acting)}
                                className="px-3 py-2 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {acting === "key-returned" && <Loader2 className="w-3 h-3 animate-spin" />}
                                Log Key Returned
                              </button>
                            )}
                        </div>

                        {/* Who we are buying from (L17). Editable until the
                            money leaves; after that the supplier on the
                            vehicle is the counterparty a real payment went
                            to, and the server refuses to change it. */}
                        {!purchase.payout && (
                          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
                            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                              <Store className="w-3 h-3" /> Selling dealer
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={purchase.supplier?.id ? String(purchase.supplier.id) : ""}
                                disabled={Boolean(acting)}
                                onChange={(e) => assignDealer(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white disabled:opacity-50"
                              >
                                <option value="">Private seller (no approved dealer)</option>
                                {dealers.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                    {d.payable ? "" : " — no payout account"}
                                  </option>
                                ))}
                              </select>
                              <QuickAddCounterparty
                                kind="dealer"
                                isAdmin={isAdmin}
                                onAdded={(created) => {
                                  setDealers((prev) =>
                                    [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
                                  );
                                  assignDealer(String(created.id), { alreadyWarned: true });
                                }}
                              />
                              {acting === "dealer" && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                              )}
                            </div>

                            {/* The blocker, stated before the payout button is
                                pressed rather than as a 409 afterwards. */}
                            {purchase.supplier && !purchase.supplier.payable && (
                              <p className="flex items-start gap-1.5 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                                <BanknoteX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>
                                  {purchase.supplier.readiness?.summary ||
                                    "This dealer has no payout account on file."}{" "}
                                  {isAdmin
                                    ? "Add it on the Dealers screen to unblock the purchase."
                                    : "An admin needs to add it before the vehicle can be paid for."}
                                </span>
                              </p>
                            )}
                            {purchase.supplier?.payable && (
                              <p className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                                <BadgeCheck className="w-3.5 h-3.5" />
                                Payout account on file
                                {purchase.supplier.contact_person
                                  ? ` · ${purchase.supplier.contact_person}`
                                  : ""}
                                {purchase.supplier.phone ? ` · ${purchase.supplier.phone}` : ""}
                              </p>
                            )}
                          </div>
                        )}

                        {purchase.payout ? (
                          <p className="text-[11px] text-slate-500">
                            Paid {lkr(purchase.payout.amount)} to{" "}
                            {purchase.payout.supplier_name || "a private seller"} on{" "}
                            {fmtDate(purchase.payout.paid_on)}
                            {purchase.payout.reference_no ? ` · ${purchase.payout.reference_no}` : ""}
                            {purchase.payout.paid_to_bank
                              ? ` · ${purchase.payout.paid_to_bank} ${purchase.payout.paid_to_account}`
                              : ""}
                          </p>
                        ) : (
                          purchase.nextStep?.stage === "payout" && (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                placeholder="Payment reference"
                                value={payoutRef}
                                onChange={(e) => setPayoutRef(e.target.value)}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                              />
                              <button
                                type="button"
                                onClick={payDealer}
                                disabled={Boolean(acting)}
                                className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {acting === "payout" && <Loader2 className="w-3 h-3 animate-spin" />}
                                Pay the Dealer
                              </button>
                            </div>
                          )
                        )}

                        {purchase.payout && (
                          <div className="border-t border-slate-100 pt-3 space-y-2">
                            <p className="text-[11px] text-slate-500">
                              Registration:{" "}
                              <span className="font-semibold text-slate-700">
                                {humanize(purchase.registrationStatus)}
                              </span>
                              {purchase.registration?.submitted_reference &&
                                ` · lodged ${fmtDate(purchase.registration.submitted_at)} (${purchase.registration.submitted_reference})`}
                              {purchase.registration?.cr_number &&
                                ` · CR ${purchase.registration.cr_number}`}
                            </p>

                            {purchase.registrationStatus === "not_started" && (
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="DMT reference"
                                  value={dmtRef}
                                  onChange={(e) => setDmtRef(e.target.value)}
                                  className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => advanceRegistration("submitted")}
                                  disabled={Boolean(acting)}
                                  className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {acting === "submitted" && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Lodge with the DMT
                                </button>
                              </div>
                            )}

                            {purchase.registrationStatus === "submitted" && (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <input
                                  type="text"
                                  placeholder="CR number"
                                  value={crNumber}
                                  onChange={(e) => setCrNumber(e.target.value)}
                                  className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                                />
                                <input
                                  type="text"
                                  placeholder={detail.registration_no || "Registration no."}
                                  value={newRegNo}
                                  onChange={(e) => setNewRegNo(e.target.value)}
                                  className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => advanceRegistration("registered")}
                                  disabled={Boolean(acting)}
                                  className="px-3 py-2 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {acting === "registered" && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Record CR
                                </button>
                              </div>
                            )}

                            {purchase.registrationStatus === "registered" && (
                              <p className="text-[11px] text-emerald-700 font-semibold flex items-start gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                Registered to {purchase.registration.absolute_owner} as absolute owner,
                                with {purchase.registration.registered_user || "the lessee"} as
                                registered user.
                              </p>
                            )}
                          </div>
                        )}

                      </div>
                    )}

                      </>
                    )}
                    {activeTab === "rentals" && (
                      <>
                    {/* The live lease (L7) — activation, rentals, release. */}
                    {purchase?.registrationStatus &&
                      ["registered", "release_issued", "transferred"].includes(
                        purchase.registrationStatus
                      ) && (
                        <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                            <CalendarClock className="w-3.5 h-3.5" /> Lease &amp; Rentals
                          </p>

                          {!agreement?.agreement ? (
                            <>
                              <p className="text-[11px] text-slate-500">
                                The vehicle is registered to us. Activating starts the rental
                                schedule.
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  leaseAction(
                                    "activate",
                                    () => api.post(`/leases/${selected.id}/agreement/activate`, {}),
                                    "Lease Activated",
                                    "The rental schedule has been generated."
                                  )
                                }
                                disabled={Boolean(acting)}
                                className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {acting === "activate" && <Loader2 className="w-3 h-3 animate-spin" />}
                                Activate the Lease
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                                {[
                                  ["Agreement", agreement.agreement.agreement_no],
                                  ["Rental", lkr(agreement.agreement.monthly_rental)],
                                  [
                                    "Paid",
                                    `${agreement.position?.rentalsPaid ?? 0}/${agreement.position?.rentalsTotal ?? 0}`,
                                  ],
                                  ["Outstanding", lkr(agreement.position?.outstanding)],
                                ].map(([k, v]) => (
                                  <div key={k}>
                                    <p className="uppercase font-bold tracking-wider text-slate-400">{k}</p>
                                    <p className="font-mono font-bold text-slate-800">{v}</p>
                                  </div>
                                ))}
                              </div>

                              {agreement.position?.arrears?.count > 0 && (
                                <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                                  {agreement.position.arrears.count} rental(s) overdue —{" "}
                                  {lkr(agreement.position.arrears.amount)}.
                                </p>
                              )}

                              {agreement.agreement.status === "active" && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    placeholder={`Rental (${agreement.agreement.monthly_rental})`}
                                    value={rentalAmount}
                                    onChange={(e) => setRentalAmount(e.target.value)}
                                    className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono bg-white"
                                  />
                                  <select
                                    value={rentalMethod}
                                    onChange={(e) => setRentalMethod(e.target.value)}
                                    className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white"
                                  >
                                    <option value="bank_transfer">Bank transfer</option>
                                    <option value="cash">Cash</option>
                                    <option value="cheque">Cheque</option>
                                    <option value="standing_order">Standing order</option>
                                    <option value="other">Other</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      leaseAction(
                                        "rental",
                                        () =>
                                          api.post(`/leases/${selected.id}/agreement/rentals`, {
                                            amount: Number(rentalAmount),
                                            method: rentalMethod,
                                          }),
                                        "Rental Recorded",
                                        "The schedule has been updated."
                                      ).then(() => setRentalAmount(""))
                                    }
                                    disabled={Boolean(acting) || !(Number(rentalAmount) > 0)}
                                    className="px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    {acting === "rental" && <Loader2 className="w-3 h-3 animate-spin" />}
                                    Record Rental
                                  </button>
                                </div>
                              )}

                              {agreement.position?.fullyPaid &&
                                purchase.registrationStatus === "registered" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      leaseAction(
                                        "release",
                                        () => api.post(`/leases/${selected.id}/agreement/release`),
                                        "Release Letter Issued",
                                        "The lessee can now transfer the vehicle at the DMT."
                                      )
                                    }
                                    disabled={Boolean(acting)}
                                    className="px-3 py-2 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    {acting === "release" && <Loader2 className="w-3 h-3 animate-spin" />}
                                    Issue Release Letter
                                  </button>
                                )}

                              {purchase.registrationStatus === "release_issued" && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] text-slate-500">
                                    Release {purchase.registration.release_letter_no} issued.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      leaseAction(
                                        "transfer",
                                        () =>
                                          api.patch(`/leases/${selected.id}/agreement/transfer`, {}),
                                        "Ownership Transferred",
                                        "The lease is complete."
                                      )
                                    }
                                    disabled={Boolean(acting)}
                                    className="px-3 py-2 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    {acting === "transfer" && <Loader2 className="w-3 h-3 animate-spin" />}
                                    Record DMT Transfer
                                  </button>
                                </div>
                              )}

                              {purchase.registrationStatus === "transferred" && (
                                <p className="text-[11px] text-emerald-700 font-semibold flex items-start gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                  Ownership transferred on{" "}
                                  {fmtDate(purchase.registration.transferred_at)}. This lease is
                                  complete.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      </>
                    )}
                    {activeTab === "decision" && (
                      <>
                    {/* Decision */}
                    <div className="rounded-2xl border border-slate-100 p-4 space-y-3">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Gavel className="w-3.5 h-3.5" /> Decision
                      </p>

                      {approvalBlockedReason && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          {approvalBlockedReason}
                        </p>
                      )}

                      <textarea
                        rows={2}
                        maxLength={1000}
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        placeholder="Note to the applicant (required when rejecting)…"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs resize-none"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => decide("approved")}
                          disabled={Boolean(acting) || Boolean(approvalBlockedReason)}
                          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {acting === "approved" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => decide("under_review")}
                          disabled={Boolean(acting)}
                          className="px-4 py-2 text-xs font-bold text-sky-700 bg-white border border-sky-200 hover:bg-sky-50 rounded-lg disabled:opacity-50"
                        >
                          Move to Review
                        </button>
                        <button
                          type="button"
                          onClick={() => decide("info_requested")}
                          disabled={Boolean(acting)}
                          className="px-4 py-2 text-xs font-bold text-amber-800 bg-white border border-amber-200 hover:bg-amber-50 rounded-lg disabled:opacity-50"
                        >
                          Request Info
                        </button>
                        <button
                          type="button"
                          onClick={() => decide("rejected")}
                          disabled={Boolean(acting)}
                          className="px-4 py-2 text-xs font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {acting === "rejected" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          Reject
                        </button>
                      </div>
                    </div>

                      </>
                    )}

                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

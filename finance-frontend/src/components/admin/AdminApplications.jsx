import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Eye,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Shield,
  FileText,
  AlertTriangle,
  FileCheck,
  DollarSign,
  Sparkles,
  Wallet,
  Percent,
  Loader2,
  RefreshCw,
  Inbox,
  Info,
  History,
  FileSignature,
  Landmark,
  Users,
  FileDown,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import CreditPolicyPanel from "../CreditPolicyPanel";
import PricingBadge from "../PricingBadge";
import AdverseActionPanel from "../AdverseActionPanel";
import LoanDocumentPanel from "../loans/LoanDocumentPanel";

/**
 * The decision matrix's verdict (D2), as a banner above everything a
 * reviewer reads about the application — it is the thing they are being
 * asked to confirm or overrule.
 *
 * `acted` is what separates the two automatic actions in the copy: an
 * auto_reject has already happened and the application is sitting in
 * 'rejected', whereas an auto_approve is only ever a recommendation waiting
 * on a human, because approving issues a binding offer.
 */
const MATRIX_STYLES = {
  auto_approve: {
    label: "Recommends approval",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    panel: "bg-emerald-50/60 border-emerald-200",
    icon: Check,
  },
  manual_review: {
    label: "Manual review",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    panel: "bg-slate-50 border-slate-200",
    icon: Eye,
  },
  auto_reject: {
    label: "Auto-rejected",
    chip: "bg-rose-100 text-rose-800 border-rose-200",
    panel: "bg-rose-50/60 border-rose-200",
    icon: X,
  },
};

function DecisionMatrixBanner({ matrix }) {
  // Applications assessed before D2 have no evaluation. Rendering nothing
  // is honest; a neutral "manual review" badge would claim the matrix ran.
  if (!matrix) return null;
  const style = MATRIX_STYLES[matrix.action] || MATRIX_STYLES.manual_review;
  const Icon = style.icon;
  return (
    <div className={`rounded-2xl border p-4 space-y-2 ${style.panel}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          Decision Matrix
        </h5>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase ${style.chip}`}
        >
          <Icon className="w-3.5 h-3.5" />
          {style.label}
        </span>
      </div>
      <p className="text-xs text-slate-700 leading-relaxed">{matrix.rationale}</p>
      <p className="text-[10px] text-slate-500 leading-relaxed font-mono">
        matrix {matrix.matrix_version} ·{" "}
        {matrix.acted
          ? "decided automatically by the system"
          : "recommendation only — a reviewer decides"}
      </p>
    </div>
  );
}

/**
 * How much of the risk assessment rested on this customer's OWN repayment
 * record with us, versus neutral assumptions.
 *
 * This matters to a reviewer in a way that is easy to miss: a first-time
 * borrower's assessment shows no defaults and no arrears, but that is because
 * we have never lent to them — not because they have a clean record. Without
 * this note the two look identical on screen, and "no evidence of problems"
 * reads as "evidence of no problems".
 *
 * The figures are a snapshot frozen when the model scored the application
 * (migration 043), not today's record, so they always describe what the model
 * actually saw.
 */
function CreditHistoryNote({ history }) {
  // Assessments made before behavioural features existed carry no snapshot.
  // Rendering nothing is honest; a "thin file" badge would assert something
  // that was never measured.
  if (!history) return null;

  const thin = history.is_thin_file || !history.has_internal_history;
  const weight = Math.round(Number(history.evidence_weight || 0) * 100);

  return (
    <div
      className={`rounded-xl border p-3 space-y-1.5 ${
        thin ? "bg-amber-50/70 border-amber-200" : "bg-white/70 border-indigo-100"
      }`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
          Evidence behind this score
        </span>
        <span
          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
            thin ? "bg-amber-200 text-amber-900" : "bg-indigo-100 text-indigo-800"
          }`}
        >
          {thin ? "Thin file" : `${weight}% observed`}
        </span>
      </div>

      {thin ? (
        <p className="text-[11px] text-amber-900 leading-relaxed">
          No meaningful repayment history with us. The credit-behaviour inputs
          fall back to neutral assumptions — this is <strong>not</strong> a
          verified clean record.
        </p>
      ) : (
        <p className="text-[11px] text-slate-600 leading-relaxed">
          Scored using this customer&apos;s own record:{" "}
          {history.accounts_observed} facilit
          {history.accounts_observed === 1 ? "y" : "ies"},{" "}
          {history.installments_concluded} concluded instalment
          {history.installments_concluded === 1 ? "" : "s"},{" "}
          {history.late_installments} paid late
          {history.written_off_accounts > 0
            ? `, ${history.written_off_accounts} written off`
            : ""}
          .
        </p>
      )}

      {history.crib_declaration?.capped ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-800">
            Declared CRIB score contradicts the file
          </p>
          <p className="text-[11px] text-rose-900 leading-relaxed">
            Applicant stated{" "}
            <strong>{history.crib_declaration.declared}</strong>, which that
            default/arrears history could not support. Scored at{" "}
            <strong>{history.crib_declaration.used}</strong> (plausible ceiling{" "}
            {history.crib_declaration.plausible_ceiling}).
          </p>
        </div>
      ) : null}

      <p className="text-[10px] text-slate-400 leading-relaxed">
        No credit-bureau (CRIB) feed is connected; bureau score remains
        self-declared.
      </p>
    </div>
  );
}

const RISK_STYLES = {
  0: { badge: "bg-emerald-50 text-emerald-700 border-emerald-100", bar: "bg-emerald-500" },
  1: { badge: "bg-amber-50 text-amber-700 border-amber-100", bar: "bg-amber-500" },
  2: { badge: "bg-rose-50 text-rose-700 border-rose-100", bar: "bg-rose-500" },
};

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  under_review: "bg-amber-50 text-amber-700 border-amber-100",
  more_info_required: "bg-sky-50 text-sky-700 border-sky-100",
  // Approved now means "offer issued, waiting on the applicant" — an action
  // state, not a finished one.
  approved: "bg-sky-50 text-sky-700 border-sky-100",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-100",
  disbursed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rejected: "bg-rose-50 text-rose-700 border-rose-100",
  withdrawn: "bg-slate-50 text-slate-600 border-slate-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
};

// F2 — staff work queue. sla_status is null for anything already decided
// (see loan.controller.js serializeApplication), rendered as "—" below.
const SLA_STYLES = {
  on_track: "bg-emerald-50 text-emerald-700 border-emerald-100",
  due_soon: "bg-amber-50 text-amber-700 border-amber-100",
  overdue: "bg-rose-50 text-rose-700 border-rose-100",
};
const SLA_LABELS = {
  on_track: "On track",
  due_soon: "Due soon",
  overdue: "Overdue",
};

// How to present each lifecycle move a reviewer can make. Which of these are
// actually offered on a given application comes from the server's
// `allowed_transitions` — this map only decides what the button looks like,
// so the frontend never keeps its own copy of the status machine.
const STATUS_ACTIONS = {
  under_review: {
    label: "Start Review",
    title: "Start Review",
    verb: "move to review",
    icon: Eye,
    tone: "neutral",
    notePlaceholder: "Optional note for the applicant...",
  },
  more_info_required: {
    label: "Request Info",
    title: "Request More Information",
    verb: "request more information on",
    icon: Info,
    tone: "neutral",
    // The note IS the request here — it's what the applicant will be told.
    notePlaceholder: "What does the applicant need to provide?",
    noteRequired: true,
  },
  approved: {
    label: "Approve",
    title: "Approve & Send Offer",
    verb: "approve",
    icon: Check,
    tone: "primary",
    notePlaceholder: "Optional internal note on the decision...",
    irreversible: true,
    // Approving issues the offer the applicant will accept or decline, so
    // this dialog also collects the terms. Left blank, the server offers
    // the recommended amount at the product's rate — see
    // loanOffer.service.js buildOfferTerms.
    collectsOfferTerms: true,
  },
  rejected: {
    label: "Reject",
    title: "Reject Application",
    verb: "reject",
    icon: X,
    tone: "danger",
    notePlaceholder: "Explain the decision in your own words (shown to the applicant)...",
    irreversible: true,
    // Every rejection needs a standardized adverse-action reason (D4) — see
    // the reason picker rendered below, next to the offer-terms block for
    // 'approved'.
    collectsAdverseActionReasons: true,
  },
  disbursed: {
    label: "Mark Disbursed",
    title: "Mark Funds Disbursed",
    verb: "release funds for",
    icon: DollarSign,
    tone: "primary",
    notePlaceholder: "Optional disbursement reference...",
    irreversible: true,
    // H4 — show where the funds would go (or that there's nowhere to send
    // them yet) before staff can confirm. See the beneficiaryAccount fetch
    // effect and the panel rendered below collectsOfferTerms.
    showsBeneficiaryAccount: true,
  },
  closed: {
    label: "Close Loan",
    title: "Close Loan",
    verb: "close",
    icon: FileCheck,
    tone: "neutral",
    notePlaceholder: "Optional closing note...",
    irreversible: true,
  },
};

/**
 * The action config for moving `from` → `to`, with one contextual override:
 * reaching under_review from a REJECTED application is a reopening, not the
 * start of a first review, and calling it "Start Review" would understate
 * what an admin is about to do — undo a decision the applicant has already
 * been told about. (D2; only admins are offered this move at all, which the
 * server decides via allowed_transitions.)
 */
function actionConfig(to, from) {
  const base = STATUS_ACTIONS[to];
  if (!base) return base;
  if (to === "under_review" && from === "rejected") {
    return {
      ...base,
      label: "Reopen",
      title: "Reopen Rejected Application",
      verb: "reopen",
      icon: RefreshCw,
      notePlaceholder: "Why is this rejection being reconsidered?",
      noteRequired: true,
    };
  }
  return base;
}

const TONE_CLASSES = {
  primary:
    "bg-indigo-900 hover:bg-indigo-950 text-white shadow-md shadow-indigo-950/10",
  danger: "bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200",
  neutral:
    "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200",
};

/** "more_info_required" → "more info required", for display. */
const formatStatus = (status) => String(status || "").replace(/_/g, " ");

// Order matches the lifecycle, so the filter dropdown reads as a progression.
const APPLICATION_STATUSES = [
  "pending",
  "under_review",
  "more_info_required",
  "approved",
  "accepted",
  "disbursed",
  "closed",
  "rejected",
  "withdrawn",
];

const STATUS_LABELS = {
  pending: "Pending",
  under_review: "Under Review",
  more_info_required: "More Info Required",
  approved: "Approved (offer sent)",
  accepted: "Offer Accepted",
  disbursed: "Disbursed",
  closed: "Closed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

// Statuses still sitting in a reviewer's queue — the default working set.
// 'approved' is excluded: the ball is in the applicant's court there, not
// the reviewer's.
const OPEN_STATUSES = ["pending", "under_review", "more_info_required"];

/**
 * The lifecycle moves to offer for an application, in a stable order so the
 * buttons don't jump around as the status changes. Anything the server
 * allows but we have no button design for is dropped rather than rendered
 * blank.
 */
const ACTION_ORDER = Object.keys(STATUS_ACTIONS);
const actionsFor = (application) =>
  ACTION_ORDER.filter((status) =>
    (application?.allowed_transitions || []).includes(status)
  );

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

// Calendar dates (due dates, maturity) arrive as bare "YYYY-MM-DD" with no
// time or timezone; new Date() would read those as UTC midnight and render
// the previous day west of UTC. Parse the parts as a LOCAL date instead.
// Full timestamps still go through the normal constructor.
const parseDate = (value) => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
};

const formatDate = (value) =>
  value
    ? parseDate(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

// The applicant-declared fields (see finance-backend mlClient.service.js
// DECLARABLE_FIELDS) — self-reported on the loan application form, not a
// verified bureau record. Every field is optional, so only render what the
// applicant actually filled in.
function buildDeclaredRows(declared) {
  if (!declared) return [];
  const rows = [
    { label: "Marital Status", value: declared.marital_status },
    { label: "Education Level", value: declared.education_level },
    { label: "Occupation", value: declared.occupation },
    { label: "Employer Category", value: declared.employer_category },
    {
      label: "Years With Employer",
      value: declared.years_employed != null ? `${declared.years_employed} yrs` : null,
    },
    {
      label: "Additional Income",
      value:
        declared.additional_income != null
          ? formatCurrency(declared.additional_income)
          : null,
    },
    {
      label: "Other Active Loans",
      value: declared.existing_loans != null ? declared.existing_loans : null,
    },
    {
      label: "Previous Defaults",
      value: declared.previous_defaults != null ? declared.previous_defaults : null,
    },
    {
      label: "CRIB Score",
      value: declared.crib_score != null ? declared.crib_score : null,
    },
    {
      label: "Guarantor Exposure",
      value:
        declared.guarantor_exposure != null
          ? formatCurrency(declared.guarantor_exposure)
          : null,
    },
    {
      label: "Guarantor Defaults",
      value: declared.guarantor_defaults != null ? declared.guarantor_defaults : null,
    },
  ];
  return rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== "");
}

export default function AdminApplications({ focusApplicationId, onFocusHandled }) {
  const { showToast } = useToast();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const [selectedApp, setSelectedApp] = useState(null);
  // F3 — decision letter / statement downloads, tracked separately so one
  // download's spinner never blocks the other.
  const [downloadingLetter, setDownloadingLetter] = useState(false);
  const [downloadingStatement, setDownloadingStatement] = useState(false);
  // { applicationId, status, applicantName } — confirmation step before PATCH.
  const [pendingDecision, setPendingDecision] = useState(null);
  const [decisionNote, setDecisionNote] = useState("");
  // H4 — the applicant's beneficiary account, fetched only when the pending
  // decision is a disbursement (the one action that actually needs it). Lets
  // staff see WHERE funds would go — and whether that's even possible —
  // before they click through and hit the NO_BENEFICIARY_ACCOUNT 409.
  const [beneficiaryAccount, setBeneficiaryAccount] = useState(null);
  const [beneficiaryAccountLoading, setBeneficiaryAccountLoading] = useState(false);
  // D2 override state. Deliberately NOT computed here: whether a decision
  // deviates from the matrix, and which reason codes are legitimate for the
  // direction it deviates in, are the server's rules
  // (decisionMatrix.service.js). The client learns both from the 422 the
  // server returns and renders exactly the codes it was handed — so this
  // dialog can never offer an option the server would then reject.
  const [overridePrompt, setOverridePrompt] = useState(null);
  const [overrideCode, setOverrideCode] = useState("");
  // D4 adverse-action reasons for the Reject dialog. Fetched once, up front
  // — unlike the override catalog (revealed only after a 422, since most
  // decisions never need one), EVERY rejection needs a reason, so waiting
  // for a round trip before showing the picker would mean staff type a
  // note, click Confirm, and get bounced back to fill in something they
  // could have been shown immediately.
  const [adverseActionReasons, setAdverseActionReasons] = useState([]);
  const [selectedReasonCodes, setSelectedReasonCodes] = useState([]);
  // Staff's optional counter-offer, collected when approving. Every field
  // blank = "offer the recommended terms"; the server resolves the
  // fallbacks and computes the EMI, which is never sent from here.
  const EMPTY_OFFER_TERMS = { amount: "", tenure_months: "", interest_rate: "", validity_days: "", note: "" };
  const [offerTerms, setOfferTerms] = useState(EMPTY_OFFER_TERMS);
  // The application whose offer is being replaced, or null. Re-issuing is
  // its own endpoint (POST .../offer) because it does NOT move the status —
  // approved → approved isn't a transition.
  const [reissuing, setReissuing] = useState(null);
  const [actioningId, setActioningId] = useState(null);

  // I1 — the fees this offer will charge, and which of them staff are
  // waiving. Fee CONFIG comes from the product; the resolved amounts shown
  // here are a preview, and the server recomputes them authoritatively at
  // issuance (it never trusts an amount from this dialog — only which fees
  // are waived, and why).
  const [offerFeeConfigs, setOfferFeeConfigs] = useState([]);
  const [offerFeesLoading, setOfferFeesLoading] = useState(false);
  /** { [fee_type]: reason } — presence in this map means "waive it". */
  const [feeWaivers, setFeeWaivers] = useState({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setOfferFeeConfigs([]);
      setFeeWaivers({});
      const productId = pendingDecision?.productId ?? reissuing?.product_id;
      if (!productId) return;

      setOfferFeesLoading(true);
      try {
        const res = await api.get(`/admin/products/${productId}/fees`);
        if (!cancelled) {
          // Only active fees can be charged, so only those are offered for
          // waiving — matching what the server will actually resolve.
          setOfferFeeConfigs((res.data?.fees || []).filter((f) => f.active === 1 || f.active === true));
        }
      } catch {
        // A failed fetch means no waiver UI, not a blocked offer — the
        // server still applies the product's fees correctly either way.
        if (!cancelled) setOfferFeeConfigs([]);
      } finally {
        if (!cancelled) setOfferFeesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingDecision, reissuing]);

  // H4 — fetch lazily, only when the dialog opens for a disbursement.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setBeneficiaryAccount(null);
      if (!pendingDecision || pendingDecision.status !== "disbursed") return;

      setBeneficiaryAccountLoading(true);
      try {
        const res = await api.get(
          `/admin/applications/${pendingDecision.applicationId}/beneficiary-account`
        );
        if (!cancelled) setBeneficiaryAccount(res.data);
      } catch {
        // Treated as "unknown/incomplete" — the confirm button below already
        // fails safe (disabled unless complete === true), so a fetch error
        // here can't accidentally let a disbursement through un-checked.
        if (!cancelled) setBeneficiaryAccount({ complete: false });
      } finally {
        if (!cancelled) setBeneficiaryAccountLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingDecision]);

  // The detail panel's audit-trail tab (migration 022) — fetched on demand
  // when an application is opened, not embedded in the list response, since
  // most applications are never inspected in a given session.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const selectedAppId = selectedApp?.application_id;

  // Which tab of the detail panel is showing. Reset to "overview" every time
  // a DIFFERENT application is opened (not on every re-render of the same
  // one, e.g. after a status update) — adjust-state-during-render, the same
  // pattern used for openedFocusId above, rather than a syncing effect.
  const [detailTab, setDetailTab] = useState("overview");
  const [tabSyncedAppId, setTabSyncedAppId] = useState(selectedAppId);
  if (selectedAppId !== tabSyncedAppId) {
    setTabSyncedAppId(selectedAppId);
    setDetailTab("overview");
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!selectedAppId) {
        setHistory([]);
        setHistoryError("");
        return;
      }
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const res = await api.get(`/loans/${selectedAppId}/history`);
        if (!cancelled) setHistory(res.data?.events || []);
      } catch (err) {
        if (!cancelled) {
          setHistoryError(
            err.response?.data?.message || "Couldn't load the application history."
          );
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedAppId]);

  // Guarantor(s)/collateral pledged against this application (D5) — fetched
  // alongside history, same on-demand reasoning.
  const [security, setSecurity] = useState({ guarantors: [], collateral: [] });
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState("");
  // NIC -> exposure summary, fetched lazily per-guarantor on request rather
  // than for every guarantor on every application open — most applications
  // have zero or one guarantor, and a reviewer only needs this when they're
  // actually deciding whether to trust that person's backing.
  const [guarantorExposure, setGuarantorExposure] = useState({});
  const [exposureLoadingNic, setExposureLoadingNic] = useState(null);
  const [verifyingCollateralId, setVerifyingCollateralId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setGuarantorExposure({});
      if (!selectedAppId) {
        setSecurity({ guarantors: [], collateral: [] });
        setSecurityError("");
        return;
      }
      setSecurityLoading(true);
      setSecurityError("");
      try {
        const res = await api.get(`/loans/${selectedAppId}/security`);
        if (!cancelled) {
          setSecurity({
            guarantors: res.data?.guarantors || [],
            collateral: res.data?.collateral || [],
          });
        }
      } catch (err) {
        if (!cancelled) {
          setSecurityError(
            err.response?.data?.message || "Couldn't load guarantor/collateral details."
          );
        }
      } finally {
        if (!cancelled) setSecurityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedAppId]);

  const loadGuarantorExposure = async (nic) => {
    if (!nic || guarantorExposure[nic] || exposureLoadingNic === nic) return;
    setExposureLoadingNic(nic);
    try {
      const res = await api.get(`/admin/guarantors/${encodeURIComponent(nic)}/exposure`);
      setGuarantorExposure((prev) => ({ ...prev, [nic]: res.data }));
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Load Exposure",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setExposureLoadingNic(null);
    }
  };

  const verifyCollateralItem = async (collateralId, verificationStatus) => {
    if (!selectedAppId || verifyingCollateralId) return;
    setVerifyingCollateralId(collateralId);
    try {
      await api.patch(
        `/admin/applications/${selectedAppId}/collateral/${collateralId}/verify`,
        { verification_status: verificationStatus }
      );
      setSecurity((prev) => ({
        ...prev,
        collateral: prev.collateral.map((c) =>
          c.id === collateralId ? { ...c, verification_status: verificationStatus } : c
        ),
      }));
      showToast({
        type: "success",
        title: verificationStatus === "verified" ? "Collateral Verified" : "Collateral Rejected",
        message: `Item #${collateralId} marked as ${verificationStatus}.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setVerifyingCollateralId(null);
    }
  };

  // The repayment calendar (026) — fetched alongside history, but only when
  // the application actually has an account; most applications never reach
  // disbursement, so this stays empty for them rather than issuing a
  // request that would just return nothing.
  const [schedule, setSchedule] = useState([]);
  // Payments received against this loan, loaded with the schedule (040).
  const [payments, setPayments] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const hasAccount = Boolean(selectedApp?.account);
  // Outstanding / arrears / settlement, derived server-side as-at now.
  const [loanPosition, setLoanPosition] = useState(null);
  // Record-payment dialog. `settlement` mode pre-fills the quoted figure and
  // locks it, because a settlement must be paid in full or not at all — the
  // server refuses anything else (loanModel.recordPayment).
  const EMPTY_PAYMENT = { amount: "", paid_on: "", method: "cash", external_ref: "", note: "" };
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);
  const [paymentMode, setPaymentMode] = useState(null); // null | 'installment' | 'settlement'
  const [savingPayment, setSavingPayment] = useState(false);

  const openPaymentDialog = (mode) => {
    const todayLocal = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    setPaymentForm({
      ...EMPTY_PAYMENT,
      paid_on: `${todayLocal.getFullYear()}-${pad(todayLocal.getMonth() + 1)}-${pad(todayLocal.getDate())}`,
      amount:
        mode === "settlement" ? String(loanPosition?.settlement?.total ?? "") : "",
    });
    setPaymentMode(mode);
  };

  const submitPayment = async () => {
    if (savingPayment || !selectedApp) return;
    setSavingPayment(true);
    try {
      const res = await api.post(`/admin/applications/${selectedApp.application_id}/payments`, {
        amount: Number(paymentForm.amount),
        paid_on: paymentForm.paid_on,
        method: paymentForm.method,
        payment_type: paymentMode,
        external_ref: paymentForm.external_ref.trim() || undefined,
        note: paymentForm.note.trim() || undefined,
      });
      showToast({
        type: "success",
        title: "Payment Recorded",
        message: `${res.data.reference_no} recorded. Outstanding is now ${formatCurrency(
          res.data.outstanding?.total
        )}.`,
      });
      setPaymentMode(null);
      setPaymentForm(EMPTY_PAYMENT);
      // A final payment closes the loan and the application, so refresh the
      // list rather than patching one field.
      await refreshApplications();
      setSelectedApp(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Record Payment",
        message: err.response?.data?.message || "Please check the amount and try again.",
      });
    } finally {
      setSavingPayment(false);
    }
  };

  // Shared with the post-waive refetch below, so waiving a fee doesn't need
  // the heavier refreshApplications()/close-panel round trip a payment does
  // — waiving never changes the application's own status.
  const loadSchedule = async (applicationId) => {
    // Payments come along for the ride (040) — the schedule and the payments
    // that changed it are always looked at together, so fetching them apart
    // would just be two renders of the same view.
    const [res, pmts] = await Promise.all([
      api.get(`/loans/${applicationId}/schedule`),
      api.get(`/loans/${applicationId}/payments`),
    ]);
    return {
      schedule: res.data?.schedule || [],
      payments: pmts.data?.payments || [],
      loanPosition: {
        outstanding: res.data?.outstanding,
        arrears: res.data?.arrears,
        settlement: res.data?.settlement,
      },
    };
  };

  /** Save a payment receipt PDF (040). Authenticated GET, so blob-then-anchor. */
  const downloadReceipt = async (payment) => {
    try {
      const res = await api.get(
        `/loans/${selectedAppId}/payments/${payment.payment_id}/receipt.pdf`,
        { responseType: "blob" }
      );
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `receipt-${payment.reference_no || payment.payment_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch {
      setScheduleError("Couldn't download that receipt.");
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!selectedAppId || !hasAccount) {
        setSchedule([]);
        setPayments([]);
        setLoanPosition(null);
        setScheduleError("");
        return;
      }
      setScheduleLoading(true);
      setScheduleError("");
      try {
        const result = await loadSchedule(selectedAppId);
        if (!cancelled) {
          setSchedule(result.schedule);
          setPayments(result.payments);
          setLoanPosition(result.loanPosition);
        }
      } catch (err) {
        if (!cancelled) {
          setScheduleError(
            err.response?.data?.message || "Couldn't load the repayment schedule."
          );
        }
      } finally {
        if (!cancelled) setScheduleLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedAppId, hasAccount]);

  const [waivingFeeId, setWaivingFeeId] = useState(null);

  const waiveFee = async (scheduleId) => {
    if (waivingFeeId || !selectedApp) return;
    setWaivingFeeId(scheduleId);
    try {
      const res = await api.patch(
        `/admin/applications/${selectedApp.application_id}/schedule/${scheduleId}/waive-fee`
      );
      const result = await loadSchedule(selectedApp.application_id);
      setSchedule(result.schedule);
      setLoanPosition(result.loanPosition);
      showToast({
        type: "success",
        title: "Late Fee Waived",
        message: `${formatCurrency(res.data.waived)} waived.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Waive Fee",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setWaivingFeeId(null);
    }
  };

  // Shared fetch logic — kept state-free so it's safe to call both from the
  // mount effect (via an effect-local closure, per the rules-of-hooks
  // set-state-in-effect check) and directly from the Refresh button.
  const loadApplications = async () => {
    const res = await api.get("/admin/applications");
    return res.data?.applications || [];
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/admin/adverse-action-reasons");
        if (!cancelled) setAdverseActionReasons(res.data?.reasons || []);
      } catch {
        // The Reject dialog degrades to "no suggestions yet" rather than
        // blocking the page — the server still enforces the real
        // requirement regardless of whether this catalog loaded.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshApplications = async () => {
    setLoading(true);
    setError("");
    try {
      setApplications(await loadApplications());
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Couldn't load applications. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const apps = await loadApplications();
        if (!cancelled) setApplications(apps);
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Couldn't load applications. Please try again."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // K2 — open a specific application when arriving from elsewhere (the
  // dashboard home's "recent applications" table), once `applications` has
  // loaded. `openedFocusId` records which request we've already acted on,
  // so this only opens a given id once even though the component re-renders
  // often — the same "adjust state when a prop changes" pattern React's own
  // docs recommend in place of a syncing effect (setSelectedApp here is this
  // component's OWN state, safe to set during render). Notifying the PARENT
  // (onFocusHandled) is a genuine side effect on something outside this
  // component, so that stays in a real effect below rather than firing
  // during render.
  const [openedFocusId, setOpenedFocusId] = useState(null);
  if (focusApplicationId && focusApplicationId !== openedFocusId && applications.length > 0) {
    setOpenedFocusId(focusApplicationId);
    const match = applications.find((a) => a.application_id === focusApplicationId);
    if (match) setSelectedApp(match);
  }

  useEffect(() => {
    if (openedFocusId !== null) onFocusHandled?.();
    // Only re-run when a NEW id has actually been opened, not on every
    // identity change of the callback itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedFocusId]);

  const filteredApps = useMemo(() => {
    const result = applications.filter((app) => {
      const applicantName = `${app.applicant?.first_name || ""} ${app.applicant?.last_name || ""}`.trim();
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        applicantName.toLowerCase().includes(term) ||
        app.applicant?.email?.toLowerCase().includes(term) ||
        String(app.application_id).includes(term);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "open"
          ? OPEN_STATUSES.includes(app.status)
          : app.status === statusFilter);

      return matchesSearch && matchesStatus;
    });

    // F2 — the "Open" filter doubles as the staff work queue: oldest (most
    // overdue) first, so nobody has to sort a general-purpose list by hand
    // to find what's been sitting the longest.
    if (statusFilter === "open") {
      result.sort((a, b) => (b.processing_age_days ?? 0) - (a.processing_age_days ?? 0));
    }

    return result;
  }, [applications, searchTerm, statusFilter]);

  const declaredRows = useMemo(
    () => buildDeclaredRows(selectedApp?.declared),
    [selectedApp]
  );

  // Which tabs the detail panel shows for the currently-open application —
  // Offer/Repayment only appear once there's something to show, so a fresh
  // pending application isn't shown two tabs that would just say "nothing
  // here yet".
  const detailTabs = useMemo(() => {
    if (!selectedApp) return [];
    const tabs = [
      { id: "overview", label: "Overview", icon: Info },
      { id: "security", label: "Guarantor & Collateral", icon: Users },
      { id: "documents", label: "Documents", icon: FileText },
    ];
    if (selectedApp.offer) tabs.push({ id: "offer", label: "Offer & Terms", icon: FileSignature });
    if (selectedApp.account) tabs.push({ id: "repayment", label: "Repayment", icon: Landmark });
    tabs.push({ id: "history", label: "History", icon: History });
    return tabs;
  }, [selectedApp]);

  const totalPages = Math.ceil(filteredApps.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedApps = filteredApps.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  // F3 — fetch as a blob and save it (these are authenticated GETs, not
  // public URLs a plain <a href> could hit), rather than navigate to it.
  const downloadFile = async (url, filename) => {
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  };

  const handleDownloadLetter = async () => {
    if (downloadingLetter || !selectedApp) return;
    setDownloadingLetter(true);
    try {
      await downloadFile(
        `/loans/${selectedApp.application_id}/decision-letter`,
        `decision-letter-app-${selectedApp.application_id}.pdf`
      );
    } catch (err) {
      showToast({
        type: "error",
        title: "Download failed",
        message: err.response?.data?.message || "Couldn't generate the decision letter.",
      });
    } finally {
      setDownloadingLetter(false);
    }
  };

  const handleDownloadStatement = async () => {
    if (downloadingStatement || !selectedApp) return;
    setDownloadingStatement(true);
    try {
      await downloadFile(
        `/loans/${selectedApp.application_id}/statement.csv`,
        `loan-statement-app-${selectedApp.application_id}.csv`
      );
    } catch (err) {
      showToast({
        type: "error",
        title: "Download failed",
        message: err.response?.data?.message || "Couldn't generate the loan statement.",
      });
    } finally {
      setDownloadingStatement(false);
    }
  };

  const applyStatusUpdate = (applicationId, updated) => {
    setApplications((prev) =>
      prev.map((app) =>
        app.application_id === applicationId ? { ...app, ...updated } : app
      )
    );
    setSelectedApp((prev) =>
      prev && prev.application_id === applicationId ? { ...prev, ...updated } : prev
    );
  };

  const requestDecision = (app, status) => {
    setPendingDecision({
      applicationId: app.application_id,
      status,
      from: app.status,
      // Needed to look up the product's fee schedule (I1) for the waiver UI.
      productId: app.product_id,
      applicantName:
        `${app.applicant?.first_name || ""} ${app.applicant?.last_name || ""}`.trim() ||
        app.applicant?.email ||
        `Application #${app.application_id}`,
      // Pre-fill the offer form with what the engine recommended, so staff
      // see the terms they're about to send and can edit rather than guess.
      // Left as-is, the server resolves the identical values itself.
      recommendedAmount: app.recommendation?.recommended_amount,
      requestedAmount: app.requested_amount,
      tenureMonths: app.tenure_months,
    });
    setDecisionNote("");
    setOverridePrompt(null);
    setOverrideCode("");
    setOfferTerms({
      ...EMPTY_OFFER_TERMS,
      amount: app.recommendation?.recommended_amount ?? app.requested_amount ?? "",
      tenure_months: app.tenure_months ?? "",
    });
    // Pre-select what D1's policy verdict already points to (D4) — a
    // starting point, not a forced answer; staff can add to or clear it.
    setSelectedReasonCodes(
      status === "rejected" ? app.policy?.suggested_adverse_action_reasons || [] : []
    );
  };

  const confirmDecision = async () => {
    if (!pendingDecision) return;
    const { applicationId, status } = pendingDecision;
    const action = actionConfig(status, pendingDecision.from);
    const previous = applications.find((a) => a.application_id === applicationId);

    setActioningId(applicationId);
    // Optimistic flip so the row reflects the move immediately. The action
    // buttons are blanked rather than guessed at: which moves are legal from
    // the new status is the server's call, and its response carries the
    // authoritative list a moment later.
    applyStatusUpdate(applicationId, { status, allowed_transitions: [] });

    try {
      // Only send offer terms on the action that issues an offer, and only
      // the fields staff actually filled in — blanks must reach the server
      // as absent so its own fallbacks apply. `emi` is deliberately never
      // sent: the instalment is computed server-side.
      const offer = action?.collectsOfferTerms
        ? Object.fromEntries(
            Object.entries(offerTerms).filter(([, v]) => String(v).trim() !== "")
          )
        : undefined;

      // Fee waivers (I1) — only which fees to waive and why. The amounts
      // themselves are always resolved server-side from the product config.
      if (offer) {
        const waivers = Object.entries(feeWaivers)
          .filter(([, reason]) => String(reason).trim() !== "")
          .map(([fee_type, reason]) => ({ fee_type, reason: reason.trim() }));
        if (waivers.length) offer.fee_waivers = waivers;
      }

      const res = await api.patch(`/admin/applications/${applicationId}/status`, {
        status,
        note: decisionNote.trim() || undefined,
        override_reason_code: overrideCode || undefined,
        // Only meaningful for a rejection (D4) — sending an empty array on
        // every other transition would be harmless (the server ignores it
        // outside 'rejected'), but omitting it keeps the request honest
        // about what this action actually is.
        reason_codes: action?.collectsAdverseActionReasons ? selectedReasonCodes : undefined,
        ...(offer && Object.keys(offer).length ? { offer } : {}),
      });
      applyStatusUpdate(applicationId, res.data);
      showToast({
        type: "success",
        title: `Application ${formatStatus(status)}`,
        message: `Application #${applicationId} is now ${formatStatus(status)}.`,
      });
    } catch (err) {
      // Roll back the optimistic flip, restoring the moves that were on
      // offer before we tried.
      if (previous) {
        applyStatusUpdate(applicationId, {
          status: previous.status,
          allowed_transitions: previous.allowed_transitions,
        });
      }

      // The server is telling us this decision contradicts the matrix and
      // needs a justification (D2). That is not a failure to report and
      // dismiss — it is the dialog asking for one more field, so keep it
      // open with the server's own list of acceptable codes.
      const data = err.response?.data;
      if (err.response?.status === 422 && data?.override_required) {
        setOverridePrompt({
          message: data.message,
          direction: data.override_direction,
          reasons: data.override_reasons || [],
        });
        setActioningId(null);
        return;
      }

      // Belt and braces: the picker is already shown up front for every
      // Reject, so this should only fire if selectedReasonCodes somehow
      // went stale (e.g. the catalog failed to load initially). Surface it
      // as a toast rather than silently reopening the same empty picker.
      if (err.response?.status === 422 && data?.adverse_action_required) {
        if (Array.isArray(data.reasons) && data.reasons.length) {
          setAdverseActionReasons(data.reasons);
        }
        showToast({
          type: "error",
          title: "Reason Required",
          message: data.message,
        });
        setActioningId(null);
        return;
      }

      showToast({
        type: "error",
        title: "Update Failed",
        message: data?.message || `Couldn't ${action?.verb || "update"} this application.`,
      });
    } finally {
      setActioningId(null);
    }

    // Only a completed (or genuinely failed) decision closes the dialog —
    // the override path above returns early so the reviewer keeps their
    // note and terms.
    setPendingDecision(null);
    setDecisionNote("");
    setOverridePrompt(null);
    setOverrideCode("");
    setOfferTerms(EMPTY_OFFER_TERMS);
    setSelectedReasonCodes([]);
  };

  const confirmReissue = async () => {
    if (!reissuing) return;
    const applicationId = reissuing.application_id;
    setActioningId(applicationId);
    try {
      const body = Object.fromEntries(
        Object.entries(offerTerms).filter(([, v]) => String(v).trim() !== "")
      );
      const res = await api.post(`/admin/applications/${applicationId}/offer`, body);
      applyStatusUpdate(applicationId, res.data);
      showToast({
        type: "success",
        title: "Offer Issued",
        message: `A new offer has been sent for application #${applicationId}.`,
      });
      setReissuing(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Issue Offer",
        message: err.response?.data?.message || "Please check the terms and try again.",
      });
    } finally {
      setActioningId(null);
      setOfferTerms(EMPTY_OFFER_TERMS);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
        <div className="relative md:col-span-2">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            placeholder="Search applicant, email, application ID..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 transition-all text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <FileCheck className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="bg-transparent text-xs text-slate-600 font-semibold focus:outline-none cursor-pointer w-full"
          >
            <option value="all">All Review States</option>
            <option value="open">Open (needs attention)</option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={refreshApplications}
          disabled={loading}
          className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Main List */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="p-8">
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!loading && !error && applications.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              No loan applications yet
            </p>
          </div>
        )}

        {!loading && !error && applications.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-6 py-3.5">ID</th>
                  <th className="px-6 py-3.5">Applicant</th>
                  <th className="px-6 py-3.5">Product</th>
                  <th className="px-6 py-3.5">Requested Amount</th>
                  <th className="px-6 py-3.5 text-center">Risk Band</th>
                  <th className="px-6 py-3.5 text-center">Status</th>
                  <th className="px-6 py-3.5 text-center">Age</th>
                  <th className="px-6 py-3.5">Date</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {paginatedApps.length > 0 ? (
                  paginatedApps.map((app) => {
                    const riskStyle = RISK_STYLES[app.risk?.label];
                    const isActioning = actioningId === app.application_id;

                    return (
                      <tr key={app.application_id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-mono text-xs font-semibold text-indigo-950">
                          #{app.application_id}
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-slate-800">
                            {app.applicant?.first_name} {app.applicant?.last_name}
                          </p>
                          <p className="text-[11px] text-slate-400">{app.applicant?.email}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg">
                            {app.product_name || "—"}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono font-bold text-slate-800">
                          {formatCurrency(app.requested_amount)}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {app.risk?.category ? (
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${riskStyle?.badge}`}
                            >
                              {app.risk.category}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase whitespace-nowrap ${
                              STATUS_STYLES[app.status] ||
                              "bg-slate-50 text-slate-600 border-slate-200"
                            }`}
                          >
                            {formatStatus(app.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {app.sla_status ? (
                            <span
                              className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap ${
                                SLA_STYLES[app.sla_status] || "bg-slate-50 text-slate-600 border-slate-200"
                              }`}
                              title={`${app.processing_age_days} day${app.processing_age_days === 1 ? "" : "s"} since last status change`}
                            >
                              {app.processing_age_days}d · {SLA_LABELS[app.sla_status] || app.sla_status}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500 font-mono">
                          {formatDate(app.created_at)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {isActioning ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400 ml-auto" />
                          ) : (
                            <button
                              onClick={() => setSelectedApp(app)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-800 hover:bg-indigo-50 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Review
                              {actionsFor(app).length > 0 && (
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Awaiting a decision" />
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                      No applications matched the specified filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3 bg-slate-50/20 text-xs">
            <span className="text-slate-500 font-medium">
              Showing <span className="text-slate-800 font-bold">{startIndex + 1}</span> to{" "}
              <span className="text-slate-800 font-bold">
                {Math.min(startIndex + itemsPerPage, filteredApps.length)}
              </span>{" "}
              of <span className="text-slate-800 font-bold">{filteredApps.length}</span> entries
            </span>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => handlePageChange(i + 1)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all border ${currentPage === i + 1 ? "bg-indigo-900 text-white border-indigo-900 shadow-sm shadow-indigo-950/10" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedApp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs"
              onClick={() => setSelectedApp(null)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed top-0 right-0 h-full w-full max-w-3xl bg-white z-50 shadow-2xl flex flex-col"
            >
              {/* Header — applicant, status, and the quick facts a reviewer
                  needs regardless of which tab they're on. Never scrolls. */}
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 shrink-0">
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-black text-lg text-slate-900 truncate">
                        {selectedApp.applicant?.first_name} {selectedApp.applicant?.last_name}
                      </h3>
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase whitespace-nowrap ${
                          STATUS_STYLES[selectedApp.status] ||
                          "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                      >
                        {formatStatus(selectedApp.status)}
                      </span>
                      {selectedApp.risk?.category && (
                        <span
                          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${RISK_STYLES[selectedApp.risk.label]?.badge}`}
                        >
                          {selectedApp.risk.category}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-400 text-xs mt-0.5">
                      #{selectedApp.application_id} · {selectedApp.applicant?.email}
                    </p>
                    <p className="text-xs text-slate-600 mt-1.5">
                      <span className="font-bold text-indigo-900">
                        {formatCurrency(selectedApp.requested_amount)}
                      </span>{" "}
                      · {selectedApp.tenure_months} mo · {selectedApp.product_name || "—"} ·
                      Submitted {formatDate(selectedApp.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedApp(null)}
                    className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Tab bar — never scrolls, so switching sections never
                  requires re-finding where you were. */}
              <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 overflow-x-auto shrink-0 bg-white">
                {detailTabs.map(({ id, label, icon: TabIcon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDetailTab(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                      detailTab === id
                        ? "bg-indigo-900 text-white"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Scrollable tab content. */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {detailTab === "overview" && (
                <>
                {selectedApp.info_request && (
                  <div className="p-4 bg-sky-50 border border-sky-100 rounded-2xl text-xs space-y-2">
                    <div>
                      <span className="font-bold text-sky-700">
                        Requested {formatDate(selectedApp.info_request.requested_at)}:
                      </span>{" "}
                      <span className="text-slate-800">{selectedApp.info_request.note}</span>
                    </div>
                    {selectedApp.info_request.response ? (
                      <div className="pt-2 border-t border-sky-100">
                        <span className="font-bold text-emerald-700">
                          Applicant replied {formatDate(selectedApp.info_request.responded_at)}:
                        </span>{" "}
                        <span className="text-slate-800">{selectedApp.info_request.response}</span>
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-sky-100 text-slate-400 italic">
                        Awaiting the applicant's response.
                      </div>
                    )}
                  </div>
                )}

                {declaredRows.length > 0 && (
                  <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-100 space-y-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <h5 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-amber-600" />
                        Applicant-Declared Details
                      </h5>
                      <span className="text-[9px] text-amber-700 font-bold uppercase bg-amber-100 px-1.5 py-0.5 rounded">
                        Self-reported
                      </span>
                    </div>
                    {declaredRows.map((row) => (
                      <div key={row.label} className="flex justify-between text-xs">
                        <span className="text-slate-500">{row.label}</span>
                        <span className="font-semibold text-slate-800">{row.value}</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-amber-700/70 pt-1 leading-relaxed">
                      Entered by the applicant on the loan form — not verified
                      against a credit bureau.
                    </p>
                  </div>
                )}

                {/* The system's own verdict comes first — it is what a
                    reviewer is being asked to confirm or overrule. */}
                <DecisionMatrixBanner matrix={selectedApp.decision_matrix} />

                {/* Policy sits ABOVE the risk block on purpose: the
                    mandatory criteria are what a reviewer must clear before
                    the model's opinion is even relevant. detailed shows
                    every rule, including the ones that could not be
                    evaluated for want of declared data. */}
                <CreditPolicyPanel policy={selectedApp.policy} detailed />

                {selectedApp.risk?.probabilities && (
                  <div className="space-y-4 bg-indigo-50/40 p-5 rounded-2xl border border-indigo-100/40">
                    <div>
                      <h5 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-indigo-600" />
                        AI Risk Assessment
                      </h5>
                    </div>

                    {/* Probability of default leads, because it is the one
                        number that means something on its own — the three
                        bars below are the outcome distribution it comes from,
                        and the risk band is a policy cut-off applied to it. */}
                    <div className="flex items-baseline justify-between gap-3 pb-3 border-b border-indigo-100/70">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Probability of Default
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Chance this facility is charged off
                        </p>
                      </div>
                      <span className="text-2xl font-bold font-mono text-indigo-900">
                        {formatPercent(
                          selectedApp.risk.probability_of_default ??
                            selectedApp.risk.probabilities["High Risk"]
                        )}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Predicted repayment outcome
                      </p>
                      {Object.entries(selectedApp.risk.probabilities).map(([label, prob]) => {
                        const idx = label === "Low Risk" ? 0 : label === "Medium Risk" ? 1 : 2;
                        // The model predicts an observed OUTCOME, so name the
                        // outcome rather than repeating the band label.
                        const outcome = ["Repaid cleanly", "Repaid, but late", "Defaulted"][idx];
                        return (
                          <div key={label}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-600">{outcome}</span>
                              <span className="font-mono font-semibold text-slate-800">
                                {formatPercent(prob)}
                              </span>
                            </div>
                            <div className="w-full h-2.5 bg-white rounded-full overflow-hidden border border-indigo-100/60">
                              <div
                                style={{ width: `${Math.round(Number(prob || 0) * 100)}%` }}
                                className={`h-full rounded-full ${RISK_STYLES[idx].bar}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <CreditHistoryNote history={selectedApp.credit_history} />
                  </div>
                )}

                {selectedApp.recommendation && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                        <Wallet className="w-3.5 h-3.5" />
                        <span className="text-[10px] uppercase font-semibold tracking-wider">
                          Recommended Amount
                        </span>
                      </div>
                      <span className="text-sm font-bold text-slate-800 font-mono">
                        {formatCurrency(selectedApp.recommendation.recommended_amount)}
                      </span>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                        <Percent className="w-3.5 h-3.5" />
                        <span className="text-[10px] uppercase font-semibold tracking-wider">
                          Recommended EMI
                        </span>
                      </div>
                      <span className="text-sm font-bold text-slate-800 font-mono">
                        {formatCurrency(selectedApp.recommendation.recommended_emi)} / mo
                      </span>
                    </div>
                  </div>
                )}

                {/* The rate the EMI above was actually computed from (D3).
                    English labels — staff tooling stays English by project
                    convention (see CreditPolicyPanel's DEFAULT_LABELS). */}
                <PricingBadge pricing={selectedApp.pricing} detailed />

                {selectedApp.explanation && (
                  <div className="bg-indigo-50/40 border border-indigo-100 rounded-2xl p-4 flex items-start space-x-3">
                    <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider">
                        AI Explanation
                      </h4>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                        {selectedApp.explanation}
                      </p>
                    </div>
                  </div>
                )}

                {/* The standardized reasons behind a rejection (D4) —
                    detailed shows the immutable model/policy/matrix
                    snapshot alongside them. null on anything never
                    rejected. */}
                <AdverseActionPanel adverseAction={selectedApp.adverse_action} detailed />
                </>
              )}

              {detailTab === "security" && (
                /* Guarantor(s)/collateral pledged against this application
                   (D5) — the real data behind CreditPolicyPanel's
                   GUARANTOR_RELIABILITY/COLLATERAL_COVERAGE rules in
                   Overview. Fetched on demand when the application opens;
                   see the security/securityLoading state. */
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-5 space-y-4">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-slate-500" />
                      Guarantor &amp; Collateral
                    </h4>

                    {securityLoading && (
                      <p className="text-xs text-slate-400 flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                      </p>
                    )}
                    {securityError && <p className="text-xs text-rose-600">{securityError}</p>}

                    {!securityLoading &&
                      !securityError &&
                      security.guarantors.length === 0 &&
                      security.collateral.length === 0 && (
                        <p className="text-xs text-slate-400">
                          No guarantor or collateral pledged on this application.
                        </p>
                      )}

                    {security.guarantors.length > 0 && (
                      <div className="space-y-2.5">
                        <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                          Guarantors
                        </p>
                        {security.guarantors.map((g) => {
                          const exposure = g.nic ? guarantorExposure[g.nic] : null;
                          return (
                            <div
                              key={g.id}
                              className="bg-white rounded-xl border border-slate-100 p-3 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs">
                                  <span className="font-semibold text-slate-800">{g.full_name}</span>
                                  {g.relationship_to_applicant && (
                                    <span className="text-slate-400"> · {g.relationship_to_applicant}</span>
                                  )}
                                  {g.nic && (
                                    <span className="block text-[10px] text-slate-400 font-mono">
                                      {g.nic}
                                      {g.phone ? ` · ${g.phone}` : ""}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs font-bold text-slate-800 font-mono shrink-0">
                                  {formatCurrency(g.guaranteed_amount)}
                                </span>
                              </div>
                              {g.nic && (
                                <div>
                                  {!exposure ? (
                                    <button
                                      type="button"
                                      onClick={() => loadGuarantorExposure(g.nic)}
                                      disabled={exposureLoadingNic === g.nic}
                                      className="text-[10px] font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
                                    >
                                      {exposureLoadingNic === g.nic
                                        ? "Loading exposure…"
                                        : "View exposure across other loans"}
                                    </button>
                                  ) : (
                                    <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                                      <span
                                        className={
                                          exposure.distressed_guarantee_count > 0
                                            ? "text-rose-600 font-semibold"
                                            : "text-slate-600"
                                        }
                                      >
                                        Backing {exposure.active_guarantee_count} active
                                        facilit{exposure.active_guarantee_count === 1 ? "y" : "ies"}, total{" "}
                                        {formatCurrency(exposure.total_active_exposure)}
                                        {exposure.distressed_guarantee_count > 0 &&
                                          ` — ${exposure.distressed_guarantee_count} overdue elsewhere`}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {security.collateral.length > 0 && (
                      <div className="space-y-2.5">
                        <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                          Collateral
                        </p>
                        {security.collateral.map((c) => (
                          <div
                            key={c.id}
                            className="bg-white rounded-xl border border-slate-100 p-3 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs">
                                <span className="font-semibold text-slate-800 capitalize">
                                  {c.collateral_type.replace(/_/g, " ")}
                                </span>
                                {c.description && (
                                  <span className="text-slate-400"> — {c.description}</span>
                                )}
                                {c.ownership_reference && (
                                  <span className="block text-[10px] text-slate-400 font-mono">
                                    {c.ownership_reference}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs font-bold text-slate-800 font-mono shrink-0">
                                {formatCurrency(c.estimated_value)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                                  c.verification_status === "verified"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                    : c.verification_status === "rejected"
                                      ? "bg-rose-50 text-rose-700 border-rose-100"
                                      : "bg-amber-50 text-amber-700 border-amber-100"
                                }`}
                              >
                                {c.verification_status.replace(/_/g, " ")}
                              </span>
                              {c.verification_status === "self_declared" && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => verifyCollateralItem(c.id, "verified")}
                                    disabled={verifyingCollateralId === c.id}
                                    className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50 flex items-center gap-0.5"
                                  >
                                    <Check className="w-3 h-3" /> Verify
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => verifyCollateralItem(c.id, "rejected")}
                                    disabled={verifyingCollateralId === c.id}
                                    className="text-[10px] font-semibold text-rose-600 hover:text-rose-800 disabled:opacity-50 flex items-center gap-0.5"
                                  >
                                    <X className="w-3 h-3" /> Reject
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              {detailTab === "documents" && (
                /* Supporting documents the applicant has uploaded (NIC,
                   payslip, bank statement) — E1. Advisory only: verifying
                   or rejecting a document here never changes the
                   application's own status. */
                <LoanDocumentPanel
                  applicationId={selectedApp.application_id}
                  canUpload={false}
                  canVerify
                />
              )}

              {detailTab === "repayment" && selectedApp.account && (
                  <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5 text-emerald-700">
                        <Landmark className="w-3.5 h-3.5" />
                        <span className="text-[10px] uppercase font-semibold tracking-wider">
                          Loan Account
                        </span>
                        <span className="font-mono text-xs text-slate-600 ml-1">
                          {selectedApp.account.account_no}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase bg-white text-emerald-700 border-emerald-200">
                        {formatStatus(selectedApp.account.status)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {[
                        ["Principal", formatCurrency(selectedApp.account.principal)],
                        ["Instalment", `${formatCurrency(selectedApp.account.emi)} / mo`],
                        [
                          "Rate",
                          `${selectedApp.account.interest_rate}% ${selectedApp.account.rate_type}`,
                        ],
                        ["Tenure", `${selectedApp.account.tenure_months} months`],
                        ["Disbursed", formatDate(selectedApp.account.disbursed_at)],
                        ["First due", formatDate(selectedApp.account.first_due_date)],
                        ["Matures", formatDate(selectedApp.account.maturity_date)],
                        [
                          "Total repayable",
                          formatCurrency(selectedApp.account.total_repayable),
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                            {label}
                          </span>
                          <span className="font-mono font-bold text-slate-800">{value}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleDownloadStatement}
                      disabled={downloadingStatement}
                      className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors disabled:opacity-50"
                    >
                      {downloadingStatement ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      Download Statement (CSV)
                    </button>

                    {loanPosition && (
                      <div className="mt-4 pt-3 border-t border-emerald-100">
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                              Outstanding
                            </span>
                            <span className="font-mono font-bold text-slate-800">
                              {formatCurrency(loanPosition.outstanding?.total)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                              Arrears
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                loanPosition.arrears?.isInArrears
                                  ? "text-rose-600"
                                  : "text-slate-800"
                              }`}
                            >
                              {formatCurrency(loanPosition.arrears?.arrearsAmount)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                              Days past due
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                loanPosition.arrears?.daysPastDue > 0
                                  ? "text-rose-600"
                                  : "text-slate-800"
                              }`}
                            >
                              {loanPosition.arrears?.daysPastDue ?? 0}
                            </span>
                          </div>
                        </div>

                        {selectedApp.account.status === "active" && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              onClick={() => openPaymentDialog("installment")}
                              className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold text-white bg-indigo-900 hover:bg-indigo-950 rounded-lg"
                            >
                              <Wallet className="w-3.5 h-3.5" /> Record Payment
                            </button>
                            {loanPosition.settlement && (
                              <button
                                onClick={() => openPaymentDialog("settlement")}
                                className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                              >
                                Settle Early ({formatCurrency(loanPosition.settlement.total)})
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-emerald-100">
                      <div className="flex items-center gap-1.5 text-emerald-700 mb-2">
                        <History className="w-3 h-3" />
                        <span className="text-[10px] uppercase font-semibold tracking-wider">
                          Repayment Schedule
                        </span>
                      </div>
                      {scheduleLoading && (
                        <div className="flex items-center py-2 text-slate-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      )}
                      {!scheduleLoading && scheduleError && (
                        <p className="text-xs text-rose-600">{scheduleError}</p>
                      )}
                      {!scheduleLoading && !scheduleError && schedule.length > 0 && (
                        <div className="overflow-x-auto -mx-1 max-h-64 overflow-y-auto">
                          <table className="w-full text-[11px] min-w-[480px]">
                            <thead className="sticky top-0 bg-emerald-50">
                              <tr className="text-slate-400 uppercase text-[9px] tracking-wider">
                                <th className="text-left font-semibold px-1 py-1">#</th>
                                <th className="text-left font-semibold px-1 py-1">Due</th>
                                <th className="text-right font-semibold px-1 py-1">Principal</th>
                                <th className="text-right font-semibold px-1 py-1">Interest</th>
                                <th className="text-right font-semibold px-1 py-1">EMI</th>
                                <th className="text-right font-semibold px-1 py-1">Balance</th>
                                <th className="text-right font-semibold px-1 py-1">Late Fee</th>
                                <th className="text-right font-semibold px-1 py-1">Owing</th>
                                <th className="text-right font-semibold px-1 py-1">Status</th>
                                <th className="text-right font-semibold px-1 py-1"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {schedule.map((row) => (
                                <tr
                                  key={row.installment_no}
                                  className="border-t border-emerald-100/60 font-mono text-slate-700"
                                >
                                  <td className="px-1 py-1">{row.installment_no}</td>
                                  <td className="px-1 py-1 whitespace-nowrap">
                                    {formatDate(row.due_date)}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {formatCurrency(row.principal_component)}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {formatCurrency(row.interest_component)}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {formatCurrency(row.emi)}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {formatCurrency(row.closing_balance)}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {row.late_fee_amount > 0 ? (
                                      <span
                                        className={
                                          row.late_fee_amount - row.late_fee_paid - row.late_fee_waived > 0
                                            ? "text-rose-600 font-bold"
                                            : "text-slate-400 line-through"
                                        }
                                      >
                                        {formatCurrency(row.late_fee_amount)}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300">—</span>
                                    )}
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {formatCurrency(row.outstanding)}
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
                                      {row.status}
                                    </span>
                                  </td>
                                  <td className="px-1 py-1 text-right">
                                    {row.late_fee_amount - row.late_fee_paid - row.late_fee_waived >
                                      0 && (
                                      <button
                                        onClick={() => waiveFee(row.schedule_id)}
                                        disabled={waivingFeeId === row.schedule_id}
                                        className="text-[9px] font-sans font-bold text-indigo-800 hover:text-indigo-950 underline disabled:opacity-50"
                                      >
                                        {waivingFeeId === row.schedule_id ? "…" : "Waive"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Payments received, with receipts (040). Staff need the
                        receipt too — a customer who has lost theirs asks the
                        bank, and card payments have no staff member to ask. */}
                    {payments.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-emerald-100">
                        <div className="flex items-center gap-1.5 text-emerald-700 mb-2">
                          <Wallet className="w-3 h-3" />
                          <span className="text-[10px] uppercase font-semibold tracking-wider">
                            Payments Received
                          </span>
                        </div>
                        <ul className="space-y-1">
                          {payments.map((p) => (
                            <li
                              key={p.payment_id}
                              className="flex items-center justify-between gap-2 text-[11px] bg-white border border-emerald-100 rounded-lg px-2.5 py-1.5"
                            >
                              <span className="min-w-0">
                                <span className="font-mono font-bold text-slate-700">
                                  {formatCurrency(p.amount)}
                                </span>
                                <span className="text-slate-400">
                                  {" · "}
                                  {formatDate(p.paid_on)}
                                  {" · "}
                                  {p.reference_no}
                                  {" · "}
                                  {p.recorded_by_name || "paid online by customer"}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => downloadReceipt(p)}
                                className="flex items-center gap-1 text-indigo-800 hover:underline font-semibold shrink-0"
                              >
                                <FileDown className="w-3 h-3" /> Receipt
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

              {detailTab === "offer" && selectedApp.offer && (
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <FileSignature className="w-3.5 h-3.5" />
                        <span className="text-[10px] uppercase font-semibold tracking-wider">
                          Offer
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                          selectedApp.offer.status === "accepted"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                            : selectedApp.offer.status === "pending"
                              ? "bg-sky-50 text-sky-700 border-sky-100"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                        }`}
                      >
                        {formatStatus(selectedApp.offer.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {[
                        ["Amount", formatCurrency(selectedApp.offer.amount)],
                        ["Instalment", `${formatCurrency(selectedApp.offer.emi)} / mo`],
                        ["Tenure", `${selectedApp.offer.tenure_months} months`],
                        [
                          "Rate",
                          `${selectedApp.offer.interest_rate}% ${selectedApp.offer.rate_type}`,
                        ],
                        ["Total repayable", formatCurrency(selectedApp.offer.total_repayable)],
                        ["Expires", formatDate(selectedApp.offer.expires_at)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <span className="block text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                            {label}
                          </span>
                          <span className="font-mono font-bold text-slate-800">{value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Fees actually quoted on this offer (I1) — the snapshot,
                        not the product's current config, so a later re-pricing
                        never rewrites what this customer was told. */}
                    {Array.isArray(selectedApp.offer.fees) &&
                      selectedApp.offer.fees.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-200 text-xs">
                          <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-1.5">
                            Fees (deducted from payout)
                          </p>
                          {selectedApp.offer.fees.map((fee) => (
                            <div
                              key={fee.fee_type}
                              className="flex justify-between gap-2 py-0.5"
                            >
                              <span className="text-slate-500">
                                {fee.label}
                                {fee.calc_method === "percentage"
                                  ? ` (${fee.rate_or_amount}%)`
                                  : ""}
                                {fee.waived && fee.waived_reason && (
                                  <span className="italic text-amber-700">
                                    {" "}
                                    — waived: {fee.waived_reason}
                                  </span>
                                )}
                              </span>
                              <span
                                className={`font-mono shrink-0 ${fee.waived ? "line-through text-slate-400" : "text-slate-700"}`}
                              >
                                {formatCurrency(fee.amount)}
                              </span>
                            </div>
                          ))}
                          <div className="flex justify-between gap-2 pt-1.5 mt-1 border-t border-slate-100 font-bold">
                            <span className="text-slate-600">Net disbursed</span>
                            <span className="font-mono text-emerald-700">
                              {formatCurrency(selectedApp.offer.net_disbursed)}
                            </span>
                          </div>
                          {selectedApp.offer.effective_apr != null && (
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-500">Effective APR</span>
                              <span className="font-mono font-bold text-slate-700">
                                {selectedApp.offer.effective_apr}%
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                    {selectedApp.offer.note && (
                      <p className="text-xs text-slate-600 mt-3 italic">
                        "{selectedApp.offer.note}"
                      </p>
                    )}
                    {selectedApp.offer.response_note && (
                      <p className="text-xs text-slate-600 mt-2">
                        <span className="font-bold text-slate-500">Applicant said: </span>
                        {selectedApp.offer.response_note}
                      </p>
                    )}

                    {selectedApp.status === "approved" && (
                      <button
                        onClick={() => {
                          setOfferTerms({
                            ...EMPTY_OFFER_TERMS,
                            amount: selectedApp.offer.amount ?? "",
                            tenure_months: selectedApp.offer.tenure_months ?? "",
                          });
                          setReissuing(selectedApp);
                        }}
                        disabled={actioningId === selectedApp.application_id}
                        className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-800 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Issue a replacement offer
                      </button>
                    )}
                  </div>
                )}

              {detailTab === "history" && (
                <>
                {selectedApp.decision && (
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs space-y-1.5">
                    <div>
                      <span className="font-bold text-slate-500">Decided by: </span>
                      <span className="text-slate-800 font-semibold">
                        {/* A NULL decided_by with source 'system' is the
                            decision matrix having decided by itself, not an
                            unknown reviewer — see D2. */}
                        {selectedApp.decision.source === "system"
                          ? "Decision matrix (automatic)"
                          : selectedApp.decision.decided_by_name ||
                            `Staff #${selectedApp.decision.decided_by}`}
                      </span>
                    </div>
                    {selectedApp.decision.override_reason_code && (
                      <div className="flex items-start gap-1.5 pt-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-amber-700">Override: </span>
                          <span className="text-amber-900 font-mono">
                            {selectedApp.decision.override_reason_code}
                          </span>
                          <span className="text-slate-500">
                            {" "}
                            — this decision went against the system's recommendation.
                          </span>
                        </div>
                      </div>
                    )}
                    <div>
                      <span className="font-bold text-slate-500">Decided at: </span>
                      <span className="text-slate-800">{formatDate(selectedApp.decision.decided_at)}</span>
                    </div>
                    {selectedApp.decision.note && (
                      <div>
                        <span className="font-bold text-slate-500">Note: </span>
                        <span className="text-slate-800">{selectedApp.decision.note}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleDownloadLetter}
                      disabled={downloadingLetter}
                      className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:underline disabled:opacity-50 pt-1"
                    >
                      {downloadingLetter ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      Download Decision Letter (PDF)
                    </button>
                  </div>
                )}

                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-3">
                    <History className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase font-semibold tracking-wider">
                      Full History
                    </span>
                  </div>

                  {historyLoading && (
                    <div className="flex items-center justify-center py-4 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  )}

                  {!historyLoading && historyError && (
                    <p className="text-xs text-rose-600">{historyError}</p>
                  )}

                  {!historyLoading && !historyError && (
                    <ol className="space-y-3">
                      {history.map((ev) => (
                        <li key={ev.id} className="flex gap-3 text-xs">
                          <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300" />
                          <div className="min-w-0 flex-1">
                            <p className="text-slate-700">
                              {ev.from_status ? (
                                <>
                                  <span className="font-semibold">{formatStatus(ev.from_status)}</span>
                                  {" → "}
                                </>
                              ) : (
                                <span className="text-slate-400">Created as </span>
                              )}
                              <span className="font-semibold">{formatStatus(ev.to_status)}</span>
                            </p>
                            <p className="text-slate-400 mt-0.5">
                              {formatDate(ev.created_at)}
                              {ev.actor_name && ` · ${ev.actor_name}`}
                              {ev.actor_role && ` (${ev.actor_role})`}
                            </p>
                            {ev.note && <p className="text-slate-600 mt-1 italic">"{ev.note}"</p>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                </>
              )}
              </div>

              {/* Sticky action footer — always visible regardless of which
                  tab is open, so deciding an application never requires
                  scrolling back up to find the buttons. */}
              <div className="border-t border-slate-100 p-4 shrink-0 bg-white flex flex-wrap justify-end gap-3">
                {actionsFor(selectedApp).length > 0 ? (
                  actionsFor(selectedApp).map((status) => {
                    const action = actionConfig(status, selectedApp.status);
                    const ActionIcon = action.icon;
                    return (
                      <button
                        key={status}
                        onClick={() => requestDecision(selectedApp, status)}
                        disabled={actioningId === selectedApp.application_id}
                        className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${TONE_CLASSES[action.tone]}`}
                      >
                        <ActionIcon className="w-4 h-4" /> {action.label}
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                    <FileCheck className="w-4 h-4 text-slate-400" />
                    NO FURTHER ACTION ({formatStatus(selectedApp.status).toUpperCase()})
                  </span>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Record-payment dialog. In 'settlement' mode the amount is fixed to
          the quoted figure — the server refuses a partial settlement, since
          underpaying would hand over the interest waiver without closing the
          loan. */}
      <AnimatePresence>
        {paymentMode && selectedApp && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-800">
                  <Wallet className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900">
                  {paymentMode === "settlement" ? "Early Settlement" : "Record Payment"}
                </h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                {paymentMode === "settlement"
                  ? `Settle loan ${selectedApp.account?.account_no} in full. Interest on future instalments is waived.`
                  : `Against loan ${selectedApp.account?.account_no}. Outstanding ${formatCurrency(
                      loanPosition?.outstanding?.total
                    )}.`}
              </p>

              <div className="space-y-2 mb-4">
                <label className="block">
                  <span className="block text-[10px] font-semibold text-slate-500 mb-1">
                    Amount (LKR)
                  </span>
                  <input
                    type="number"
                    value={paymentForm.amount}
                    readOnly={paymentMode === "settlement"}
                    onChange={(e) =>
                      setPaymentForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    className={`w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800 ${
                      paymentMode === "settlement" ? "bg-slate-50 text-slate-500" : ""
                    }`}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[10px] font-semibold text-slate-500 mb-1">
                      Value date
                    </span>
                    <input
                      type="date"
                      value={paymentForm.paid_on}
                      onChange={(e) =>
                        setPaymentForm((p) => ({ ...p, paid_on: e.target.value }))
                      }
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] font-semibold text-slate-500 mb-1">
                      Method
                    </span>
                    <select
                      value={paymentForm.method}
                      onChange={(e) =>
                        setPaymentForm((p) => ({ ...p, method: e.target.value }))
                      }
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:border-indigo-800"
                    >
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="standing_order">Standing order</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                </div>
                <input
                  type="text"
                  value={paymentForm.external_ref}
                  onChange={(e) =>
                    setPaymentForm((p) => ({ ...p, external_ref: e.target.value }))
                  }
                  placeholder="Receipt / transaction reference (optional)"
                  maxLength={100}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800"
                />
                <input
                  type="text"
                  value={paymentForm.note}
                  onChange={(e) => setPaymentForm((p) => ({ ...p, note: e.target.value }))}
                  placeholder="Note (optional)"
                  maxLength={500}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800"
                />
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPaymentMode(null)}
                  disabled={savingPayment}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitPayment}
                  disabled={
                    savingPayment || !paymentForm.amount || !paymentForm.paid_on
                  }
                  className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 bg-indigo-900 hover:bg-indigo-950 text-white"
                >
                  {savingPayment && <Loader2 className="w-4 h-4 animate-spin" />}
                  Record
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Replacement-offer dialog. Separate from the decision dialog because
          re-issuing doesn't move the application's status at all. */}
      <AnimatePresence>
        {reissuing && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="p-2 rounded-xl bg-slate-100 text-slate-600">
                  <FileSignature className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900">Issue Replacement Offer</h3>
              </div>
              <p className="text-sm text-slate-600 mb-4">
                This supersedes the current offer on application #
                {reissuing.application_id} and notifies the applicant.
              </p>

              <div className="grid grid-cols-2 gap-2 mb-2">
                {[
                  ["amount", "Amount (LKR)"],
                  ["tenure_months", "Tenure (months)"],
                  ["interest_rate", "Rate % (blank = product)"],
                  ["validity_days", "Valid for (days)"],
                ].map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="block text-[10px] font-semibold text-slate-500 mb-1">
                      {label}
                    </span>
                    <input
                      type="number"
                      value={offerTerms[key]}
                      onChange={(e) =>
                        setOfferTerms((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800"
                    />
                  </label>
                ))}
              </div>
              <input
                type="text"
                value={offerTerms.note}
                onChange={(e) => setOfferTerms((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Covering note shown to the applicant..."
                maxLength={500}
                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800 mb-4"
              />

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setReissuing(null);
                    setOfferTerms(EMPTY_OFFER_TERMS);
                  }}
                  disabled={actioningId === reissuing.application_id}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmReissue}
                  disabled={actioningId === reissuing.application_id}
                  className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 bg-indigo-900 hover:bg-indigo-950 text-white"
                >
                  {actioningId === reissuing.application_id && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  Send Offer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm decision dialog */}
      <AnimatePresence>
        {pendingDecision && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              {(() => {
                const action = actionConfig(pendingDecision.status, pendingDecision.from);
                const DialogIcon = action.icon;
                const busy = actioningId === pendingDecision.applicationId;
                // An override, or a rejection's adverse-action reasons,
                // both need a written explanation alongside the code(s) —
                // a checkbox/dropdown selection on its own isn't one.
                const noteMissing =
                  (action.noteRequired || overridePrompt || action.collectsAdverseActionReasons) &&
                  !decisionNote.trim();
                const overrideMissing = Boolean(overridePrompt) && !overrideCode;
                const reasonCodesMissing =
                  Boolean(action.collectsAdverseActionReasons) && selectedReasonCodes.length === 0;
                // A waiver ticked but not justified — the server rejects it
                // with a 400, so block it here rather than round-trip (I1).
                const waiverReasonMissing =
                  Boolean(action.collectsOfferTerms) &&
                  Object.values(feeWaivers).some((r) => String(r).trim() === "");
                return (
                  <>
                    <div className="flex items-center gap-2.5 mb-3">
                      <div
                        className={`p-2 rounded-xl ${
                          action.tone === "danger"
                            ? "bg-rose-50 text-rose-600"
                            : action.tone === "primary"
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <DialogIcon className="w-5 h-5" />
                      </div>
                      <h3 className="font-bold text-slate-900">{action.title}</h3>
                    </div>

                    <p className="text-sm text-slate-600 mb-4">
                      This will {action.verb} application #{pendingDecision.applicationId} for{" "}
                      <span className="font-semibold text-slate-800">
                        {pendingDecision.applicantName}
                      </span>
                      {action.irreversible
                        ? ". This cannot be undone, and the applicant will be notified immediately."
                        : ". The applicant will be notified immediately."}
                    </p>

                    {action.collectsOfferTerms && (
                      <div className="mb-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-2">
                          Offer terms
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["amount", "Amount (LKR)", "number"],
                            ["tenure_months", "Tenure (months)", "number"],
                            ["interest_rate", "Rate % (blank = product)", "number"],
                            ["validity_days", "Valid for (days, blank = 14)", "number"],
                          ].map(([key, label, type]) => (
                            <label key={key} className="block">
                              <span className="block text-[10px] font-semibold text-slate-500 mb-1">
                                {label}
                              </span>
                              <input
                                type={type}
                                value={offerTerms[key]}
                                onChange={(e) =>
                                  setOfferTerms((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800"
                              />
                            </label>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={offerTerms.note}
                          onChange={(e) =>
                            setOfferTerms((prev) => ({ ...prev, note: e.target.value }))
                          }
                          placeholder="Covering note shown to the applicant..."
                          maxLength={500}
                          className="mt-2 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-800"
                        />
                        <p className="text-[10px] text-slate-400 mt-2">
                          The monthly instalment is calculated by the server from these
                          terms and the product's rate type.
                        </p>

                        {/* Fees & waivers (I1). Amounts here are a preview
                            resolved from the product config against the
                            amount above; the server recomputes them
                            authoritatively at issuance and only ever trusts
                            this dialog for WHICH fees are waived and why. */}
                        {offerFeesLoading ? (
                          <p className="text-[10px] text-slate-400 mt-3">Loading fees…</p>
                        ) : offerFeeConfigs.length > 0 ? (
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-2">
                              Fees (deducted from the payout)
                            </p>
                            <div className="space-y-1.5">
                              {offerFeeConfigs.map((fee) => {
                                const waiving = Object.prototype.hasOwnProperty.call(
                                  feeWaivers,
                                  fee.fee_type
                                );
                                const base = Number(offerTerms.amount) || 0;
                                const preview =
                                  fee.calc_method === "fixed"
                                    ? Number(fee.rate_or_amount)
                                    : Math.min(
                                        Math.max(
                                          (base * Number(fee.rate_or_amount)) / 100,
                                          fee.min_amount === null ? 0 : Number(fee.min_amount)
                                        ),
                                        fee.max_amount === null
                                          ? Number.POSITIVE_INFINITY
                                          : Number(fee.max_amount)
                                      );
                                return (
                                  <div key={fee.fee_type} className="text-[11px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <label className="flex items-center gap-1.5 text-slate-600">
                                        <input
                                          type="checkbox"
                                          checked={waiving}
                                          onChange={(e) =>
                                            setFeeWaivers((prev) => {
                                              const next = { ...prev };
                                              if (e.target.checked) next[fee.fee_type] = "";
                                              else delete next[fee.fee_type];
                                              return next;
                                            })
                                          }
                                        />
                                        Waive
                                      </label>
                                      <span
                                        className={`font-mono ${waiving ? "line-through text-slate-400" : "text-slate-700 font-semibold"}`}
                                      >
                                        {fee.label}
                                        {fee.calc_method === "percentage"
                                          ? ` (${fee.rate_or_amount}%)`
                                          : ""}
                                        {" · "}
                                        {formatCurrency(preview)}
                                      </span>
                                    </div>
                                    {/* A waiver is discretionary pricing, so
                                        the server requires a reason — Confirm
                                        stays disabled until one is given. */}
                                    {waiving && (
                                      <input
                                        type="text"
                                        value={feeWaivers[fee.fee_type]}
                                        onChange={(e) =>
                                          setFeeWaivers((prev) => ({
                                            ...prev,
                                            [fee.fee_type]: e.target.value,
                                          }))
                                        }
                                        placeholder="Reason for waiving (required)…"
                                        maxLength={500}
                                        className="mt-1 w-full px-2 py-1 border border-amber-200 bg-amber-50/40 rounded-lg text-[11px] focus:outline-none focus:border-amber-400"
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Where funds will actually go. This is a single-bank
                        platform, so there's no "which bank" to show — just the
                        applicant's branch/account here.

                        Purely informational since migration 039: an absent
                        account no longer blocks anything, because the server
                        opens one during the disbursal itself (and offer
                        acceptance normally already did). It used to be a hard
                        warning with Confirm disabled, back when a customer had
                        to type these details in themselves and a loan could sit
                        approved and undisbursable indefinitely. */}
                    {action.showsBeneficiaryAccount && (
                      <div className="mb-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-2 flex items-center gap-1">
                          <Landmark className="w-3 h-3" /> Disbursement account
                        </p>
                        {beneficiaryAccountLoading ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...
                          </div>
                        ) : beneficiaryAccount?.complete ? (
                          <div className="text-xs text-slate-700 space-y-0.5">
                            <p>
                              <span className="text-slate-400">Branch:</span>{" "}
                              {beneficiaryAccount.branch}
                            </p>
                            <p>
                              <span className="text-slate-400">Account:</span>{" "}
                              <span className="font-mono">{beneficiaryAccount.account_number}</span>
                            </p>
                            <p>
                              <span className="text-slate-400">Holder:</span>{" "}
                              {beneficiaryAccount.account_holder}
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-start gap-1.5 text-xs text-slate-500">
                            <Landmark className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              This applicant has no account on file yet — one will be opened in
                              their name when you confirm. If they already bank here, add their
                              existing account from their customer record first so it is used
                              instead.
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* D4 adverse-action reasons. Shown for every Reject,
                        not conditionally like the override prompt below —
                        every rejection needs one, so there is nothing to
                        wait for a 422 to reveal. Suggestions from D1's
                        policy verdict (requestDecision) are pre-checked;
                        staff can add to or clear them, but at least one
                        must remain checked. */}
                    {action.collectsAdverseActionReasons && (
                      <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                        <p className="text-[10px] uppercase font-semibold tracking-wider text-rose-700">
                          Reason for decline (required — shown to the applicant)
                        </p>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {adverseActionReasons.map((r) => {
                            const checked = selectedReasonCodes.includes(r.code);
                            return (
                              <label
                                key={r.code}
                                className="flex items-start gap-2 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedReasonCodes((prev) =>
                                      checked
                                        ? prev.filter((c) => c !== r.code)
                                        : [...prev, r.code]
                                    )
                                  }
                                  className="mt-0.5 accent-rose-600"
                                />
                                <span className="text-xs">
                                  <span className="font-semibold text-slate-700">{r.label}</span>
                                  <span className="block text-[10px] text-slate-500 leading-relaxed">
                                    {r.description}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        {adverseActionReasons.length === 0 && (
                          <p className="text-[10px] text-rose-700">
                            Couldn't load the reason list — reloading the page should fix this.
                          </p>
                        )}
                      </div>
                    )}

                    {/* D2 override. Appears only once the server has said
                        this decision contradicts the matrix, and lists
                        exactly the codes it handed back for the direction
                        the override is going — an approval is never
                        offered "adverse information" as a justification. */}
                    {overridePrompt && (
                      <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-900 leading-relaxed font-medium">
                            {overridePrompt.message}
                          </p>
                        </div>
                        <label className="block">
                          <span className="block text-[10px] uppercase font-semibold tracking-wider text-amber-700 mb-1">
                            Override reason (required)
                          </span>
                          <select
                            value={overrideCode}
                            onChange={(e) => setOverrideCode(e.target.value)}
                            className="w-full px-2 py-1.5 bg-white border border-amber-300 rounded-lg text-xs focus:outline-none focus:border-amber-500"
                          >
                            <option value="">Select a reason...</option>
                            {overridePrompt.reasons.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        {overrideCode && (
                          <p className="text-[10px] text-amber-800 leading-relaxed">
                            {
                              overridePrompt.reasons.find((r) => r.code === overrideCode)
                                ?.description
                            }
                          </p>
                        )}
                        <p className="text-[10px] text-amber-700 leading-relaxed">
                          This is recorded against the decision and in the application's
                          audit trail. A written explanation below is also required.
                        </p>
                      </div>
                    )}

                    <textarea
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder={
                        overridePrompt
                          ? "Explain why you are overriding the system's recommendation..."
                          : action.notePlaceholder
                      }
                      maxLength={500}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800 mb-4 resize-none"
                    />

                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => {
                          setPendingDecision(null);
                          setOverridePrompt(null);
                          setOverrideCode("");
                          setSelectedReasonCodes([]);
                        }}
                        disabled={busy}
                        className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmDecision}
                        disabled={
                          busy ||
                          noteMissing ||
                          overrideMissing ||
                          reasonCodesMissing ||
                          waiverReasonMissing
                        }
                        title={
                          reasonCodesMissing
                            ? "Select at least one reason for the decline"
                            : overrideMissing
                              ? "Select an override reason"
                              : noteMissing
                                ? "A note is required for this action"
                                : waiverReasonMissing
                                  ? "Give a reason for every waived fee"
                                  : undefined
                        }
                        className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                          action.tone === "danger"
                            ? "bg-rose-600 hover:bg-rose-700 text-white"
                            : "bg-indigo-900 hover:bg-indigo-950 text-white"
                        }`}
                      >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        Confirm
                      </button>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

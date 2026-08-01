import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  Loader2,
  AlertTriangle,
  X,
  ChevronRight,
  Check,
  ArrowLeftRight,
  Banknote,
  MapPin,
  CalendarDays,
  FileText,
  User,
  Mail,
  Phone,
  Briefcase,
  Wallet,
  ShieldCheck,
  RefreshCw,
  Inbox,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import ExchangeStatusChip from "./ExchangeStatusChip";
import FxDecisionSupportPanel from "./FxDecisionSupportPanel";
import FxDocumentPanel from "./FxDocumentPanel";
import FxRequestEventTimeline from "./FxRequestEventTimeline";
import { PURPOSE_CODE_OPTIONS, STATUS_META } from "../../constants/fxExchange";

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  ...Object.keys(STATUS_META)
    .filter((s) => s !== "approved")
    .map((s) => ({ value: s, label: STATUS_META[s].label })),
];

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

const applicantName = (r) => `${r?.applicant?.first_name || ""} ${r?.applicant?.last_name || ""}`.trim();

const ACTION_META = {
  approve: { label: "Approve", verb: "approve", color: "emerald", icon: Check },
  reject: { label: "Reject", verb: "reject", color: "rose", icon: X },
  counter: { label: "Counter-Quote", verb: "send a counter-quote for", color: "amber", icon: RefreshCw },
  settle: { label: "Mark Settled", verb: "mark settled", color: "blue", icon: ShieldCheck },
};

const ACTION_BUTTON_CLASS = {
  emerald: "bg-emerald-600 hover:bg-emerald-700 text-white",
  rose: "bg-rose-600 hover:bg-rose-700 text-white",
  amber: "bg-amber-600 hover:bg-amber-700 text-white",
  blue: "bg-blue-600 hover:bg-blue-700 text-white",
};

// Tailwind's scanner needs literal class strings, not `bg-${color}-50`
// template interpolation — a static lookup per color, same reason
// ACTION_BUTTON_CLASS above isn't built with a template string either.
const ACTION_ICON_CLASS = {
  emerald: "bg-emerald-50 text-emerald-600",
  rose: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  blue: "bg-blue-50 text-blue-600",
};

/**
 * The staff/admin FX exchange-request queue — filters + a detail drawer
 * with decision support, the full fx_request_events timeline, and the
 * approve/reject/counter/settle actions (CURRENCY_FEATURE.md §12). Shared
 * between StaffFxExchange (default status pending_review, the working
 * queue) and AdminFxExchange's Audit tab (default status all, oversight
 * over every request) rather than built twice — both roles hit the exact
 * same endpoints (GET /admin/queue, GET/POST .../review, POST .../settle)
 * per the Phase 10 RBAC (admin, staff both allowed).
 *
 * Pagination: "Load More" (offset-based), not virtualization — matches the
 * existing MyExchangeRequests.jsx (Phase 11) and AdminApplications.jsx
 * convention already in this codebase, and composes naturally with the
 * server-side status/currency filters (offset resets on change) without
 * adding a virtualization dependency this codebase doesn't otherwise use.
 * Amount/date/customer filters have no server-side query param (see
 * fxExchange.routes.js) and apply client-side over whatever page(s) are
 * already loaded — the same accepted trade-off Phase 11 documented for
 * MyExchangeRequests' date filter.
 */
export default function FxRequestQueue({ customers = [], defaultStatus = "pending_review", title, subtitle }) {
  const { showToast } = useToast();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);

  const [statusFilter, setStatusFilter] = useState(defaultStatus);
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [search, setSearch] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedRef, setSelectedRef] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [pendingAction, setPendingAction] = useState(null); // { type, note, counteredRate }
  const [actioning, setActioning] = useState(false);

  const fetchPage = async (offset) => {
    const params = { limit: PAGE_SIZE, offset };
    if (statusFilter && statusFilter !== "all") params.status = statusFilter;
    else params.status = "all";
    if (currencyFilter) params.currency = currencyFilter;
    const res = await api.get("/currency/exchange/admin/queue", { params });
    return res.data?.requests || [];
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await fetchPage(0);
        if (cancelled) return;
        setRequests(rows);
        setHasMore(rows.length === PAGE_SIZE);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Couldn't load the exchange request queue. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, currencyFilter]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const rows = await fetchPage(requests.length);
      setRequests((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      showToast({
        type: "error",
        title: "Load Failed",
        message: err.response?.data?.message || "Couldn't load more requests.",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    const min = amountMin !== "" ? Number(amountMin) : null;
    const max = amountMax !== "" ? Number(amountMax) : null;
    return requests.filter((r) => {
      if (term) {
        const haystack = `${applicantName(r)} ${r.applicant?.email || ""} ${r.reference_no}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (min !== null && !Number.isNaN(min) && Number(r.quoted_lkr_amount) < min) return false;
      if (max !== null && !Number.isNaN(max) && Number(r.quoted_lkr_amount) > max) return false;
      if (dateFrom && r.created_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && r.created_at.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [requests, search, amountMin, amountMax, dateFrom, dateTo]);

  const currencyOptions = useMemo(
    () => Array.from(new Set(requests.map((r) => r.currency_code))).sort(),
    [requests]
  );

  const customerProfile = useMemo(() => {
    if (!selectedRequest) return null;
    return customers.find((c) => c.user_id === selectedRequest.user_id) || null;
  }, [customers, selectedRequest]);

  const applyRowUpdate = (ref, patch) => {
    setRequests((prev) => prev.map((r) => (r.reference_no === ref ? { ...r, ...patch } : r)));
  };

  const openDetail = async (row) => {
    setSelectedRef(row.reference_no);
    setSelectedRequest({ ...row, events: undefined });
    setDetailError("");
    setDetailLoading(true);
    try {
      const res = await api.get(`/currency/exchange/requests/${row.reference_no}`);
      // The single-request read has no applicant join (findByReferenceNo) —
      // keep the queue row's applicant info, which does (findQueue's JOIN).
      setSelectedRequest({ ...res.data, applicant: res.data.applicant || row.applicant });
    } catch (err) {
      setDetailError(err.response?.data?.message || "Couldn't load this request's detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (ref, fallbackApplicant) => {
    try {
      const res = await api.get(`/currency/exchange/requests/${ref}`);
      const merged = { ...res.data, applicant: res.data.applicant || fallbackApplicant };
      setSelectedRequest(merged);
      applyRowUpdate(ref, merged);
      return merged;
    } catch {
      return null;
    }
  };

  const closeDetail = () => {
    setSelectedRef(null);
    setSelectedRequest(null);
    setPendingAction(null);
  };

  const requestAction = (type) => {
    setPendingAction({
      type,
      note: "",
      counteredRate: selectedRequest?.quoted_rate ? String(selectedRequest.quoted_rate) : "",
    });
  };

  const OPTIMISTIC_STATUS = { approve: "ready_for_settlement", reject: "rejected", settle: "settled" };

  const confirmAction = async () => {
    if (!pendingAction || !selectedRequest) return;
    const { type, note, counteredRate } = pendingAction;
    const ref = selectedRequest.reference_no;
    const applicant = selectedRequest.applicant;

    if (type === "reject" && !note.trim()) return;
    if (type === "counter" && !(Number(counteredRate) > 0)) return;

    setActioning(true);
    const previousStatus = selectedRequest.status;
    const optimisticStatus = OPTIMISTIC_STATUS[type] || previousStatus;
    setSelectedRequest((prev) => ({ ...prev, status: optimisticStatus }));
    applyRowUpdate(ref, { status: optimisticStatus });

    try {
      if (type === "settle") {
        await api.post(`/currency/exchange/requests/${ref}/settle`, { note: note.trim() || undefined });
      } else {
        await api.post(`/currency/exchange/requests/${ref}/review`, {
          action: type,
          note: note.trim() || undefined,
          countered_rate: type === "counter" ? Number(counteredRate) : undefined,
        });
      }

      await refreshDetail(ref, applicant);
      showToast({
        type: "success",
        title: `${ACTION_META[type].label} Successful`,
        message: `${ref} was ${type === "settle" ? "marked settled" : `${type}d`}. The customer has been notified.`,
      });
    } catch (err) {
      // Roll back visibly — a 409 means another staff member likely acted
      // first (CURRENCY_FEATURE.md §12.2's transitionStatus row-lock check).
      setSelectedRequest((prev) => (prev ? { ...prev, status: previousStatus } : prev));
      applyRowUpdate(ref, { status: previousStatus });
      const truth = await refreshDetail(ref, applicant);
      const isConflict = err.response?.status === 409;
      showToast({
        type: "error",
        title: isConflict ? "Already Handled" : `${ACTION_META[type].label} Failed`,
        message:
          err.response?.data?.message ||
          (isConflict
            ? `This request was already updated by someone else — now showing ${truth?.status || "the current status"}.`
            : `Couldn't complete this action.`),
      });
    } finally {
      setActioning(false);
      setPendingAction(null);
    }
  };

  const purposeLabel = (code) => PURPOSE_CODE_OPTIONS.find((p) => p.value === code)?.label || code;

  // Compliance state for the open request. `document_count` comes back on
  // every request payload, and FxDocumentPanel pushes an updated count up
  // when it loads, so the approve gate below reflects reality without the
  // queue having to fetch the document list itself.
  const docCount = Number(selectedRequest?.document_count ?? 0);
  const docsSatisfied = !selectedRequest?.requires_documents || docCount > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Currency Exchange</p>
          <h1 className="text-sm font-bold text-slate-800">{title}</h1>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
          <Filter className="w-3.5 h-3.5" />
          Filters
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="col-span-2 sm:col-span-1 lg:col-span-2">
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Customer</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email, or reference"
                className="w-full pl-7 pr-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Currency</label>
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary bg-white"
            >
              <option value="">All Currencies</option>
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Min LKR</label>
            <input
              type="number"
              min="0"
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Max LKR</label>
            <input
              type="number"
              min="0"
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
            />
          </div>
        </div>
        {(amountMin || amountMax || dateFrom || dateTo || search) && (
          <p className="text-[10px] text-slate-400 mt-2">
            Customer/amount/date filters apply to the {requests.length} request(s) currently loaded — use "Load
            More" below to bring more rows into scope.
          </p>
        )}
      </div>

      {/* Queue table */}
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

        {!loading && !error && requests.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No exchange requests found.</p>
          </div>
        )}

        {!loading && !error && requests.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-5 py-3.5">Reference</th>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-5 py-3.5">Trade</th>
                  <th className="px-5 py-3.5">LKR Amount</th>
                  <th className="px-5 py-3.5 text-center">Status</th>
                  <th className="px-5 py-3.5">Submitted</th>
                  <th className="px-5 py-3.5 text-right">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredRequests.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-xs">
                      No requests matched the current filters.
                    </td>
                  </tr>
                )}
                {filteredRequests.map((r) => (
                  <tr
                    key={r.reference_no}
                    onClick={() => openDetail(r)}
                    className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                  >
                    {/* The row's onClick is mouse convenience only — a <tr>
                        can't be focused, so keyboard users reach the detail
                        drawer through this real button (Phase 24, §25).
                        Deliberately NOT role="button"/tabIndex on the <tr>
                        itself: that would override the row's table semantics
                        for screen readers, trading one problem for another.
                        stopPropagation keeps a mouse click from firing both. */}
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(r);
                        }}
                        aria-label={`Open request ${r.reference_no}`}
                        className="font-mono text-xs font-bold text-slate-800 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                      >
                        {r.reference_no}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{applicantName(r) || "—"}</p>
                      <p className="text-[11px] text-slate-400">{r.applicant?.email}</p>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-600">
                      {r.direction === "buy" ? "Buy" : "Sell"} {Number(r.foreign_amount).toLocaleString()}{" "}
                      {r.currency_code}
                    </td>
                    <td className="px-5 py-4 font-mono font-bold text-slate-800 text-xs">
                      {formatLkr(r.quoted_lkr_amount)}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <ExchangeStatusChip status={r.status} />
                      {/* A pending request that's over the documentation
                          threshold with nothing uploaded can't be approved —
                          surfaced here so staff can triage the queue without
                          opening each row. */}
                      {r.requires_documents && (
                        <span
                          className={`block mt-1 text-[10px] font-semibold ${
                            Number(r.document_count ?? 0) > 0 ? "text-emerald-600" : "text-amber-700"
                          }`}
                        >
                          {Number(r.document_count ?? 0) > 0
                            ? `${r.document_count} doc${Number(r.document_count) === 1 ? "" : "s"}`
                            : "Docs missing"}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 font-mono">{formatDate(r.created_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <ChevronRight className="w-4 h-4 text-slate-300 inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && hasMore && (
          <div className="px-6 py-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-60 transition-colors inline-flex items-center gap-2"
            >
              {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Load More
            </button>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {selectedRef && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs"
              onClick={closeDetail}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed top-0 right-0 h-full w-full max-w-xl bg-white z-50 shadow-2xl overflow-y-auto"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/60 sticky top-0 z-10">
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Exchange Request</h3>
                  <p className="text-slate-400 text-xs font-mono">{selectedRef}</p>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  aria-label="Close request details"
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {detailLoading && (
                  <div className="flex items-center justify-center py-10 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}

                {!detailLoading && detailError && (
                  <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{detailError}</span>
                  </div>
                )}

                {!detailLoading && !detailError && selectedRequest && (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Status</span>
                        <div className="mt-1">
                          <ExchangeStatusChip status={selectedRequest.status} className="text-xs px-3 py-1.5" />
                        </div>
                      </div>
                    </div>

                    {/* Customer profile summary */}
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Customer Profile
                      </span>
                      <div className="mt-2 p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2.5">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          {applicantName(selectedRequest) || "Unknown customer"}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <Mail className="w-3.5 h-3.5 text-slate-400" />
                          {selectedRequest.applicant?.email || customerProfile?.email || "—"}
                        </div>
                        {customerProfile?.phone && (
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            {customerProfile.phone}
                          </div>
                        )}
                        {customerProfile?.employment_type && (
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                            {customerProfile.employment_type}
                            {customerProfile.company_name ? ` · ${customerProfile.company_name}` : ""}
                          </div>
                        )}
                        {customerProfile?.monthly_income != null && (
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Wallet className="w-3.5 h-3.5 text-slate-400" />
                            Monthly income: {formatLkr(customerProfile.monthly_income)}
                          </div>
                        )}
                        {!customerProfile && (
                          <p className="text-[11px] text-slate-400 pt-1">
                            Full profile not found in the customer directory — showing request-level details only.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Trade terms */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-brand-primary/10 flex items-center justify-center shrink-0">
                          <Banknote className="w-4.5 h-4.5 text-brand-primary" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                            {selectedRequest.direction === "buy" ? "Customer Buying" : "Customer Selling"}
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {Number(selectedRequest.foreign_amount).toLocaleString()}{" "}
                            {selectedRequest.currency_code}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Quote: {formatRate(selectedRequest.quoted_rate)} LKR/{selectedRequest.currency_code} ·{" "}
                            {(selectedRequest.spread_bps_applied / 100).toFixed(2)}% spread ·{" "}
                            {selectedRequest.rate_source || "—"}
                          </p>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-brand-accent/10 flex items-center justify-center shrink-0">
                          <Wallet className="w-4.5 h-4.5 text-brand-accent" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                            Requested LKR Amount
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {formatLkr(selectedRequest.quoted_lkr_amount)}
                          </p>
                          <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            Validated against fx_limits at submission (server-enforced)
                          </p>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                          <FileText className="w-4.5 h-4.5 text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                            Purpose Declaration
                          </p>
                          <p className="text-sm font-bold text-slate-800">
                            {purposeLabel(selectedRequest.purpose_code)}
                          </p>
                          <p
                            className={`text-[11px] mt-0.5 font-semibold ${
                              !selectedRequest.requires_documents
                                ? "text-slate-400"
                                : docsSatisfied
                                  ? "text-emerald-600"
                                  : "text-amber-700"
                            }`}
                          >
                            {!selectedRequest.requires_documents
                              ? "Below documentation threshold"
                              : docsSatisfied
                                ? `Documents required · ${docCount} provided`
                                : "Documents required · none provided"}
                          </p>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                          <MapPin className="w-4.5 h-4.5 text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">Branch</p>
                          <p className="text-sm font-bold text-slate-800">{selectedRequest.branch}</p>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex items-start gap-3 sm:col-span-2">
                        <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center shrink-0">
                          <CalendarDays className="w-4.5 h-4.5 text-slate-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                            Settlement Date
                          </p>
                          <p className="text-sm font-bold text-slate-800">{formatDate(selectedRequest.settlement_date)}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Submitted {formatDateTime(selectedRequest.created_at)} · Quote locked{" "}
                            {formatDateTime(selectedRequest.quote_locked_at)}, expired{" "}
                            {formatDateTime(selectedRequest.quote_expires_at)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {selectedRequest.status === "rejected" && selectedRequest.review_note && (
                      <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          <strong>Rejection reason:</strong> {selectedRequest.review_note}
                        </span>
                      </div>
                    )}

                    {/* Supporting documents — read-only for staff; the server
                        rejects any upload from a non-owner independently. */}
                    {(selectedRequest.requires_documents || docCount > 0) && (
                      <FxDocumentPanel
                        referenceNo={selectedRequest.reference_no}
                        requiresDocuments={selectedRequest.requires_documents}
                        canUpload={false}
                        onCountChange={(count) =>
                          setSelectedRequest((prev) =>
                            prev ? { ...prev, document_count: count } : prev
                          )
                        }
                      />
                    )}

                    {/* Decision support */}
                    <FxDecisionSupportPanel currencyCode={selectedRequest.currency_code} />

                    {/* Audit timeline */}
                    <FxRequestEventTimeline events={selectedRequest.events} />

                    {/* Actions */}
                    <div className="pt-2 border-t border-slate-100">
                      {selectedRequest.status === "pending_review" && !docsSatisfied && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3.5 text-xs mb-3">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>
                            This request is over the documentation threshold and the customer has
                            not uploaded any supporting evidence yet. It cannot be approved until
                            they do — you can still reject or counter-quote it.
                          </span>
                        </div>
                      )}
                      {selectedRequest.status === "pending_review" && (
                        <div className="flex flex-wrap gap-2.5">
                          <button
                            onClick={() => requestAction("approve")}
                            disabled={!docsSatisfied}
                            title={
                              docsSatisfied
                                ? undefined
                                : "Supporting documents are required before this request can be approved."
                            }
                            className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-50"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => requestAction("reject")}
                            className="px-4 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                          <button
                            onClick={() => requestAction("counter")}
                            className="px-4 py-2 bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Counter-Quote
                          </button>
                        </div>
                      )}
                      {selectedRequest.status === "ready_for_settlement" && (
                        <button
                          onClick={() => requestAction("settle")}
                          className="px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" /> Mark Settled
                        </button>
                      )}
                      {!["pending_review", "ready_for_settlement"].includes(selectedRequest.status) && (
                        <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg w-fit">
                          <ShieldCheck className="w-4 h-4 text-slate-400" />
                          NO FURTHER ACTION — {STATUS_META[selectedRequest.status]?.label?.toUpperCase() ||
                            selectedRequest.status.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Action confirmation */}
      <AnimatePresence>
        {pendingAction && selectedRequest && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`p-2 rounded-xl ${ACTION_ICON_CLASS[ACTION_META[pendingAction.type].color]}`}>
                  {(() => {
                    const Icon = ACTION_META[pendingAction.type].icon;
                    return <Icon className="w-5 h-5" />;
                  })()}
                </div>
                <h3 className="font-bold text-slate-900">{ACTION_META[pendingAction.type].label}</h3>
              </div>

              <p className="text-sm text-slate-600 mb-4">
                {pendingAction.type === "counter" ? "Send a counter-quote for" : ACTION_META[pendingAction.type].label}{" "}
                <span className="font-mono font-semibold text-slate-800">{selectedRequest.reference_no}</span> for{" "}
                <span className="font-semibold text-slate-800">{applicantName(selectedRequest)}</span>? This is
                customer-visible and cannot be undone.
              </p>

              {pendingAction.type === "counter" && (
                <div className="mb-4">
                  <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                    New Rate (LKR per {selectedRequest.currency_code})
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={pendingAction.counteredRate}
                    onChange={(e) => setPendingAction((p) => ({ ...p, counteredRate: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                  />
                  {Number(pendingAction.counteredRate) > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      New LKR amount:{" "}
                      <span className="font-semibold text-slate-700">
                        {formatLkr(Number(selectedRequest.foreign_amount) * Number(pendingAction.counteredRate))}
                      </span>{" "}
                      (was {formatLkr(selectedRequest.quoted_lkr_amount)})
                    </p>
                  )}
                </div>
              )}

              <textarea
                value={pendingAction.note}
                onChange={(e) => setPendingAction((p) => ({ ...p, note: e.target.value }))}
                placeholder={
                  pendingAction.type === "reject"
                    ? "Reason for rejection (required)..."
                    : "Optional note to include in the notification..."
                }
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary mb-1 resize-none"
              />
              {pendingAction.type === "reject" && !pendingAction.note.trim() && (
                <p className="text-[11px] text-rose-500 mb-3">A reason is required to reject a request.</p>
              )}
              {pendingAction.type !== "reject" && <div className="mb-3" />}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPendingAction(null)}
                  disabled={actioning}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAction}
                  disabled={
                    actioning ||
                    (pendingAction.type === "reject" && !pendingAction.note.trim()) ||
                    (pendingAction.type === "counter" && !(Number(pendingAction.counteredRate) > 0))
                  }
                  className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-50 ${ACTION_BUTTON_CLASS[ACTION_META[pendingAction.type].color]}`}
                >
                  {actioning && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm {ACTION_META[pendingAction.type].label}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

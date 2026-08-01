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
  Briefcase,
  Calendar,
  Sparkles,
  Wallet,
  Percent,
  Loader2,
  RefreshCw,
  Inbox,
  Info,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

const RISK_STYLES = {
  0: { badge: "bg-emerald-50 text-emerald-700 border-emerald-100", bar: "bg-emerald-500" },
  1: { badge: "bg-amber-50 text-amber-700 border-amber-100", bar: "bg-amber-500" },
  2: { badge: "bg-rose-50 text-rose-700 border-rose-100", bar: "bg-rose-500" },
};

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rejected: "bg-rose-50 text-rose-700 border-rose-100",
};

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
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

export default function AdminApplications() {
  const { showToast } = useToast();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const [selectedApp, setSelectedApp] = useState(null);
  // { applicationId, status, applicantName } — confirmation step before PATCH.
  const [pendingDecision, setPendingDecision] = useState(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [actioningId, setActioningId] = useState(null);

  // Shared fetch logic — kept state-free so it's safe to call both from the
  // mount effect (via an effect-local closure, per the rules-of-hooks
  // set-state-in-effect check) and directly from the Refresh button.
  const loadApplications = async () => {
    const res = await api.get("/admin/applications");
    return res.data?.applications || [];
  };

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

  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      const applicantName = `${app.applicant?.first_name || ""} ${app.applicant?.last_name || ""}`.trim();
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        applicantName.toLowerCase().includes(term) ||
        app.applicant?.email?.toLowerCase().includes(term) ||
        String(app.application_id).includes(term);

      const matchesStatus = statusFilter === "all" || app.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [applications, searchTerm, statusFilter]);

  const declaredRows = useMemo(
    () => buildDeclaredRows(selectedApp?.declared),
    [selectedApp]
  );

  const totalPages = Math.ceil(filteredApps.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedApps = filteredApps.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
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
      applicantName:
        `${app.applicant?.first_name || ""} ${app.applicant?.last_name || ""}`.trim() ||
        app.applicant?.email ||
        `Application #${app.application_id}`,
    });
    setDecisionNote("");
  };

  const confirmDecision = async () => {
    if (!pendingDecision) return;
    const { applicationId, status } = pendingDecision;
    const previous = applications.find((a) => a.application_id === applicationId);

    setActioningId(applicationId);
    // Optimistic flip so the row reflects the decision immediately.
    applyStatusUpdate(applicationId, { status });

    try {
      const res = await api.patch(`/admin/applications/${applicationId}/status`, {
        status,
        note: decisionNote.trim() || undefined,
      });
      applyStatusUpdate(applicationId, res.data);
      showToast({
        type: "success",
        title: status === "approved" ? "Application Approved" : "Application Rejected",
        message: `Application #${applicationId} was ${status}. The applicant has been notified.`,
      });
    } catch (err) {
      // Roll back the optimistic flip.
      if (previous) applyStatusUpdate(applicationId, { status: previous.status });
      showToast({
        type: "error",
        title: "Update Failed",
        message:
          err.response?.data?.message ||
          `Couldn't ${status === "approved" ? "approve" : "reject"} this application.`,
      });
    } finally {
      setActioningId(null);
      setPendingDecision(null);
      setDecisionNote("");
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
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
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
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase ${STATUS_STYLES[app.status]}`}
                          >
                            {app.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500 font-mono">
                          {formatDate(app.created_at)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedApp(app)}
                              className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
                              title="View details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {app.status === "pending" && (
                              <>
                                <button
                                  onClick={() => requestDecision(app, "approved")}
                                  disabled={isActioning}
                                  className="p-1.5 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 rounded-lg transition-colors disabled:opacity-40"
                                  title="Approve application"
                                >
                                  {isActioning ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Check className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  onClick={() => requestDecision(app, "rejected")}
                                  disabled={isActioning}
                                  className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors disabled:opacity-40"
                                  title="Reject application"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
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
              className="fixed top-0 right-0 h-full w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/60 sticky top-0 z-10">
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Application Detail</h3>
                  <p className="text-slate-400 text-xs">#{selectedApp.application_id}</p>
                </div>
                <button
                  onClick={() => setSelectedApp(null)}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Applicant
                  </span>
                  <h4 className="text-lg font-black text-slate-800">
                    {selectedApp.applicant?.first_name} {selectedApp.applicant?.last_name}
                  </h4>
                  <p className="text-xs text-slate-500">{selectedApp.applicant?.email}</p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Product
                    </span>
                    <span className="font-semibold text-slate-800">
                      {selectedApp.product_name || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5" /> Requested Amount
                    </span>
                    <span className="font-extrabold text-indigo-900">
                      {formatCurrency(selectedApp.requested_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5" /> Tenure
                    </span>
                    <span className="font-semibold text-slate-800">
                      {selectedApp.tenure_months} months
                    </span>
                  </div>
                  {selectedApp.purpose && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500 font-medium">Purpose</span>
                      <span className="font-semibold text-slate-800">{selectedApp.purpose}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Submitted
                    </span>
                    <span className="font-mono text-slate-600">
                      {formatDate(selectedApp.created_at)}
                    </span>
                  </div>
                </div>

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

                {selectedApp.risk?.probabilities && (
                  <div className="space-y-4 bg-indigo-50/40 p-5 rounded-2xl border border-indigo-100/40">
                    <div>
                      <h5 className="text-xs font-bold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-indigo-600" />
                        AI Risk Assessment
                      </h5>
                    </div>
                    <div className="space-y-3">
                      {Object.entries(selectedApp.risk.probabilities).map(([label, prob]) => {
                        const idx = label === "Low Risk" ? 0 : label === "Medium Risk" ? 1 : 2;
                        return (
                          <div key={label}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-600">{label}</span>
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

                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs">
                  <div>
                    <span className="font-bold text-slate-500">Current Status: </span>
                    <span
                      className={`font-black uppercase ml-1 ${
                        selectedApp.status === "approved"
                          ? "text-emerald-600"
                          : selectedApp.status === "rejected"
                            ? "text-red-500"
                            : "text-amber-600"
                      }`}
                    >
                      {selectedApp.status}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  {selectedApp.status === "pending" ? (
                    <>
                      <button
                        onClick={() => requestDecision(selectedApp, "rejected")}
                        disabled={actioningId === selectedApp.application_id}
                        className="px-4 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-xl text-sm font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Reject
                      </button>
                      <button
                        onClick={() => requestDecision(selectedApp, "approved")}
                        disabled={actioningId === selectedApp.application_id}
                        className="px-5 py-2 bg-indigo-900 hover:bg-indigo-950 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 shadow-md shadow-indigo-950/10 cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-4.5 h-4.5" /> Approve
                      </button>
                    </>
                  ) : (
                    <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                      <FileCheck className="w-4 h-4 text-slate-400" />
                      APPLICATION CLOSED ({selectedApp.status.toUpperCase()})
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          </>
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
              <div className="flex items-center gap-2.5 mb-3">
                <div
                  className={`p-2 rounded-xl ${pendingDecision.status === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}
                >
                  {pendingDecision.status === "approved" ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <X className="w-5 h-5" />
                  )}
                </div>
                <h3 className="font-bold text-slate-900">
                  {pendingDecision.status === "approved" ? "Approve" : "Reject"} Application
                </h3>
              </div>

              <p className="text-sm text-slate-600 mb-4">
                {pendingDecision.status === "approved" ? "Approve" : "Reject"} application #
                {pendingDecision.applicationId} for{" "}
                <span className="font-semibold text-slate-800">
                  {pendingDecision.applicantName}
                </span>
                ? This cannot be undone, and the applicant will be notified immediately.
              </p>

              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Optional note to include in the notification..."
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800 mb-4 resize-none"
              />

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPendingDecision(null)}
                  disabled={actioningId === pendingDecision.applicationId}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDecision}
                  disabled={actioningId === pendingDecision.applicationId}
                  className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    pendingDecision.status === "approved"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-rose-600 hover:bg-rose-700 text-white"
                  }`}
                >
                  {actioningId === pendingDecision.applicationId && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  Confirm {pendingDecision.status === "approved" ? "Approval" : "Rejection"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

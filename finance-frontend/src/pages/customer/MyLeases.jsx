import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LeaseProgressBar } from "../../components/leasing/LeaseProgressTracker";
import { Car, CarFront, Loader2, AlertTriangle, Inbox, ArrowRight } from "lucide-react";
import api from "../../api/axios";

/**
 * The customer's lease applications.
 *
 * Separate from MyApplications (loans) rather than a filtered view of it,
 * because they are separate entities served by separate endpoints — a lease
 * has a lessee, a financed amount and a term, not a borrower, a principal
 * and a tenure.
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

// Resolved via customer.leaseApplication's condition keys — the same three
// labels LeaseApplication.jsx and LeaseDetail.jsx show, kept in one place in
// translation rather than three separately-maintained English copies (which
// had already drifted: this file alone said "Used" where the other two say
// "Used (registered)").
const CONDITION_KEYS = {
  brand_new: "conditionBrandNew",
  reconditioned: "conditionReconditioned",
  used: "conditionUsed",
};

const formatStatus = (s) => String(s || "").replace(/_/g, " ");
const lkr = (v) => `LKR ${Number(v || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const formatDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function MyLeases() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/leases/my-applications");
        if (!cancelled) setApplications(res.data?.applications || []);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.leasing.loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` only changes identity on an actual language switch, in which case
    // refetching this list is harmless — cheaper to accept than to disable
    // the check for a dependency that is genuinely used in the error path.
  }, [t]);

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <Car className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t("customer.leasing.eyebrow")}</p>
              <p className="text-sm font-bold text-slate-800">{t("customer.leasing.myLeasesTitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/dashboard/leases/apply")}
            className="flex items-center justify-center gap-2 bg-brand-primary hover:bg-brand-primary/95 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            <CarFront className="w-4 h-4" />
            {t("customer.leasing.applyCta")}
          </button>
        </div>

        {loading && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-8 flex items-center justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!loading && !error && applications.length === 0 && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">{t("customer.leasing.noLeasesTitle")}</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
{t("customer.leasing.noLeasesHint")}
            </p>
            <button
              type="button"
              onClick={() => navigate("/dashboard/leases/apply")}
              className="mt-5 inline-flex items-center gap-2 bg-brand-primary hover:bg-brand-primary/95 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm"
            >
              <CarFront className="w-4 h-4" />
              {t("customer.leasing.applyCta")}
            </button>
          </div>
        )}

        {!loading && !error && applications.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {applications.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate(`/dashboard/leases/${a.id}`)}
                className="w-full text-left p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:border-brand-primary/30 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-xl shrink-0 bg-brand-primary/10 text-brand-primary">
                    <Car className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">
                      {a.make} {a.model} {a.year_of_manufacture} · #{a.id}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t("customer.leasing.listCardSummary", {
                        amount: lkr(a.financed_amount),
                        term: a.term_months,
                        condition: CONDITION_KEYS[a.condition_type]
                          ? t(`customer.leaseApplication.${CONDITION_KEYS[a.condition_type]}`)
                          : a.condition_type,
                      })}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {a.product_name} · {t("customer.leasing.appliedInline", { date: formatDate(a.created_at) })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase border ${
                      STATUS_STYLES[a.status] || "bg-slate-50 text-slate-600 border-slate-100"
                    }`}
                  >
                    {formatStatus(a.status)}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                </div>
                </div>

                {/* How far along, without opening it. The status chip above
                    names ONE state; this says where that sits in the whole
                    sequence, which is the part people do not know. */}
                <LeaseProgressBar row={a} className="mt-4" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

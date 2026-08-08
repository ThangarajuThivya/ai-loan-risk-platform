import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FilePlus2, Loader2, AlertTriangle, Inbox, FileStack } from "lucide-react";
import api from "../../api/axios";
import { ApplicationSummaryCard } from "./dashboardWidgets";
import { getApplicationBucket } from "./dashboardFormat";

// Order matters — this is also the display order of the pills.
const FILTERS = [
  { id: "all", labelKey: "customer.applications.filterAll" },
  { id: "needs_action", labelKey: "customer.applications.filterNeedsAction" },
  { id: "in_review", labelKey: "customer.applications.filterInReview" },
  { id: "active", labelKey: "customer.applications.filterActive" },
  { id: "closed", labelKey: "customer.applications.filterClosed" },
];

function MyApplications() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    const loadApplications = async () => {
      try {
        const res = await api.get("/loans/my-applications");
        if (cancelled) return;
        setApplications(res.data?.applications || []);
      } catch (err) {
        if (cancelled) return;
        setAppsError(
          err.response?.data?.message || t("customer.common.loadApplicationsError")
        );
      } finally {
        if (!cancelled) setAppsLoading(false);
      }
    };

    loadApplications();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Counts computed once per filter so a pill can show how many
  // applications fall into it without the customer having to click through
  // each one first — the whole point of this filter bar.
  const counts = useMemo(() => {
    const c = { all: applications.length, needs_action: 0, in_review: 0, active: 0, closed: 0 };
    for (const app of applications) c[getApplicationBucket(app)] += 1;
    return c;
  }, [applications]);

  const filteredApplications = useMemo(
    () =>
      filter === "all"
        ? applications
        : applications.filter((app) => getApplicationBucket(app) === filter),
    [applications, filter]
  );

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <FileStack className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                {t("customer.applications.loansEyebrow")}
              </p>
              <p className="text-sm font-bold text-slate-800">{t("customer.applications.pageTitle")}</p>
            </div>
          </div>

          <button
            onClick={() => navigate("/dashboard/apply")}
            type="button"
            className="flex items-center justify-center space-x-2 bg-brand-primary hover:bg-brand-primary/95 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            <FilePlus2 className="w-4 h-4" />
            <span>{t("customer.common.applyForLoan")}</span>
          </button>
        </div>

        {!appsLoading && !appsError && applications.length > 0 && (
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
            {FILTERS.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors border ${
                  filter === id
                    ? "bg-brand-primary text-white border-brand-primary"
                    : "bg-white text-slate-500 border-slate-100 hover:border-brand-primary/30"
                }`}
              >
                {t(labelKey)}
                <span
                  className={`px-1.5 rounded-full text-[10px] ${
                    filter === id ? "bg-white/20" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {counts[id]}
                </span>
              </button>
            ))}
          </div>
        )}

        {appsLoading && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-8 flex items-center justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!appsLoading && appsError && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{appsError}</span>
            </div>
          </div>
        )}

        {!appsLoading && !appsError && applications.length === 0 && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">
              {t("customer.common.noApplicationsTitle")}
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {t("customer.common.noApplicationsHint")}
            </p>
            <button
              onClick={() => navigate("/dashboard/apply")}
              type="button"
              className="mt-5 inline-flex items-center space-x-2 bg-brand-primary hover:bg-brand-primary/95 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>{t("customer.common.applyForLoan")}</span>
            </button>
          </div>
        )}

        {!appsLoading && !appsError && applications.length > 0 && filteredApplications.length === 0 && (
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">
              {t("customer.applications.noneInFilter")}
            </p>
          </div>
        )}

        {!appsLoading && !appsError && filteredApplications.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredApplications.map((application) => (
              <ApplicationSummaryCard
                key={application.application_id}
                application={application}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MyApplications;

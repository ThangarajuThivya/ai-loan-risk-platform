import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FilePlus2, Loader2, AlertTriangle, Inbox, FileStack } from "lucide-react";
import api from "../../api/axios";
import { ApplicationCard } from "./dashboardWidgets";

function MyApplications() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

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

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-5xl mx-auto">
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

        {appsLoading && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 flex items-center justify-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!appsLoading && appsError && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{appsError}</span>
            </div>
          </div>
        )}

        {!appsLoading && !appsError && applications.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
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

        {!appsLoading && !appsError && applications.length > 0 && (
          <div className="space-y-3">
            {applications.map((application) => (
              <ApplicationCard
                key={application.application_id}
                application={application}
                expanded={expandedId === application.application_id}
                onToggle={() =>
                  setExpandedId((prev) =>
                    prev === application.application_id
                      ? null
                      : application.application_id
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MyApplications;

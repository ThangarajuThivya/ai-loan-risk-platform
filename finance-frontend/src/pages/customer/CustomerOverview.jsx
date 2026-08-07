import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  UserCircle,
  FilePlus2,
  ArrowLeftRight,
  UserCog,
  Loader2,
  AlertTriangle,
  Inbox,
  FileStack,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import api from "../../api/axios";
import { ApplicationSummaryCard, NotificationsPanel, StatCard } from "./dashboardWidgets";
import PaymentReturnHandler from "../../components/loans/PaymentReturnHandler";

const QUICK_ACTIONS = [
  {
    to: "/dashboard/apply",
    labelKey: "customer.overview.quickActionApply",
    icon: FilePlus2,
  },
  {
    to: "/dashboard/currency/exchange",
    labelKey: "customer.overview.quickActionExchange",
    icon: ArrowLeftRight,
  },
  {
    to: "/dashboard/profile",
    labelKey: "customer.overview.quickActionProfile",
    icon: UserCog,
  },
];

const RECENT_LIMIT = 3;

function CustomerOverview() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [applications, setApplications] = useState([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState("");

  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState("");

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

    const loadNotifications = async () => {
      try {
        const res = await api.get("/notifications/my-notifications");
        if (cancelled) return;
        setNotifications(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        if (cancelled) return;
        setNotifError(
          err.response?.data?.message || t("customer.widgets.loadNotificationsError")
        );
      } finally {
        if (!cancelled) setNotifLoading(false);
      }
    };

    loadApplications();
    loadNotifications();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Grouped by lifecycle outcome rather than by literal status, so states
  // added to the machine land in the right tile instead of silently
  // counting as zero: anything still with the bank or the applicant is
  // "in review", and a disbursed loan is still an approved one.
  const stats = useMemo(() => {
    const countIn = (...statuses) =>
      applications.filter((a) => statuses.includes(a.status)).length;
    return {
      total: applications.length,
      pending: countIn("pending", "under_review", "more_info_required"),
      approved: countIn("approved", "disbursed", "closed"),
      rejected: countIn("rejected", "withdrawn"),
    };
  }, [applications]);

  const recentApplications = useMemo(
    () => applications.slice(0, RECENT_LIMIT),
    [applications]
  );

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      {/* The gateway always redirects back here after a card payment (040),
          regardless of which application's detail page the payment was
          started from. Renders nothing; just confirms with the server what
          actually happened — the repayment tab re-fetches fresh whenever a
          customer opens it, so there is nothing here left to refresh. */}
      <PaymentReturnHandler />
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center space-x-3 mb-6">
          <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
            <UserCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
              {t("customer.overview.welcomeBack")}
            </p>
            <p className="text-sm font-bold text-slate-800">
              {user?.email || t("customer.overview.customerFallback")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {QUICK_ACTIONS.map(({ to, labelKey, icon: Icon }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              type="button"
              className="flex items-center space-x-3 bg-white border border-slate-100 shadow-sm rounded-2xl p-4 text-left hover:border-brand-primary/30 hover:bg-brand-primary/5 transition-colors"
            >
              <div className="bg-brand-primary/10 text-brand-primary p-2 rounded-xl shrink-0">
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-sm font-semibold text-slate-700">{t(labelKey)}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label={t("customer.overview.statTotalApplications")} value={stats.total} icon={FileStack} accent="slate" />
          <StatCard label={t("customer.overview.statPendingReview")} value={stats.pending} icon={Clock} accent="amber" />
          <StatCard label={t("customer.overview.statApproved")} value={stats.approved} icon={CheckCircle2} accent="emerald" />
          <StatCard label={t("customer.overview.statRejected")} value={stats.rejected} icon={XCircle} accent="rose" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t("customer.overview.recentApplications")}
              </h2>
              {applications.length > 0 && (
                <button
                  onClick={() => navigate("/dashboard/applications")}
                  type="button"
                  className="flex items-center space-x-1 text-xs font-semibold text-brand-primary hover:underline"
                >
                  <span>{t("customer.overview.viewAll")}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
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

            {!appsLoading && !appsError && recentApplications.length > 0 && (
              <div className="space-y-3">
                {recentApplications.map((application) => (
                  <ApplicationSummaryCard
                    key={application.application_id}
                    application={application}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-4">
            <NotificationsPanel
              notifications={notifications}
              loading={notifLoading}
              error={notifError}
              limit={5}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomerOverview;

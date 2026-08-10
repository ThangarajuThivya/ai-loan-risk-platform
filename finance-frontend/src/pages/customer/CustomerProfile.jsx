import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  User,
  Mail,
  Calendar,
  VenusAndMars,
  MapPin,
  Briefcase,
  Building2,
  Wallet,
  CheckCircle,
  Circle,
  Loader2,
  AlertTriangle,
  IdCard,
  ShieldCheck,
  ShieldAlert,
  Heart,
  GraduationCap,
  Clock,
  Landmark,
  Hash,
  UserCheck,
  BadgeCheck,
  Sparkles,
  ChevronRight,
  Copy,
  Check,
  RefreshCw,
  Lock,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import ChangePasswordForm from "../../components/ChangePasswordForm";
import {
  MARITAL_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  OCCUPATION_OPTIONS,
  EMPLOYER_CATEGORY_OPTIONS,
} from "../../constants/loanCategories";

/**
 * The customer's own profile — identity (fixed), contact + personal details,
 * employment + income (both feed the risk model), bank accounts (read-only,
 * issued by the bank), and account security.
 *
 * REBUILT ON THE SAME TAB PATTERN as LoanApplicationDetail and LeaseDetail:
 * a compact identity header, an attention banner for the one thing worth
 * surfacing without hunting for it, a segmented tab bar, then one topic per
 * tab. The previous version was a single dense card with every field in
 * 10-11px text — functional, but it read as a form to get through rather
 * than a page with a handful of distinct things on it, which is what it
 * actually is.
 */

const EMPLOYMENT_TYPE_OPTIONS = [
  "Salaried Employee",
  "Self Employed",
  "Business Owner",
  "Student",
  "Unemployed",
];

const KYC_BADGE = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const inputClass =
  "w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary transition-colors disabled:bg-slate-50 disabled:text-slate-400";

/** One labeled input/select cell, shared by the Contact and Employment tabs. */
function Field({ icon: Icon, label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 leading-snug">{hint}</p>}
    </div>
  );
}

function SectionCard({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function ProfileSkeleton() {
  const block = "bg-slate-200/70 rounded-xl animate-pulse";
  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5">
          <div className={`w-16 h-16 rounded-full shrink-0 ${block}`} />
          <div className="flex-1 space-y-2.5">
            <div className={`h-4 w-48 ${block}`} />
            <div className={`h-3 w-64 ${block}`} />
          </div>
        </div>
        <div className={`h-11 w-full ${block}`} />
        <div className={`h-64 w-full ${block}`} />
      </div>
    </div>
  );
}

/** The empty form snapshot used both on load and after a successful save. */
const formFromProfile = (p) => ({
  phone: p?.phone || "",
  address: p?.address || "",
  employmentType: p?.employment_type || "",
  companyName: p?.company_name || "",
  monthlyIncome: p?.monthly_income ?? "",
  monthlyExpense: p?.monthly_expense ?? "",
  nationalId: p?.national_id || "",
  maritalStatus: p?.marital_status || "",
  educationLevel: p?.education_level || "",
  occupation: p?.occupation || "",
  employerCategory: p?.employer_category || "",
  yearsEmployed: p?.years_employed ?? "",
});

export default function CustomerProfile() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [profile, setProfile] = useState(null);
  // The customer's accounts with this bank (039). Read-only here: the bank
  // ISSUES these, the customer does not declare them, so there is nothing on
  // this page to edit. One is opened automatically when they accept a loan
  // offer, so an empty list is a normal state, not something to fix.
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [form, setForm] = useState(null);
  // The pristine snapshot the form loaded (or last saved) with — real state,
  // not a ref, because it has to participate in the isDirty comparison on
  // every render, and reading a ref's .current during render is exactly
  // what this project's lint config flags.
  const [savedForm, setSavedForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [copiedAccountId, setCopiedAccountId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/user/profile");
      const p = res.data?.profile;
      const nextForm = formFromProfile(p);
      setProfile(p);
      setAccounts(res.data?.accounts || []);
      setForm(nextForm);
      setSavedForm(nextForm);
      setAvatarBroken(false);
    } catch (err) {
      setError(err.response?.data?.message || t("customer.profile.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // Wrapped rather than called directly: loadProfile sets state, and a
    // synchronous setState call in an effect body trips the
    // cascading-render lint rule. The await defers it past the render pass.
    (async () => {
      await loadProfile();
    })();
    // loadProfile is recreated only when `t` changes (language switch); an
    // exhaustive dependency list would refetch on every render once `form`
    // is added to it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const isDirty = Boolean(form && savedForm && JSON.stringify(form) !== JSON.stringify(savedForm));

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const res = await api.put("/user/profile", {
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        employmentType: form.employmentType || undefined,
        companyName: form.companyName.trim() || undefined,
        monthlyIncome: Number(form.monthlyIncome),
        monthlyExpense: Number(form.monthlyExpense),
        nationalId: form.nationalId.trim() || undefined,
        maritalStatus: form.maritalStatus || undefined,
        educationLevel: form.educationLevel || undefined,
        occupation: form.occupation || undefined,
        employerCategory: form.employerCategory || undefined,
        yearsEmployed: form.yearsEmployed !== "" ? Number(form.yearsEmployed) : undefined,
      });
      const p = res.data?.profile;
      const nextForm = formFromProfile(p);
      setProfile(p);
      setAccounts(res.data?.accounts || []);
      setForm(nextForm);
      setSavedForm(nextForm);
      showToast({
        type: "success",
        title: t("customer.profile.updateSuccessTitle"),
        message: t("customer.profile.updateSuccessMessage"),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.profile.updateFailedTitle"),
        message: err.response?.data?.message || t("customer.profile.updateFailedDefault"),
      });
    } finally {
      setSaving(false);
    }
  };

  const copyAccountNumber = async (acc) => {
    try {
      await navigator.clipboard.writeText(acc.account_number);
      setCopiedAccountId(acc.id);
      setTimeout(() => setCopiedAccountId((id) => (id === acc.id ? null : id)), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context). The
      // number is already visible on screen, so this fails quietly rather
      // than as an error toast over a nicety.
    }
  };

  // Independent, directly-fillable fields only — KYC verification is a
  // separate, staff-adjudicated concept (see the Identity card in Overview)
  // and does not belong in a "type this in to reach 100%" meter.
  const COMPLETENESS_FIELDS = useMemo(
    () => [
      { test: (f) => Boolean(f.phone.trim()), labelKey: "phoneLabel", tabId: "contact" },
      { test: (f) => Boolean(f.address.trim()), labelKey: "addressLabel", tabId: "contact" },
      { test: (f) => Boolean(f.nationalId.trim()), labelKey: "nationalIdLabel", tabId: "contact" },
      { test: (f) => Boolean(f.maritalStatus), labelKey: "maritalStatusLabel", tabId: "contact" },
      { test: (f) => Boolean(f.educationLevel), labelKey: "educationLevelLabel", tabId: "contact" },
      { test: (f) => Boolean(f.employmentType), labelKey: "employmentLabel", tabId: "employment" },
      { test: (f) => Boolean(f.occupation), labelKey: "occupationLabel", tabId: "employment" },
      { test: (f) => Boolean(f.employerCategory), labelKey: "employerCategoryLabel", tabId: "employment" },
      { test: (f) => f.yearsEmployed !== "", labelKey: "yearsEmployedLabel", tabId: "employment" },
    ],
    []
  );

  if (loading) return <ProfileSkeleton />;

  if (error) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
        <div className="max-w-xl mx-auto flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-2xl p-5 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={loadProfile}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 hover:text-rose-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("customer.profile.retryButton")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const filledCount = COMPLETENESS_FIELDS.filter((f) => f.test(form)).length;
  const completeness = Math.round((filledCount / COMPLETENESS_FIELDS.length) * 100);
  const nextMissing = COMPLETENESS_FIELDS.find((f) => !f.test(form));

  const avatarUrl = profile?.profile_image ? `http://localhost:5000${profile.profile_image}` : null;
  const showAvatarPhoto = avatarUrl && !avatarBroken;
  const kycVerified = profile?.kyc_status === "verified";
  const accountsCount = accounts.length;

  const TABS = [
    { id: "overview", labelKey: "customer.profile.tabOverview", icon: User },
    { id: "contact", labelKey: "customer.profile.tabContact", icon: MapPin },
    { id: "employment", labelKey: "customer.profile.tabEmployment", icon: Briefcase },
    { id: "accounts", labelKey: "customer.profile.tabAccounts", icon: Landmark, count: accountsCount },
    { id: "security", labelKey: "customer.profile.tabSecurity", icon: Lock },
  ];

  return (
    <div className="pb-28 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-5xl mx-auto">
        {/* ================= Identity header ================= */}
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-4 flex flex-col sm:flex-row gap-4 sm:items-center">
          <div className="relative shrink-0">
            {showAvatarPhoto ? (
              <img
                src={avatarUrl}
                alt=""
                onError={() => setAvatarBroken(true)}
                className="w-16 h-16 rounded-full object-cover ring-4 ring-white shadow"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-brand-primary to-brand-secondary text-white flex items-center justify-center text-xl font-black shadow ring-4 ring-white">
                {(profile?.first_name?.[0] || "").toUpperCase()}
                {(profile?.last_name?.[0] || "").toUpperCase()}
              </div>
            )}
            {kycVerified && (
              <span
                title={t("customer.profile.kycStatus_verified")}
                className="absolute -bottom-1 -right-1 bg-emerald-500 text-white rounded-full p-0.5 border-2 border-white shadow"
              >
                <BadgeCheck className="w-3.5 h-3.5" />
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {profile?.first_name} {profile?.last_name}
              </h2>
              {profile?.kyc_status && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${KYC_BADGE[profile.kyc_status]}`}
                >
                  <ShieldCheck className="w-2.5 h-2.5" />
                  {t(`customer.profile.kycStatus_${profile.kyc_status}`)}
                </span>
              )}
            </div>
            <p className="text-slate-500 text-xs flex items-center gap-1.5 truncate">
              <Mail className="w-3.5 h-3.5 shrink-0" /> {profile?.email}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {formatDate(profile?.date_of_birth)}
              </span>
              <span className="flex items-center gap-1">
                <VenusAndMars className="w-3 h-3" /> {profile?.gender || "—"}
              </span>
              {profile?.created_at && (
                <span>{t("customer.profile.memberSince", { date: formatDate(profile.created_at) })}</span>
              )}
            </div>
          </div>
        </div>

        {/* Attention banner — the one thing worth surfacing without making
            a customer hunt across tabs for it, same convention as the loan
            and lease detail pages. */}
        {completeness < 100 && (
          <button
            type="button"
            onClick={() => setActiveTab(nextMissing.tabId)}
            className="w-full flex items-center justify-between gap-3 bg-brand-primary text-white rounded-2xl p-4 mb-4 text-left hover:bg-brand-primary/95 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Sparkles className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {t("customer.profile.attentionBannerTitle", { percent: completeness })}
                </p>
                <p className="text-xs text-white/80 truncate">
                  {t("customer.profile.attentionBannerBody", {
                    field: t(`customer.profile.${nextMissing.labelKey}`),
                  })}
                </p>
              </div>
            </div>
            <span className="text-xs font-bold whitespace-nowrap shrink-0">
              {t("customer.profile.completenessCta")}
            </span>
          </button>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto bg-white rounded-2xl border border-slate-100 shadow-sm p-1.5">
          {TABS.map(({ id: tabId, labelKey, icon: Icon, count }) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                activeTab === tabId ? "bg-brand-primary text-white" : "text-slate-500 hover:bg-slate-50"
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

        {/* ================= Overview ================= */}
        {activeTab === "overview" && (
          <div className="space-y-4">
            <SectionCard>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-4">
                <Sparkles className="w-3.5 h-3.5 text-brand-accent" /> {t("customer.profile.completenessHeading")}
              </h4>
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      completeness === 100 ? "bg-emerald-500" : "bg-brand-accent"
                    }`}
                    style={{ width: `${completeness}%` }}
                  />
                </div>
                <span className="text-sm font-black text-slate-800 font-mono tabular-nums shrink-0">
                  {completeness}%
                </span>
              </div>

              {completeness === 100 ? (
                <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4" /> {t("customer.profile.completenessComplete")}
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">
                    {t("customer.profile.overviewChecklistHeading")}
                  </p>
                  {COMPLETENESS_FIELDS.filter((f) => !f.test(form)).map((f) => (
                    <button
                      key={f.labelKey}
                      type="button"
                      onClick={() => setActiveTab(f.tabId)}
                      className="w-full flex items-center justify-between gap-2 py-2 px-2.5 -mx-2.5 rounded-lg text-left hover:bg-slate-50 transition-colors group"
                    >
                      <span className="flex items-center gap-2.5 text-sm text-slate-600">
                        <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                        {t(`customer.profile.${f.labelKey}`)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-primary transition-colors shrink-0" />
                    </button>
                  ))}
                  {COMPLETENESS_FIELDS.filter((f) => f.test(form)).map((f) => (
                    <div key={f.labelKey} className="flex items-center gap-2.5 py-2 px-2.5 -mx-2.5 text-sm text-slate-400">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="line-through decoration-slate-300">
                        {t(`customer.profile.${f.labelKey}`)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                <ShieldCheck className="w-3.5 h-3.5 text-brand-primary" />{" "}
                {t("customer.profile.overviewIdentityHeading")}
              </h4>
              <div className="flex items-start gap-3">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${
                    profile?.kyc_status ? KYC_BADGE[profile.kyc_status] : "bg-slate-50 text-slate-500 border-slate-200"
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {profile?.kyc_status ? t(`customer.profile.kycStatus_${profile.kyc_status}`) : "—"}
                </span>
                {profile?.kyc_status === "rejected" && profile.kyc_notes && (
                  <p className="text-xs text-rose-600 flex items-start gap-1.5 min-w-0">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="italic">"{profile.kyc_notes}"</span>
                  </p>
                )}
                {profile?.kyc_status === "verified" && profile.kyc_verified_at && (
                  <p className="text-xs text-slate-400">{formatDate(profile.kyc_verified_at)}</p>
                )}
              </div>
            </SectionCard>

            <button
              type="button"
              onClick={() => setActiveTab("accounts")}
              className="w-full text-left"
            >
              <SectionCard className="hover:border-slate-200 transition-colors">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
                    <span className="bg-brand-primary/10 text-brand-primary p-1.5 rounded-lg">
                      <Landmark className="w-4 h-4" />
                    </span>
                    {t("customer.profile.overviewAccountsStat")}
                  </span>
                  <span className="flex items-center gap-2 text-slate-400">
                    <span className="text-lg font-black text-slate-800 font-mono">{accountsCount}</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </SectionCard>
            </button>
          </div>
        )}

        {/* ================= Contact & Personal ================= */}
        {activeTab === "contact" && (
          <SectionCard>
            <p className="text-xs text-slate-400 mb-5">{t("customer.profile.contactFinancialHint")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <Field label={t("customer.profile.phoneLabel")}>
                <input
                  type="text"
                  value={form.phone}
                  onChange={handleField("phone")}
                  placeholder={t("customer.profile.phonePlaceholder")}
                  className={inputClass}
                />
              </Field>

              <Field
                icon={IdCard}
                label={t("customer.profile.nationalIdLabel")}
                hint={
                  profile?.kyc_status === "verified"
                    ? t("customer.profile.nationalIdLockedHint")
                    : t("customer.profile.nationalIdHint")
                }
              >
                <input
                  type="text"
                  value={form.nationalId}
                  onChange={handleField("nationalId")}
                  disabled={profile?.kyc_status === "verified"}
                  placeholder={t("customer.profile.nationalIdPlaceholder")}
                  className={inputClass}
                />
              </Field>

              <Field icon={MapPin} label={t("customer.profile.addressLabel")}>
                <input
                  type="text"
                  value={form.address}
                  onChange={handleField("address")}
                  placeholder={t("customer.profile.addressPlaceholder")}
                  className={inputClass}
                />
              </Field>

              <Field icon={Heart} label={t("customer.profile.maritalStatusLabel")}>
                <select
                  value={form.maritalStatus}
                  onChange={handleField("maritalStatus")}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">{t("customer.profile.selectPlaceholder")}</option>
                  {MARITAL_STATUS_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>

              <Field icon={GraduationCap} label={t("customer.profile.educationLevelLabel")}>
                <select
                  value={form.educationLevel}
                  onChange={handleField("educationLevel")}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">{t("customer.profile.selectPlaceholder")}</option>
                  {EDUCATION_LEVEL_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </SectionCard>
        )}

        {/* ================= Employment & Income ================= */}
        {activeTab === "employment" && (
          <SectionCard>
            <p className="text-xs text-slate-400 mb-5">{t("customer.profile.sectionEmploymentHint")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <Field icon={Briefcase} label={t("customer.profile.employmentLabel")}>
                <select
                  value={form.employmentType}
                  onChange={handleField("employmentType")}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">{t("customer.profile.selectPlaceholder")}</option>
                  {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field icon={Building2} label={t("customer.profile.companyLabel")}>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={handleField("companyName")}
                  placeholder={t("customer.profile.companyPlaceholder")}
                  className={inputClass}
                />
              </Field>
              <Field icon={Briefcase} label={t("customer.profile.occupationLabel")}>
                <select
                  value={form.occupation}
                  onChange={handleField("occupation")}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">{t("customer.profile.selectPlaceholder")}</option>
                  {OCCUPATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field icon={Building2} label={t("customer.profile.employerCategoryLabel")}>
                <select
                  value={form.employerCategory}
                  onChange={handleField("employerCategory")}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">{t("customer.profile.selectPlaceholder")}</option>
                  {EMPLOYER_CATEGORY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field icon={Clock} label={t("customer.profile.yearsEmployedLabel")}>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={form.yearsEmployed}
                  onChange={handleField("yearsEmployed")}
                  placeholder={t("customer.profile.yearsEmployedPlaceholder")}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field icon={Wallet} label={t("customer.profile.monthlyIncomeLabel")}>
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={form.monthlyIncome}
                  onChange={handleField("monthlyIncome")}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field label={t("customer.profile.monthlyExpenseLabel")}>
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={form.monthlyExpense}
                  onChange={handleField("monthlyExpense")}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
          </SectionCard>
        )}

        {/* ================= Accounts ================= */}
        {activeTab === "accounts" && (
          <SectionCard>
            <p className="text-xs text-slate-400 mb-4">{t("customer.profile.accountsHint")}</p>

            {accounts.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-start gap-2">
                <Landmark className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>{t("customer.profile.accountsEmpty")}</span>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {accounts.map((acc) => (
                  <li
                    key={acc.id}
                    className={`border rounded-xl p-4 space-y-2 ${
                      acc.status === "active"
                        ? "border-slate-100 bg-slate-50"
                        : "border-slate-100 bg-white opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => copyAccountNumber(acc)}
                        title={t("customer.profile.copyAccountNumber")}
                        className="font-mono text-sm font-bold text-slate-800 tracking-wide flex items-center gap-1.5 hover:text-brand-primary transition-colors"
                      >
                        {acc.account_number}
                        {copiedAccountId === acc.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-300" />
                        )}
                      </button>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                          acc.status === "active"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-slate-100 text-slate-500 border-slate-200"
                        }`}
                      >
                        {t(`customer.profile.accountStatus.${acc.status}`)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" /> {acc.branch}
                      </span>
                      <span className="flex items-center gap-1">
                        <UserCheck className="w-3 h-3 shrink-0" /> {acc.account_holder}
                      </span>
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3 shrink-0" />{" "}
                        {t(`customer.profile.accountType.${acc.account_type}`)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 shrink-0" /> {formatDate(acc.opened_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {/* ================= Security ================= */}
        {activeTab === "security" && <ChangePasswordForm />}
      </div>

      {/* Floating save bar. Shown while actively on an editable tab (so
          "All changes saved" confirms a save landed), and — because `form`
          state persists across tab switches — kept showing on ANY tab for
          as long as isDirty is true, so a customer who edits Contact, then
          wanders to Accounts to check something, can still save from there
          instead of having to find their way back first. */}
      {(isDirty || activeTab === "contact" || activeTab === "employment") && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-lg z-30">
          <div className="bg-white/95 backdrop-blur border border-slate-200 shadow-lg rounded-2xl px-5 py-3.5 flex items-center justify-between gap-4">
            <span
              className={`text-xs font-semibold flex items-center gap-1.5 ${
                isDirty ? "text-amber-600" : "text-emerald-600"
              }`}
            >
              {isDirty ? <AlertTriangle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
              {isDirty ? t("customer.profile.unsavedChanges") : t("customer.profile.allSaved")}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="px-6 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 disabled:opacity-40 disabled:shadow-none shrink-0"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              {t("customer.profile.saveChanges")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
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
  Loader2,
  AlertTriangle,
  IdCard,
  ShieldCheck,
  Heart,
  GraduationCap,
  Clock,
  Landmark,
  Hash,
  UserCheck,
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/user/profile");
        const p = res.data?.profile;
        if (!cancelled) {
          setProfile(p);
          setAccounts(res.data?.accounts || []);
          setForm({
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
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.profile.loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      setProfile(res.data?.profile);
      setAccounts(res.data?.accounts || []);
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

  if (loading) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
        <div className="max-w-xl mx-auto flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Identity summary — fixed after registration */}
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-6 items-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-brand-primary to-brand-secondary text-white flex items-center justify-center text-2xl font-black shadow-lg shrink-0">
          {(profile?.first_name?.[0] || "").toUpperCase()}
          {(profile?.last_name?.[0] || "").toUpperCase()}
        </div>
        <div className="flex-1 space-y-1 text-center md:text-left">
          <h2 className="text-xl font-bold text-slate-900">
            {profile?.first_name} {profile?.last_name}
          </h2>
          <p className="text-slate-500 text-xs flex items-center justify-center md:justify-start gap-1.5">
            <Mail className="w-3.5 h-3.5" /> {profile?.email}
          </p>
          {profile?.kyc_status && (
            <div className="flex flex-col items-center md:items-start gap-1 mt-1">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${KYC_BADGE[profile.kyc_status]}`}
              >
                <ShieldCheck className="w-3 h-3" />
                {t(`customer.profile.kycStatus_${profile.kyc_status}`)}
              </span>
              {profile.kyc_status === "rejected" && profile.kyc_notes && (
                <p className="text-[10px] text-rose-600 italic max-w-xs">"{profile.kyc_notes}"</p>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs bg-slate-50 border border-slate-100 p-4 rounded-2xl">
          <div className="text-center px-2">
            <p className="text-[10px] text-slate-400 uppercase font-bold flex items-center justify-center gap-1">
              <Calendar className="w-3 h-3" /> {t("customer.profile.dobLabel")}
            </p>
            <p className="font-bold text-slate-800 mt-0.5">
              {formatDate(profile?.date_of_birth)}
            </p>
          </div>
          <div className="text-center px-2">
            <p className="text-[10px] text-slate-400 uppercase font-bold flex items-center justify-center gap-1">
              <VenusAndMars className="w-3 h-3" /> {t("customer.profile.genderLabel")}
            </p>
            <p className="font-bold text-slate-800 mt-0.5">{profile?.gender || "—"}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Editable contact + financial details */}
        <form
          onSubmit={handleSubmit}
          className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4"
        >
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <User className="w-4.5 h-4.5 text-brand-primary" /> {t("customer.profile.contactFinancialHeading")}
          </h4>
          <p className="text-[11px] text-slate-400 -mt-2">
            {t("customer.profile.contactFinancialHint")}
          </p>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">{t("customer.profile.phoneLabel")}</label>
              <input
                type="text"
                value={form.phone}
                onChange={handleField("phone")}
                placeholder={t("customer.profile.phonePlaceholder")}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                <IdCard className="w-3 h-3" /> {t("customer.profile.nationalIdLabel")}
              </label>
              <input
                type="text"
                value={form.nationalId}
                onChange={handleField("nationalId")}
                disabled={profile?.kyc_status === "verified"}
                placeholder={t("customer.profile.nationalIdPlaceholder")}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary disabled:bg-slate-50 disabled:text-slate-400"
              />
              {profile?.kyc_status === "verified" ? (
                <p className="text-[10px] text-slate-400">{t("customer.profile.nationalIdLockedHint")}</p>
              ) : (
                <p className="text-[10px] text-slate-400">{t("customer.profile.nationalIdHint")}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {t("customer.profile.addressLabel")}
              </label>
              <input
                type="text"
                value={form.address}
                onChange={handleField("address")}
                placeholder={t("customer.profile.addressPlaceholder")}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                  <Briefcase className="w-3 h-3" /> {t("customer.profile.employmentLabel")}
                </label>
                <select
                  value={form.employmentType}
                  onChange={handleField("employmentType")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                >
                  <option value="">{t("customer.profile.selectPlaceholder")}</option>
                  {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {t("customer.profile.companyLabel")}
                </label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={handleField("companyName")}
                  placeholder={t("customer.profile.companyPlaceholder")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> {t("customer.profile.monthlyIncomeLabel")}
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={form.monthlyIncome}
                  onChange={handleField("monthlyIncome")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase">
                  {t("customer.profile.monthlyExpenseLabel")}
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  value={form.monthlyExpense}
                  onChange={handleField("monthlyExpense")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                />
              </div>
            </div>

            {/* H2 — stable attributes promoted from per-application declared
                fields to durable customer_profiles columns: settable here
                directly, and reused/reaffirmed by the loan wizard. */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <h5 className="text-[11px] font-bold text-slate-500 uppercase">
                {t("customer.profile.personalDetailsHeading")}
              </h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Heart className="w-3 h-3" /> {t("customer.profile.maritalStatusLabel")}
                  </label>
                  <select
                    value={form.maritalStatus}
                    onChange={handleField("maritalStatus")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                  >
                    <option value="">{t("customer.profile.selectPlaceholder")}</option>
                    {MARITAL_STATUS_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" /> {t("customer.profile.educationLevelLabel")}
                  </label>
                  <select
                    value={form.educationLevel}
                    onChange={handleField("educationLevel")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                  >
                    <option value="">{t("customer.profile.selectPlaceholder")}</option>
                    {EDUCATION_LEVEL_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> {t("customer.profile.occupationLabel")}
                  </label>
                  <select
                    value={form.occupation}
                    onChange={handleField("occupation")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                  >
                    <option value="">{t("customer.profile.selectPlaceholder")}</option>
                    {OCCUPATION_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> {t("customer.profile.employerCategoryLabel")}
                  </label>
                  <select
                    value={form.employerCategory}
                    onChange={handleField("employerCategory")}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                  >
                    <option value="">{t("customer.profile.selectPlaceholder")}</option>
                    {EMPLOYER_CATEGORY_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {t("customer.profile.yearsEmployedLabel")}
                </label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={form.yearsEmployed}
                  onChange={handleField("yearsEmployed")}
                  placeholder={t("customer.profile.yearsEmployedPlaceholder")}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              {t("customer.profile.saveChanges")}
            </button>
          </div>
        </form>

        <div className="space-y-6">
          {/* The customer's accounts with this bank (039). Deliberately
              read-only and outside the form above: the bank ISSUES an account
              number, the customer does not declare one, so there is nothing
              here to type or save. This replaces the editable "beneficiary
              account" fields that used to live in that form — those asked the
              customer for a number nobody could verify, and left an approved
              loan undisbursable until they happened to fill them in.
              An account is opened automatically the moment a loan offer is
              accepted, so an empty list here is a normal state, not a task. */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
              <Landmark className="w-4.5 h-4.5 text-brand-primary" />{" "}
              {t("customer.profile.accountsHeading")}
            </h4>
            <p className="text-[11px] text-slate-400 -mt-2">
              {t("customer.profile.accountsHint")}
            </p>

            {accounts.length === 0 ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-4 flex items-start gap-2">
                <Landmark className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>{t("customer.profile.accountsEmpty")}</span>
              </div>
            ) : (
              <ul className="space-y-3">
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
                      <span className="font-mono text-sm font-bold text-slate-800 tracking-wide">
                        {acc.account_number}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
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
          </div>

          <ChangePasswordForm />
        </div>
      </div>
    </div>
    </div>
  );
}

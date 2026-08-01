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
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import ChangePasswordForm from "../../components/ChangePasswordForm";

const EMPLOYMENT_TYPE_OPTIONS = [
  "Salaried Employee",
  "Self Employed",
  "Business Owner",
  "Student",
  "Unemployed",
];

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
          setForm({
            phone: p?.phone || "",
            address: p?.address || "",
            employmentType: p?.employment_type || "",
            companyName: p?.company_name || "",
            monthlyIncome: p?.monthly_income ?? "",
            monthlyExpense: p?.monthly_expense ?? "",
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
      });
      setProfile(res.data?.profile);
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
                placeholder="e.g. 0771234567"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {t("customer.profile.addressLabel")}
              </label>
              <input
                type="text"
                value={form.address}
                onChange={handleField("address")}
                placeholder="e.g. 123 Galle Road, Colombo"
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

        <ChangePasswordForm />
      </div>
    </div>
    </div>
  );
}

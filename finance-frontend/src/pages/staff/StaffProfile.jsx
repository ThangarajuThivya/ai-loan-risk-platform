import { useEffect, useState } from "react";
import { Mail, Phone, Info, Loader2, AlertTriangle } from "lucide-react";
import api from "../../api/axios";
import ChangePasswordForm from "../../components/ChangePasswordForm";

// Staff have no self-editable profile fields (admin manages name/email/phone
// via Staff Management) — this page is just an identity summary plus the one
// thing staff genuinely need to self-serve: changing their own password.
export default function StaffProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/user/profile");
        if (!cancelled) setProfile(res.data?.profile);
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message || "Couldn't load your profile. Please try again."
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-6 items-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-brand-primary to-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shrink-0">
          {(profile?.first_name?.[0] || "").toUpperCase()}
          {(profile?.last_name?.[0] || "").toUpperCase()}
        </div>
        <div className="flex-1 space-y-1.5 text-center sm:text-left">
          <h2 className="text-xl font-bold text-slate-900">
            {profile?.first_name} {profile?.last_name}
          </h2>
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-brand-primary/10 text-brand-primary">
            Staff Member
          </span>
          <p className="text-slate-500 text-sm flex items-center justify-center sm:justify-start gap-1.5 mt-1.5">
            <Mail className="w-3.5 h-3.5" /> {profile?.email}
          </p>
          {profile?.phone && (
            <p className="text-slate-500 text-sm flex items-center justify-center sm:justify-start gap-1.5">
              <Phone className="w-3.5 h-3.5" /> {profile.phone}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        Name, email, and phone are managed by an admin — contact one if these
        need to change.
      </div>

      <ChangePasswordForm />
    </div>
  );
}

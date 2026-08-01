import { useEffect, useState } from "react";
import { Mail, Phone, Loader2, AlertTriangle } from "lucide-react";
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
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-6 items-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#0F4C81] to-indigo-600 text-white flex items-center justify-center text-2xl font-black shadow-lg shrink-0">
          {(profile?.first_name?.[0] || "").toUpperCase()}
          {(profile?.last_name?.[0] || "").toUpperCase()}
        </div>
        <div className="flex-1 space-y-1.5 text-center sm:text-left">
          <h2 className="text-xl font-bold text-slate-900">
            {profile?.first_name} {profile?.last_name}
          </h2>
          <p className="text-[#0F4C81] text-xs font-bold uppercase tracking-wider">Staff</p>
          <p className="text-slate-500 text-xs flex items-center justify-center sm:justify-start gap-1.5">
            <Mail className="w-3.5 h-3.5" /> {profile?.email}
          </p>
          {profile?.phone && (
            <p className="text-slate-500 text-xs flex items-center justify-center sm:justify-start gap-1.5">
              <Phone className="w-3.5 h-3.5" /> {profile.phone}
            </p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 px-1">
        Name, email, and phone are managed by an admin. Contact one if these need to change.
      </p>

      <ChangePasswordForm />
    </div>
  );
}

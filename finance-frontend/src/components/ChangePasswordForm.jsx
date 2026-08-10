import { useState } from "react";
import { Lock, Key, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import api from "../api/axios";
import { useToast } from "./toast/useToast";

// Shared by CustomerProfile and StaffProfile — both roles hit the same
// PUT /api/user/passwordChange endpoint, which works for any authenticated
// role, so the form itself has no role-specific logic.
//
// COLLAPSED BY DEFAULT. On the customer profile page this sits in a sidebar
// next to the bank-accounts card; a password form nobody is currently using
// doesn't need three always-visible inputs' worth of vertical space to say
// "you can change your password here" — the header row says that on its
// own, and clicking it is what a settings-style "Security" row looks like
// everywhere else.
export default function ChangePasswordForm() {
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const closeAndReset = () => {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword || submitting) return;

    if (newPassword.length < 8) {
      showToast({
        type: "error",
        title: "Password Too Short",
        message: "New password must be at least 8 characters.",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast({
        type: "error",
        title: "Passwords Don't Match",
        message: "New password and confirmation must match.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.put("/user/passwordChange", {
        currentPassword,
        newPassword,
      });
      showToast({
        type: "success",
        title: "Password Changed",
        message: res.data?.message || "Your password was updated.",
      });
      closeAndReset();
    } catch (err) {
      showToast({
        type: "error",
        title: "Password Change Failed",
        message: err.response?.data?.message || "Please check your current password.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
      <button
        type="button"
        onClick={() => (open ? closeAndReset() : setOpen(true))}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <span className="bg-brand-primary/10 text-brand-primary p-1.5 rounded-lg">
            <Lock className="w-4 h-4" />
          </span>
          Password
        </h4>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {!open && <p className="text-xs text-slate-400 mt-1.5 ml-9">Change your account password.</p>}

      {open && (
        <form onSubmit={handleSubmit} className="space-y-2.5 text-xs mt-4 pt-4 border-t border-slate-100">
          <div className="space-y-1">
            <label className="font-bold text-slate-500 uppercase">Current Password</label>
            <input
              type="password"
              required
              autoFocus
              placeholder="••••••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-500 uppercase">New Password</label>
            <input
              type="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-500 uppercase">Confirm New Password</label>
            <input
              type="password"
              required
              placeholder="••••••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAndReset}
              disabled={submitting}
              className="px-4 py-2.5 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-bold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Key className="w-3.5 h-3.5" />
              )}
              Update Password
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

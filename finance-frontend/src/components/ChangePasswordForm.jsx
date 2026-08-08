import { useState } from "react";
import { Lock, Key, Loader2 } from "lucide-react";
import api from "../api/axios";
import { useToast } from "./toast/useToast";

// Shared by CustomerProfile and StaffProfile — both roles hit the same
// PUT /api/user/passwordChange endpoint, which works for any authenticated
// role, so the form itself has no role-specific logic.
export default function ChangePasswordForm() {
  const { showToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
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
    <form
      onSubmit={handleSubmit}
      className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3"
    >
      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
        <Lock className="w-4.5 h-4.5 text-brand-primary" /> Change Password
      </h4>

      <div className="space-y-2.5 text-xs">
        <div className="space-y-1">
          <label className="font-bold text-slate-500 uppercase">Current Password</label>
          <input
            type="password"
            required
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
      </div>

      <div className="pt-3 border-t border-slate-100 flex justify-end">
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
  );
}

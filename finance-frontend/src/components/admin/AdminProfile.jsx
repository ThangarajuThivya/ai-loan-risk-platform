import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  User,
  Mail,
  Phone,
  Shield,
  Key,
  CheckCircle,
  RefreshCw,
  Lock,
  Camera,
} from "lucide-react";
import { useToast } from "../../components/toast/useToast";
import api from "../../api/axios";

export default function AdminProfile() {
  const [name, setName] = useState("Super Admin");
  const [email, setEmail] = useState("Admin@digetalbank.com");
  const [phone, setPhone] = useState("+1 (555) 019-2834");
  const [role, setRole] = useState("Chief Underwriting Director");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const { showToast } = useToast();

  const handleUpdateProfile = (e) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    setTimeout(() => {
      setIsUpdatingProfile(false);
      alert("Administrative credentials updated successfully!");
    }, 1000);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) return;

    if (newPassword !== confirmPassword) {
      showToast({
        type: "error",

        title: "password change error ",

        message: `Confirm password does not match`,
      });

      return;
    }

    try {
      const response = await api.put("/user/passwordChange", {
        currentPassword,
        newPassword,
      });

      showToast({
        type: "success",

        title: "password change success ",

        message: response.data.message,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      showToast({
        type: "error",

        title: "password change failed ",

        message: error.response?.data?.message,
      });
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Profile summary banner */}
      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-6 items-center">
        {/* Avatar */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-900 to-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg">
            MC
          </div>
          <button
            className="absolute bottom-0 right-0 p-1.5 bg-[#00A86B] text-white rounded-full hover:scale-105 transition-transform shadow"
            title="Upload avatar photo"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1 text-center md:text-left flex-1">
          <h2 className="text-xl font-bold text-slate-900">{name}</h2>
          <p className="text-[#0F4C81] text-xs font-bold uppercase tracking-wider">
            {role}
          </p>
          <p className="text-slate-400 text-xs">
            Security clearance: LEVEL 5 (Sovereign Administrator)
          </p>
        </div>

        <div className="flex gap-2 text-xs bg-slate-50 border border-slate-150 p-4 rounded-2xl">
          <div className="text-center px-4">
            <p className="text-[10px] text-slate-400 uppercase font-bold">
              Audits Pass
            </p>
            <p className="font-bold text-slate-800 text-sm mt-0.5">382</p>
          </div>
          <div className="border-l border-slate-200"></div>
          <div className="text-center px-4">
            <p className="text-[10px] text-slate-400 uppercase font-bold">
              Accuracy
            </p>
            <p className="font-bold text-emerald-600 text-sm mt-0.5">99.8%</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Info card form */}
        <form
          onSubmit={handleUpdateProfile}
          className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4"
        >
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <User className="w-4.5 h-4.5 text-indigo-700" /> Admin Information
            Details
          </h4>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                Director Full Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                Registered Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                Phone Line Connection
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                Designation Role
              </label>
              <input
                type="text"
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 focus:outline-none"
                disabled
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={isUpdatingProfile}
              className="px-5 py-2.5 bg-[#0F4C81] hover:bg-indigo-950 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
            >
              {isUpdatingProfile ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5" />
              )}
              Update Profile details
            </button>
          </div>
        </form>

        {/* Change password */}
        <form
          onSubmit={handleChangePassword}
          className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4"
        >
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <Lock className="w-4.5 h-4.5 text-indigo-700" /> Administrative
            Security Rotation
          </h4>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                Current Admin Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                New Security Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
              />
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">
                Confirm Password rotation
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              className="px-5 py-2.5 bg-[#00A86B] hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5" /> Rotate Password Hash
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

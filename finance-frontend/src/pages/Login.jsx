import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Lock, Mail, ShieldCheck, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/toast/useToast";

export default function Login() {
  const { t } = useTranslation();
  const [activeTab] = useState("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authSuccess, setAuthSuccess] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();
  const { showToast } = useToast();

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;

    try {
      setAuthenticating(true);

      // AuthContext login function call

      const loggedInUser = await login({
        email,

        password,
      });

      setAuthenticating(false);

      setAuthSuccess(true);

      showToast({
        type: "success",

        title: t('login.toastSuccessTitle'),

        message: t('login.toastSuccessMessage'),
      });
      // Role Based Redirect

      if (loggedInUser?.role === "admin") {
        navigate("/admin");
      } else if (loggedInUser?.role === "staff") {
        navigate("/staff");
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setAuthenticating(false);
      console.log(err);
      showToast({
        type: "error",

        title: t('login.toastFailTitle'),

        message: err.response?.data?.message || t('login.invalidCredentials'),
      });
    }
  };

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen flex flex-col justify-center items-center px-4">
      {/* Brand Icon & Heading */}
      <div className="text-center mb-8 space-y-1">
        <div className="inline-flex items-center space-x-2 bg-brand-primary p-3.5 rounded-2xl shadow-md text-white mb-4">
          <ShieldCheck className="w-8 h-8 text-brand-accent" />
        </div>
        <h1 className="font-display font-bold text-2xl text-slate-900 leading-none">
          {t('login.pageTitle')}
        </h1>
        <p className="text-slate-500 text-xs">
          {t('login.pageSubtitle')}
        </p>
      </div>

      {/* Main Center Card */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden">
        {/* Dynamic backdrop decorative glows */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-accent/5 rounded-full blur-xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-brand-primary/5 rounded-full blur-xl pointer-events-none"></div>

        {/* 1. Tab Selector Switches */}
        {/* <div className="flex bg-slate-50 rounded-xl p-1 mb-6 border border-slate-200">
          {(['customer', 'officer', 'admin'] ).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => handleTabChange(role)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider ${
                activeTab === role 
                  ? 'bg-white text-brand-primary shadow-sm border border-slate-100' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {role}
            </button>
          ))}
        </div> */}

        {/* Animate tab text description */}
        <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl mb-6 text-xs text-slate-500 leading-relaxed">
          <p className="font-semibold text-slate-700 uppercase tracking-widest text-[9px] mb-1 font-mono">
            {t('login.portalConsole', { role: activeTab.toUpperCase() })}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {!authSuccess ? (
            <motion.form
              key="login-form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleLoginSubmit}
              className="space-y-4"
            >
              {/* Email Address */}
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                  {t('login.emailLabel')}
                </label>
                <div className="relative">
                  <Mail className="absolute inset-y-0 left-3.5 w-5 h-5 text-slate-400 my-auto" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                    placeholder="name@Degital-iloan.com"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider">
                    {t('login.passwordLabel')}
                  </label>
                  <span
                    onClick={() => navigate("/forgot-password")}
                    className="text-[10px] text-brand-primary font-semibold hover:underline cursor-pointer"
                  >
                    {t('login.forgotLink')}
                  </span>
                </div>
                <div className="relative">
                  <Lock className="absolute inset-y-0 left-3.5 w-5 h-5 text-slate-400 my-auto" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-11 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-3.5 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={authenticating}
                className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm uppercase text-xs tracking-wider pt-4"
              >
                {authenticating ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>{t('login.verifyingButton')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('login.submitButton')}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </motion.form>
          ) : (
            <motion.div
              key="auth-success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center p-6 space-y-4"
            >
              <div className="bg-emerald-100 text-emerald-800 p-3 rounded-full inline-block mx-auto border border-emerald-200">
                <ShieldCheck className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="font-display font-bold text-lg text-emerald-900 uppercase">
                {t('login.authApproved')}
              </h3>
              <p className="text-slate-600 text-xs leading-relaxed max-w-xs mx-auto">
                <Trans i18nKey="login.authApprovedBody" values={{ email }} components={{ b: <strong /> }} />
              </p>

              <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-left font-mono text-[11px] text-slate-500">
                <div className="flex justify-between py-1 border-b border-slate-150">
                  <span>{t('login.userRoleLabel')}</span>
                  <span className="font-bold text-brand-primary">
                    {activeTab.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-150">
                  <span>{t('login.tokenVerLabel')}</span>
                  <span className="font-bold text-slate-800">
                    Degital-SEC-JWT-921
                  </span>
                </div>
                <div className="flex justify-between py-1 pt-1">
                  <span>{t('login.deedsStatusLabel')}</span>
                  <span className="font-bold text-brand-accent">
                    {t('login.authApprovedStatus')}
                  </span>
                </div>
              </div>
              <div className="pt-2 space-y-2">
                {activeTab === "officer" || activeTab === "admin" ? (
                  <button
                    onClick={() => navigate("/admin")}
                    className="bg-brand-primary hover:bg-opacity-90 text-white px-5 py-3 rounded-xl text-xs font-bold transition-colors w-full flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <span>{t('login.launchAdminDashboard')}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => navigate("/")}
                    className="bg-brand-primary hover:bg-opacity-90 text-white px-5 py-3 rounded-xl text-xs font-bold transition-colors w-full flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <span>{t('login.goToMemberHome')}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setAuthSuccess(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2 rounded-xl text-xs font-semibold transition-colors w-full"
                >
                  {t('login.resetAuthState')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

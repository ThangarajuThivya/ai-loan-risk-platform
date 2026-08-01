import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Lock,
  Mail,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";
import api from "../api/axios";
import { useToast } from "../components/toast/useToast";

const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [step, setStep] = useState("email"); // email -> otp -> reset -> done
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const timerRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [cooldown]);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!email) return;

    try {
      setSubmitting(true);
      await api.post("/auth/forgot-password", { email });

      showToast({
        type: "success",
        title: t('forgotPassword.otpSentTitle'),
        message: t('forgotPassword.otpSentMessage'),
      });

      setStep("otp");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      showToast({
        type: "error",
        title: t('forgotPassword.requestFailedTitle'),
        message: err.response?.data?.message || t('forgotPassword.sendOtpFailed'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0) return;

    try {
      setSubmitting(true);
      await api.post("/auth/resend-otp", { email });

      showToast({
        type: "success",
        title: t('forgotPassword.otpResentTitle'),
        message: t('forgotPassword.otpResentMessage'),
      });

      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      showToast({
        type: "error",
        title: t('forgotPassword.resendFailedTitle'),
        message: err.response?.data?.message || t('forgotPassword.resendFailedMessage'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) return;

    try {
      setSubmitting(true);
      const res = await api.post("/auth/verify-otp", { email, otp });

      setResetToken(res.data.resetToken);
      setStep("reset");

      showToast({
        type: "success",
        title: t('forgotPassword.otpVerifiedTitle'),
        message: t('forgotPassword.otpVerifiedMessage'),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t('forgotPassword.verificationFailedTitle'),
        message: err.response?.data?.message || t('forgotPassword.invalidOtp'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();

    if (newPassword.length < 8) {
      showToast({
        type: "error",
        title: t('forgotPassword.weakPasswordTitle'),
        message: t('forgotPassword.weakPasswordMessage'),
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast({
        type: "error",
        title: t('forgotPassword.mismatchTitle'),
        message: t('forgotPassword.mismatchMessage'),
      });
      return;
    }

    try {
      setSubmitting(true);
      await api.post("/auth/reset-password", { resetToken, newPassword });

      setStep("done");

      showToast({
        type: "success",
        title: t('forgotPassword.passwordResetTitle'),
        message: t('forgotPassword.passwordResetMessage'),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t('forgotPassword.resetFailedTitle'),
        message: err.response?.data?.message || t('forgotPassword.invalidResetToken'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen flex flex-col justify-center items-center px-4">
      <div className="text-center mb-8 space-y-1">
        <div className="inline-flex items-center space-x-2 bg-brand-primary p-3.5 rounded-2xl shadow-md text-white mb-4">
          <KeyRound className="w-8 h-8 text-brand-accent" />
        </div>
        <h1 className="font-display font-bold text-2xl text-slate-900 leading-none">
          {t('forgotPassword.pageTitle')}
        </h1>
        <p className="text-slate-500 text-xs">
          Verify your identity with a one-time code sent to your email.
        </p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl max-w-md w-full p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-accent/5 rounded-full blur-xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-brand-primary/5 rounded-full blur-xl pointer-events-none"></div>

        <AnimatePresence mode="wait">
          {step === "email" && (
            <motion.form
              key="email-step"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleSendOtp}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                  {t('forgotPassword.emailLabel')}
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

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm uppercase text-xs tracking-wider disabled:opacity-60"
              >
                <span>{submitting ? t('forgotPassword.sendingButton') : t('forgotPassword.sendOtpButton')}</span>
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => navigate("/login")}
                className="w-full text-slate-500 text-xs font-semibold flex items-center justify-center gap-1 hover:text-slate-700"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('forgotPassword.backToLogin')}
              </button>
            </motion.form>
          )}

          {step === "otp" && (
            <motion.form
              key="otp-step"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleVerifyOtp}
              className="space-y-4"
            >
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl text-xs text-slate-500 leading-relaxed">
                {t('forgotPassword.enterCodeSentTo', { email })}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                  {t('forgotPassword.otpLabel')}
                </label>
                <div className="relative">
                  <KeyRound className="absolute inset-y-0 left-3.5 w-5 h-5 text-slate-400 my-auto" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl text-sm tracking-[0.5em] font-mono focus:outline-none focus:border-brand-primary"
                    placeholder="000000"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || otp.length !== 6}
                className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm uppercase text-xs tracking-wider disabled:opacity-60"
              >
                <span>{submitting ? t('forgotPassword.verifyingButton') : t('forgotPassword.verifyOtpButton')}</span>
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={handleResendOtp}
                disabled={cooldown > 0 || submitting}
                className="w-full text-brand-primary text-xs font-semibold hover:underline disabled:text-slate-400 disabled:no-underline"
              >
                {cooldown > 0 ? t('forgotPassword.resendOtpCooldown', { seconds: cooldown }) : t('forgotPassword.resendOtpButton')}
              </button>

              <button
                type="button"
                onClick={() => setStep("email")}
                className="w-full text-slate-500 text-xs font-semibold flex items-center justify-center gap-1 hover:text-slate-700"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('forgotPassword.useOtherEmail')}
              </button>
            </motion.form>
          )}

          {step === "reset" && (
            <motion.form
              key="reset-step"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleResetPassword}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                  {t('forgotPassword.newPasswordLabel')}
                </label>
                <div className="relative">
                  <Lock className="absolute inset-y-0 left-3.5 w-5 h-5 text-slate-400 my-auto" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
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

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                  {t('forgotPassword.confirmPasswordLabel')}
                </label>
                <div className="relative">
                  <Lock className="absolute inset-y-0 left-3.5 w-5 h-5 text-slate-400 my-auto" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                    placeholder="••••••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm uppercase text-xs tracking-wider disabled:opacity-60"
              >
                <span>{submitting ? t('forgotPassword.resettingButton') : t('forgotPassword.resetPasswordButton')}</span>
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>
            </motion.form>
          )}

          {step === "done" && (
            <motion.div
              key="done-step"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center p-6 space-y-4"
            >
              <div className="bg-emerald-100 text-emerald-800 p-3 rounded-full inline-block mx-auto border border-emerald-200">
                <ShieldCheck className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="font-display font-bold text-lg text-emerald-900 uppercase">
                {t('forgotPassword.doneTitle')}
              </h3>
              <p className="text-slate-600 text-xs leading-relaxed max-w-xs mx-auto">
                Your password has been updated. Please log in with your new
                credentials.
              </p>

              <button
                onClick={() => navigate("/login")}
                className="bg-brand-primary hover:bg-opacity-90 text-white px-5 py-3 rounded-xl text-xs font-bold transition-colors w-full flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
              >
                <span>{t('forgotPassword.goToLogin')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

import { motion } from 'motion/react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  ShieldCheck,
  Coins,
  Calculator,
  Lock,
  UserPlus,
  ArrowUpRight,
  KeyRound,
} from 'lucide-react';

import { useAuth } from '../auth/AuthContext';
import RiskCalculator from '../components/RiskCalculator';

/**
 * The public eligibility page.
 *
 * REBUILT because it used to do three different things depending on who was
 * looking, and one of those three was wrong:
 *
 *   - A CUSTOMER saw a second, lighter-weight "quick check" version of the
 *     loan application form, right down to calling the same POST
 *     /loans/assess the real wizard uses. Someone who can already submit a
 *     real application was being shown a toy of it instead — this page now
 *     sends them straight to /dashboard/apply rather than rendering a
 *     preview of a form they're entitled to fill in for real.
 *   - STAFF/ADMIN see the internal risk calculator (unchanged).
 *   - An ANONYMOUS visitor saw a blunt "Log In For A Live Assessment" bar
 *     on an otherwise empty page — a wall, not a pitch. Replaced with an
 *     actual pitch: what the assessment gives you, and a clear way to get
 *     one, instead of just being told to go away and come back signed in.
 */
export default function Eligibility() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (user?.role === 'customer') {
    return <Navigate to="/dashboard/apply" replace />;
  }

  const isStaffOrAdmin = user?.role === 'admin' || user?.role === 'staff';

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen">
      {/* Page Title & Hero */}
      <section className="bg-gradient-to-r from-brand-primary to-slate-900 text-white py-16 px-4 mb-12">
        <div className="max-w-7xl mx-auto text-center space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display font-bold text-4xl sm:text-5xl tracking-tight"
          >
            {t('eligibility.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('eligibility.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {!user && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12"
          >
            {/* The pitch */}
            <div className="lg:col-span-7 p-8 sm:p-10 space-y-5">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-accent/10 text-brand-accent">
                <Sparkles className="w-6 h-6" />
              </span>
              <h2 className="font-display font-bold text-2xl text-slate-900 tracking-tight">
                {t('eligibility.signupPitchTitle')}
              </h2>
              <p className="text-slate-600 text-sm leading-relaxed max-w-md">
                {t('eligibility.signupPitchBody')}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center gap-2 bg-brand-accent text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-accent/90 transition-all shadow-sm glow-btn"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('eligibility.createAccountCta')}
                  <ArrowUpRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center gap-2 text-slate-600 hover:text-brand-primary border border-slate-200 hover:border-brand-primary/30 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
                >
                  <KeyRound className="w-4 h-4" />
                  {t('eligibility.signInCta')}
                </Link>
              </div>

              <p className="text-xs text-slate-400 pt-1">{t('eligibility.signupFootnote')}</p>
            </div>

            {/* The preview — a locked look at the same three figures the
                real result card shows a signed-in customer, so "create an
                account" has something concrete attached to it instead of
                being an abstract ask. */}
            <div className="lg:col-span-5 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-100 p-8 sm:p-10 flex flex-col justify-center">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-4">
                {t('eligibility.previewHeading')}
              </p>
              <div className="space-y-3">
                {[
                  { icon: ShieldCheck, labelKey: 'eligibility.riskRatingBadgeLabel' },
                  { icon: Coins, labelKey: 'eligibility.recommendedAmountLabel' },
                  { icon: Calculator, labelKey: 'eligibility.previewEmiLabel' },
                ].map(({ icon: Icon, labelKey }) => (
                  <div
                    key={labelKey}
                    className="flex items-center justify-between gap-3 bg-white rounded-xl border border-slate-100 px-4 py-3"
                  >
                    <span className="flex items-center gap-2.5 text-xs font-semibold text-slate-500">
                      <Icon className="w-4 h-4 text-slate-300 shrink-0" />
                      {t(labelKey)}
                    </span>
                    <span
                      aria-hidden="true"
                      className="font-mono text-sm font-bold text-slate-300 blur-[3px] select-none"
                    >
                      LKR •••,•••
                    </span>
                  </div>
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-4">
                <Lock className="w-3 h-3" />
                {t('eligibility.previewLockedNote')}
              </p>
            </div>
          </motion.div>
        )}

        {isStaffOrAdmin && <RiskCalculator />}
      </div>
    </div>
  );
}

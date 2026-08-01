import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import {
  Calculator,
  HelpCircle,
  AlertTriangle,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
  Sparkles,
  Coins,
  Lock,
  ArrowUpRight,
  Loader2
} from 'lucide-react';

import api from '../api/axios';
import { useAuth } from '../auth/AuthContext';
import RiskCalculator from '../components/RiskCalculator';

const RISK_STYLES = {
  0: { badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: ShieldCheck, iconWrap: 'bg-emerald-500' },
  1: { badge: 'bg-amber-100 text-amber-800 border-amber-200', icon: ShieldQuestion, iconWrap: 'bg-amber-500' },
  2: { badge: 'bg-rose-100 text-rose-800 border-rose-200', icon: ShieldAlert, iconWrap: 'bg-rose-500' },
};

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 })}`;

export default function Eligibility() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isCustomer = user?.role === 'customer';
  const isStaffOrAdmin = user?.role === 'admin' || user?.role === 'staff';

  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(isCustomer);
  const [productsError, setProductsError] = useState('');

  const [productId, setProductId] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [tenureMonths, setTenureMonths] = useState('');
  const [purpose, setPurpose] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isCustomer) return;
    let cancelled = false;

    const loadProducts = async () => {
      try {
        const res = await api.get('/loans/products');
        const list = res.data?.products || [];
        if (cancelled) return;
        setProducts(list);
        if (list.length) setProductId(String(list[0].id));
      } catch {
        if (cancelled) return;
        setProductsError(t('eligibility.loadProductsError'));
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    };

    loadProducts();
    return () => {
      cancelled = true;
    };
  }, [isCustomer, t]);

  const handleEvaluate = async (e) => {
    e.preventDefault();
    if (!productId || !requestedAmount || !tenureMonths || submitting) return;

    setSubmitting(true);
    setSubmitError('');
    setResult(null);

    try {
      const res = await api.post('/loans/assess', {
        product_id: Number(productId),
        requested_amount: Number(requestedAmount),
        tenure_months: Number(tenureMonths),
        purpose: purpose.trim() || undefined,
      });
      setResult(res.data);
    } catch (err) {
      setSubmitError(
        err.response?.data?.message || t('eligibility.assessError')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const riskStyle = result ? RISK_STYLES[result.risk?.label] : null;
  const RiskIcon = riskStyle?.icon;

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
          <div className="bg-slate-900 text-white rounded-2xl p-6 mb-10 flex flex-col md:flex-row items-center justify-between border border-slate-800 shadow-md">
            <div className="flex items-start space-x-4 mb-4 md:mb-0">
              <div className="bg-brand-accent/20 text-brand-accent p-2.5 rounded-xl shrink-0">
                <Lock className="w-5 h-5 text-brand-accent" />
              </div>
              <div>
                <h4 className="font-display font-bold text-sm text-white">{t('eligibility.loginPromptTitle')}</h4>
                <p className="text-xs text-slate-300 mt-1 max-w-xl">
                  {t('eligibility.loginPromptBody')}
                </p>
              </div>
            </div>
            <Link
              to="/login"
              className="bg-brand-accent text-white px-5 py-2.5 rounded-lg text-xs font-semibold hover:bg-brand-accent/90 transition-colors shadow-sm whitespace-nowrap flex items-center space-x-1"
            >
              <span>{t('eligibility.logIn')}</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {user && !isCustomer && !isStaffOrAdmin && (
          <div className="bg-slate-900 text-white rounded-2xl p-6 mb-10 flex items-center space-x-4 border border-slate-800 shadow-md">
            <div className="bg-brand-accent/20 text-brand-accent p-2.5 rounded-xl shrink-0">
              <Lock className="w-5 h-5 text-brand-accent" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-white">{t('eligibility.unavailableTitle')}</h4>
              <p className="text-xs text-slate-300 mt-1 max-w-xl">
                {t('eligibility.unavailableBody', { role: user.role })}
              </p>
            </div>
          </div>
        )}

        {isStaffOrAdmin && <RiskCalculator />}

        {isCustomer && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Left Column Form */}
            <div className="lg:col-span-6 bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100">
              <h3 className="font-display font-bold text-xl text-slate-900 mb-6 flex items-center space-x-2">
                <Calculator className="w-5 h-5 text-brand-primary" />
                <span>{t('eligibility.underwritingForm')}</span>
              </h3>

              {productsError ? (
                <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{productsError}</span>
                </div>
              ) : (
                <form onSubmit={handleEvaluate} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('eligibility.loanProductLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <select
                      required
                      disabled={productsLoading}
                      value={productId}
                      onChange={(e) => setProductId(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white transition-all duration-200 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      {productsLoading && <option>{t('eligibility.loadingProducts')}</option>}
                      {!productsLoading && products.length === 0 && (
                        <option>{t('eligibility.noProductsAvailable')}</option>
                      )}
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.interest_rate}% {p.rate_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('eligibility.requestedAmountLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder={t('eligibility.amountPlaceholder')}
                      value={requestedAmount}
                      onChange={(e) => setRequestedAmount(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all duration-200"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                      {t('eligibility.tenureMonthsLabel')} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder={t('eligibility.tenurePlaceholder')}
                      value={tenureMonths}
                      onChange={(e) => setTenureMonths(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all duration-200"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider">
                        {t('eligibility.purposeLabel')}
                      </label>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-mono">{t('eligibility.optionalBadge')}</span>
                    </div>
                    <input
                      type="text"
                      maxLength={150}
                      placeholder={t('eligibility.purposePlaceholder')}
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all duration-200"
                    />
                  </div>

                  {submitError && (
                    <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || productsLoading || !products.length}
                    className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>{t('eligibility.analyzingButton')}</span>
                      </>
                    ) : (
                      <span>{t('eligibility.evaluateButton')}</span>
                    )}
                  </button>
                </form>
              )}
            </div>

            {/* Right Column Output UI */}
            <div className="lg:col-span-6 space-y-6">
              <AnimatePresence mode="wait">
                {!result && !submitting && (
                  <div className="bg-slate-50 border-2 border-dashed border-slate-200 p-8 rounded-3xl text-center flex flex-col justify-center items-center h-full min-h-[400px]">
                    <HelpCircle className="w-12 h-12 text-slate-300 mb-4" />
                    <h4 className="font-display font-bold text-lg text-slate-600">{t('eligibility.pendingTitle')}</h4>
                    <p className="text-slate-500 text-xs max-w-sm mt-2 leading-relaxed">
                      {t('eligibility.pendingBody')}
                    </p>
                  </div>
                )}

                {submitting && (
                  <div className="bg-white border border-slate-100 shadow-sm p-8 rounded-3xl text-center flex flex-col justify-center items-center h-full min-h-[400px]">
                    <div className="relative mb-6">
                      <div className="w-16 h-16 bg-brand-primary/10 rounded-full animate-ping absolute"></div>
                      <div className="w-16 h-16 bg-brand-primary/20 rounded-full flex items-center justify-center relative">
                        <Sparkles className="w-8 h-8 text-brand-primary animate-pulse" />
                      </div>
                    </div>
                    <h4 className="font-display font-bold text-lg text-slate-800">{t('eligibility.assessingTitle')}</h4>
                    <p className="text-slate-500 text-xs max-w-sm mt-2 leading-relaxed animate-pulse">
                      {t('eligibility.assessingSubtext')}
                    </p>
                  </div>
                )}

                {result && !submitting && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-slate-100 shadow-md p-6 sm:p-8 rounded-3xl space-y-6"
                  >
                    {/* Status Banner */}
                    <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex items-center space-x-3">
                      <div className={`${riskStyle?.iconWrap} text-white p-2 rounded-full shrink-0`}>
                        {RiskIcon && <RiskIcon className="w-6 h-6" />}
                      </div>
                      <div>
                        <h4 className="font-display font-bold text-sm text-slate-900 uppercase">
                          {result.risk?.category}
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Application #{result.application_id}
                        </p>
                      </div>
                    </div>

                    {/* Badges Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
                        <span className="text-[10px] text-slate-400 block uppercase font-semibold font-mono tracking-wider">{t('eligibility.riskRatingBadgeLabel')}</span>
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase border mt-2 ${riskStyle?.badge}`}>
                          {result.risk?.category}
                        </span>
                      </div>

                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
                        <span className="text-[10px] text-slate-400 block uppercase font-semibold font-mono tracking-wider">{t('eligibility.recommendedAmountLabel')}</span>
                        <span className="text-sm font-bold block text-slate-800 mt-2 font-mono">
                          {formatCurrency(result.recommendation?.recommended_amount)}
                        </span>
                      </div>
                    </div>

                    {/* Recommendation Card */}
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-start space-x-3">
                      <Coins className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">{t('eligibility.aiRecommendationLabel')}</h4>
                        <p className="text-xs text-slate-700 mt-1">
                          <Trans
                            i18nKey="eligibility.recommendationBody"
                            values={{
                              category: result.risk?.category,
                              amount: formatCurrency(result.recommendation?.recommended_amount),
                              loanType: result.recommendation?.loan_type,
                              emi: `${formatCurrency(result.recommendation?.recommended_emi)}/mo`,
                            }}
                            components={{ b: <strong className="font-mono text-emerald-800" /> }}
                          />
                        </p>
                      </div>
                    </div>

                    <div className="pt-2">
                      <Link
                        to="/dashboard"
                        className="w-full bg-brand-accent text-white py-3.5 rounded-xl font-semibold hover:bg-brand-accent/95 transition-all duration-200 block text-center shadow-sm glow-btn text-sm"
                      >
                        {t('eligibility.viewInDashboard')}
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

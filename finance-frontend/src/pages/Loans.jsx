import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Home as HomeIcon,
  GraduationCap,
  Briefcase,
  Car,
  Gem,
  Landmark,
  X,
  ArrowRight,
  Percent,
  Calendar,
  DollarSign,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import api from '../api/axios';

// Maps a product's free-text `type` (set by admins in the loan products
// catalog) to a display icon. Falls back to Landmark for any type that
// doesn't match a known keyword, so new product types never break the page.
const ICON_BY_TYPE = {
  personal: User,
  housing: HomeIcon,
  home: HomeIcon,
  leasing: Car,
  vehicle: Car,
  education: GraduationCap,
  business: Briefcase,
  pawning: Gem,
};

function iconForType(type) {
  const key = (type || '').toLowerCase();
  return ICON_BY_TYPE[key] || Landmark;
}

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 })}`;

const formatTenure = (min, max, t) => {
  const minM = Number(min);
  const maxM = Number(max);
  if (minM >= 12 && maxM >= 12 && minM % 12 === 0 && maxM % 12 === 0) {
    return t('loans.tenureYears', { min: minM / 12, max: maxM / 12 });
  }
  return t('loans.tenureMonths', { min: minM, max: maxM });
};

// `rate_type` is a fixed DB value ("reducing" | "flat") rather than free text,
// so it has no translation column — it maps to a locale key here instead.
// Unknown values fall through to the raw string, matching iconForType's
// "new values never break the page" behaviour above.
const formatRateType = (rateType, t) => {
  const key = (rateType || '').toLowerCase();
  if (key === 'reducing') return t('loans.rateTypeReducing');
  if (key === 'flat') return t('loans.rateTypeFlat');
  return rateType;
};

export default function Loans() {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLoan, setSelectedLoan] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get('/loans/products');
        if (!cancelled) setProducts(res.data?.products || []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message || t('loans.loadError')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen">
      {/* Page Title & Hero Banner */}
      <section className="bg-gradient-to-r from-brand-primary to-slate-900 text-white py-16 px-4 mb-12">
        <div className="max-w-7xl mx-auto text-center space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display font-bold text-4xl sm:text-5xl tracking-tight"
          >
            {t('loans.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('loans.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {loading && (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="max-w-xl mx-auto flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <div className="text-center py-24 text-slate-400 text-sm">
            {t('loans.emptyState')}
          </div>
        )}

        {/* Products Grid */}
        {!loading && !error && products.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {products.map((loan) => {
              const IconComponent = iconForType(loan.type);
              return (
                <motion.div
                  key={loan.id}
                  whileHover={{ y: -8, scale: 1.01 }}
                  className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
                >
                  <div>
                    {/* Icon Frame */}
                    <div className="w-12 h-12 rounded-xl bg-brand-primary/10 flex items-center justify-center mb-6">
                      <IconComponent className="w-6 h-6 text-brand-primary" />
                    </div>

                    {/* Title & Desc */}
                    <h3 className="font-display font-bold text-xl text-slate-900 mb-3">{loan.name}</h3>
                    <p className="text-slate-600 text-sm leading-relaxed mb-6">
                      {loan.description || t('loans.cardDescriptionFallback', { type: loan.type })}
                    </p>

                    {/* High Level Stats Summary */}
                    <div className="space-y-2 border-t border-slate-100 pt-4 mb-6">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium uppercase tracking-wider">{t('loans.interestRateLabel')}</span>
                        <span className="font-mono font-bold text-slate-800">
                          {Number(loan.interest_rate).toFixed(2)}% ({formatRateType(loan.rate_type, t)})
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500 font-medium uppercase tracking-wider">{t('loans.maxAmountLabel')}</span>
                        <span className="font-mono font-bold text-brand-accent">{formatCurrency(loan.max_amount)}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedLoan(loan)}
                    className="w-full bg-slate-50 text-brand-primary hover:bg-brand-accent hover:text-white px-5 py-3 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center space-x-1.5 group"
                  >
                    <span>{t('loans.learnMoreDetails')}</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Modal Drawer backdrop */}
        <AnimatePresence>
          {selectedLoan && (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ duration: 0.2 }}
                className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-10 shadow-2xl relative border border-slate-100"
              >
                {/* Close Button */}
                <button
                  onClick={() => setSelectedLoan(null)}
                  className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Header Information */}
                <div className="flex items-center space-x-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                    {(() => {
                      const IconComponent = iconForType(selectedLoan.type);
                      return <IconComponent className="w-7 h-7" />;
                    })()}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-2xl text-slate-900 leading-none">{selectedLoan.name} {t('loans.termsSuffix')}</h3>
                    <p className="text-xs text-brand-secondary font-mono tracking-wider uppercase mt-1">{t('loans.preApprovedMatrix')}</p>
                  </div>
                </div>

                {/* Sub Description */}
                <p className="text-slate-600 text-sm leading-relaxed mb-8">
                  {selectedLoan.description || t('loans.modalDescriptionFallback')}
                </p>

                {/* Tiers Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-2 text-slate-500 mb-1">
                      <Percent className="w-4 h-4 text-brand-secondary" />
                      <span className="text-xs font-semibold uppercase tracking-wider">{t('loans.interestAprLabel')}</span>
                    </div>
                    <span className="font-mono text-base font-bold text-slate-800">
                      {Number(selectedLoan.interest_rate).toFixed(2)}% ({formatRateType(selectedLoan.rate_type, t)})
                    </span>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-2 text-slate-500 mb-1">
                      <Calendar className="w-4 h-4 text-brand-secondary" />
                      <span className="text-xs font-semibold uppercase tracking-wider">{t('loans.tenureSplitsLabel')}</span>
                    </div>
                    <span className="font-mono text-base font-bold text-slate-800">
                      {formatTenure(selectedLoan.min_tenure_months, selectedLoan.max_tenure_months, t)}
                    </span>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-2 text-slate-500 mb-1">
                      <DollarSign className="w-4 h-4 text-brand-accent" />
                      <span className="text-xs font-semibold uppercase tracking-wider">{t('loans.amountRangeLabel')}</span>
                    </div>
                    <span className="font-mono text-sm font-bold text-brand-accent">
                      {formatCurrency(selectedLoan.min_amount)} – {formatCurrency(selectedLoan.max_amount)}
                    </span>
                  </div>
                </div>

                {/* Footer Action buttons */}
                <div className="mt-2 pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
                  <button
                    onClick={() => setSelectedLoan(null)}
                    className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 text-sm transition-colors"
                  >
                    {t('loans.closePortfolio')}
                  </button>
                  <a
                    href="/eligibility"
                    className="bg-brand-accent text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-accent/90 transition-colors shadow-sm glow-btn text-center"
                  >
                    {t('loans.checkEligibilityNow')}
                  </a>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

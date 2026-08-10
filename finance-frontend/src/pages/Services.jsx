import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Landmark,
  User,
  Home as HomeIcon,
  GraduationCap,
  Briefcase,
  Gem,
  Car,
  CarFront,
  Bike,
  Truck,
  ShieldAlert,
  Sparkles,
  Languages,
  ArrowLeftRight,
  LineChart,
  Calculator,
  HelpCircle,
  MessageSquare,
  ArrowRight,
  Percent,
  Calendar,
  DollarSign,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';
import api from '../api/axios';
import PhotoBackdrop from '../components/PhotoBackdrop';
import { IMAGES } from '../utils/photoAssets';

/**
 * The public services page — now the ONE place loans and vehicle leasing are
 * browsed, rather than each having a standalone page of its own.
 *
 * WHY THE STANDALONE /loans AND /leasing PAGES ARE GONE: loan products used
 * to live at /loans and have a Navbar tab of their own; when leasing needed
 * the same treatment, adding a second near-identical page and a second tab
 * would have meant three places (Home, /loans-or-/leasing, Services) all
 * partially describing the same two products. Folding the live catalogues
 * in here, alongside the AI tools and currency sections that already lived
 * on this page, means there is exactly one page that answers "what can I
 * get here and what does it cost" — which is what a services page is for.
 *
 * Every card below describes a capability that actually exists and runs
 * today (verified against the backend/DB, not assumed) — no OCR, no deep
 * reinforcement learning, no LLM chat agent, and no named vendor/algorithm
 * (a real bank's public services page doesn't publish its model stack
 * either — this describes what a visitor experiences, not how it's built).
 */

/* ------------------------------------------------------------------ *
 * Loan / lease catalogue — live data, shared formatting + detail modal
 * ------------------------------------------------------------------ */

const LOAN_ICON_BY_TYPE = {
  personal: User,
  housing: HomeIcon,
  home: HomeIcon,
  education: GraduationCap,
  business: Briefcase,
  pawning: Gem,
};
const iconForLoanType = (type) => LOAN_ICON_BY_TYPE[(type || '').toLowerCase()] || Landmark;

const VEHICLE_ICON_BY_CLASS = {
  car: Car,
  suv: CarFront,
  motorcycle: Bike,
  three_wheeler: CarFront,
  commercial: Truck,
};
const iconForVehicleClass = (vehicleClass) =>
  VEHICLE_ICON_BY_CLASS[(vehicleClass || '').toLowerCase()] || Car;

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 })}`;

const formatSpan = (min, max, t, yearsKey, monthsKey) => {
  const minM = Number(min);
  const maxM = Number(max);
  if (minM >= 12 && maxM >= 12 && minM % 12 === 0 && maxM % 12 === 0) {
    return t(yearsKey, { min: minM / 12, max: maxM / 12 });
  }
  return t(monthsKey, { min: minM, max: maxM });
};

// rate_type is a fixed DB value ("reducing" | "flat") shared by both loan
// and lease products, so one pair of display strings covers both rather
// than each catalogue carrying its own copy of the same two words.
const formatRateType = (rateType, t) => {
  const key = (rateType || '').toLowerCase();
  if (key === 'reducing') return t('loans.rateTypeReducing');
  if (key === 'flat') return t('loans.rateTypeFlat');
  return rateType;
};

const hasRateRange = (p) =>
  p.min_interest_rate !== null &&
  p.min_interest_rate !== undefined &&
  p.max_interest_rate !== null &&
  p.max_interest_rate !== undefined;

const formatRate = (p) =>
  hasRateRange(p)
    ? `${Number(p.min_interest_rate).toFixed(2)}% – ${Number(p.max_interest_rate).toFixed(2)}%`
    : `${Number(p.interest_rate).toFixed(2)}%`;

/**
 * One catalogue card — a loan product or a lease vehicle class, told apart
 * only by which fields it's handed (`amount`/`term` field names differ
 * between loan_products and lease_products; see the two call sites below).
 */
function CatalogueCard({ Icon, accent, name, description, fallbackDescKey, rate, rateType, maxAmount, onViewDetails, viewLabel, t }) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="bg-white rounded-2xl p-7 border border-slate-100 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col justify-between"
    >
      <div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${accent}`}>
          <Icon className="w-6 h-6" />
        </div>
        <h3 className="font-display font-bold text-lg text-slate-900 mb-2.5">{name}</h3>
        <p className="text-slate-600 text-sm leading-relaxed mb-5">
          {description || t(fallbackDescKey, { type: name })}
        </p>
        <div className="space-y-2 border-t border-slate-100 pt-4 mb-5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium uppercase tracking-wider">
              {t('loans.interestRateLabel')}
            </span>
            <span className="font-mono font-bold text-slate-800">
              {rate} ({rateType})
            </span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium uppercase tracking-wider">
              {t('loans.maxAmountLabel')}
            </span>
            <span className="font-mono font-bold text-brand-accent">{maxAmount}</span>
          </div>
        </div>
      </div>
      <button
        onClick={onViewDetails}
        className="w-full bg-slate-50 text-brand-primary hover:bg-brand-accent hover:text-white px-5 py-3 rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center space-x-1.5 group"
      >
        <span>{viewLabel}</span>
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
      </button>
    </motion.div>
  );
}

/**
 * The detail modal, shared by both catalogues. `stats` carries three
 * {icon, label, value} tiles so the loan and lease call sites can each pass
 * their own field names without this component knowing which product kind
 * it's showing.
 */
function CatalogueDetailModal({ item, Icon, accent, titleSuffix, description, stats, footnote, ctaHref, ctaLabel, closeLabel, onClose }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-10 shadow-2xl relative border border-slate-100"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-4 mb-8">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${accent}`}>
            <Icon className="w-7 h-7" />
          </div>
          <h3 className="font-display font-bold text-2xl text-slate-900 leading-none">
            {item.name} {titleSuffix}
          </h3>
        </div>

        <p className="text-slate-600 text-sm leading-relaxed mb-8">{description}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center space-x-2 text-slate-500 mb-1">
                <s.icon className="w-4 h-4 text-brand-secondary" />
                <span className="text-xs font-semibold uppercase tracking-wider">{s.label}</span>
              </div>
              <span className="font-mono text-sm sm:text-base font-bold text-slate-800">{s.value}</span>
            </div>
          ))}
        </div>

        {footnote && (
          <p className="text-xs text-slate-400 border-t border-slate-100 pt-4 mb-2">{footnote}</p>
        )}

        <div className="mt-4 pt-6 border-t border-slate-100 flex flex-col sm:flex-row justify-end space-y-2 sm:space-y-0 sm:space-x-3">
          <button
            onClick={onClose}
            className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 text-sm transition-colors"
          >
            {closeLabel}
          </button>
          <Link
            to={ctaHref}
            className="bg-brand-accent text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-accent/90 transition-colors shadow-sm glow-btn text-center"
          >
            {ctaLabel}
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

/** A dark, photo-backed banner heading a catalogue section — the same
 * photography and navy scrim used on the Home page cards for these exact
 * products, so a visitor arriving here from Home sees a continuous system
 * rather than a second site with a different look. */
function SectionBanner({ eyebrow, title, subtitle, image, position }) {
  return (
    <div className="relative rounded-3xl overflow-hidden mb-10 px-6 py-10 sm:px-12 sm:py-14">
      <PhotoBackdrop src={image} position={position} />
      <div className="relative max-w-2xl">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-accent">
          {eyebrow}
        </span>
        <h2 className="mt-3 font-display font-bold text-2xl sm:text-3xl text-white tracking-tight">
          {title}
        </h2>
        <p className="mt-3 text-sm text-white/70 leading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Descriptive sections (no live data) — AI tools, currency, self-service
 * ------------------------------------------------------------------ */

// Only cards for genuinely PUBLIC pages carry a link (`/emi-calculator`,
// `/eligibility`). Currency exchange and customer support have no public
// route at all — they're dashboard screens — so those cards stay
// descriptive only.
const DESCRIPTIVE_SECTIONS = [
  {
    id: 'ai-tools',
    eyebrowKey: 'servicesPage.aiToolsEyebrow',
    titleKey: 'servicesPage.aiToolsHeading',
    cards: [
      {
        id: 'risk-assessment',
        icon: ShieldAlert,
        color: 'text-brand-primary bg-brand-primary/10',
        titleKey: 'servicesPage.riskAssessmentTitle',
        descKey: 'servicesPage.riskAssessmentDesc',
      },
      {
        id: 'smart-recommendations',
        icon: Sparkles,
        color: 'text-brand-accent bg-brand-accent/10',
        titleKey: 'servicesPage.smartRecommendationsTitle',
        descKey: 'servicesPage.smartRecommendationsDesc',
      },
      {
        id: 'ai-explanation',
        icon: Languages,
        color: 'text-brand-secondary bg-brand-secondary/10',
        titleKey: 'servicesPage.aiExplanationTitle',
        descKey: 'servicesPage.aiExplanationDesc',
      },
    ],
  },
  {
    id: 'currency',
    eyebrowKey: 'servicesPage.currencyEyebrow',
    titleKey: 'servicesPage.currencyHeading',
    cards: [
      {
        id: 'fx-exchange',
        icon: ArrowLeftRight,
        color: 'text-brand-accent bg-brand-accent/10',
        titleKey: 'servicesPage.fxExchangeTitle',
        descKey: 'servicesPage.fxExchangeDesc',
      },
      {
        id: 'currency-rates',
        icon: LineChart,
        color: 'text-brand-primary bg-brand-primary/10',
        titleKey: 'servicesPage.currencyRatesTitle',
        descKey: 'servicesPage.currencyRatesDesc',
      },
    ],
  },
  {
    id: 'tools-support',
    eyebrowKey: 'servicesPage.toolsEyebrow',
    titleKey: 'servicesPage.toolsHeading',
    cards: [
      {
        id: 'emi-calculator',
        icon: Calculator,
        color: 'text-brand-secondary bg-brand-secondary/10',
        titleKey: 'servicesPage.emiCalculatorTitle',
        descKey: 'servicesPage.emiCalculatorDesc',
        linkTo: '/emi-calculator',
        linkKey: 'servicesPage.emiCalculatorLink',
      },
      {
        id: 'eligibility',
        icon: HelpCircle,
        color: 'text-brand-primary bg-brand-primary/10',
        titleKey: 'servicesPage.eligibilityTitle',
        descKey: 'servicesPage.eligibilityDesc',
        linkTo: '/eligibility',
        linkKey: 'servicesPage.eligibilityLink',
      },
      {
        id: 'support',
        icon: MessageSquare,
        color: 'text-brand-accent bg-brand-accent/10',
        titleKey: 'servicesPage.supportTitle',
        descKey: 'servicesPage.supportDesc',
      },
      {
        id: 'multilingual',
        icon: Languages,
        color: 'text-brand-secondary bg-brand-secondary/10',
        titleKey: 'servicesPage.multilingualTitle',
        descKey: 'servicesPage.multilingualDesc',
      },
    ],
  },
];

function DescriptiveCard({ card, t }) {
  const Icon = card.icon;
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="bg-white p-7 rounded-2xl shadow-sm hover:shadow-lg border border-slate-100 transition-all duration-300 flex flex-col"
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${card.color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="font-display font-bold text-lg text-slate-900 mb-2.5">{t(card.titleKey)}</h3>
      <p className="text-slate-600 text-sm leading-relaxed flex-1">{t(card.descKey)}</p>
      {card.linkTo && (
        <Link
          to={card.linkTo}
          className="inline-flex items-center space-x-1.5 text-brand-primary font-semibold hover:text-brand-secondary transition-colors text-sm mt-5 pt-4 border-t border-slate-100"
        >
          <span>{t(card.linkKey)}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function Services() {
  const { t } = useTranslation();

  const [loans, setLoans] = useState([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loansError, setLoansError] = useState('');

  const [leases, setLeases] = useState([]);
  const [leasesLoading, setLeasesLoading] = useState(true);
  const [leasesError, setLeasesError] = useState('');

  const [selectedLoan, setSelectedLoan] = useState(null);
  const [selectedLease, setSelectedLease] = useState(null);

  // Two independent fetches, two independent loading/error states — a slow
  // or failing lease catalogue must never hold up the loan cards, or vice
  // versa. Both endpoints are public (no verifyToken), same as Home's board.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoansLoading(true);
      setLoansError('');
      try {
        const res = await api.get('/loans/products');
        if (!cancelled) setLoans(res.data?.products || []);
      } catch (err) {
        if (!cancelled) setLoansError(err.response?.data?.message || t('loans.loadError'));
      } finally {
        if (!cancelled) setLoansLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLeasesLoading(true);
      setLeasesError('');
      try {
        const res = await api.get('/leases/products');
        if (!cancelled) setLeases(res.data?.products || []);
      } catch (err) {
        if (!cancelled) setLeasesError(err.response?.data?.message || t('leasingPage.loadError'));
      } finally {
        if (!cancelled) setLeasesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="pt-24 pb-16 bg-brand-bg min-h-screen">
      {/* Page Title & Hero — same navy + photo language as the Home page,
          so this reads as a continuation of it rather than a different
          site with a different visual system. */}
      <section className="relative bg-[#071B2F] py-16 px-4 mb-12 overflow-hidden">
        <PhotoBackdrop src={IMAGES.hero} position="center 30%" />
        <div className="relative max-w-7xl mx-auto text-center space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display font-bold text-4xl sm:text-5xl tracking-tight text-white"
          >
            {t('servicesPage.pageTitle')}
          </motion.h1>
          <p className="text-white/70 max-w-2xl mx-auto text-sm sm:text-base">
            {t('servicesPage.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20">
        {/* ================= Loan Products (live) ================= */}
        <section>
          <SectionBanner
            eyebrow={t('servicesPage.loansEyebrow')}
            title={t('servicesPage.loansHeading')}
            subtitle={t('servicesPage.loanProductsDesc')}
            image={IMAGES.loans}
            position="center 30%"
          />

          {loansLoading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          )}
          {!loansLoading && loansError && (
            <div className="max-w-xl mx-auto flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{loansError}</span>
            </div>
          )}
          {!loansLoading && !loansError && loans.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm">{t('loans.emptyState')}</div>
          )}
          {!loansLoading && !loansError && loans.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loans.map((loan) => (
                <CatalogueCard
                  key={loan.id}
                  Icon={iconForLoanType(loan.type)}
                  accent="bg-brand-primary/10 text-brand-primary"
                  name={loan.name}
                  description={loan.description}
                  fallbackDescKey="loans.cardDescriptionFallback"
                  rate={formatRate(loan)}
                  rateType={formatRateType(loan.rate_type, t)}
                  maxAmount={formatCurrency(loan.max_amount)}
                  viewLabel={t('loans.learnMoreDetails')}
                  onViewDetails={() => setSelectedLoan(loan)}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>

        {/* ================= Vehicle Leasing (live) ================= */}
        <section>
          <SectionBanner
            eyebrow={t('servicesPage.leasingEyebrow')}
            title={t('servicesPage.leasingHeading')}
            subtitle={t('servicesPage.leasingProductsDesc')}
            image={IMAGES.leasing}
            position="center 38%"
          />

          {leasesLoading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          )}
          {!leasesLoading && leasesError && (
            <div className="max-w-xl mx-auto flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{leasesError}</span>
            </div>
          )}
          {!leasesLoading && !leasesError && leases.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm">{t('leasingPage.emptyState')}</div>
          )}
          {!leasesLoading && !leasesError && leases.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {leases.map((lease) => (
                <CatalogueCard
                  key={lease.id}
                  Icon={iconForVehicleClass(lease.vehicle_class)}
                  accent="bg-brand-accent/10 text-brand-accent"
                  name={lease.name}
                  description={lease.description}
                  fallbackDescKey="leasingPage.cardDescriptionFallback"
                  rate={formatRate(lease)}
                  rateType={formatRateType(lease.rate_type, t)}
                  maxAmount={formatCurrency(lease.max_financed_amount)}
                  viewLabel={t('leasingPage.learnMoreDetails')}
                  onViewDetails={() => setSelectedLease(lease)}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>

        {/* ================= Descriptive sections ================= */}
        {DESCRIPTIVE_SECTIONS.map((section) => (
          <section key={section.id}>
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">
                {t(section.eyebrowKey)}
              </h2>
              <p className="font-display font-bold text-2xl sm:text-3xl text-slate-900 tracking-tight">
                {t(section.titleKey)}
              </p>
              <div className="w-12 h-1 bg-brand-accent mx-auto mt-4 rounded-full" />
            </div>
            <div
              className={`grid grid-cols-1 gap-6 mx-auto ${
                section.cards.length === 2
                  ? 'md:grid-cols-2 max-w-4xl'
                  : 'md:grid-cols-2 lg:grid-cols-3'
              }`}
            >
              {section.cards.map((card) => (
                <DescriptiveCard key={card.id} card={card} t={t} />
              ))}
            </div>
          </section>
        ))}

        {/* Regulatory disclaimer panel */}
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-500 leading-relaxed max-w-3xl mx-auto text-center">
          <strong>{t('servicesPage.complianceLabel')}</strong> {t('servicesPage.complianceBody')}
        </div>
      </div>

      <AnimatePresence>
        {selectedLoan && (
          <CatalogueDetailModal
            item={selectedLoan}
            Icon={iconForLoanType(selectedLoan.type)}
            accent="bg-brand-primary/10 text-brand-primary"
            titleSuffix={t('loans.termsSuffix')}
            description={selectedLoan.description || t('loans.modalDescriptionFallback')}
            stats={[
              {
                icon: Percent,
                label: t('loans.interestAprLabel'),
                value: `${formatRate(selectedLoan)} (${formatRateType(selectedLoan.rate_type, t)})`,
              },
              {
                icon: Calendar,
                label: t('loans.tenureSplitsLabel'),
                value: formatSpan(
                  selectedLoan.min_tenure_months,
                  selectedLoan.max_tenure_months,
                  t,
                  'loans.tenureYears',
                  'loans.tenureMonths'
                ),
              },
              {
                icon: DollarSign,
                label: t('loans.amountRangeLabel'),
                value: `${formatCurrency(selectedLoan.min_amount)} – ${formatCurrency(selectedLoan.max_amount)}`,
              },
            ]}
            ctaHref="/eligibility"
            ctaLabel={t('loans.checkEligibilityNow')}
            closeLabel={t('loans.closePortfolio')}
            onClose={() => setSelectedLoan(null)}
          />
        )}
        {selectedLease && (
          <CatalogueDetailModal
            item={selectedLease}
            Icon={iconForVehicleClass(selectedLease.vehicle_class)}
            accent="bg-brand-accent/10 text-brand-accent"
            titleSuffix={t('leasingPage.termsSuffix')}
            description={selectedLease.description || t('leasingPage.modalDescriptionFallback')}
            stats={[
              {
                icon: Percent,
                label: t('leasingPage.interestAprLabel'),
                value: `${formatRate(selectedLease)} (${formatRateType(selectedLease.rate_type, t)})`,
              },
              {
                icon: Calendar,
                label: t('leasingPage.termLabel'),
                value: formatSpan(
                  selectedLease.min_term_months,
                  selectedLease.max_term_months,
                  t,
                  'leasingPage.termYears',
                  'leasingPage.termMonths'
                ),
              },
              {
                icon: DollarSign,
                label: t('leasingPage.financedRangeLabel'),
                value: `${formatCurrency(selectedLease.min_financed_amount)} – ${formatCurrency(selectedLease.max_financed_amount)}`,
              },
            ]}
            // The one distinction worth repeating in the lease modal: title,
            // not just terms, is what makes this a lease rather than a loan.
            footnote={t('leasingPage.ownershipNote')}
            ctaHref="/register"
            ctaLabel={t('leasingPage.getStartedCta')}
            closeLabel={t('leasingPage.closeLabel')}
            onClose={() => setSelectedLease(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

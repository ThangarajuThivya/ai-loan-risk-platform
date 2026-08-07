import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useTranslation } from 'react-i18next';
import {
  Landmark,
  ShieldAlert,
  Sparkles,
  Languages,
  ArrowLeftRight,
  LineChart,
  Calculator,
  HelpCircle,
  MessageSquare,
  ArrowRight
} from 'lucide-react';

// Every card below describes a capability that actually exists and runs
// today (verified against the backend/DB, not assumed) — no OCR, no deep
// reinforcement learning, no LLM chat agent, and no named vendor/algorithm
// (a real bank's public services page doesn't publish its model stack
// either — this describes what a visitor experiences, not how it's built).
//
// Only cards for genuinely PUBLIC pages carry a link (`/loans`,
// `/emi-calculator`, `/eligibility` are all reachable without an account).
// Currency exchange and customer support have no public route at all —
// they're dashboard screens — so those cards are descriptive only.
const SECTIONS = [
  {
    id: "loans",
    eyebrowKey: "servicesPage.loansEyebrow",
    titleKey: "servicesPage.loansHeading",
    cards: [
      {
        id: "loan-products",
        icon: Landmark,
        color: "text-brand-primary bg-brand-primary/10",
        titleKey: "servicesPage.loanProductsTitle",
        descKey: "servicesPage.loanProductsDesc",
        linkTo: "/loans",
        linkKey: "servicesPage.loanProductsLink",
      },
    ],
  },
  {
    id: "ai-tools",
    eyebrowKey: "servicesPage.aiToolsEyebrow",
    titleKey: "servicesPage.aiToolsHeading",
    cards: [
      {
        id: "risk-assessment",
        icon: ShieldAlert,
        color: "text-brand-primary bg-brand-primary/10",
        titleKey: "servicesPage.riskAssessmentTitle",
        descKey: "servicesPage.riskAssessmentDesc",
      },
      {
        id: "smart-recommendations",
        icon: Sparkles,
        color: "text-brand-accent bg-brand-accent/10",
        titleKey: "servicesPage.smartRecommendationsTitle",
        descKey: "servicesPage.smartRecommendationsDesc",
      },
      {
        id: "ai-explanation",
        icon: Languages,
        color: "text-brand-secondary bg-brand-secondary/10",
        titleKey: "servicesPage.aiExplanationTitle",
        descKey: "servicesPage.aiExplanationDesc",
      },
    ],
  },
  {
    id: "currency",
    eyebrowKey: "servicesPage.currencyEyebrow",
    titleKey: "servicesPage.currencyHeading",
    cards: [
      {
        id: "fx-exchange",
        icon: ArrowLeftRight,
        color: "text-brand-accent bg-brand-accent/10",
        titleKey: "servicesPage.fxExchangeTitle",
        descKey: "servicesPage.fxExchangeDesc",
      },
      {
        id: "currency-rates",
        icon: LineChart,
        color: "text-brand-primary bg-brand-primary/10",
        titleKey: "servicesPage.currencyRatesTitle",
        descKey: "servicesPage.currencyRatesDesc",
      },
    ],
  },
  {
    id: "tools-support",
    eyebrowKey: "servicesPage.toolsEyebrow",
    titleKey: "servicesPage.toolsHeading",
    cards: [
      {
        id: "emi-calculator",
        icon: Calculator,
        color: "text-brand-secondary bg-brand-secondary/10",
        titleKey: "servicesPage.emiCalculatorTitle",
        descKey: "servicesPage.emiCalculatorDesc",
        linkTo: "/emi-calculator",
        linkKey: "servicesPage.emiCalculatorLink",
      },
      {
        id: "eligibility",
        icon: HelpCircle,
        color: "text-brand-primary bg-brand-primary/10",
        titleKey: "servicesPage.eligibilityTitle",
        descKey: "servicesPage.eligibilityDesc",
        linkTo: "/eligibility",
        linkKey: "servicesPage.eligibilityLink",
      },
      {
        id: "support",
        icon: MessageSquare,
        color: "text-brand-accent bg-brand-accent/10",
        titleKey: "servicesPage.supportTitle",
        descKey: "servicesPage.supportDesc",
      },
      {
        id: "multilingual",
        icon: Languages,
        color: "text-brand-secondary bg-brand-secondary/10",
        titleKey: "servicesPage.multilingualTitle",
        descKey: "servicesPage.multilingualDesc",
      },
    ],
  },
];

function ServiceCard({ card, t }) {
  const Icon = card.icon;
  return (
    <motion.div
      whileHover={{ y: -8 }}
      className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-md border border-slate-100 transition-all duration-300 flex flex-col"
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${card.color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="font-display font-bold text-lg text-slate-900 mb-3">{t(card.titleKey)}</h3>
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

export default function Services() {
  const { t } = useTranslation();
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
            {t('servicesPage.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('servicesPage.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20">
        {SECTIONS.map((section) => (
          <section key={section.id}>
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">
                {t(section.eyebrowKey)}
              </h2>
              <p className="font-display font-bold text-2xl sm:text-3xl text-slate-900 tracking-tight">
                {t(section.titleKey)}
              </p>
              <div className="w-12 h-1 bg-brand-accent mx-auto mt-4 rounded-full"></div>
            </div>
            <div
              className={`grid grid-cols-1 gap-8 mx-auto ${
                section.cards.length === 1
                  ? "max-w-xl"
                  : section.cards.length === 2
                    ? "md:grid-cols-2 max-w-4xl"
                    : "md:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {section.cards.map((card) => (
                <ServiceCard key={card.id} card={card} t={t} />
              ))}
            </div>
          </section>
        ))}

        {/* Regulatory disclaimer panel */}
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-500 leading-relaxed max-w-3xl mx-auto text-center">
          <strong>{t('servicesPage.complianceLabel')}</strong> {t('servicesPage.complianceBody')}
        </div>
      </div>
    </div>
  );
}

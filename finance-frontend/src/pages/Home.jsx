import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Cpu,
  Clock,
  FileSearch,
  Sparkles,
  CheckCircle,
  UserCheck,
  ArrowRight,
  Database,
  Search
} from 'lucide-react';


// Helper component for counting up numbers
function StatCounter({ target, suffix = '', label }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const duration = 1500; // 1.5 seconds
    const end = target;
    if (end === 0) return;
    
    const stepTime = Math.max(Math.floor(duration / end), 10);
    const timer = setInterval(() => {
      start += Math.ceil(end / 100);
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(start);
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [target]);

  return (
    <div className="text-center p-6 bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-center items-center">
      <div className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-brand-primary mb-2 flex items-center">
        <span>{count.toLocaleString()}</span>
        <span className="text-brand-accent ml-0.5">{suffix}</span>
      </div>
      <p className="text-xs sm:text-sm font-semibold tracking-wider text-slate-500 uppercase">{label}</p>
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation();

  const features = [
    {
      icon: Cpu,
      title: t('home.featureNeuralTitle'),
      desc: t('home.featureNeuralDesc'),
      color: 'text-brand-primary bg-brand-primary/10'
    },
    {
      icon: Clock,
      title: t('home.featureRapidTitle'),
      desc: t('home.featureRapidDesc'),
      color: 'text-brand-accent bg-brand-accent/10'
    },
    {
      icon: FileSearch,
      title: t('home.featureOcrTitle'),
      desc: t('home.featureOcrDesc'),
      color: 'text-brand-secondary bg-brand-secondary/10'
    }
  ];

  const coreBenefits = [
    {
      title: t('home.benefitEnhancedApprovalTitle'),
      description: t('home.benefitEnhancedApprovalDesc')
    },
    {
      title: t('home.benefitAprTitle'),
      description: t('home.benefitAprDesc')
    },
    {
      title: t('home.benefitPrivacyTitle'),
      description: t('home.benefitPrivacyDesc')
    },
    {
      title: t('home.benefitIntegrationTitle'),
      description: t('home.benefitIntegrationDesc')
    }
  ];

  return (
    <div className="overflow-hidden">
      {/* 1. Hero Section (Animated gradient background) */}
      <section className="relative pt-32 pb-20 sm:pb-28 lg:pt-40 lg:pb-36 bg-gradient-to-br from-brand-primary via-brand-primary to-slate-900 overflow-hidden">
        {/* Abstract background decorative blobs */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand-secondary/20 rounded-full blur-3xl -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-brand-accent/10 rounded-full blur-3xl -ml-20 -mb-20"></div>
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-white/5 rounded-full blur-2xl"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Left Column Text */}
            <div className="lg:col-span-7 space-y-6">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10"
              >
                <span className="flex h-2 w-2 rounded-full bg-brand-accent animate-pulse" />
                <span className="text-xs font-mono font-semibold text-brand-accent tracking-wider uppercase">
                  {t('home.badge')}
                </span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="font-display font-bold text-4xl sm:text-5xl lg:text-6xl text-white tracking-tight leading-tight"
              >
                {t('home.heroTitlePrefix')}<span className="text-brand-accent">{t('home.heroTitleHighlight')}</span>{t('home.heroTitleSuffix')}
              </motion.h1>

              <motion.p 
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="text-base sm:text-lg text-slate-300 max-w-xl leading-relaxed"
              >
                {t('home.heroSubtitle')}
              </motion.p>

              {/* CTAs */}
              <motion.div 
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-4 pt-4"
              >
                <Link
                  to="/eligibility"
                  className="bg-brand-accent text-white px-8 py-4 rounded-xl text-base font-semibold hover:bg-brand-accent/90 transition-all duration-200 shadow-md text-center glow-btn flex items-center justify-center space-x-2"
                >
                  <span>{t('home.checkEligibility')}</span>
                  <ArrowRight className="w-5 h-5" />
                </Link>
                <Link
                  to="/loans"
                  className="bg-white/10 hover:bg-white/15 text-white border border-white/20 px-8 py-4 rounded-xl text-base font-semibold transition-all duration-200 text-center"
                >
                  {t('home.exploreProducts')}
                </Link>
              </motion.div>
            </div>

            {/* Right Column Visual Panel */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="lg:col-span-5 relative"
            >
              {/* Glassmorphic Live Assessment HUD Card */}
              <div className="bg-slate-900/60 backdrop-blur-xl rounded-3xl p-6 sm:p-8 border border-white/15 shadow-2xl relative">
                <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-brand-accent"></div>
                  </div>
                  <span className="text-xs font-mono text-slate-400">HUD_LIVE_DEEDS v1.19</span>
                </div>

                <div className="space-y-5">
                  <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-mono text-slate-300">{t('home.hudNeuralCreditHealth')}</span>
                      <span className="text-xs font-mono text-brand-accent font-semibold">{t('home.hudRiskReading', { percent: '94.2' })}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-brand-accent h-full w-[94.2%] rounded-full animate-pulse"></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[10px] text-slate-400 block font-mono">{t('home.hudAnnualInflow')}</span>
                      <span className="text-lg font-bold text-white font-display">$142,500</span>
                    </div>
                    <div className="p-3.5 bg-white/5 rounded-xl border border-white/5">
                      <span className="text-[10px] text-slate-400 block font-mono">{t('home.hudDebtRatio')}</span>
                      <span className="text-lg font-bold text-white font-display">12.4%</span>
                    </div>
                  </div>

                  <div className="bg-brand-accent/10 border border-brand-accent/20 rounded-xl p-4 flex items-start space-x-3">
                    <Sparkles className="w-5 h-5 text-brand-accent shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">{t('home.hudAutomatedRecommendation')}</h4>
                      <p className="text-xs text-slate-300 mt-1">{t('home.hudRecommendationText', { rate: '8.9' })}</p>
                    </div>
                  </div>
                </div>

                {/* Abs decoration card overlay */}
                <div className="absolute -bottom-8 -left-8 bg-brand-accent rounded-2xl p-4 shadow-xl border border-brand-accent/20 hidden sm:flex items-center space-x-3 animate-bounce" style={{ animationDuration: '4s' }}>
                  <ShieldCheck className="w-10 h-10 text-white" />
                  <div>
                    <p className="text-xs text-white/80 leading-none">{t('home.hudOcrVerified')}</p>
                    <p className="text-sm font-bold text-white font-display leading-none mt-1">{t('home.hudSecureAudit')}</p>
                  </div>
                </div>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* 2. AI Loan System Introduction */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">{t('home.architectureEyebrow')}</h2>
            <p className="font-display font-bold text-3xl sm:text-4xl text-slate-900 tracking-tight">
              {t('home.architectureTitle')}
            </p>
            <div className="w-12 h-1 bg-brand-accent mx-auto mt-4 rounded-full"></div>
            <p className="text-slate-600 mt-4 leading-relaxed">
              {t('home.architectureIntro')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="space-y-6">
              <div className="flex items-start space-x-4">
                <div className="bg-brand-primary/10 p-3 rounded-xl shrink-0">
                  <Database className="w-6 h-6 text-brand-primary" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-lg text-slate-900">{t('home.cashflowTitle')}</h3>
                  <p className="text-slate-600 text-sm mt-1">{t('home.cashflowDesc')}</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="bg-brand-accent/10 p-3 rounded-xl shrink-0">
                  <UserCheck className="w-6 h-6 text-brand-accent" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-lg text-slate-900">{t('home.fairLendingTitle')}</h3>
                  <p className="text-slate-600 text-sm mt-1">{t('home.fairLendingDesc')}</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="bg-brand-secondary/10 p-3 rounded-xl shrink-0">
                  <Search className="w-6 h-6 text-brand-secondary" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-lg text-slate-900">{t('home.fraudTitle')}</h3>
                  <p className="text-slate-600 text-sm mt-1">{t('home.fraudDesc')}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-6 sm:p-10 rounded-2xl border border-slate-100 relative">
              <div className="absolute top-4 right-4 bg-brand-accent/10 text-brand-accent text-xs font-mono px-2 py-1 rounded">
                {t('home.simulationOutput')}
              </div>
              <h3 className="font-display font-bold text-xl text-slate-900 mb-4">{t('home.auditTrailTitle')}</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-6">
                {t('home.auditTrailIntro')}
              </p>

              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500">{t('home.logOcrStream', { time: '0.0' })}</span>
                  <span className="text-brand-primary font-bold">{t('home.logOcrStreamValue')}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500">{t('home.logSignature', { time: '1.2' })}</span>
                  <span className="text-brand-accent font-bold">{t('home.logSignatureValue', { percent: '99.8' })}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500">{t('home.logCashReserves', { time: '2.8' })}</span>
                  <span className="text-slate-900">{t('home.logCashReservesValue', { amount: '$8,450' })}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-200">
                  <span className="text-slate-500">{t('home.logLiquidity', { time: '4.5' })}</span>
                  <span className="text-emerald-600 font-bold">{t('home.logLiquidityValue', { coefficient: '0.12' })}</span>
                </div>
                <div className="flex justify-between py-2 text-brand-accent font-bold pt-2">
                  <span>{t('home.logVerdict', { time: '5.0' })}</span>
                  <span>{t('home.logVerdictValue')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Key Features */}
      <section className="py-20 bg-slate-50 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase mb-2">{t('home.capabilitiesEyebrow')}</h2>
            <p className="font-display font-bold text-3xl sm:text-4xl text-slate-900 tracking-tight">
              {t('home.capabilitiesTitle')}
            </p>
            <div className="w-12 h-1 bg-brand-accent mx-auto mt-4 rounded-full"></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((item, index) => (
              <motion.div 
                key={index}
                whileHover={{ y: -8 }}
                className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-md border border-slate-100 transition-all duration-300"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${item.color}`}>
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display font-bold text-lg text-slate-900 mb-3">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link
              to="/services"
              className="inline-flex items-center space-x-1.5 text-brand-primary font-semibold hover:text-brand-secondary transition-colors text-sm"
            >
              <span>{t('home.exploreAllServices')}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Benefits Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Left Info Panel */}
            <div className="lg:col-span-5 space-y-6">
              <h2 className="text-xs font-bold text-brand-secondary tracking-widest uppercase">{t('home.meritsEyebrow')}</h2>
              <h3 className="font-display font-bold text-3xl sm:text-4xl text-slate-900 tracking-tight leading-tight">
                {t('home.whyChooseTitle')}
              </h3>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
                {t('home.whyChooseDesc')}
              </p>
              
              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                <div className="flex items-center space-x-2 text-brand-primary font-semibold text-sm">
                  <CheckCircle className="w-5 h-5 text-brand-accent" />
                  <span>{t('home.automatedDecisionPaths')}</span>
                </div>
                <div className="flex items-center space-x-2 text-brand-primary font-semibold text-sm">
                  <CheckCircle className="w-5 h-5 text-brand-accent" />
                  <span>{t('home.realtimeInterestOptimization')}</span>
                </div>
                <div className="flex items-center space-x-2 text-brand-primary font-semibold text-sm">
                  <CheckCircle className="w-5 h-5 text-brand-accent" />
                  <span>{t('home.militaryGradeSafety')}</span>
                </div>
              </div>
            </div>

            {/* Right Benefits Grid */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
              {coreBenefits.map((benefit, index) => (
                <div 
                  key={index} 
                  className="p-6 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-colors duration-200 border border-slate-100"
                >
                  <span className="text-xs font-mono font-bold text-brand-accent block mb-2">{t('home.benefitLabel', { num: index + 1 })}</span>
                  <h4 className="font-display font-bold text-base text-slate-900 mb-2">{benefit.title}</h4>
                  <p className="text-slate-600 text-xs leading-relaxed">{benefit.description}</p>
                </div>
              ))}
            </div>

          </div>
        </div>
      </section>

      {/* 5. Statistics Counter */}
      <section className="py-16 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCounter target={12450} suffix="+" label={t('home.statProcessedDecisions')} />
            <StatCounter target={3} suffix="" label={t('home.statSupportedLanguages')} />
            <StatCounter target={140} suffix="M+" label={t('home.statVolumeEvaluated')} />
            <StatCounter target={5} suffix="s" label={t('home.statAvgLatency')} />
          </div>
        </div>
      </section>

      {/* 6. Call To Action Button (Apply Now) */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-brand-primary to-brand-secondary rounded-3xl p-8 sm:p-12 text-center text-white relative overflow-hidden shadow-xl">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-brand-accent/20 rounded-full blur-2xl -ml-16 -mb-16"></div>

            <div className="relative z-10 max-w-2xl mx-auto space-y-6">
              <h2 className="font-display font-bold text-3xl sm:text-4xl text-white tracking-tight">
                {t('home.ctaTitle')}
              </h2>
              <p className="text-slate-200 text-sm sm:text-base leading-relaxed">
                {t('home.ctaSubtitle')}
              </p>
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center space-y-3 sm:space-y-0 sm:space-x-4">
                <Link
                  to="/eligibility"
                  className="w-full sm:w-auto bg-brand-accent text-white px-8 py-4 rounded-xl text-base font-semibold hover:bg-brand-accent/90 transition-all duration-200 shadow-md glow-btn block text-center"
                >
                  {t('home.applyNow')}
                </Link>
                <Link
                  to="/emi-calculator"
                  className="w-full sm:w-auto bg-white/10 hover:bg-white/15 text-white border border-white/20 px-8 py-4 rounded-xl text-base font-semibold transition-all duration-200 block text-center"
                >
                  {t('home.tryEmiCalculator')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

import { motion } from "framer-motion";
import { useTranslation } from 'react-i18next';
import {
  ShieldAlert,
  FileSearch,
  Sparkles,
  Languages,
  RefreshCw,
  Cpu,
  ArrowRight
} from 'lucide-react';


// AI_FEATURES is module-level, so it can't call t() directly — every piece of
// copy is a translation key resolved at render time. Only the icon and the id
// are literal.
const AI_FEATURES = [
  {
    id: "risk-assessment",
    iconName: "ShieldAlert",
    titleKey: "aiFeaturesPage.riskAssessmentTitle",
    descriptionKey: "aiFeaturesPage.riskAssessmentDesc",
    frontBenefitKey: "aiFeaturesPage.riskAssessmentBenefit",
    backDeepDiveKey: "aiFeaturesPage.riskAssessmentDeepDive",
  },
  {
    id: "ocr-document",
    iconName: "FileSearch",
    titleKey: "aiFeaturesPage.ocrDocumentTitle",
    descriptionKey: "aiFeaturesPage.ocrDocumentDesc",
    frontBenefitKey: "aiFeaturesPage.ocrDocumentBenefit",
    backDeepDiveKey: "aiFeaturesPage.ocrDocumentDeepDive",
  },
  {
    id: "personalized-recs",
    iconName: "Sparkles",
    titleKey: "aiFeaturesPage.personalizedRecsTitle",
    descriptionKey: "aiFeaturesPage.personalizedRecsDesc",
    frontBenefitKey: "aiFeaturesPage.personalizedRecsBenefit",
    backDeepDiveKey: "aiFeaturesPage.personalizedRecsDeepDive",
  },
  {
    id: "multilingual-support",
    iconName: "Languages",
    titleKey: "aiFeaturesPage.multilingualSupportTitle",
    descriptionKey: "aiFeaturesPage.multilingualSupportDesc",
    frontBenefitKey: "aiFeaturesPage.multilingualSupportBenefit",
    backDeepDiveKey: "aiFeaturesPage.multilingualSupportDeepDive",
  },
];

const IconMap = {
  ShieldAlert: ShieldAlert,
  FileSearch: FileSearch,
  Sparkles: Sparkles,
  Languages: Languages
};

export default function AiFeatures() {
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
            {t('aiFeaturesPage.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('aiFeaturesPage.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        
        {/* Intro HUD */}
        <div className="bg-white p-6 sm:p-10 rounded-3xl border border-slate-100 shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-4">
            <div className="inline-flex items-center space-x-2 bg-brand-primary/10 px-3 py-1 rounded-full text-brand-primary text-xs font-mono">
              <Cpu className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '6s' }} />
              <span>{t('aiFeaturesPage.coreArchitectureBlueprint')}</span>
            </div>
            <h2 className="font-display font-bold text-2xl text-slate-900">{t('aiFeaturesPage.howItWorksTitle')}</h2>
            <p className="text-slate-600 text-sm leading-relaxed">
              {t('aiFeaturesPage.howItWorksBody')}
            </p>
          </div>
          <div className="lg:col-span-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-center">
            <span className="text-[10px] font-mono text-slate-400 block uppercase">{t('aiFeaturesPage.operationalLatency')}</span>
            <span className="text-3xl font-display font-bold text-brand-primary block mt-1">{t('aiFeaturesPage.latencyValue')}</span>
            <span className="text-xs text-slate-500 block mt-1">{t('aiFeaturesPage.latencyNote')}</span>
          </div>
        </div>

        {/* Interactive Flip Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {AI_FEATURES.map((feat) => {
            const IconComponent = IconMap[feat.iconName] || Sparkles;
            return (
              <div 
                key={feat.id} 
                className="group h-[320px] w-full perspective-1000 cursor-pointer"
              >
                {/* Outer Flip Frame */}
                <div className="relative w-full h-full duration-700 transform-style-3d group-hover:rotate-y-180">
                  
                  {/* Front Side Card */}
                  <div className="absolute inset-0 w-full h-full backface-hidden bg-white p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                    <div>
                      {/* Icon */}
                      <div className="flex justify-between items-start mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary relative overflow-hidden">
                          <IconComponent className="w-6 h-6 animate-pulse" />
                        </div>
                        <div className="flex items-center space-x-1 text-xs text-slate-400 font-mono">
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{t('aiFeaturesPage.hoverToFlip')}</span>
                        </div>
                      </div>

                      {/* Info */}
                      <h3 className="font-display font-bold text-xl text-slate-900 mb-3">{t(feat.titleKey)}</h3>
                      <p className="text-slate-600 text-sm leading-relaxed">
                        {t(feat.descriptionKey)}
                      </p>
                    </div>

                    {/* Footer mini-highlight */}
                    <div className="border-t border-slate-100 pt-4 text-xs font-semibold text-brand-accent flex items-center space-x-1.5">
                      <span className="w-2 h-2 rounded-full bg-brand-accent"></span>
                      <span>{t(feat.frontBenefitKey)}</span>
                    </div>
                  </div>

                  {/* Back Side Card */}
                  <div className="absolute inset-0 w-full h-full backface-hidden rotate-y-180 bg-slate-900 text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between border border-white/5">
                    <div>
                      <div className="flex justify-between items-center mb-6">
                        <span className="text-xs font-mono text-brand-accent tracking-widest uppercase">{t('aiFeaturesPage.deepUnderwritingAudit')}</span>
                        <span className="text-xs text-slate-400 font-mono">HOVER TO FLIP</span>
                      </div>
                      
                      <h4 className="font-display font-bold text-lg text-white mb-3">{t('aiFeaturesPage.modelMechanicsTitle')}</h4>
                      <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                        {t(feat.backDeepDiveKey)}
                      </p>
                    </div>

                    <div className="border-t border-white/10 pt-4 flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-mono">{t('aiFeaturesPage.soc2Pipeline')}</span>
                      <a href="/eligibility" className="text-brand-accent hover:text-white font-semibold flex items-center space-x-1">
                        <span>{t('aiFeaturesPage.testSandbox')}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                </div>
              </div>
            );
          })}
        </div>

        {/* Regulatory disclaimer panel */}
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-500 leading-relaxed max-w-3xl mx-auto text-center">
          <strong>{t('aiFeaturesPage.complianceLabel')}</strong> {t('aiFeaturesPage.complianceBody')}
        </div>

      </div>
    </div>
  );
}

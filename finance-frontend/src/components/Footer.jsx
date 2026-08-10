import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Mail, Phone, MapPin, CheckCircle2 } from 'lucide-react';

export default function Footer() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-900 text-white border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          
          {/* Column 1: Brand & Intro */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="bg-brand-accent p-2 rounded-lg">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-display font-bold text-xl tracking-tight leading-none text-white">Degital</span>
                <span className="text-[10px] font-mono tracking-widest uppercase text-brand-secondary">AI Loan System</span>
              </div>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              {t('footer.tagline')}
            </p>
            <div className="flex items-center space-x-2 text-xs text-brand-accent font-medium">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t('footer.fdicBadge')}</span>
            </div>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h3 className="font-display font-bold text-sm tracking-widest uppercase text-slate-300 mb-4">{t('footer.navigationHeading')}</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/" className="hover:text-brand-accent transition-colors">{t('footer.homeLanding')}</Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-brand-accent transition-colors">{t('footer.aboutUs')}</Link>
              </li>
              <li>
                <Link to="/eligibility" className="hover:text-brand-accent transition-colors">{t('footer.eligibilityChecker')}</Link>
              </li>
              <li>
                <Link to="/emi-calculator" className="hover:text-brand-accent transition-colors">{t('footer.emiCalculator')}</Link>
              </li>
              <li>
                <Link to="/services" className="hover:text-brand-accent transition-colors">{t('footer.services')}</Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Utility Links */}
          <div>
            <h3 className="font-display font-bold text-sm tracking-widest uppercase text-slate-300 mb-4">{t('footer.platformHeading')}</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                <Link to="/faq" className="hover:text-brand-accent transition-colors">{t('footer.faqLink')}</Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-brand-accent transition-colors">{t('footer.contactSupport')}</Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-brand-accent transition-colors">{t('footer.officerSignIn')}</Link>
              </li>
              <li>
                <Link to="/register" className="hover:text-brand-accent transition-colors">{t('footer.customerEnrollment')}</Link>
              </li>
              <li>
                <span className="text-slate-500 line-through">{t('footer.apiDocsLocked')}</span>
                <span className="ml-2 text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{t('footer.locked')}</span>
              </li>
            </ul>
          </div>

          {/* Column 4: Contact & Compliance */}
          <div className="space-y-4">
            <h3 className="font-display font-bold text-sm tracking-widest uppercase text-slate-300 mb-4">{t('footer.contactInfoHeading')}</h3>
            <div className="space-y-3 text-sm text-slate-400">
              {/* These were a US toll-free number and a Manhattan address on
                  a Sri Lankan bank. Left in place they contradicted every
                  other thing the site says about where it operates. */}
              <div className="flex items-start space-x-3">
                <Phone className="w-5 h-5 text-brand-secondary shrink-0 mt-0.5" />
                <span>+94 11 234 5678</span>
              </div>
              <div className="flex items-start space-x-3">
                <Mail className="w-5 h-5 text-brand-secondary shrink-0 mt-0.5" />
                <span>support@degital.lk</span>
              </div>
              <div className="flex items-start space-x-3">
                <MapPin className="w-5 h-5 text-brand-secondary shrink-0 mt-0.5" />
                <span>No. 42, Janadhipathi Mawatha, Colombo 01, Sri Lanka</span>
              </div>
            </div>
          </div>

        </div>

        <hr className="my-8 border-slate-800" />

        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 space-y-4 sm:space-y-0">
          <div>
            {t('footer.copyright', { year: currentYear })}
          </div>
          <div className="flex space-x-4">
            <span className="hover:text-slate-400 cursor-pointer">{t('footer.privacyPolicy')}</span>
            <span>&bull;</span>
            <span className="hover:text-slate-400 cursor-pointer">{t('footer.termsOfService')}</span>
            <span>&bull;</span>
            <span className="hover:text-slate-400 cursor-pointer">{t('footer.securityAudits')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

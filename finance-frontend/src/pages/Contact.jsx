import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Mail, 
  Phone, 
  MapPin, 
  Send, 
  CheckCircle, 
  ShieldCheck, 
  Clock, 
  Map
} from 'lucide-react';

export default function Contact() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  // Generated once when the message is "sent", not during render — a
  // Math.random() call in the JSX re-rolls the ID on every re-render, so the
  // confirmation would show the user a different reference each time.
  const [transmissionId, setTransmissionId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name || !email || !message) return;

    setSending(true);

    setTimeout(() => {
      setSending(false);
      setTransmissionId(`Degital-MSG-${Math.floor(Math.random() * 90000) + 10000}`);
      setSubmitted(true);
      setName('');
      setEmail('');
      setMessage('');
    }, 1500);
  };

  const contactCards = [
    {
      icon: Phone,
      title: t('contact.phoneSupportTitle'),
      detail1: '+1 (800) 555-Degital (2872)',
      detail2: t('contact.phoneHours'),
      color: 'text-brand-primary bg-brand-primary/10'
    },
    {
      icon: Mail,
      title: t('contact.emailSupportTitle'),
      detail1: 'support@Degital-iloan.com',
      detail2: t('contact.emailResponseTime'),
      color: 'text-brand-accent bg-brand-accent/10'
    },
    {
      icon: MapPin,
      title: t('contact.hqTitle'),
      detail1: t('contact.hqAddressLine1'),
      detail2: 'New York, NY 10005',
      color: 'text-brand-secondary bg-brand-secondary/10'
    }
  ];

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
            {t('contact.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('contact.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        
        {/* Contact Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {contactCards.map((card, i) => (
            <div 
              key={i} 
              className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-start space-x-4"
            >
              <div className={`p-3.5 rounded-xl shrink-0 ${card.color}`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display font-bold text-sm text-slate-900 uppercase tracking-wider">{card.title}</h3>
                <p className="font-mono text-sm font-semibold text-slate-800">{card.detail1}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{card.detail2}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Form and Map Side-by-Side */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          
          {/* Contact Form Block */}
          <motion.div 
            initial={{ opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-6 bg-white p-6 sm:p-8 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between"
          >
            <div>
              <h2 className="font-display font-bold text-xl text-slate-900 mb-2">{t('contact.formHeading')}</h2>
              <p className="text-slate-500 text-xs leading-relaxed mb-6">
                {t('contact.formSubheading')}
              </p>

              <AnimatePresence mode="wait">
                {!submitted ? (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Name */}
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                        {t('contact.fullNameLabel')}
                      </label>
                      <input 
                        type="text"
                        required
                        placeholder={t('contact.namePlaceholder')}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors"
                      />
                    </div>

                    {/* Email */}
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                        {t('contact.emailLabel')}
                      </label>
                      <input 
                        type="email"
                        required
                        placeholder={t('contact.emailPlaceholder')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors"
                      />
                    </div>

                    {/* Message */}
                    <div>
                      <label className="block text-xs font-semibold uppercase text-slate-500 tracking-wider mb-2">
                        {t('contact.queryLabel')}
                      </label>
                      <textarea 
                        required
                        rows={4}
                        placeholder={t('contact.queryPlaceholder')}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors resize-none"
                      />
                    </div>

                    {/* Submit */}
                    <button 
                      type="submit"
                      disabled={sending}
                      className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm"
                    >
                      {sending ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>{t('contact.sendingButton')}</span>
                        </>
                      ) : (
                        <>
                          <span>{t('contact.sendButton')}</span>
                          <Send className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-8 bg-emerald-50 rounded-2xl border border-emerald-100 text-center space-y-4"
                  >
                    <CheckCircle className="w-12 h-12 text-emerald-600 mx-auto" />
                    <h3 className="font-display font-bold text-lg text-emerald-900">{t('contact.successHeading')}</h3>
                    <p className="text-emerald-700 text-xs leading-relaxed max-w-sm mx-auto">
                      <Trans
                        i18nKey="contact.successBody"
                        values={{ transmissionId }}
                        components={{ b: <strong /> }}
                      />
                    </p>
                    <button 
                      onClick={() => setSubmitted(false)}
                      className="text-brand-primary text-xs font-semibold hover:underline pt-2 block mx-auto"
                    >
                      {t('contact.sendAnother')}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="border-t border-slate-100 pt-5 mt-6 flex items-center justify-center space-x-2 text-xs text-slate-400 font-mono">
              <ShieldCheck className="w-4 h-4 text-brand-accent" />
              <span>{t('contact.soc2Transit')}</span>
            </div>
          </motion.div>

          {/* Google Map Mock Frame Block */}
          <div className="lg:col-span-6 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between space-y-6">
            <div>
              <h2 className="font-display font-bold text-xl text-slate-900 mb-2">{t('contact.locationHeading')}</h2>
              <p className="text-slate-500 text-xs leading-relaxed mb-4">
                {t('contact.locationSubheading')}
              </p>
            </div>

            {/* Stylized Mock Google Map Grid */}
            <div className="bg-slate-50 rounded-2xl border border-slate-200 relative overflow-hidden flex-grow min-h-[260px] flex flex-col justify-between p-6">
              {/* Map background style using coordinates layout pattern */}
              <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#0F4C81_1px,transparent_1px)] [background-size:16px_16px]"></div>
              
              <div className="relative z-10 flex justify-between items-start">
                <span className="text-[10px] font-mono bg-slate-200 text-slate-600 px-2 py-0.5 rounded uppercase">HUD_MAP v2.4</span>
                <span className="text-[10px] font-mono text-slate-400">40.7075° N, 74.0112° W</span>
              </div>

              {/* Pin design element */}
              <div className="relative z-10 flex flex-col justify-center items-center my-auto">
                {/* Pulsing ring */}
                <div className="absolute w-12 h-12 bg-brand-primary/10 rounded-full animate-ping"></div>
                <div className="relative bg-brand-primary text-white p-3 rounded-full shadow-lg border-2 border-white">
                  <MapPin className="w-6 h-6 text-brand-accent" />
                </div>
                <span className="font-display font-bold text-sm text-slate-800 bg-white shadow-md border border-slate-200 px-3 py-1 rounded-full mt-2 block font-medium">
                  {t('contact.hqPinLabel')}
                </span>
              </div>

              <div className="relative z-10 flex justify-between items-center text-[11px] text-slate-500 border-t border-slate-200 pt-3">
                <span className="flex items-center space-x-1">
                  <Map className="w-3.5 h-3.5 text-brand-secondary" />
                  <span>{t('contact.interactiveMapPlaceholder')}</span>
                </span>
                <span className="text-[10px] font-mono text-brand-accent font-semibold flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{t('contact.officeHours')}</span>
                </span>
              </div>
            </div>

            <div className="p-4 bg-brand-bg rounded-2xl border border-slate-100 flex items-start space-x-3 text-xs leading-relaxed text-slate-600">
              <MapPin className="w-5 h-5 text-brand-accent shrink-0 mt-0.5" />
              <span>
                <strong>{t('contact.appointmentsLabel')}</strong> {t('contact.appointmentsBody')}
              </span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

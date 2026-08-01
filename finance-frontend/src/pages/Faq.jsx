import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  HelpCircle,
  Search,
  Loader2,
  AlertTriangle,
  ArrowRight
} from 'lucide-react';
import api from '../api/axios';

export default function Faq() {
  const { t } = useTranslation();
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFaq, setActiveFaq] = useState(null);
  const [filterCategory, setFilterCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get('/faqs');
        if (!cancelled) {
          setFaqs(res.data?.faqs || []);
          // Categories come back translated (?lang=, added by the axios
          // interceptor), so a language switch invalidates whatever category
          // is currently selected — it is a string in the *previous*
          // language and would match nothing, silently emptying the list.
          setFilterCategory('All');
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message || t('faq.loadError')
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

  const categories = ['All', ...new Set(faqs.map((item) => item.category))];

  const filteredFaqs = faqs.filter((item) => {
    const matchesCategory = filterCategory === 'All' || item.category === filterCategory;
    const matchesSearch = item.question.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const toggleAccordion = (id) => {
    if (activeFaq === id) {
      setActiveFaq(null);
    } else {
      setActiveFaq(id);
    }
  };

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
            {t('faq.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('faq.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        
        {/* Search & Category Filter Header Panel */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute inset-y-0 left-4 w-5 h-5 text-slate-400 my-auto" />
            <input 
              type="text"
              placeholder={t('faq.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary transition-colors font-medium text-slate-800"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2 pt-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  filterCategory === cat 
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat === 'All' ? t('faq.allCategory') : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Accordions */}
        <div className="space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && filteredFaqs.length > 0 ? (
            filteredFaqs.map((faq) => {
              const isOpen = activeFaq === faq.id;
              return (
                <div 
                  key={faq.id} 
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-200"
                >
                  {/* Accordion Trigger Header */}
                  <button
                    onClick={() => toggleAccordion(faq.id)}
                    className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-slate-50/50 transition-colors focus:outline-none"
                  >
                    <div className="flex items-center space-x-3 pr-4">
                      <HelpCircle className="w-5 h-5 text-brand-secondary shrink-0" />
                      <h3 className="font-display font-semibold text-sm sm:text-base text-slate-900 leading-tight">
                        {faq.question}
                      </h3>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-brand-primary' : ''}`} />
                  </button>

                  {/* Accordion Expandable Panel */}
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="px-6 pb-6 pt-1 border-t border-slate-50 text-xs sm:text-sm text-slate-600 leading-relaxed space-y-4">
                          <p>{faq.answer}</p>
                          <div className="flex items-center justify-between pt-4 text-[11px] font-mono text-slate-400 border-t border-slate-100">
                            <span>{t('faq.categoryLabel')}: {faq.category.toUpperCase()}</span>
                            <span>{t('faq.policyIdLabel')}: FAQ-{String(faq.id).padStart(3, '0')}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          ) : null}

          {!loading && !error && filteredFaqs.length === 0 && (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 p-12 rounded-3xl text-center">
              <p className="text-slate-500 font-medium">
                {faqs.length === 0
                  ? t('faq.emptyPublished')
                  : t('faq.emptyNoResults')}
              </p>
              {faqs.length > 0 && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterCategory('All'); }}
                  className="text-brand-primary text-xs font-semibold mt-2 hover:underline"
                >
                  {t('faq.clearFilters')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Help block */}
        <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="space-y-1">
            <h4 className="font-display font-semibold text-sm text-brand-primary">{t('faq.stillHaveQuestions')}</h4>
            <p className="text-xs text-slate-500 leading-relaxed max-w-md">{t('faq.helpBlockBody')}</p>
          </div>
          <a 
            href="/contact"
            className="bg-brand-primary text-white px-5 py-2.5 rounded-lg text-xs font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center space-x-1 whitespace-nowrap"
          >
            <span>{t('faq.askSupportTeam')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>

      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Calculator } from 'lucide-react';
import api from '../api/axios';

export default function EmiCalculator() {
  const { t } = useTranslation();
  const [loanAmount, setLoanAmount] = useState(50000);
  const [interestRate, setInterestRate] = useState(8.5);
  const [tenure, setTenure] = useState(36);
  const [isYears, setIsYears] = useState(false); // Months by default

  const [emi, setEmi] = useState(0);
  const [totalInterest, setTotalInterest] = useState(0);
  const [totalRepayment, setTotalRepayment] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState('');

  // Ask the backend (Task 3's computeEmi) for the amortization figures
  // whenever inputs change, debounced so sliders don't spam the API.
  useEffect(() => {
    const principal = loanAmount;
    const tenureMonths = isYears ? tenure * 12 : tenure;

    if (principal <= 0 || interestRate < 0 || tenureMonths <= 0) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCalculating(true);
      setCalcError('');
      try {
        const res = await api.post(
          '/loans/emi-preview',
          {
            principal,
            annualRatePct: interestRate,
            tenureMonths,
          },
          { signal: controller.signal }
        );
        setEmi(Math.round(res.data.emi));
        setTotalInterest(Math.round(res.data.totalInterest));
        setTotalRepayment(Math.round(res.data.totalPayable));
      } catch (err) {
        if (err.code !== 'ERR_CANCELED') {
          setCalcError(t('emiCalculator.calcError'));
        }
      } finally {
        setCalculating(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loanAmount, interestRate, tenure, isYears, t]);

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
            {t('emiCalculator.pageTitle')}
          </motion.h1>
          <p className="text-slate-300 max-w-2xl mx-auto text-sm sm:text-base">
            {t('emiCalculator.pageSubtitle')}
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          
          {/* Left Column Config Sliders */}
          <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col justify-between space-y-6">
            <h3 className="font-display font-bold text-xl text-slate-900 flex items-center space-x-2 pb-2 border-b border-slate-100">
              <Calculator className="w-5 h-5 text-brand-primary" />
              <span>{t('emiCalculator.configureLoanCriteria')}</span>
            </h3>

            {/* Slider 1: Loan Amount */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">{t('emiCalculator.loanPrincipal')}</span>
                <div className="flex items-center space-x-1 font-mono font-bold text-slate-800 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <span className="text-xs text-slate-400">$</span>
                  <input 
                    type="number"
                    value={loanAmount}
                    min="1000"
                    max="2000000"
                    onChange={(e) => setLoanAmount(Math.max(1000, parseInt(e.target.value) || 0))}
                    className="w-20 bg-transparent text-right outline-none text-sm font-semibold"
                  />
                </div>
              </div>
              <input 
                type="range"
                min="5000"
                max="1000000"
                step="5000"
                value={loanAmount}
                onChange={(e) => setLoanAmount(parseInt(e.target.value))}
                className="w-full accent-brand-primary h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>$5,000</span>
                <span>$500,000</span>
                <span>$1,000,000</span>
              </div>
            </div>

            {/* Slider 2: Interest Rate */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">{t('emiCalculator.interestRateApr')}</span>
                <div className="flex items-center space-x-1 font-mono font-bold text-slate-800 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <input 
                    type="number"
                    value={interestRate}
                    min="1"
                    max="25"
                    step="0.1"
                    onChange={(e) => setInterestRate(Math.max(1, parseFloat(e.target.value) || 0))}
                    className="w-12 bg-transparent text-right outline-none text-sm font-semibold"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </div>
              </div>
              <input 
                type="range"
                min="3"
                max="20"
                step="0.1"
                value={interestRate}
                onChange={(e) => setInterestRate(parseFloat(e.target.value))}
                className="w-full accent-brand-primary h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>3.0%</span>
                <span>11.5%</span>
                <span>20.0%</span>
              </div>
            </div>

            {/* Slider 3: Tenure with Months/Years Switcher Toggle */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">{t('emiCalculator.tenurePeriod')}</span>
                
                {/* Months / Years switcher toggle button */}
                <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200">
                  <button 
                    type="button"
                    onClick={() => {
                      if (isYears) {
                        setTenure(tenure * 12);
                        setIsYears(false);
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${!isYears ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {t('emiCalculator.months')}
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      if (!isYears) {
                        setTenure(Math.max(1, Math.round(tenure / 12)));
                        setIsYears(true);
                      }
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${isYears ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {t('emiCalculator.years')}
                  </button>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">{t('emiCalculator.dragToAdjust')}</span>
                <span className="font-mono text-sm font-bold text-slate-800 bg-slate-50 px-3 py-1 rounded-xl border border-slate-200">
                  {tenure} {isYears ? t('emiCalculator.years') : t('emiCalculator.months')}
                </span>
              </div>

              <input 
                type="range"
                min={isYears ? 1 : 12}
                max={isYears ? 30 : 180}
                step={1}
                value={tenure}
                onChange={(e) => setTenure(parseInt(e.target.value))}
                className="w-full accent-brand-primary h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>{isYears ? t('emiCalculator.tickYearSingular') : t('emiCalculator.tickMonthsShort', { count: 12 })}</span>
                <span>{isYears ? t('emiCalculator.tickYears', { count: 15 }) : t('emiCalculator.tickMonthsShort', { count: 96 })}</span>
                <span>{isYears ? t('emiCalculator.tickYears', { count: 30 }) : t('emiCalculator.tickMonthsShort', { count: 180 })}</span>
              </div>
            </div>

            {/* Static notice */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-[11px] text-slate-500 leading-relaxed">
              {t('emiCalculator.engineNotice')}
            </div>

            {calcError && (
              <div className="p-3 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-xs">
                {calcError}
              </div>
            )}
          </div>

          {/* Right Column Outputs & Glow HUD */}
          <div className="lg:col-span-5 bg-gradient-to-br from-brand-primary to-slate-900 text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between space-y-8 relative overflow-hidden">
            {/* Ambient abstract glows */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-accent/15 rounded-full blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-brand-secondary/15 rounded-full blur-3xl"></div>

            <div className="relative z-10 space-y-6">
              <span className="text-xs font-mono font-bold tracking-wider text-brand-accent uppercase block">{t('emiCalculator.simulationCalculations')}</span>
              
              {/* Giant Monthly EMI Result Card */}
              <div className="text-center py-6 border border-white/10 rounded-2xl bg-white/5 backdrop-blur-md relative overflow-hidden group">
                <div className="absolute inset-0 bg-brand-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <span className="text-xs text-slate-300 uppercase font-semibold tracking-wider block mb-2">
                  {t('emiCalculator.estimatedMonthlyEmi')} {calculating && <span className="text-brand-accent animate-pulse">· {t('emiCalculator.updating')}</span>}
                </span>

                {/* Monthly payment value */}
                <div className={`text-4xl sm:text-5xl font-display font-bold text-white tracking-tight flex items-center justify-center filter drop-shadow-[0_0_15px_rgba(0,168,107,0.3)] transition-opacity ${calculating ? 'opacity-60' : 'opacity-100'}`}>
                  <span className="text-2xl text-slate-400 mr-0.5">$</span>
                  <span>{emi.toLocaleString()}</span>
                  <span className="text-xs text-slate-400 ml-1">{t('emiCalculator.perMonth')}</span>
                </div>
              </div>

              {/* Breakdown metrics list */}
              <div className="space-y-4 pt-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300">{t('emiCalculator.principalRequested')}</span>
                  <span className="font-mono font-semibold text-white">${loanAmount.toLocaleString()}</span>
                </div>
                
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300">{t('emiCalculator.aggregateInterest')}</span>
                  <span className="font-mono font-semibold text-brand-secondary">${totalInterest.toLocaleString()}</span>
                </div>

                <hr className="border-white/10" />

                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-300 font-bold">{t('emiCalculator.totalGrossRepayment')}</span>
                  <span className="font-mono font-bold text-brand-accent text-lg">${totalRepayment.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* CTA action to sign up */}
            <div className="relative z-10 pt-4">
              <a 
                href="/eligibility"
                className="w-full bg-brand-accent text-white py-4 rounded-xl text-sm font-semibold hover:bg-brand-accent/90 transition-all duration-200 text-center block shadow-md glow-btn"
              >
                {t('emiCalculator.applyWithLimit')}
              </a>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

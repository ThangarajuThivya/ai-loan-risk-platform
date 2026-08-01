import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Save, 
  Building, 
  FileText, 
  Bell, 
  Globe, 
  Info,
  CheckCircle,
  Cpu
} from 'lucide-react';

export default function AdminSettings() {
  const [bankName, setBankName] = useState('Digital AI Sovereign Bank');
  const [bankBranch, setBankBranch] = useState('Silicon Valley Head Office');
  const [currency, setCurrency] = useState('USD ($)');
  
  const [defaultRate, setDefaultRate] = useState(7.5);
  const [maxPersonalLimit, setMaxPersonalLimit] = useState(50000);
  const [riskBufferLimit, setRiskBufferLimit] = useState(45);
  
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [ocrAutoVerification, setOcrAutoVerification] = useState(true);
  const [criticalRiskBlock, setCriticalRiskBlock] = useState(false);
  
  const [language, setLanguage] = useState('English');
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      alert('System configuration parameters persisted successfully!');
    }, 1200);
  };

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-4xl">
      {/* Title block */}
      <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Aura Bank Configuration</h3>
          <p className="text-xs text-slate-500 font-medium">Fine-tune underwriting thresholds, OCR model pathways, and audit alerts</p>
        </div>
        <button
          type="submit"
          className="px-5 py-2.5 bg-[#0F4C81] hover:bg-indigo-950 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
        >
          <Save className="w-4 h-4" /> Save System Config
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bank Information */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <Building className="w-4.5 h-4.5 text-indigo-700" /> Bank Information
          </h4>
          
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Institution Name</label>
              <input
                type="text"
                required
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Registered Branch Location</label>
              <input
                type="text"
                required
                value={bankBranch}
                onChange={(e) => setBankBranch(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Operating Standard Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs cursor-pointer"
              >
                <option value="USD ($)">USD ($) - US Dollars</option>
                <option value="EUR (€)">EUR (€) - Euros</option>
                <option value="GBP (£)">GBP (£) - British Pounds</option>
                <option value="INR (₹)">INR (₹) - Indian Rupees</option>
              </select>
            </div>
          </div>
        </div>

        {/* Loan Underwriting Rules */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <FileText className="w-4.5 h-4.5 text-indigo-700" /> Underwriting Rules
          </h4>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase">Benchmark APR (%)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={defaultRate}
                  onChange={(e) => setDefaultRate(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-500 uppercase">Max Personal Cap ($)</label>
                <input
                  type="number"
                  required
                  value={maxPersonalLimit}
                  onChange={(e) => setMaxPersonalLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Risk Threshold Limit (DTI %)</label>
              <input
                type="number"
                required
                value={riskBufferLimit}
                onChange={(e) => setRiskBufferLimit(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs font-mono"
              />
              <span className="text-[10px] text-slate-400">Flag applications violating this debt-to-income benchmark.</span>
            </div>
          </div>
        </div>

        {/* Real-time Telemetry & Notification Rules */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <Bell className="w-4.5 h-4.5 text-indigo-700" /> Notifications & AI Automation
          </h4>

          <div className="space-y-3.5 text-xs">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => setEmailAlerts(e.target.checked)}
                className="w-4 h-4 text-indigo-900 border-slate-200 rounded-lg focus:ring-indigo-800/10 cursor-pointer"
              />
              <div>
                <span className="font-bold text-slate-700 block">Critical Risk Email Warnings</span>
                <span className="text-[10px] text-slate-400">Email directors immediately upon high delinquency flag.</span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ocrAutoVerification}
                onChange={(e) => setOcrAutoVerification(e.target.checked)}
                className="w-4 h-4 text-indigo-900 border-slate-200 rounded-lg focus:ring-indigo-800/10 cursor-pointer"
              />
              <div>
                <span className="font-bold text-slate-700 block">Automated Document NLP Checks</span>
                <span className="text-[10px] text-slate-400">Use deep pre-approval matching on OCR verified receipts.</span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={criticalRiskBlock}
                onChange={(e) => setCriticalRiskBlock(e.target.checked)}
                className="w-4 h-4 text-indigo-900 border-slate-200 rounded-lg focus:ring-indigo-800/10 cursor-pointer"
              />
              <div>
                <span className="font-bold text-slate-700 block">Instant Critical Delinquency Block</span>
                <span className="text-[10px] text-slate-400">Instantly decline applications above 90% risk score.</span>
              </div>
            </label>
          </div>
        </div>

        {/* Theme and Language Selection */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <Globe className="w-4.5 h-4.5 text-indigo-700" /> Localization & Style Theme
          </h4>

          <div className="space-y-3.5 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Operating Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 text-xs cursor-pointer"
              >
                <option value="English">English (US)</option>
                <option value="Spanish">Spanish (ES)</option>
                <option value="French">French (FR)</option>
                <option value="German">German (DE)</option>
              </select>
            </div>

            {/* Read-only theme card */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-150 space-y-1 text-slate-500">
              <span className="font-bold text-slate-700 flex items-center gap-1 uppercase text-[9px] tracking-wider"><Info className="w-3.5 h-3.5 text-indigo-600" /> Active Visual Theme Mode</span>
              <p className="text-[11px] leading-relaxed">
                Branding profile locks active to <span className="font-semibold text-indigo-900">Sleek Interface Preset</span>. Color configurations match standard sovereign vault templates. Primary theme changes are read-only.
              </p>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

import { useEffect, useState } from "react";
import { Save, Building, FileText, Bell, Info, Loader2 } from "lucide-react";
import { useToast } from "../../components/toast/useToast";
import api from "../../api/axios";

// No system_settings table exists in the backend for MOST of this page —
// it's a working preview of the intended admin controls, not a wired-up
// feature, and saving confirms locally without changing live behavior.
// ocrAutoExtraction is the one exception: it's backed by a real
// system_settings row (migration 055) and actually controls whether
// documentPipeline.service.js runs when a document is uploaded — see
// admin.controller.js#getOcrAutoExtractionSetting /
// documentPipeline.service.js#processDocumentInBackground. It does NOT
// control staff verification, which stays entirely under staff's own
// verify/reject action regardless of this setting.
export default function AdminSettings() {
  const { showToast } = useToast();

  const [bankName, setBankName] = useState("Aura Digital Bank");
  const [bankBranch, setBankBranch] = useState("Colombo Head Office");
  const [currency, setCurrency] = useState("LKR (Rs.)");

  const [defaultRate, setDefaultRate] = useState(14.5);
  const [maxPersonalLimit, setMaxPersonalLimit] = useState(2000000);
  const [riskBufferLimit, setRiskBufferLimit] = useState(45);

  const [emailAlerts, setEmailAlerts] = useState(true);
  const [ocrAutoExtraction, setOcrAutoExtraction] = useState(true);
  const [ocrSettingLoading, setOcrSettingLoading] = useState(true);
  const [criticalRiskBlock, setCriticalRiskBlock] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/admin/settings/ocr-auto-extraction");
        setOcrAutoExtraction(Boolean(res.data?.enabled));
      } catch {
        // Fails open to the seeded/prior default (true) rather than
        // blocking the whole settings page on one setting's fetch.
      } finally {
        setOcrSettingLoading(false);
      }
    })();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // The one real setting on this page — persisted for real. Everything
      // else below still only confirms locally; see the file header.
      const res = await api.put("/admin/settings/ocr-auto-extraction", {
        enabled: ocrAutoExtraction,
      });
      setOcrAutoExtraction(Boolean(res.data?.enabled));
      await new Promise((resolve) => setTimeout(resolve, 300));
      showToast({
        type: "success",
        title: "Settings Saved",
        message: "Your changes have been recorded for this session.",
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't Save Settings",
        message: err.response?.data?.message || "The document extraction setting couldn't be updated.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-6 sm:p-8 rounded-3xl border border-slate-100 shadow-sm">
        <div>
          <h3 className="font-display font-bold text-xl text-slate-900">Bank Settings</h3>
          <p className="text-sm text-slate-500 mt-1">
            Configure underwriting thresholds, automation, and alerts for the loan risk platform.
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="shrink-0 px-5 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>

      <div className="flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-[11px] text-slate-500">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        Preview only, except Automatic Document Extraction below — the rest of
        these settings aren't yet connected to a backend, so saving them
        won't change live system behavior.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bank Information */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <Building className="w-4.5 h-4.5 text-brand-primary" /> Bank Information
          </h4>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Institution Name</label>
              <input
                type="text"
                required
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Branch / Head Office</label>
              <input
                type="text"
                required
                value={bankBranch}
                onChange={(e) => setBankBranch(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Base Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary text-xs cursor-pointer"
              >
                <option value="LKR (Rs.)">LKR (Rs.) — Sri Lankan Rupee</option>
                <option value="USD ($)">USD ($) — US Dollar</option>
                <option value="EUR (€)">EUR (€) — Euro</option>
                <option value="GBP (£)">GBP (£) — British Pound</option>
              </select>
            </div>
          </div>
        </div>

        {/* Underwriting Rules */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <FileText className="w-4.5 h-4.5 text-brand-primary" /> Underwriting Rules
          </h4>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Default Interest Rate (%)</label>
              <input
                type="number"
                step="0.01"
                required
                value={defaultRate}
                onChange={(e) => setDefaultRate(Number(e.target.value))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Max Personal Loan (LKR)</label>
              <input
                type="number"
                required
                value={maxPersonalLimit}
                onChange={(e) => setMaxPersonalLimit(Number(e.target.value))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-500 uppercase">Risk Threshold (DTI %)</label>
              <input
                type="number"
                required
                value={riskBufferLimit}
                onChange={(e) => setRiskBufferLimit(Number(e.target.value))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary text-xs font-mono"
              />
              <span className="text-[10px] text-slate-400">Flag applications above this debt-to-income ratio.</span>
            </div>
          </div>
        </div>

        {/* Notifications & Automation */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h4 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
            <Bell className="w-4.5 h-4.5 text-brand-primary" /> Notifications & Automation
          </h4>
          <div className="space-y-3.5 text-xs">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => setEmailAlerts(e.target.checked)}
                className="w-4 h-4 text-brand-primary border-slate-200 rounded-lg focus:ring-brand-primary/10 cursor-pointer"
              />
              <div>
                <span className="font-bold text-slate-700 block">Critical Risk Email Alerts</span>
                <span className="text-[10px] text-slate-400">Notify admins immediately on a high-risk flag.</span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ocrAutoExtraction}
                disabled={ocrSettingLoading}
                onChange={(e) => setOcrAutoExtraction(e.target.checked)}
                className="w-4 h-4 text-brand-primary border-slate-200 rounded-lg focus:ring-brand-primary/10 cursor-pointer disabled:opacity-50"
              />
              <div>
                <span className="font-bold text-slate-700 block">Automatic Document Extraction</span>
                <span className="text-[10px] text-slate-400">
                  Run document extraction automatically on uploaded documents. Results are
                  advisory and require staff review — this does not verify or reject documents
                  on its own.
                </span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={criticalRiskBlock}
                onChange={(e) => setCriticalRiskBlock(e.target.checked)}
                className="w-4 h-4 text-brand-primary border-slate-200 rounded-lg focus:ring-brand-primary/10 cursor-pointer"
              />
              <div>
                <span className="font-bold text-slate-700 block">Auto-Decline High-Risk Applications</span>
                <span className="text-[10px] text-slate-400">Automatically reject applications scored above 90% risk.</span>
              </div>
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  Gauge,
  Wallet,
  BarChart3,
  History,
  Radio,
  Loader2,
  AlertTriangle,
  Pencil,
  X,
  Plus,
  CheckCircle2,
  XCircle,
  Save,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import FxRequestQueue from "../currency/FxRequestQueue";
import FxPositionChart from "../currency/FxPositionChart";
import FxRiskPanel from "../currency/FxRiskPanel";
import LiveRateFeedPanel from "../currency/LiveRateFeedPanel";

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// Same formula as finance-backend/src/services/crossRate.service.js's
// applySpread — reproduced client-side ONLY for the admin's live preview
// while editing (never used to compute anything that's actually charged;
// the PATCH always goes through the server, which recomputes and enforces
// this itself). Keeping the two in sync is a manual note, not a shared
// import, since the frontend has no access to backend service modules.
function previewSpread(midRate, buySpreadBps, sellSpreadBps) {
  if (!(midRate > 0)) return { buy_rate: null, sell_rate: null };
  return {
    buy_rate: midRate * (1 - buySpreadBps / 10000),
    sell_rate: midRate * (1 + sellSpreadBps / 10000),
  };
}

const SUB_TABS = [
  { id: "spreads", label: "Spreads", icon: Gauge },
  { id: "limits", label: "Limits", icon: Wallet },
  { id: "position", label: "Position", icon: BarChart3 },
  { id: "audit", label: "Audit", icon: History },
  { id: "rate-feed", label: "Rate Feed", icon: Radio },
];

function ConfirmModal({ title, icon: Icon, children, onCancel, onConfirm, confirmLabel, busy, disabled }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
      >
        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-brand-primary/10 text-brand-primary">
            <Icon className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-slate-900">{title}</h3>
        </div>
        {children}
        <div className="flex justify-end gap-3 mt-5">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || disabled}
            className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 bg-brand-primary hover:bg-brand-primary/95 text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function SpreadsView() {
  const { showToast } = useToast();
  const [spreads, setSpreads] = useState([]);
  const [midRates, setMidRates] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingCode, setEditingCode] = useState(null);
  const [editValues, setEditValues] = useState({ buy: "", sell: "", tradable: true });
  const [pendingSave, setPendingSave] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [spreadsRes, boardRes] = await Promise.all([
        api.get("/currency/exchange/admin/spreads"),
        api.get("/currency/board"),
      ]);
      setSpreads(spreadsRes.data?.spreads || []);
      const map = {};
      (boardRes.data?.rates || []).forEach((r) => {
        map[r.currency] = r.mid_rate;
      });
      setMidRates(map);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load spread configuration.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startEdit = (row) => {
    setEditingCode(row.currency_code);
    setEditValues({
      buy: String(row.buy_spread_bps),
      sell: String(row.sell_spread_bps),
      tradable: !!row.is_tradable,
    });
  };

  const requestSave = (row) => {
    setPendingSave({
      code: row.currency_code,
      before: row,
      after: {
        buy_spread_bps: Number(editValues.buy),
        sell_spread_bps: Number(editValues.sell),
        is_tradable: editValues.tradable,
      },
    });
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    setSaving(true);
    try {
      const res = await api.patch(`/currency/exchange/admin/spreads/${pendingSave.code}`, {
        buy_spread_bps: pendingSave.after.buy_spread_bps,
        sell_spread_bps: pendingSave.after.sell_spread_bps,
        is_tradable: pendingSave.after.is_tradable,
      });
      setSpreads((prev) => prev.map((s) => (s.currency_code === pendingSave.code ? res.data.spread : s)));
      showToast({
        type: "success",
        title: "Spread Updated",
        message: `${pendingSave.code}'s customer-facing rate changes immediately.`,
      });
      setEditingCode(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Couldn't update this spread.",
      });
    } finally {
      setSaving(false);
      setPendingSave(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Buy Spread (bps)</th>
                <th className="px-4 py-3">Sell Spread (bps)</th>
                <th className="px-4 py-3">Tradable</th>
                <th className="px-4 py-3">Live Preview (LKR)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {spreads.map((row) => {
                const isEditing = editingCode === row.currency_code;
                const mid = midRates[row.currency_code];
                const preview = isEditing
                  ? previewSpread(mid, Number(editValues.buy) || 0, Number(editValues.sell) || 0)
                  : { buy_rate: mid ? mid * (1 - row.buy_spread_bps / 10000) : null, sell_rate: mid ? mid * (1 + row.sell_spread_bps / 10000) : null };
                return (
                  <tr key={row.currency_code} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-bold text-slate-800">{row.currency_code}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          max="10000"
                          value={editValues.buy}
                          onChange={(e) => setEditValues((v) => ({ ...v, buy: e.target.value }))}
                          className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
                        />
                      ) : (
                        <span className="font-mono text-slate-600">{row.buy_spread_bps}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          max="10000"
                          value={editValues.sell}
                          onChange={(e) => setEditValues((v) => ({ ...v, sell: e.target.value }))}
                          className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-brand-primary"
                        />
                      ) : (
                        <span className="font-mono text-slate-600">{row.sell_spread_bps}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editValues.tradable}
                            onChange={(e) => setEditValues((v) => ({ ...v, tradable: e.target.checked }))}
                          />
                          Tradable
                        </label>
                      ) : row.is_tradable ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-[11px] font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400 text-[11px] font-bold">
                          <XCircle className="w-3.5 h-3.5" /> No
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      Buy {formatRate(preview.buy_rate)} / Sell {formatRate(preview.sell_rate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingCode(null)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => requestSave(row)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-primary hover:bg-brand-primary/90"
                          >
                            <Save className="w-3.5 h-3.5" /> Save
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(row)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-primary border border-brand-primary/20 hover:bg-brand-primary/5"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {pendingSave && (
          <ConfirmModal
            title={`Update ${pendingSave.code} Spread`}
            icon={Gauge}
            busy={saving}
            confirmLabel="Confirm & Save"
            onCancel={() => setPendingSave(null)}
            onConfirm={confirmSave}
          >
            <p className="text-sm text-slate-600 mb-3">
              This changes the customer-facing rate for {pendingSave.code} immediately, for every new quote.
            </p>
            <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs space-y-1">
              <p>
                Buy spread: {pendingSave.before.buy_spread_bps} → <strong>{pendingSave.after.buy_spread_bps}</strong> bps
              </p>
              <p>
                Sell spread: {pendingSave.before.sell_spread_bps} → <strong>{pendingSave.after.sell_spread_bps}</strong> bps
              </p>
              <p>
                Tradable: {pendingSave.before.is_tradable ? "Yes" : "No"} →{" "}
                <strong>{pendingSave.after.is_tradable ? "Yes" : "No"}</strong>
              </p>
            </div>
          </ConfirmModal>
        )}
      </AnimatePresence>
    </div>
  );
}

const TRADABLE_CODES = ["USD", "EUR", "GBP", "JPY", "INR"];

function LimitsView() {
  const { showToast } = useToast();
  const [limits, setLimits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(null); // { currency_code, max_per_transaction_lkr, max_per_customer_per_day_lkr, isNew }
  const [pendingSave, setPendingSave] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/currency/exchange/admin/limits");
      setLimits(res.data?.limits || []);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load FX limits.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const configuredCodes = useMemo(() => new Set(limits.map((l) => l.currency_code)), [limits]);
  const availableForOverride = TRADABLE_CODES.filter((c) => !configuredCodes.has(c));

  const startEdit = (row) => {
    setEditing({
      currency_code: row.currency_code,
      max_per_transaction_lkr: String(row.max_per_transaction_lkr),
      max_per_customer_per_day_lkr: String(row.max_per_customer_per_day_lkr),
      // Empty string represents NULL — "no documentation requirement" —
      // and is sent as an explicit null so the server can tell it apart
      // from the field being absent.
      document_threshold_lkr:
        row.document_threshold_lkr == null ? "" : String(row.document_threshold_lkr),
      isNew: false,
    });
  };

  const startAdd = () => {
    setEditing({
      currency_code: availableForOverride[0] || "",
      max_per_transaction_lkr: "",
      max_per_customer_per_day_lkr: "",
      document_threshold_lkr: "",
      isNew: true,
    });
  };

  const requestSave = () => {
    if (!editing.currency_code) return;
    if (!(Number(editing.max_per_transaction_lkr) > 0) || !(Number(editing.max_per_customer_per_day_lkr) > 0)) return;
    const existing = limits.find((l) => l.currency_code === editing.currency_code);
    setPendingSave({ ...editing, before: existing || null });
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    setSaving(true);
    try {
      const res = await api.patch("/currency/exchange/admin/limits", {
        currency_code: pendingSave.currency_code,
        max_per_transaction_lkr: Number(pendingSave.max_per_transaction_lkr),
        max_per_customer_per_day_lkr: Number(pendingSave.max_per_customer_per_day_lkr),
        document_threshold_lkr:
          String(pendingSave.document_threshold_lkr).trim() === ""
            ? null
            : Number(pendingSave.document_threshold_lkr),
      });
      setLimits((prev) => {
        const exists = prev.some((l) => l.currency_code === res.data.limit.currency_code);
        return exists
          ? prev.map((l) => (l.currency_code === res.data.limit.currency_code ? res.data.limit : l))
          : [...prev, res.data.limit];
      });
      showToast({
        type: "success",
        title: "Limit Updated",
        message: `${pendingSave.currency_code} limits apply to every submission from now on.`,
      });
      setEditing(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Couldn't update this limit.",
      });
    } finally {
      setSaving(false);
      setPendingSave(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={startAdd}
          disabled={availableForOverride.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Per-Currency Override
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Max Per Transaction (LKR)</th>
                <th className="px-4 py-3">Max Per Customer / Day (LKR)</th>
                <th className="px-4 py-3">Documents Required At (LKR)</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {limits.map((row) => (
                <tr key={row.currency_code} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-bold text-slate-800">
                    {row.currency_code === "ALL" ? "ALL (default)" : row.currency_code}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">{formatLkr(row.max_per_transaction_lkr)}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {formatLkr(row.max_per_customer_per_day_lkr)}
                  </td>
                  {/* NULL is a real setting here — "this currency needs no
                      supporting documents at any value" — so it renders as
                      an explicit label, not a dash that reads as missing. */}
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {row.document_threshold_lkr == null ? (
                      <span className="font-sans text-xs text-slate-400">Not required</span>
                    ) : (
                      formatLkr(row.document_threshold_lkr)
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(row.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => startEdit(row)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-primary border border-brand-primary/20 hover:bg-brand-primary/5"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        A per-currency row overrides the ALL default for that currency only; a currency with no row here uses the
        ALL default. Enforced server-side at submission time (CURRENCY_FEATURE.md §12.4), not just at quote time.
      </p>

      <AnimatePresence>
        {editing && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900">
                  {editing.isNew ? "Add Currency Override" : `Edit ${editing.currency_code} Limit`}
                </h3>
                <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {editing.isNew && (
                <div className="mb-3">
                  <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Currency</label>
                  <select
                    value={editing.currency_code}
                    onChange={(e) => setEditing((v) => ({ ...v, currency_code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary bg-white"
                  >
                    {availableForOverride.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mb-3">
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  Max Per Transaction (LKR)
                </label>
                <input
                  type="number"
                  min="0"
                  value={editing.max_per_transaction_lkr}
                  onChange={(e) => setEditing((v) => ({ ...v, max_per_transaction_lkr: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                />
              </div>
              <div className="mb-3">
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  Max Per Customer / Day (LKR)
                </label>
                <input
                  type="number"
                  min="0"
                  value={editing.max_per_customer_per_day_lkr}
                  onChange={(e) => setEditing((v) => ({ ...v, max_per_customer_per_day_lkr: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                />
              </div>
              <div className="mb-4">
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  Documents Required At (LKR)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="Leave blank — no documents required"
                  value={editing.document_threshold_lkr}
                  onChange={(e) => setEditing((v) => ({ ...v, document_threshold_lkr: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                />
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  Requests at or above this LKR value require supporting documents before staff can
                  approve them. Existing requests keep whatever was in force when they were submitted.
                </p>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={requestSave}
                  disabled={
                    !editing.currency_code ||
                    !(Number(editing.max_per_transaction_lkr) > 0) ||
                    !(Number(editing.max_per_customer_per_day_lkr) > 0)
                  }
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-brand-primary hover:bg-brand-primary/95 text-white disabled:opacity-50"
                >
                  Review & Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingSave && (
          <ConfirmModal
            title={`Confirm ${pendingSave.currency_code} Limit`}
            icon={Wallet}
            busy={saving}
            confirmLabel="Confirm & Save"
            onCancel={() => setPendingSave(null)}
            onConfirm={confirmSave}
          >
            <p className="text-sm text-slate-600 mb-3">
              This changes what every customer can request for {pendingSave.currency_code} immediately.
            </p>
            <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs space-y-1">
              <p>
                Per transaction:{" "}
                {pendingSave.before ? formatLkr(pendingSave.before.max_per_transaction_lkr) : "—"} →{" "}
                <strong>{formatLkr(pendingSave.max_per_transaction_lkr)}</strong>
              </p>
              <p>
                Per customer/day:{" "}
                {pendingSave.before ? formatLkr(pendingSave.before.max_per_customer_per_day_lkr) : "—"} →{" "}
                <strong>{formatLkr(pendingSave.max_per_customer_per_day_lkr)}</strong>
              </p>
              <p>
                Documents required at:{" "}
                {pendingSave.before?.document_threshold_lkr == null
                  ? "Not required"
                  : formatLkr(pendingSave.before.document_threshold_lkr)}{" "}
                →{" "}
                <strong>
                  {String(pendingSave.document_threshold_lkr).trim() === ""
                    ? "Not required"
                    : formatLkr(pendingSave.document_threshold_lkr)}
                </strong>
              </p>
            </div>
          </ConfirmModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function PositionView() {
  const [positions, setPositions] = useState([]);
  const [risk, setRisk] = useState(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get("/currency/exchange/admin/position");
        if (!cancelled) {
          setPositions(res.data?.positions || []);
          // Historical-simulation VaR on the same committed-only figures
          // (Phase 32, §33). Null when the scenario artifact is absent.
          setRisk(res.data?.risk || null);
          setNote(res.data?.note || "");
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || "Couldn't load the FX position report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">Net Exposure by Currency</h2>
        <FxPositionChart data={positions} loading={loading} error={error} note={note} />
      </div>

      {!loading && !error && <FxRiskPanel risk={risk} />}

      {!loading && !error && positions.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-3">Currency</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Count</th>
                  <th className="px-4 py-3">Foreign Amount</th>
                  <th className="px-4 py-3">LKR Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {positions.flatMap((p) =>
                  p.breakdown.map((b, i) => (
                    <tr key={`${p.currency_code}-${b.direction}-${b.status}-${i}`} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-bold text-slate-800">{p.currency_code}</td>
                      <td className="px-4 py-3 capitalize text-slate-600">{b.direction}</td>
                      <td className="px-4 py-3 text-slate-600">{b.status.replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{b.count}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {Number(b.total_foreign_amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{formatLkr(b.total_lkr_amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminFxExchange({ customers }) {
  const [tab, setTab] = useState("spreads");

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
          <ArrowLeftRight className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Currency Exchange</p>
          <h1 className="text-sm font-bold text-slate-800">Configuration &amp; Oversight</h1>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-100 flex-wrap">
        {SUB_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
              tab === id
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "spreads" && <SpreadsView />}
      {tab === "limits" && <LimitsView />}
      {tab === "position" && <PositionView />}
      {tab === "audit" && (
        <FxRequestQueue
          customers={customers}
          defaultStatus="all"
          title="FX Exchange Audit"
          subtitle="Every exchange request across every status — drill into any reference for its full fx_request_events trail."
        />
      )}
      {tab === "rate-feed" && <LiveRateFeedPanel />}
    </div>
  );
}

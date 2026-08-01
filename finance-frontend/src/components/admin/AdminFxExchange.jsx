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
  Boxes,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowRightLeft,
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
  { id: "inventory", label: "Inventory", icon: Boxes },
  { id: "position", label: "Position", icon: BarChart3 },
  { id: "audit", label: "Audit", icon: History },
  { id: "rate-feed", label: "Rate Feed", icon: Radio },
];

const formatUnits = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-LK", { maximumFractionDigits: 2 });

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

const MOVEMENT_LABELS = {
  restock: { label: "Restock / Opening Balance", icon: ArrowDownCircle, className: "text-emerald-700" },
  settlement: { label: "Settlement", icon: ArrowRightLeft, className: "text-brand-primary" },
  adjustment: { label: "Adjustment", icon: ArrowUpCircle, className: "text-amber-700" },
};

function InventoryMovementsPanel({ code, onClose }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 20;

  const load = async (nextOffset) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/currency/exchange/admin/inventory/${code}/movements`, {
        params: { limit: PAGE_SIZE, offset: nextOffset },
      });
      const rows = res.data?.movements || [];
      setMovements((prev) => (nextOffset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(nextOffset);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load movement history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load(0);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl p-6 max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="font-bold text-slate-900">{code} Movement History</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs mb-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="overflow-y-auto flex-1 -mx-2 px-2">
          {movements.length === 0 && !loading ? (
            <p className="text-sm text-slate-400 text-center py-8">No movements recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {movements.map((m) => {
                const meta = MOVEMENT_LABELS[m.movement_type] || {
                  label: m.movement_type,
                  icon: ArrowRightLeft,
                  className: "text-slate-600",
                };
                const Icon = meta.icon;
                return (
                  <div key={m.id} className="border border-slate-100 rounded-xl p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`inline-flex items-center gap-1.5 font-bold ${meta.className}`}>
                        <Icon className="w-3.5 h-3.5" /> {meta.label}
                      </span>
                      <span className="text-slate-400">{formatDateTime(m.created_at)}</span>
                    </div>
                    <p className="text-slate-600">
                      On hand: {m.delta_units > 0 ? "+" : ""}
                      {formatUnits(m.delta_units)} → balance {formatUnits(m.balance_after)}
                      {m.delta_reserved_units !== 0 && (
                        <>
                          {" "}
                          &middot; Reserved: {m.delta_reserved_units > 0 ? "+" : ""}
                          {formatUnits(m.delta_reserved_units)} → {formatUnits(m.reserved_after)}
                        </>
                      )}
                    </p>
                    {m.note && <p className="text-slate-400 mt-1 italic">{m.note}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-4 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
        </div>

        {hasMore && !loading && (
          <button
            onClick={() => load(offset + PAGE_SIZE)}
            className="mt-3 shrink-0 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 self-center"
          >
            Load More
          </button>
        )}
      </motion.div>
    </div>
  );
}

function InventoryView() {
  const { showToast } = useToast();
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // { currency_code, action: 'opening_balance' | 'adjustment', amount, note }
  const [editing, setEditing] = useState(null);
  const [pendingSave, setPendingSave] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historyCode, setHistoryCode] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/currency/exchange/admin/inventory");
      setInventory(res.data?.inventory || []);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load FX inventory.");
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

  const startEdit = (row, action) => {
    setEditing({
      currency_code: row.currency_code,
      action,
      amount: action === "opening_balance" ? String(row.on_hand) : "",
      note: "",
      before: row,
    });
  };

  const amountValid = (() => {
    if (!editing) return false;
    const n = Number(editing.amount);
    if (editing.amount === "" || Number.isNaN(n)) return false;
    return editing.action === "opening_balance" ? n >= 0 : n !== 0;
  })();

  const requestSave = () => {
    if (!editing || !amountValid) return;
    setPendingSave({ ...editing, amount: Number(editing.amount) });
  };

  const confirmSave = async () => {
    if (!pendingSave) return;
    setSaving(true);
    try {
      const res = await api.patch(`/currency/exchange/admin/inventory/${pendingSave.currency_code}`, {
        action: pendingSave.action,
        amount: pendingSave.amount,
        note: pendingSave.note || undefined,
      });
      setInventory((prev) =>
        prev.map((row) => (row.currency_code === res.data.inventory.currency_code ? res.data.inventory : row))
      );
      showToast({
        type: "success",
        title: "Inventory Updated",
        message: `${pendingSave.currency_code}'s stock balance has been updated.`,
      });
      setEditing(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Couldn't update this currency's inventory.",
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
                <th className="px-4 py-3">On Hand</th>
                <th className="px-4 py-3">Reserved</th>
                <th className="px-4 py-3">Available</th>
                <th className="px-4 py-3">Reorder Level</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inventory.map((row) => {
                const low = row.reorder_level_units != null && row.on_hand <= row.reorder_level_units;
                return (
                  <tr key={row.currency_code} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-bold text-slate-800">
                      {row.currency_code}
                      {low && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-md align-middle">
                          <AlertTriangle className="w-3 h-3" /> Low
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{formatUnits(row.on_hand)}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{formatUnits(row.reserved)}</td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-800">{formatUnits(row.available)}</td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {row.reorder_level_units == null ? "—" : formatUnits(row.reorder_level_units)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(row.updated_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setHistoryCode(row.currency_code)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50"
                        >
                          <History className="w-3.5 h-3.5" /> History
                        </button>
                        <button
                          onClick={() => startEdit(row, "adjustment")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 border border-amber-200 hover:bg-amber-50"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" /> Adjust
                        </button>
                        <button
                          onClick={() => startEdit(row, "opening_balance")}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-primary border border-brand-primary/20 hover:bg-brand-primary/5"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Opening Balance
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        One bank-wide vault per currency — there is no branch-level stock. Available = On Hand − Reserved. Every
        change is recorded in the movement ledger with the acting admin's user id; balances are never edited
        directly.
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
                  {editing.action === "opening_balance"
                    ? `Set ${editing.currency_code} Opening Balance`
                    : `Adjust ${editing.currency_code} Stock`}
                </h3>
                <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mb-3">
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">
                  {editing.action === "opening_balance"
                    ? `Opening Balance (units of ${editing.currency_code})`
                    : `Adjustment (signed units of ${editing.currency_code})`}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={editing.action === "opening_balance" ? "0" : undefined}
                  value={editing.amount}
                  onChange={(e) => setEditing((v) => ({ ...v, amount: e.target.value }))}
                  placeholder={editing.action === "adjustment" ? "e.g. -250 or 500" : undefined}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                />
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  {editing.action === "opening_balance"
                    ? "The absolute stock level to set — currently " + formatUnits(editing.before.on_hand) + "."
                    : "Positive adds stock, negative removes it (e.g. a stock-count correction or write-off)."}
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Note (optional)</label>
                <input
                  type="text"
                  maxLength={500}
                  value={editing.note}
                  onChange={(e) => setEditing((v) => ({ ...v, note: e.target.value }))}
                  placeholder="Reason for this change"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary"
                />
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
                  disabled={!amountValid}
                  className="px-4 py-2 rounded-xl text-sm font-bold bg-brand-primary hover:bg-brand-primary/95 text-white disabled:opacity-50"
                >
                  Review &amp; Save
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingSave && (
          <ConfirmModal
            title={`Confirm ${pendingSave.currency_code} Inventory Change`}
            icon={Boxes}
            busy={saving}
            confirmLabel="Confirm & Save"
            onCancel={() => setPendingSave(null)}
            onConfirm={confirmSave}
          >
            <p className="text-sm text-slate-600 mb-3">
              {pendingSave.action === "opening_balance"
                ? `This sets ${pendingSave.currency_code}'s on-hand stock to an absolute value.`
                : `This posts a signed adjustment against ${pendingSave.currency_code}'s current stock.`}
            </p>
            <div className="bg-slate-50 rounded-xl border border-slate-100 p-3 text-xs space-y-1">
              <p>
                On hand: {formatUnits(pendingSave.before.on_hand)} →{" "}
                <strong>
                  {pendingSave.action === "opening_balance"
                    ? formatUnits(pendingSave.amount)
                    : formatUnits(pendingSave.before.on_hand + pendingSave.amount)}
                </strong>
              </p>
              {pendingSave.note && <p>Note: {pendingSave.note}</p>}
            </div>
          </ConfirmModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {historyCode && (
          <InventoryMovementsPanel code={historyCode} onClose={() => setHistoryCode(null)} />
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
      {tab === "inventory" && <InventoryView />}
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

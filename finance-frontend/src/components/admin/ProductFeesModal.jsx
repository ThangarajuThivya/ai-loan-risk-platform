import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, Plus, Trash2, Receipt } from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

/**
 * Product fee configuration (I1).
 *
 * This edits CONFIG only — what a product charges from now on. Offers already
 * issued keep the fees they were quoted (they were snapshotted onto the offer
 * at issuance), so re-pricing here can never retroactively change what an
 * existing customer was told. That guarantee is enforced server-side; this
 * component just says so plainly rather than leaving an admin to wonder.
 *
 * Saves the WHOLE set in one PUT, matching the product endpoints' own
 * "send the whole form" convention.
 */

const FEE_TYPES = [
  { value: "processing", label: "Processing fee" },
  { value: "documentation", label: "Documentation fee" },
  { value: "credit_life_insurance", label: "Credit life insurance" },
  { value: "other", label: "Other" },
];

const blankFee = (usedTypes = []) => {
  const available = FEE_TYPES.find((t) => !usedTypes.includes(t.value)) || FEE_TYPES[3];
  return {
    fee_type: available.value,
    label: available.label,
    calc_method: "percentage",
    rate_or_amount: "",
    min_amount: "",
    max_amount: "",
    active: true,
  };
};

/** API row (strings from DECIMAL columns) → form row. */
const toFormFee = (f) => ({
  fee_type: f.fee_type,
  label: f.label,
  calc_method: f.calc_method,
  rate_or_amount: String(f.rate_or_amount ?? ""),
  min_amount: f.min_amount === null || f.min_amount === undefined ? "" : String(f.min_amount),
  max_amount: f.max_amount === null || f.max_amount === undefined ? "" : String(f.max_amount),
  active: f.active === 1 || f.active === true,
});

export default function ProductFeesModal({ product, onClose }) {
  const { showToast } = useToast();
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/admin/products/${product.id}/fees`);
        if (!cancelled) setFees((res.data?.fees || []).map(toFormFee));
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Couldn't load this product's fees.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  const updateFee = (index, patch) =>
    setFees((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  const removeFee = (index) => setFees((prev) => prev.filter((_, i) => i !== index));

  const addFee = () => setFees((prev) => [...prev, blankFee(prev.map((f) => f.fee_type))]);

  // Mirrors the server's own checks so an admin gets the answer without a
  // round trip; the server re-validates regardless.
  const validate = () => {
    const seen = new Set();
    for (const f of fees) {
      if (seen.has(f.fee_type)) {
        return `Two fees are both set to "${
          FEE_TYPES.find((t) => t.value === f.fee_type)?.label || f.fee_type
        }". A product can only charge each fee once.`;
      }
      seen.add(f.fee_type);
      if (!String(f.label).trim()) return "Every fee needs a label.";
      if (f.rate_or_amount === "" || Number(f.rate_or_amount) < 0) {
        return `"${f.label}" needs a ${f.calc_method === "percentage" ? "rate" : "amount"} of zero or more.`;
      }
      if (
        f.calc_method === "percentage" &&
        f.min_amount !== "" &&
        f.max_amount !== "" &&
        Number(f.min_amount) > Number(f.max_amount)
      ) {
        return `"${f.label}" has a minimum above its maximum, which can never be satisfied.`;
      }
    }
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.put(`/admin/products/${product.id}/fees`, {
        fees: fees.map((f) => ({
          fee_type: f.fee_type,
          label: f.label.trim(),
          calc_method: f.calc_method,
          rate_or_amount: Number(f.rate_or_amount),
          // A fixed fee has no meaningful min/max — send null rather than a
          // stale value the user typed before switching the method.
          min_amount:
            f.calc_method === "percentage" && f.min_amount !== "" ? Number(f.min_amount) : null,
          max_amount:
            f.calc_method === "percentage" && f.max_amount !== "" ? Number(f.max_amount) : null,
          active: f.active,
        })),
      });
      showToast({
        type: "success",
        title: "Fees Updated",
        message: `${product.name}'s fee schedule was saved.`,
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't save these fees.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900">Fees & Charges</h3>
              <p className="text-xs text-slate-500">{product.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
            Fees are <strong>deducted from the amount paid out</strong> to the customer. They do
            not change the instalment or the total repayable. Changes here apply to{" "}
            <strong>future offers only</strong> — offers already issued keep the fees they were
            quoted.
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {fees.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">
                  This product charges no fees.
                </p>
              )}

              {fees.map((fee, index) => (
                <div
                  key={index}
                  className={`border rounded-2xl p-4 space-y-3 ${
                    fee.active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/60"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={fee.fee_type}
                      onChange={(e) => {
                        const t = FEE_TYPES.find((x) => x.value === e.target.value);
                        updateFee(index, {
                          fee_type: e.target.value,
                          // Keep a label the admin already customised; only
                          // auto-fill when it still matches the old default.
                          label: FEE_TYPES.some((x) => x.label === fee.label)
                            ? t?.label || fee.label
                            : fee.label,
                        });
                      }}
                      className="px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white"
                    >
                      {FEE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      value={fee.label}
                      onChange={(e) => updateFee(index, { label: e.target.value })}
                      placeholder="Label shown to the customer"
                      maxLength={100}
                      className="flex-1 min-w-[180px] px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                    />

                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <input
                        type="checkbox"
                        checked={fee.active}
                        onChange={(e) => updateFee(index, { active: e.target.checked })}
                      />
                      Active
                    </label>

                    <button
                      type="button"
                      onClick={() => removeFee(index)}
                      className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg"
                      title="Remove this fee"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        Charged as
                      </label>
                      <select
                        value={fee.calc_method}
                        onChange={(e) => updateFee(index, { calc_method: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="percentage">% of amount</option>
                        <option value="fixed">Fixed LKR</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">
                        {fee.calc_method === "percentage" ? "Rate (%)" : "Amount (LKR)"}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={fee.rate_or_amount}
                        onChange={(e) => updateFee(index, { rate_or_amount: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                      />
                    </div>
                    {/* min/max only mean something for a percentage — a fixed
                        fee is already its own answer, and the server ignores
                        them there. Hidden rather than disabled so nobody
                        types a value that will be silently dropped. */}
                    {fee.calc_method === "percentage" && (
                      <>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">
                            Min (LKR)
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={fee.min_amount}
                            onChange={(e) => updateFee(index, { min_amount: e.target.value })}
                            placeholder="none"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">
                            Max (LKR)
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={fee.max_amount}
                            onChange={(e) => updateFee(index, { max_amount: e.target.value })}
                            placeholder="none"
                            className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {fees.length < FEE_TYPES.length && (
                <button
                  type="button"
                  onClick={addFee}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-800 border border-dashed border-indigo-200 hover:bg-indigo-50 rounded-xl w-full justify-center"
                >
                  <Plus className="w-3.5 h-3.5" /> Add a fee
                </button>
              )}
            </>
          )}

          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/40 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-5 py-2 bg-indigo-900 text-white rounded-xl text-sm font-bold hover:bg-indigo-950 shadow-md disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Fees
          </button>
        </div>
      </motion.div>
    </div>
  );
}

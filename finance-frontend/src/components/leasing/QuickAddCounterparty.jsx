import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Loader2, X, Info } from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import { DEALER_FIELDS, VALUER_FIELDS, emptyForm, toPayload, validate } from "./leaseRegisterFields";

/**
 * Add a dealer or valuer without leaving the application you are reviewing.
 *
 * The friction this removes is real: a staff member with a live file in
 * front of them whose dealer or valuer is not on the register previously had
 * no move except to stop and find an admin. Both registers were empty, so
 * that was every file.
 *
 * WHAT IT DELIBERATELY DOES NOT OFFER: a dealer's banking details. Whoever
 * fills those in chooses where the purchase money is wired, and that must
 * not be the same person processing the application. The form simply has no
 * such fields for a non-admin, the server discards them if sent anyway
 * (leaseRegister.service.js), and the resulting record is unpayable until an
 * admin completes it — which the callout below says plainly rather than
 * leaving the staff member to hit a 409 at the payout step.
 */

const CONFIG = {
  dealer: {
    fields: DEALER_FIELDS,
    url: "/admin/lease/suppliers",
    itemKey: "supplier",
    label: "dealer",
    note:
      "Adds the dealer so you can carry on. Their payout account has to be filled in by an admin before the vehicle can be paid for.",
  },
  valuer: {
    fields: VALUER_FIELDS,
    url: "/admin/lease/valuers",
    itemKey: "valuer",
    label: "valuer",
    note: null,
  },
};

export default function QuickAddCounterparty({ kind, isAdmin = false, onAdded }) {
  const config = CONFIG[kind];
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => emptyForm(config.fields));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Quick-add stays quick: identity only, even for an admin. An admin who
  // needs to set banking has a whole register screen for it, and putting
  // account fields in a popover invites them to be filled in while
  // distracted by something else.
  const fields = config.fields.filter((f) => !f.adminOnly);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setErrors({});
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(fields, form);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post(config.url, toPayload(fields, form));
      const created = res.data[config.itemKey];
      showToast({
        type: "success",
        title: `${config.label === "dealer" ? "Dealer" : "Valuer"} added`,
        message: res.data.notice || `${created.name} is now on the register.`,
      });
      setForm(emptyForm(config.fields));
      setOpen(false);
      onAdded?.(created);
    } catch (err) {
      const apiErrors = err.response?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length) {
        setErrors(
          Object.fromEntries(apiErrors.filter((fe) => fe.path).map((fe) => [fe.path, fe.msg]))
        );
      }
      showToast({
        type: "error",
        title: "Couldn't add",
        message: err.response?.data?.message || "Please check the details and try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-2.5 py-2 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1"
      >
        <Plus className="w-3 h-3" />
        New {config.label}
      </button>

      {/* A CENTRED DIALOG, NOT A DROPDOWN.
          The first version was an absolutely-positioned popover, which looked
          right in isolation and was CLIPPED IN HALF the moment it opened
          inside the review drawer — that drawer is a max-height flex column
          with its own scroll container, so an absolute child anchored near
          the bottom simply gets cut off. Only visible by looking at it; the
          DOM text was all present and correct. A fixed overlay escapes the
          clip wherever this component is dropped. */}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={close} />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.14 }}
              className="relative w-[22rem] max-w-[90vw] max-h-[85vh] overflow-y-auto bg-white rounded-2xl border border-slate-100 shadow-2xl"
            >
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
                <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
                  New {config.label}
                </span>
                <button
                  type="button"
                  onClick={close}
                  className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <form onSubmit={submit} className="p-4 space-y-2.5">
                {fields.map((f) => (
                  <label key={f.name} className="block">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      {f.label}
                      {f.required && <span className="text-rose-500"> *</span>}
                    </span>
                    {f.textarea ? (
                      <textarea
                        rows={2}
                        value={form[f.name] ?? ""}
                        disabled={saving}
                        placeholder={f.placeholder}
                        onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                        className={`w-full px-2.5 py-1.5 bg-slate-50 border rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary ${
                          errors[f.name] ? "border-rose-300" : "border-slate-200"
                        }`}
                      />
                    ) : (
                      <input
                        type={f.type || "text"}
                        value={form[f.name] ?? ""}
                        disabled={saving}
                        placeholder={f.placeholder}
                        onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                        className={`w-full px-2.5 py-1.5 bg-slate-50 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary ${
                          errors[f.name] ? "border-rose-300" : "border-slate-200"
                        }`}
                      />
                    )}
                    {errors[f.name] && (
                      <span className="block text-[10px] text-rose-600 mt-0.5">
                        {errors[f.name]}
                      </span>
                    )}
                  </label>
                ))}

                {config.note && (
                  <p className="flex items-start gap-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 leading-relaxed">
                    <Info className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
                    {isAdmin
                      ? "Adds the dealer's details. Set their payout account on the Dealers screen before the vehicle is paid for."
                      : config.note}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full px-3 py-2 text-[11px] font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-60 flex items-center justify-center gap-1.5"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  Add {config.label}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

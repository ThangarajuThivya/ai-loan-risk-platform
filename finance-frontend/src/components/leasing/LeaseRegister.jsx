import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Pencil,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Inbox,
  X,
  Store,
  Gavel,
  BadgeCheck,
  BanknoteX,
  Ban,
  Undo2,
  Phone,
  Mail,
  Landmark,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import {
  DEALER_FIELDS,
  VALUER_FIELDS,
  emptyForm,
  formFrom,
  toPayload,
  validate,
} from "./leaseRegisterFields";

/**
 * The approved dealer and valuer registers (L17).
 *
 * Migration 044 created both tables and the endpoints to manage them, and
 * then no screen was ever built — so both registers sat EMPTY, the dealer
 * dropdown on the lease application and the valuer dropdown on the review
 * queue rendered nothing, and every lease went through as "a private seller"
 * with an unassigned valuer. Not a decision anyone made; just the only
 * reachable state. This is the missing screen.
 *
 * ONE COMPONENT FOR BOTH REGISTERS. They are the same object — a standing
 * counterparty with contact details, a status and a usage count — differing
 * only in their fields and in the fact that one of them gets paid. Two
 * near-identical files would drift; the differences live in REGISTERS below.
 *
 * NO DELETE, ANYWHERE. A dealer is referenced by the vehicles they supplied
 * and a valuer by the valuations they signed, and both must stay answerable
 * long after the commercial relationship ends. Suspension is the only exit,
 * and it is presented as such rather than as a disabled bin icon.
 */

const REGISTERS = {
  dealers: {
    title: "Approved Dealers",
    singular: "dealer",
    Icon: Store,
    fields: DEALER_FIELDS,
    listUrl: "/admin/lease/suppliers",
    itemUrl: (id) => `/admin/lease/suppliers/${id}`,
    responseKey: "suppliers",
    itemKey: "supplier",
    usageKey: "vehicle_count",
    usageLabel: (n) => (n === 1 ? "1 vehicle supplied" : `${n} vehicles supplied`),
    emptyHint:
      "Add the dealerships you buy vehicles from. Applicants pick from this list, and the purchase payment goes to the banking details you record here.",
    searchable: (r) => [r.name, r.contact_person, r.business_reg_no, r.email, r.phone],
  },
  valuers: {
    title: "Approved Valuers",
    singular: "valuer",
    Icon: Gavel,
    fields: VALUER_FIELDS,
    listUrl: "/admin/lease/valuers",
    itemUrl: (id) => `/admin/lease/valuers/${id}`,
    responseKey: "valuers",
    itemKey: "valuer",
    usageKey: "valuation_count",
    usageLabel: (n) => (n === 1 ? "1 valuation signed" : `${n} valuations signed`),
    emptyHint:
      "Add the independent valuers you instruct. A valuation is only worth something if the valuer is licensed and accountable, which is why they are a register entry rather than a name typed onto a report.",
    searchable: (r) => [r.name, r.license_no, r.email, r.phone],
  },
};

const cell = "px-4 py-3 text-xs text-slate-600";

function FieldInput({ field, value, error, onChange, disabled }) {
  const base =
    "w-full px-3 py-2 bg-slate-50 border rounded-xl text-slate-800 placeholder-slate-400 text-xs transition-all focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 disabled:opacity-60";
  const cls = `${base} ${error ? "border-rose-300" : "border-slate-200"}`;
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
        {field.label}
        {field.required && <span className="text-rose-500"> *</span>}
      </span>
      {field.textarea ? (
        <textarea
          rows={2}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
          className={`${cls} resize-none`}
        />
      ) : (
        <input
          type={field.type || "text"}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
          className={cls}
        />
      )}
      {error && <span className="block text-[10px] text-rose-600 mt-1">{error}</span>}
    </label>
  );
}

export default function LeaseRegister({ kind, role = "admin" }) {
  const config = REGISTERS[kind];
  const { showToast } = useToast();
  const isAdmin = role === "admin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showSuspended, setShowSuspended] = useState(false);

  const [dialog, setDialog] = useState(null); // { mode: "create"|"edit", id }
  const [form, setForm] = useState(() => emptyForm(config.fields));
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(config.listUrl);
      setRows(res.data?.[config.responseKey] || []);
    } catch (err) {
      setError(err.response?.data?.message || `Couldn't load the ${config.singular} register.`);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    // Wrapped rather than awaited directly in the effect body: refresh sets
    // state, and a synchronous setState during an effect trips the
    // cascading-render lint rule.
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showSuspended && r.status === "suspended") return false;
      if (!term) return true;
      return config
        .searchable(r)
        .some((v) => String(v || "").toLowerCase().includes(term));
    });
  }, [rows, search, showSuspended, config]);

  const suspendedCount = rows.filter((r) => r.status === "suspended").length;
  // Surfaced as a banner rather than only per row: an admin opening this
  // screen should learn "two of your dealers cannot be paid" without having
  // to read every line.
  const unpayable = kind === "dealers" ? rows.filter((r) => r.status === "active" && !r.payable) : [];

  const openCreate = () => {
    setForm(emptyForm(config.fields));
    setFormErrors({});
    setDialog({ mode: "create", id: null });
  };

  const openEdit = (row) => {
    setForm(formFrom(config.fields, row));
    setFormErrors({});
    setDialog({ mode: "edit", id: row.id });
  };

  const submit = async (e) => {
    e.preventDefault();
    const errors = validate(config.fields, form);
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }
    setSubmitting(true);
    setFormErrors({});
    const payload = toPayload(config.fields, form, { includeAdminOnly: isAdmin });

    try {
      if (dialog.mode === "create") {
        const res = await api.post(config.listUrl, payload);
        setRows((prev) =>
          [...prev, res.data[config.itemKey]].sort((a, b) => a.name.localeCompare(b.name))
        );
        showToast({
          type: "success",
          title: `${config.singular === "dealer" ? "Dealer" : "Valuer"} added`,
          message: res.data.notice || `${payload.name} is now on the register.`,
        });
      } else {
        const res = await api.put(config.itemUrl(dialog.id), { ...payload, status: undefined });
        setRows((prev) => prev.map((r) => (r.id === dialog.id ? res.data[config.itemKey] : r)));
        showToast({ type: "success", title: "Saved", message: `${payload.name} was updated.` });
      }
      setDialog(null);
    } catch (err) {
      const apiErrors = err.response?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length) {
        setFormErrors(
          Object.fromEntries(apiErrors.filter((fe) => fe.path).map((fe) => [fe.path, fe.msg]))
        );
      }
      showToast({
        type: "error",
        title: "Couldn't save",
        message: err.response?.data?.message || "Please check the form and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Suspend / reactivate. Sends the whole row back because the update
   * endpoint replaces the record — a status-only PATCH does not exist, and
   * inventing one here would put two update paths on the same table.
   */
  const setStatus = async (row, status) => {
    setStatusBusyId(row.id);
    try {
      const payload = toPayload(config.fields, formFrom(config.fields, row), {
        includeAdminOnly: isAdmin,
      });
      const res = await api.put(config.itemUrl(row.id), { ...payload, status });
      setRows((prev) => prev.map((r) => (r.id === row.id ? res.data[config.itemKey] : r)));
      showToast({
        type: "success",
        title: status === "suspended" ? "Suspended" : "Reactivated",
        message:
          status === "suspended"
            ? `${row.name} will no longer appear for new applications. Their history is kept.`
            : `${row.name} is available again.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Couldn't change status",
        message: err.response?.data?.message || "Please try again.",
      });
    } finally {
      setStatusBusyId(null);
    }
  };

  const { Icon } = config;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 md:items-center">
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            placeholder={
              kind === "dealers"
                ? "Search by name, contact or registration no..."
                : "Search by name or licence number..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 transition-all text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          {suspendedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowSuspended((v) => !v)}
              className={`shrink-0 px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                showSuspended
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Suspended ({suspendedCount})
            </button>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 bg-indigo-900 hover:bg-indigo-950 text-white rounded-xl px-4 py-2 text-xs font-bold shadow-sm shadow-indigo-950/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add {config.singular}
          </button>
        </div>
      </div>

      {/* The gap that stalls a lease, said out loud. */}
      {unpayable.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-xs">
          <BanknoteX className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">
              {unpayable.length === 1
                ? "One dealer has no banking details"
                : `${unpayable.length} dealers have no banking details`}
            </p>
            <p className="mt-0.5 text-amber-800/90">
              {unpayable.map((r) => r.name).join(", ")} — a lease that reaches the purchase step
              with one of these will stop there until the account is on file.
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="p-8">
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="text-center py-16 px-6">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              {rows.length === 0 ? `No ${kind} on the register yet` : "Nothing matches that search"}
            </p>
            {rows.length === 0 && (
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{config.emptyHint}</p>
            )}
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-4 py-3">{config.singular === "dealer" ? "Dealer" : "Valuer"}</th>
                  <th className="px-4 py-3">Contact</th>
                  {kind === "dealers" && <th className="px-4 py-3">Payout account</th>}
                  <th className="px-4 py-3">Used</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visible.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className={cell}>
                      <div className="flex items-start gap-2.5">
                        <Icon className="w-4 h-4 text-slate-300 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 text-xs">{row.name}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {kind === "dealers"
                              ? row.business_reg_no || "No registration no."
                              : row.license_no || "No licence number on file"}
                          </p>
                          {row.status === "suspended" && (
                            <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                              <Ban className="w-2.5 h-2.5" /> Suspended
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className={cell}>
                      <div className="space-y-0.5 text-[11px]">
                        {kind === "dealers" && row.contact_person && (
                          <p className="font-semibold text-slate-700">{row.contact_person}</p>
                        )}
                        {row.phone && (
                          <p className="flex items-center gap-1.5 text-slate-500">
                            <Phone className="w-3 h-3 text-slate-300" />
                            {row.phone}
                          </p>
                        )}
                        {row.email && (
                          <p className="flex items-center gap-1.5 text-slate-500 max-w-[220px]">
                            <Mail className="w-3 h-3 text-slate-300 shrink-0" />
                            {/* The truncate has to sit on a real element, not
                                on the flex row: a bare text node becomes an
                                anonymous flex item and gets clipped without
                                an ellipsis, so a long address just stops
                                mid-word and reads as a corrupt value. */}
                            <span className="truncate" title={row.email}>
                              {row.email}
                            </span>
                          </p>
                        )}
                        {!row.phone && !row.email && <span className="text-slate-300">—</span>}
                      </div>
                    </td>

                    {kind === "dealers" && (
                      <td className={cell}>
                        {row.payable ? (
                          <div className="text-[11px]">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">
                              <BadgeCheck className="w-3 h-3" /> Payable
                            </span>
                            {isAdmin && row.bank_name && (
                              <p className="flex items-center gap-1.5 text-slate-400 mt-1">
                                <Landmark className="w-3 h-3 text-slate-300" />
                                {row.bank_name}
                                {row.bank_account_no ? ` · ${row.bank_account_no}` : ""}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px]">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold">
                              <BanknoteX className="w-3 h-3" /> Not payable
                            </span>
                            <p className="text-slate-400 mt-1 max-w-[220px]">
                              {row.readiness?.summary || "Banking details missing."}
                            </p>
                          </div>
                        )}
                      </td>
                    )}

                    <td className={cell}>
                      <span className="text-[11px] text-slate-500">
                        {config.usageLabel(Number(row[config.usageKey] || 0))}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          title="Edit"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={statusBusyId === row.id}
                          onClick={() =>
                            setStatus(row, row.status === "suspended" ? "active" : "suspended")
                          }
                          title={row.status === "suspended" ? "Reactivate" : "Suspend"}
                          className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                            row.status === "suspended"
                              ? "text-slate-400 hover:text-emerald-700 hover:bg-emerald-50"
                              : "text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                          }`}
                        >
                          {statusBusyId === row.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : row.status === "suspended" ? (
                            <Undo2 className="w-3.5 h-3.5" />
                          ) : (
                            <Ban className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Why there is no delete button, stated once rather than as a
          mysteriously absent affordance. */}
      {!loading && rows.length > 0 && (
        <p className="text-[11px] text-slate-400 px-1">
          Entries are suspended, never deleted —{" "}
          {kind === "dealers"
            ? "a dealer is referenced by every vehicle they supplied"
            : "a valuer is referenced by every valuation they signed"}
          , and that record has to outlive the relationship.
        </p>
      )}

      <AnimatePresence>
        {dialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.15 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                <h3 className="text-sm font-extrabold text-slate-800">
                  {dialog.mode === "create" ? `Add a ${config.singular}` : `Edit ${config.singular}`}
                </h3>
                <button
                  type="button"
                  onClick={() => !submitting && setDialog(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={submit} className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {config.fields
                    .filter((f) => !f.group && (isAdmin || !f.adminOnly))
                    .map((f) => (
                      <div key={f.name} className={f.textarea ? "sm:col-span-2" : ""}>
                        <FieldInput
                          field={f}
                          value={form[f.name] ?? ""}
                          error={formErrors[f.name]}
                          disabled={submitting}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, [f.name]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                </div>

                {isAdmin && config.fields.some((f) => f.group === "banking") && (
                  <fieldset className="border border-slate-100 rounded-xl p-4 bg-slate-50/40">
                    <legend className="px-2 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      Payout account
                    </legend>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Where the vehicle purchase is paid. Until all three of bank, account number
                      and account holder are on file, this dealer cannot be paid and any lease
                      reaching the purchase step will wait here.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {config.fields
                        .filter((f) => f.group === "banking")
                        .map((f) => (
                          <FieldInput
                            key={f.name}
                            field={f}
                            value={form[f.name] ?? ""}
                            error={formErrors[f.name]}
                            disabled={submitting}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, [f.name]: e.target.value }))
                            }
                          />
                        ))}
                    </div>
                  </fieldset>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-900 hover:bg-indigo-950 text-white flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {dialog.mode === "create" ? `Add ${config.singular}` : "Save changes"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

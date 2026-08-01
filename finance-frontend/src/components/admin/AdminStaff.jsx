import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  UserPlus,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Inbox,
  Copy,
  Check,
  Eye,
  EyeOff,
  Dices,
  Pencil,
  Trash2,
  Ban,
  RotateCcw,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

const emptyForm = { firstName: "", lastName: "", email: "", phone: "", password: "" };

const STATUS_STYLES = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-100",
  inactive: "bg-slate-100 text-slate-500 border-slate-200",
  suspended: "bg-rose-50 text-rose-700 border-rose-100",
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export default function AdminStaff() {
  const { showToast } = useToast();

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadStaff = async () => {
    const res = await api.get("/admin/staff");
    return res.data?.staff || [];
  };

  const refreshStaff = async () => {
    setLoading(true);
    setError("");
    try {
      setStaff(await loadStaff());
    } catch (err) {
      setError(
        err.response?.data?.message || "Couldn't load staff accounts. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const list = await loadStaff();
        if (!cancelled) setStaff(list);
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Couldn't load staff accounts. Please try again."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredStaff = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((s) => {
      const name = `${s.first_name || ""} ${s.last_name || ""}`.trim().toLowerCase();
      return name.includes(term) || s.email?.toLowerCase().includes(term);
    });
  }, [staff, searchTerm]);

  const openCreateModal = () => {
    setModalMode("create");
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setShowPassword(false);
    setCopied(false);
    setModalOpen(true);
  };

  const openEditModal = (s) => {
    setModalMode("edit");
    setEditingId(s.user_id);
    setForm({
      firstName: s.first_name || "",
      lastName: s.last_name || "",
      email: s.email || "",
      phone: s.phone || "",
      password: "",
    });
    setFormErrors({});
    setShowPassword(false);
    setCopied(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleGeneratePassword = () => {
    setForm((prev) => ({ ...prev, password: generatePassword() }));
    setShowPassword(true);
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    if (!form.password) return;
    try {
      await navigator.clipboard.writeText(form.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — the password is still visible to copy manually.
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});

    try {
      if (modalMode === "create") {
        const payload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          password: form.password,
        };
        const res = await api.post("/admin/createStaff", payload);
        setStaff((prev) => [
          {
            user_id: res.data.user_id,
            first_name: res.data.first_name,
            last_name: res.data.last_name,
            email: res.data.email,
            phone: res.data.phone,
            status: res.data.status,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        showToast({
          type: "success",
          title: "Staff Account Created",
          message: `${res.data.email} can now log in with the password you set.`,
        });
      } else {
        const payload = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
        };
        const res = await api.put(`/admin/staff/${editingId}`, payload);
        setStaff((prev) => prev.map((s) => (s.user_id === editingId ? res.data : s)));
        showToast({
          type: "success",
          title: "Staff Account Updated",
          message: `${res.data.email} was updated.`,
        });
      }
      setModalOpen(false);
    } catch (err) {
      const apiErrors = err.response?.data?.errors;
      if (Array.isArray(apiErrors) && apiErrors.length) {
        const fieldErrors = {};
        apiErrors.forEach((fe) => {
          if (fe.path) fieldErrors[fe.path] = fe.msg;
        });
        setFormErrors(fieldErrors);
      }
      showToast({
        type: "error",
        title: modalMode === "create" ? "Create Failed" : "Update Failed",
        message:
          err.response?.data?.message || "Please check the form and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (s) => {
    const nextStatus = s.status === "active" ? "inactive" : "active";
    setStatusUpdatingId(s.user_id);
    try {
      const res = await api.patch(`/admin/staff/${s.user_id}/status`, {
        status: nextStatus,
      });
      setStaff((prev) => prev.map((row) => (row.user_id === s.user_id ? res.data : row)));
      showToast({
        type: "success",
        title: nextStatus === "active" ? "Staff Reactivated" : "Staff Deactivated",
        message:
          nextStatus === "active"
            ? `${s.email} can log in again.`
            : `${s.email} can no longer log in.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Couldn't update this staff account.",
      });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.user_id);
    try {
      await api.delete(`/admin/staff/${pendingDelete.user_id}`);
      setStaff((prev) => prev.filter((s) => s.user_id !== pendingDelete.user_id));
      showToast({
        type: "success",
        title: "Staff Account Deleted",
        message: `${pendingDelete.email} was removed.`,
      });
      setPendingDelete(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Delete Failed",
        message: err.response?.data?.message || "Couldn't delete this staff account.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 transition-all text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={refreshStaff}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex-1 md:flex-none flex items-center justify-center gap-1.5 bg-indigo-900 hover:bg-indigo-950 text-white rounded-xl px-4 py-2 text-xs font-bold shadow-sm shadow-indigo-950/10 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Staff
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="p-8">
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!loading && !error && staff.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No staff accounts yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Staff have no self-service signup — add one to grant portal access.
            </p>
          </div>
        )}

        {!loading && !error && staff.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-6 py-3.5">Name</th>
                  <th className="px-6 py-3.5">Email</th>
                  <th className="px-6 py-3.5">Phone</th>
                  <th className="px-6 py-3.5 text-center">Status</th>
                  <th className="px-6 py-3.5">Joined</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStaff.length > 0 ? (
                  filteredStaff.map((s) => {
                    const isActive = s.status === "active";
                    const isTogglingStatus = statusUpdatingId === s.user_id;
                    const isDeleting = deletingId === s.user_id;
                    return (
                      <tr key={s.user_id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-800">
                          {s.first_name} {s.last_name}
                        </td>
                        <td className="px-6 py-4 text-slate-600">{s.email}</td>
                        <td className="px-6 py-4 text-slate-500 font-mono text-xs">
                          {s.phone || "—"}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase ${STATUS_STYLES[s.status] || STATUS_STYLES.active}`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500 font-mono">
                          {formatDate(s.created_at)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(s)}
                              className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-indigo-700 rounded-lg transition-colors"
                              title="Edit staff"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleStatus(s)}
                              disabled={isTogglingStatus}
                              className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                                isActive
                                  ? "hover:bg-amber-50 text-slate-400 hover:text-amber-600"
                                  : "hover:bg-emerald-50 text-slate-400 hover:text-emerald-600"
                              }`}
                              title={isActive ? "Deactivate" : "Reactivate"}
                            >
                              {isTogglingStatus ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : isActive ? (
                                <Ban className="w-4 h-4" />
                              ) : (
                                <RotateCcw className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              onClick={() => setPendingDelete(s)}
                              disabled={isDeleting}
                              className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors disabled:opacity-40"
                              title="Delete staff"
                            >
                              {isDeleting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                      No staff matched your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative border border-slate-100 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-lg text-slate-900">
                  {modalMode === "create" ? "Add Staff Account" : "Edit Staff Account"}
                </h3>
                <button
                  onClick={closeModal}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      First Name
                    </label>
                    <input
                      type="text"
                      value={form.firstName}
                      onChange={handleField("firstName")}
                      placeholder="e.g. Nimal"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.firstName && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.firstName}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={form.lastName}
                      onChange={handleField("lastName")}
                      placeholder="e.g. Perera"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.lastName && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.lastName}</p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={handleField("email")}
                      placeholder="e.g. staff@aura.com"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.email && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.email}</p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Phone{" "}
                      <span className="text-slate-400 font-normal normal-case">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={handleField("phone")}
                      placeholder="e.g. 0771234567"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.phone && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.phone}</p>
                    )}
                  </div>

                  {modalMode === "create" ? (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        Initial Password
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showPassword ? "text" : "password"}
                            value={form.password}
                            onChange={handleField("password")}
                            placeholder="At least 8 characters"
                            className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                            title={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleGeneratePassword}
                          title="Generate a random password"
                          className="shrink-0 px-3 py-2 border border-slate-200 rounded-xl text-slate-500 hover:text-indigo-700 hover:border-indigo-800 transition-colors"
                        >
                          <Dices className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyPassword}
                          disabled={!form.password}
                          title="Copy password"
                          className="shrink-0 px-3 py-2 border border-slate-200 rounded-xl text-slate-500 hover:text-indigo-700 hover:border-indigo-800 transition-colors disabled:opacity-40"
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {formErrors.password && (
                        <p className="text-[11px] text-rose-600 mt-1">{formErrors.password}</p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        There's no invite email yet — share this password with them directly,
                        then they can change it after logging in.
                      </p>
                    </div>
                  ) : (
                    <div className="sm:col-span-2 bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] text-slate-500">
                      Password isn't editable here. To reset it, use the account's own
                      "Forgot password" flow, or delete and recreate the account.
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={submitting}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-indigo-900 hover:bg-indigo-950 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 shadow-md shadow-indigo-950/10 disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {modalMode === "create" ? "Create Staff Account" : "Save Changes"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AnimatePresence>
        {pendingDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900">Delete Staff Account</h3>
              </div>

              <p className="text-sm text-slate-600 mb-6">
                Delete{" "}
                <span className="font-semibold text-slate-800">
                  {pendingDelete.first_name} {pendingDelete.last_name}
                </span>{" "}
                ({pendingDelete.email})? They'll immediately lose portal access. This
                cannot be undone.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deletingId === pendingDelete.user_id}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deletingId === pendingDelete.user_id}
                  className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                >
                  {deletingId === pendingDelete.user_id && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

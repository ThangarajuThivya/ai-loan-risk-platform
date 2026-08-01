import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Inbox,
  Layers,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

const emptyForm = {
  name: "",
  type: "",
  min_amount: "",
  max_amount: "",
  min_tenure_months: "",
  max_tenure_months: "",
  interest_rate: "",
  rate_type: "reducing",
  description: "",
};

const TYPE_SUGGESTIONS = [
  "Personal",
  "Housing",
  "Leasing",
  "Education",
  "Business",
  "Pawning",
];

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const formatTenure = (min, max) => {
  const minM = Number(min);
  const maxM = Number(max);
  if (minM >= 12 && maxM >= 12 && minM % 12 === 0 && maxM % 12 === 0) {
    return `${minM / 12} - ${maxM / 12} yrs`;
  }
  return `${minM} - ${maxM} mo`;
};

export default function AdminProducts({ readOnly = false }) {
  const { showToast } = useToast();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // "create" | "edit"
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadProducts = async () => {
    const res = await api.get("/loans/products");
    return res.data?.products || [];
  };

  const refreshProducts = async () => {
    setLoading(true);
    setError("");
    try {
      setProducts(await loadProducts());
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Couldn't load loan products. Please try again."
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
        const list = await loadProducts();
        if (!cancelled) setProducts(list);
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Couldn't load loan products. Please try again."
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

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(term) ||
        p.type?.toLowerCase().includes(term)
    );
  }, [products, searchTerm]);

  const openCreateModal = () => {
    setModalMode("create");
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (product) => {
    setModalMode("edit");
    setEditingId(product.id);
    setForm({
      name: product.name || "",
      type: product.type || "",
      min_amount: String(product.min_amount ?? ""),
      max_amount: String(product.max_amount ?? ""),
      min_tenure_months: String(product.min_tenure_months ?? ""),
      max_tenure_months: String(product.max_tenure_months ?? ""),
      interest_rate: String(product.interest_rate ?? ""),
      rate_type: product.rate_type || "reducing",
      description: product.description || "",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
  };

  const handleField = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});

    const payload = {
      name: form.name.trim(),
      type: form.type.trim(),
      min_amount: Number(form.min_amount),
      max_amount: Number(form.max_amount),
      min_tenure_months: Number(form.min_tenure_months),
      max_tenure_months: Number(form.max_tenure_months),
      interest_rate: Number(form.interest_rate),
      rate_type: form.rate_type,
      description: form.description.trim() || null,
    };

    try {
      if (modalMode === "create") {
        const res = await api.post("/admin/products", payload);
        setProducts((prev) =>
          [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name))
        );
        showToast({
          type: "success",
          title: "Product Created",
          message: `${res.data.name} was added to the catalog.`,
        });
      } else {
        const res = await api.put(`/admin/products/${editingId}`, payload);
        setProducts((prev) =>
          prev.map((p) => (p.id === editingId ? res.data : p))
        );
        showToast({
          type: "success",
          title: "Product Updated",
          message: `${res.data.name} was updated.`,
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

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    try {
      await api.delete(`/admin/products/${pendingDelete.id}`);
      setProducts((prev) => prev.filter((p) => p.id !== pendingDelete.id));
      showToast({
        type: "success",
        title: "Product Deleted",
        message: `${pendingDelete.name} was removed from the catalog.`,
      });
      setPendingDelete(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Delete Failed",
        message:
          err.response?.data?.message || "Couldn't delete this loan product.",
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
            placeholder="Search by name or type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 transition-all text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={refreshProducts}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex-1 md:flex-none flex items-center justify-center gap-1.5 bg-indigo-900 hover:bg-indigo-950 text-white rounded-xl px-4 py-2 text-xs font-bold shadow-sm shadow-indigo-950/10 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          )}
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

        {!loading && !error && products.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">
              No loan products yet
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {readOnly
                ? "No products have been added to the catalog yet."
                : "Add one to make it available on the loans page and apply form."}
            </p>
          </div>
        )}

        {!loading && !error && products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-6 py-3.5">Product</th>
                  <th className="px-6 py-3.5">Type</th>
                  <th className="px-6 py-3.5">Amount Range</th>
                  <th className="px-6 py-3.5">Tenure</th>
                  <th className="px-6 py-3.5">Interest</th>
                  {!readOnly && <th className="px-6 py-3.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredProducts.length > 0 ? (
                  filteredProducts.map((product) => {
                    const isDeleting = deletingId === product.id;
                    return (
                      <tr key={product.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-semibold text-slate-800">{product.name}</p>
                          {product.description && (
                            <p className="text-[11px] text-slate-400 line-clamp-1 max-w-xs">
                              {product.description}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg inline-flex items-center gap-1">
                            <Layers className="w-3 h-3" />
                            {product.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-700">
                          {formatCurrency(product.min_amount)} –{" "}
                          {formatCurrency(product.max_amount)}
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-600 font-mono">
                          {formatTenure(product.min_tenure_months, product.max_tenure_months)}
                        </td>
                        <td className="px-6 py-4 text-xs">
                          <span className="font-mono font-bold text-slate-800">
                            {Number(product.interest_rate).toFixed(2)}%
                          </span>
                          <span className="text-slate-400 ml-1">({product.rate_type})</span>
                        </td>
                        {!readOnly && (
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openEditModal(product)}
                                className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-indigo-700 rounded-lg transition-colors"
                                title="Edit product"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setPendingDelete(product)}
                                disabled={isDeleting}
                                className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors disabled:opacity-40"
                                title="Delete product"
                              >
                                {isDeleting ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={readOnly ? 5 : 6} className="px-6 py-12 text-center text-slate-400">
                      No products matched your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-2xl relative border border-slate-100 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-lg text-slate-900">
                  {modalMode === "create" ? "Add Loan Product" : "Edit Loan Product"}
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
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Product Name
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={handleField("name")}
                      placeholder="e.g. Personal Loan"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.name && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.name}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Type
                    </label>
                    <input
                      type="text"
                      list="product-type-suggestions"
                      value={form.type}
                      onChange={handleField("type")}
                      placeholder="e.g. Personal"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    <datalist id="product-type-suggestions">
                      {TYPE_SUGGESTIONS.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    {formErrors.type && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.type}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Rate Type
                    </label>
                    <select
                      value={form.rate_type}
                      onChange={handleField("rate_type")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800 bg-white"
                    >
                      <option value="reducing">Reducing balance</option>
                      <option value="flat">Flat rate</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Min Amount (LKR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.min_amount}
                      onChange={handleField("min_amount")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.min_amount && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.min_amount}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Max Amount (LKR)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.max_amount}
                      onChange={handleField("max_amount")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.max_amount && (
                      <p className="text-[11px] text-rose-600 mt-1">{formErrors.max_amount}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Min Tenure (months)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={form.min_tenure_months}
                      onChange={handleField("min_tenure_months")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.min_tenure_months && (
                      <p className="text-[11px] text-rose-600 mt-1">
                        {formErrors.min_tenure_months}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Max Tenure (months)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={form.max_tenure_months}
                      onChange={handleField("max_tenure_months")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.max_tenure_months && (
                      <p className="text-[11px] text-rose-600 mt-1">
                        {formErrors.max_tenure_months}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Interest Rate (% p.a.)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="60"
                      step="0.01"
                      value={form.interest_rate}
                      onChange={handleField("interest_rate")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.interest_rate && (
                      <p className="text-[11px] text-rose-600 mt-1">
                        {formErrors.interest_rate}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Description
                    </label>
                    <textarea
                      value={form.description}
                      onChange={handleField("description")}
                      rows={3}
                      maxLength={1000}
                      placeholder="Shown to customers on the loans page and apply form."
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                    />
                    {formErrors.description && (
                      <p className="text-[11px] text-rose-600 mt-1">
                        {formErrors.description}
                      </p>
                    )}
                  </div>
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
                    {modalMode === "create" ? "Create Product" : "Save Changes"}
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
                <h3 className="font-bold text-slate-900">Delete Product</h3>
              </div>

              <p className="text-sm text-slate-600 mb-6">
                Delete{" "}
                <span className="font-semibold text-slate-800">{pendingDelete.name}</span>?
                It will immediately disappear from the loans page and apply form. This
                cannot be undone.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deletingId === pendingDelete.id}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deletingId === pendingDelete.id}
                  className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                >
                  {deletingId === pendingDelete.id && (
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

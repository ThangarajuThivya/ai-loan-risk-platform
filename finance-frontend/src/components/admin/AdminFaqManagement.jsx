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
  HelpCircle,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

// One tab per language in the editor. English is the source of truth and the
// only required set — the public API COALESCEs a missing si/ta value back to
// it per field (finance-backend/src/utils/i18nContent.js), so a FAQ saved in
// English alone is a valid, fully-working row.
const LANG_TABS = [
  { code: "en", label: "English", suffix: "", required: true },
  { code: "si", label: "සිංහල · Sinhala", suffix: "_si", required: false },
  { code: "ta", label: "தமிழ் · Tamil", suffix: "_ta", required: false },
];

const emptyForm = {
  category: "",
  question: "",
  answer: "",
  category_si: "",
  question_si: "",
  answer_si: "",
  category_ta: "",
  question_ta: "",
  answer_ta: "",
};

export default function AdminFaqManagement() {
  const { showToast } = useToast();
  const [langTab, setLangTab] = useState("en");

  const [faqs, setFaqs] = useState([]);
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

  const loadFaqs = async () => {
    // translations=1 returns the raw *_si/*_ta columns alongside the English
    // ones. The public page gets the COALESCEd view instead; the editor needs
    // to see each language separately to know what is actually filled in.
    // lang:null overrides the axios interceptor, which would otherwise fold
    // the translations into the base columns when an admin is browsing in
    // Sinhala or Tamil, making the editor unable to tell them apart.
    const res = await api.get("/faqs", { params: { translations: "1", lang: null } });
    return res.data?.faqs || [];
  };

  const refreshFaqs = async () => {
    setLoading(true);
    setError("");
    try {
      setFaqs(await loadFaqs());
    } catch (err) {
      setError(
        err.response?.data?.message || "Couldn't load FAQs. Please try again."
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
        const list = await loadFaqs();
        if (!cancelled) setFaqs(list);
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message || "Couldn't load FAQs. Please try again."
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

  const categorySuggestions = useMemo(
    () => [...new Set(faqs.map((f) => f.category).filter(Boolean))],
    [faqs]
  );

  const filteredFaqs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return faqs;
    return faqs.filter(
      (f) =>
        f.question?.toLowerCase().includes(term) ||
        f.answer?.toLowerCase().includes(term) ||
        f.category?.toLowerCase().includes(term)
    );
  }, [faqs, searchTerm]);

  const openCreateModal = () => {
    setModalMode("create");
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setLangTab("en");
    setModalOpen(true);
  };

  const openEditModal = (faq) => {
    setModalMode("edit");
    setEditingId(faq.id);
    // Spread every key of emptyForm so each input stays controlled even when
    // the row has no translation for that language yet.
    setForm(
      Object.fromEntries(
        Object.keys(emptyForm).map((k) => [k, faq[k] || ""])
      )
    );
    setFormErrors({});
    setLangTab("en");
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

    // Translations go over as null when blank, so clearing a field in the
    // editor actually clears the column rather than storing an empty string
    // that would shadow the English fallback.
    const payload = Object.fromEntries(
      Object.keys(emptyForm).map((k) => {
        const value = form[k].trim();
        const isTranslation = k.includes("_");
        return [k, isTranslation ? value || null : value];
      })
    );

    try {
      if (modalMode === "create") {
        const res = await api.post("/faqs", payload);
        setFaqs((prev) =>
          [...prev, res.data].sort((a, b) => a.category.localeCompare(b.category))
        );
        showToast({
          type: "success",
          title: "FAQ Created",
          message: "The question was added to the FAQ page.",
        });
      } else {
        const res = await api.put(`/faqs/${editingId}`, payload);
        setFaqs((prev) => prev.map((f) => (f.id === editingId ? res.data : f)));
        showToast({
          type: "success",
          title: "FAQ Updated",
          message: "The question was updated.",
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

        // Errors render inside their own language tab, so a rejection on a
        // tab that isn't open would be invisible — the form would just seem
        // to fail silently. Jump to the first tab that actually has one.
        const offending = LANG_TABS.find((tab) =>
          Object.keys(fieldErrors).some((f) =>
            tab.suffix ? f.endsWith(tab.suffix) : !f.includes("_")
          )
        );
        if (offending) setLangTab(offending.code);
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
      await api.delete(`/faqs/${pendingDelete.id}`);
      setFaqs((prev) => prev.filter((f) => f.id !== pendingDelete.id));
      showToast({
        type: "success",
        title: "FAQ Deleted",
        message: "The question was removed from the FAQ page.",
      });
      setPendingDelete(null);
    } catch (err) {
      showToast({
        type: "error",
        title: "Delete Failed",
        message: err.response?.data?.message || "Couldn't delete this FAQ.",
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
            placeholder="Search by question, answer, or category..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 transition-all text-xs"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={refreshFaqs}
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
            <Plus className="w-4 h-4" />
            Add FAQ
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

        {!loading && !error && faqs.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600">No FAQs yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Add one to make it available on the public FAQ page.
            </p>
          </div>
        )}

        {!loading && !error && faqs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="px-6 py-3.5">Category</th>
                  <th className="px-6 py-3.5">Question</th>
                  <th className="px-6 py-3.5">Answer</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredFaqs.length > 0 ? (
                  filteredFaqs.map((faq) => {
                    const isDeleting = deletingId === faq.id;
                    return (
                      <tr key={faq.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg inline-flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" />
                            {faq.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 max-w-xs">
                          <p className="font-semibold text-slate-800 line-clamp-2">
                            {faq.question}
                          </p>
                        </td>
                        <td className="px-6 py-4 max-w-sm">
                          <p className="text-xs text-slate-500 line-clamp-2">
                            {faq.answer}
                          </p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(faq)}
                              className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-indigo-700 rounded-lg transition-colors"
                              title="Edit FAQ"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setPendingDelete(faq)}
                              disabled={isDeleting}
                              className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors disabled:opacity-40"
                              title="Delete FAQ"
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
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                      No FAQs matched your search.
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
                  {modalMode === "create" ? "Add FAQ" : "Edit FAQ"}
                </h3>
                <button
                  onClick={closeModal}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Language tabs. All three sets live in the same form and
                    submit together — switching tabs only changes which set is
                    visible, so a half-typed translation is never lost. The dot
                    marks a language that already has content. */}
                <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                  {LANG_TABS.map((tab) => {
                    const filled = ["category", "question", "answer"].some(
                      (f) => form[`${f}${tab.suffix}`]?.trim()
                    );
                    return (
                      <button
                        key={tab.code}
                        type="button"
                        onClick={() => setLangTab(tab.code)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          langTab === tab.code
                            ? "bg-white text-indigo-800 shadow-sm"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        <span>{tab.label}</span>
                        {filled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                      </button>
                    );
                  })}
                </div>

                {langTab !== "en" && (
                  <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 leading-relaxed">
                    Optional. Any field left blank falls back to the English
                    text on the public page.
                  </p>
                )}

                {LANG_TABS.map((tab) => {
                  const s = tab.suffix;
                  return (
                    <div key={tab.code} className={langTab === tab.code ? "space-y-4" : "hidden"}>
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                          Category{tab.required && <span className="text-rose-500"> *</span>}
                        </label>
                        <input
                          type="text"
                          list={tab.required ? "faq-category-suggestions" : undefined}
                          value={form[`category${s}`]}
                          onChange={handleField(`category${s}`)}
                          placeholder="e.g. Eligibility"
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                        />
                        {tab.required && (
                          <datalist id="faq-category-suggestions">
                            {categorySuggestions.map((c) => (
                              <option key={c} value={c} />
                            ))}
                          </datalist>
                        )}
                        {formErrors[`category${s}`] && (
                          <p className="text-[11px] text-rose-600 mt-1">{formErrors[`category${s}`]}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                          Question{tab.required && <span className="text-rose-500"> *</span>}
                        </label>
                        <input
                          type="text"
                          value={form[`question${s}`]}
                          onChange={handleField(`question${s}`)}
                          placeholder="e.g. How is my loan eligibility calculated?"
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                        />
                        {formErrors[`question${s}`] && (
                          <p className="text-[11px] text-rose-600 mt-1">{formErrors[`question${s}`]}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                          Answer{tab.required && <span className="text-rose-500"> *</span>}
                        </label>
                        <textarea
                          value={form[`answer${s}`]}
                          onChange={handleField(`answer${s}`)}
                          rows={5}
                          maxLength={5000}
                          placeholder="Shown to customers on the public FAQ page."
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-indigo-800 focus:ring-1 focus:ring-indigo-800"
                        />
                        {formErrors[`answer${s}`] && (
                          <p className="text-[11px] text-rose-600 mt-1">{formErrors[`answer${s}`]}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

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
                    {modalMode === "create" ? "Create FAQ" : "Save Changes"}
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
                <h3 className="font-bold text-slate-900">Delete FAQ</h3>
              </div>

              <p className="text-sm text-slate-600 mb-6">
                Delete{" "}
                <span className="font-semibold text-slate-800">
                  "{pendingDelete.question}"
                </span>
                ? It will immediately disappear from the public FAQ page. This cannot be
                undone.
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

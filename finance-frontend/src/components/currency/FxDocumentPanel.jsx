import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Upload, Trash2, Loader2, AlertTriangle, ShieldCheck, Eye } from "lucide-react";

import api from "../../api/axios";

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Supporting-document panel for one FX exchange request.
 *
 * Used from both sides of the workflow: the customer's detail page (which
 * passes `canUpload` while the request is still pending_review) and the
 * staff review queue (read-only — staff review evidence, they don't supply
 * it, and the server enforces that independently).
 *
 * Documents are never fetched by URL: secure-uploads/ is not served
 * statically, so previewing one means pulling it through the authenticated
 * download route as a blob and opening an object URL.
 */
export default function FxDocumentPanel({
  referenceNo,
  requiresDocuments,
  canUpload = false,
  onCountChange,
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/currency/exchange/requests/${referenceNo}/documents`);
      const list = res.data?.documents || [];
      setDocuments(list);
      onCountChange?.(list.length);
    } catch (err) {
      setError(err.response?.data?.message || t("fxDocuments.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceNo]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file still fires onChange.
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("document", file);
      await api.post(`/currency/exchange/requests/${referenceNo}/documents`, form);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t("fxDocuments.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (doc) => {
    setBusyId(doc.id);
    setError("");
    try {
      const res = await api.get(
        `/currency/exchange/requests/${referenceNo}/documents/${doc.id}/download`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener");
      // The tab has the blob by now; releasing the handle keeps this from
      // leaking a URL per preview for the life of the page.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.response?.data?.message || t("fxDocuments.viewError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (doc) => {
    setBusyId(doc.id);
    setError("");
    try {
      await api.delete(`/currency/exchange/requests/${referenceNo}/documents/${doc.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t("fxDocuments.deleteError"));
    } finally {
      setBusyId(null);
    }
  };

  const satisfied = !requiresDocuments || documents.length > 0;

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 sm:p-8">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t("fxDocuments.title")}
        </h2>
        {requiresDocuments && (
          <span
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
              satisfied
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
          >
            {satisfied
              ? t("fxDocuments.badgeProvided")
              : t("fxDocuments.badgeRequired")}
          </span>
        )}
      </div>

      {requiresDocuments && !satisfied && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3.5 text-xs mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t("fxDocuments.requiredNotice")}</span>
        </div>
      )}

      {!requiresDocuments && (
        <p className="text-xs text-slate-400 mb-4">{t("fxDocuments.notRequiredNotice")}</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {!loading && documents.length === 0 && (
        <p className="text-xs text-slate-400 py-2">{t("fxDocuments.none")}</p>
      )}

      {!loading && documents.length > 0 && (
        <ul className="space-y-2 mb-4">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5"
            >
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 truncate">{doc.original_name}</p>
                <p className="text-[10px] text-slate-400">
                  {formatBytes(doc.size_bytes)} · {new Date(doc.created_at).toLocaleString("en-LK")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleView(doc)}
                disabled={busyId === doc.id}
                className="flex items-center gap-1 text-[11px] font-semibold text-brand-primary hover:underline disabled:opacity-50 shrink-0"
              >
                {busyId === doc.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
                {t("fxDocuments.view")}
              </button>
              {canUpload && (
                <button
                  type="button"
                  onClick={() => handleDelete(doc)}
                  disabled={busyId === doc.id}
                  className="text-slate-300 hover:text-rose-600 transition-colors disabled:opacity-50 shrink-0"
                  aria-label={t("fxDocuments.remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs text-rose-600 flex items-start gap-1.5 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {canUpload && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/5 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? t("fxDocuments.uploading") : t("fxDocuments.upload")}
          </button>
          <p className="text-[10px] text-slate-400 mt-2">{t("fxDocuments.uploadHint")}</p>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  Upload,
  Trash2,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Eye,
  Check,
  X,
  Camera,
} from "lucide-react";

import api from "../../api/axios";
import ExtractionResult from "../documents/ExtractionResult";

/**
 * Supporting documents for one LEASE application.
 *
 * A sibling of LoanDocumentPanel, not a reuse of it. The two panels look
 * alike because the interaction is the same, but a lease's evidence is not a
 * loan's: the vehicle invoice and the CR are the documents the whole
 * transaction hangs on, and neither exists on the lending side. Pointing
 * this at /api/loans with an extra prop would have been the same
 * misclassification the schema was corrected of.
 *
 * Serves both sides via props: the lessee's own view passes `canUpload` (and
 * may withdraw a document while it is still pending), the staff review
 * drawer passes `canVerify`.
 *
 * ADVISORY ONLY. Verifying or rejecting a document never moves the
 * application's status — see leaseApplication.controller.verifyDocument.
 */

/** What a LESSEE is asked to supply. */
const UPLOADABLE_TYPES = [
  "national_id",
  "payslip",
  "bank_statement",
  "vehicle_invoice",
  "cr_copy",
  "other",
];

// Mirrors TWO_SIDED_DOCUMENT_TYPES in leaseDocument.service.js: types where
// a customer photographing rather than scanning the original may reasonably
// want to attach both sides — a National ID card, and a CR copy's cover.
const TWO_SIDED_TYPES = ["national_id", "cr_copy"];

const STATUS_BADGE = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function LeaseDocumentPanel({
  applicationId,
  canUpload = false,
  canVerify = false,
  onCountChange,
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState(UPLOADABLE_TYPES[0]);
  // "document" (PDF or a flat scan) vs "photo" (a phone camera shot — for a
  // two-sided type this unlocks separate front/back slots, since one photo
  // can only show one side of a card or form).
  const [uploadMode, setUploadMode] = useState("document");
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  // Keyed by document id: { loading, error, data }. Fetched alongside the
  // document list rather than on demand, so severity/confidence are visible
  // for every document without an extra click — see ExtractionResult.
  const [extractions, setExtractions] = useState({});
  // Documents currently re-running extraction via the retry button — a
  // separate set from busyId, since a retry can be in flight on the same
  // document a view/delete button is not touching.
  const [retryingIds, setRetryingIds] = useState(() => new Set());

  const fetchExtraction = useCallback(
    async (doc) => {
      setExtractions((prev) => ({
        ...prev,
        [doc.id]: { loading: true, error: false, data: prev[doc.id]?.data },
      }));
      try {
        const res = await api.get(`/leases/${applicationId}/documents/${doc.id}/extraction`);
        setExtractions((prev) => ({ ...prev, [doc.id]: { loading: false, error: false, data: res.data } }));
      } catch {
        setExtractions((prev) => ({ ...prev, [doc.id]: { loading: false, error: true, data: null } }));
      }
    },
    [applicationId]
  );

  const retryExtraction = async (doc) => {
    setRetryingIds((prev) => new Set(prev).add(doc.id));
    try {
      const res = await api.post(`/leases/${applicationId}/documents/${doc.id}/extraction/retry`);
      setExtractions((prev) => ({ ...prev, [doc.id]: { loading: false, error: false, data: res.data } }));
    } catch {
      setError(t("documentExtraction.retryError"));
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const load = useCallback(async ({ spinner = false } = {}) => {
    // The spinner belongs to the FIRST fetch for an application. Re-fetching
    // after an upload or a verify must not blank the list out from under
    // whoever is reading it.
    if (spinner) {
      setLoading(true);
      setDocuments([]);
    }
    setError("");
    try {
      const res = await api.get(`/leases/${applicationId}/documents`);
      const list = res.data?.documents || [];
      setDocuments(list);
      onCountChange?.(list.length);
      // Fire-and-forget: the document list must not wait on N extraction
      // fetches, each of which is independently allowed to fail.
      list.forEach((doc) => fetchExtraction(doc));
    } catch (err) {
      setError(err.response?.data?.message || t("leaseDocuments.loadError"));
    } finally {
      setLoading(false);
    }
    // onCountChange is a parent callback; depending on it would re-fetch on
    // every parent render unless the parent memoises, which it should not
    // have to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, t, fetchExtraction]);

  useEffect(() => {
    (async () => {
      await load({ spinner: true });
    })();
  }, [load]);

  const handleUpload = async (event, side = null) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file still fires onChange.
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("document", file);
      form.append("document_type", uploadType);
      if (side) form.append("side", side);
      await api.post(`/leases/${applicationId}/documents`, form);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t("leaseDocuments.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  const isTwoSided = TWO_SIDED_TYPES.includes(uploadType);
  const hasSide = (side) =>
    documents.some((d) => d.document_type === uploadType && d.side === side);

  const handleView = async (doc) => {
    setBusyId(doc.id);
    setError("");
    try {
      // secure-uploads/ is never served statically — the only way to read a
      // document is this authenticated route, so it comes back as a blob.
      const res = await api.get(`/leases/${applicationId}/documents/${doc.id}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.response?.data?.message || t("leaseDocuments.viewError"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (doc) => {
    setBusyId(doc.id);
    setError("");
    try {
      await api.delete(`/leases/${applicationId}/documents/${doc.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || t("leaseDocuments.deleteError"));
    } finally {
      setBusyId(null);
    }
  };

  const submitVerify = async (doc, verificationStatus, notes) => {
    setBusyId(doc.id);
    setError("");
    try {
      await api.patch(`/leases/${applicationId}/documents/${doc.id}/verify`, {
        verification_status: verificationStatus,
        verification_notes: notes || undefined,
      });
      setRejectingId(null);
      setRejectNote("");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't update that document.");
    } finally {
      setBusyId(null);
    }
  };

  const typeLabel = (type) =>
    t(`leaseDocuments.type_${type}`, { defaultValue: String(type).replace(/_/g, " ") });

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t("leaseDocuments.title")}
        </h2>
        {canUpload && (
          <p className="text-[11px] text-slate-400 mt-1.5">{t("leaseDocuments.intro")}</p>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {!loading && documents.length === 0 && (
        <p className="text-xs text-slate-400">{t("leaseDocuments.none")}</p>
      )}

      {!loading && documents.length > 0 && (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-col gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate">
                    {typeLabel(doc.document_type)}
                    {doc.side && (
                      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-brand-primary/70 align-middle">
                        {t(`leaseDocuments.${doc.side}`)}
                      </span>
                    )}
                    <span className="ml-2 font-normal text-slate-400 truncate">
                      {doc.original_name}
                    </span>
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {formatBytes(doc.size_bytes)} ·{" "}
                    {new Date(doc.created_at).toLocaleString("en-LK")}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${
                    STATUS_BADGE[doc.verification_status] || STATUS_BADGE.pending
                  }`}
                >
                  {t(`leaseDocuments.status_${doc.verification_status}`)}
                </span>
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
                  {t("leaseDocuments.view")}
                </button>
                {canUpload && doc.verification_status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleDelete(doc)}
                    disabled={busyId === doc.id}
                    className="text-slate-300 hover:text-rose-600 transition-colors disabled:opacity-50 shrink-0"
                    aria-label={t("leaseDocuments.remove")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {canVerify && doc.verification_status === "pending" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => submitVerify(doc, "verified")}
                      disabled={busyId === doc.id}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                      Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejectingId(rejectingId === doc.id ? null : doc.id)}
                      disabled={busyId === doc.id}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg disabled:opacity-50"
                    >
                      <X className="w-3 h-3" />
                      Reject
                    </button>
                  </div>
                )}
              </div>

              {doc.verification_notes && (
                <p className="text-[11px] text-slate-500 italic pl-7">
                  &ldquo;{doc.verification_notes}&rdquo;
                </p>
              )}

              {canVerify && rejectingId === doc.id && (
                <div className="pl-7 flex items-center gap-2">
                  <input
                    type="text"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Reason for rejection…"
                    maxLength={500}
                    className="flex-1 px-2.5 py-1.5 text-[11px] border border-rose-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-rose-400"
                  />
                  <button
                    type="button"
                    onClick={() => submitVerify(doc, "rejected", rejectNote.trim())}
                    disabled={busyId === doc.id || rejectNote.trim().length < 3}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              )}

              <ExtractionResult
                extraction={extractions[doc.id]}
                canVerify={canVerify}
                onRetry={() => retryExtraction(doc)}
                retrying={retryingIds.has(doc.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs text-rose-600 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {canUpload && (
        <div className="space-y-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className="px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-600 border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-brand-primary"
            >
              {UPLOADABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
            </select>

            {/* Document-vs-photo is a submission-method preference, not tied
                to any one type — a scanned CR copy and a phone photo of it
                are equally valid, so this stays a plain toggle rather than
                something the document type dictates. */}
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={uploadMode === "document"}
                onClick={() => setUploadMode("document")}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  uploadMode === "document" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500"
                }`}
              >
                {t("leaseDocuments.modeDocument")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={uploadMode === "photo"}
                onClick={() => setUploadMode("photo")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  uploadMode === "photo" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500"
                }`}
              >
                <Camera className="w-3 h-3" />
                {t("leaseDocuments.modePhoto")}
              </button>
            </div>
          </div>

          {uploadMode === "photo" && isTwoSided ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400">{t("leaseDocuments.twoSidedHint")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={frontInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  onChange={(e) => handleUpload(e, "front")}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => frontInputRef.current?.click()}
                  disabled={uploading}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 ${
                    hasSide("front")
                      ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                      : "text-brand-primary border-brand-primary/30 hover:bg-brand-primary/5"
                  }`}
                >
                  {hasSide("front") ? <Check className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                  {t("leaseDocuments.uploadFront")}
                </button>

                <input
                  ref={backInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  onChange={(e) => handleUpload(e, "back")}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => backInputRef.current?.click()}
                  disabled={uploading}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50 ${
                    hasSide("back")
                      ? "text-emerald-700 border-emerald-200 bg-emerald-50"
                      : "text-brand-primary border-brand-primary/30 hover:bg-brand-primary/5"
                  }`}
                >
                  {hasSide("back") ? <Check className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                  {t("leaseDocuments.uploadBack")}
                </button>

                {uploading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
              </div>
              <p className="text-[10px] text-slate-400">{t("leaseDocuments.photoHint")}</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={uploadMode === "photo" ? "image/jpeg,image/png" : "application/pdf,image/jpeg,image/png"}
                capture={uploadMode === "photo" ? "environment" : undefined}
                onChange={(e) => handleUpload(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/5 transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : uploadMode === "photo" ? (
                  <Camera className="w-3.5 h-3.5" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {uploading ? t("leaseDocuments.uploading") : t("leaseDocuments.upload")}
              </button>
              <p className="text-[10px] text-slate-400 basis-full">
                {uploadMode === "photo" ? t("leaseDocuments.photoHint") : t("leaseDocuments.uploadHint")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

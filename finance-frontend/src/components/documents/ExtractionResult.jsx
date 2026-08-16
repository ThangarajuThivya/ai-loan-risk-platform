import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldAlert,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";

/**
 * Renders the advisory OCR/extraction result for ONE document — shared by
 * LoanDocumentPanel and LeaseDocumentPanel (E1's loan and lease sides ask
 * for identical treatment here, so this lives outside both rather than
 * being copy-pasted twice).
 *
 * ADVISORY ONLY. Whatever the findings say — including a "blocker" severity
 * — this component never implies the document has been accepted or
 * rejected. The disclaimer below is not decoration: it's the one thing this
 * step's spec calls out by name. It only renders in the `canVerify` (staff)
 * context, since it addresses the reviewer directly ("you must still
 * verify or reject") — showing it to the applicant on their own upload
 * would be addressing the wrong audience.
 *
 * Translation policy (headline-level only, matching the rest of this
 * panel): UI labels, status/severity headings and field labels for the
 * fixed set of fields the extractors produce all go through i18n. The
 * document's own extracted VALUES (a name, an account number, a bank's
 * name...) and the validation findings' `message` text (composed
 * server-side from those values, in whatever language the source document
 * used) are rendered exactly as the API returned them — translating either
 * would mean silently rewriting evidence a reviewer is relying on.
 */

const STATUS_META = {
  pending: { icon: Clock, className: "bg-sky-50 text-sky-700 border-sky-200", key: "status_pending" },
  succeeded: {
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    key: "status_succeeded",
  },
  failed: { icon: XCircle, className: "bg-rose-50 text-rose-700 border-rose-200", key: "status_failed" },
  skipped: {
    icon: MinusCircle,
    className: "bg-slate-100 text-slate-500 border-slate-200",
    key: "status_skipped",
  },
};

const SEVERITY_META = {
  blocker: {
    icon: ShieldAlert,
    badgeClassName: "bg-rose-50 text-rose-800 border-rose-200",
    rowClassName: "bg-rose-50/70 border-rose-200",
    key: "severity_blocker",
  },
  warning: {
    icon: AlertTriangle,
    badgeClassName: "bg-amber-50 text-amber-800 border-amber-200",
    rowClassName: "bg-amber-50/70 border-amber-200",
    key: "severity_warning",
  },
  info: {
    icon: Info,
    badgeClassName: "bg-slate-100 text-slate-600 border-slate-200",
    rowClassName: "bg-slate-50 border-slate-200",
    key: "severity_info",
  },
};

const SEVERITY_ORDER = ["blocker", "warning", "info"];

/** snake_case / camelCase -> "Title Case", used only as a fallback when a field has no translated label. */
function humanizeKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// Parse-metadata keys that are noise to a reviewer rather than a fact about
// the document — never shown, translated or not.
const HIDDEN_SUBKEYS = new Set(["valid", "errors", "format"]);

export default function ExtractionResult({ extraction, canVerify = false, onRetry, retrying = false }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const fieldLabel = (key) => {
    const translated = t(`documentExtraction.field_${key}`, { defaultValue: "" });
    return translated || humanizeKey(key);
  };

  const renderValue = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
    if (typeof value === "object") {
      const parts = Object.entries(value)
        .filter(([k, v]) => !HIDDEN_SUBKEYS.has(k) && v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${fieldLabel(k)}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      return parts.length ? parts.join(" · ") : "—";
    }
    return String(value);
  };

  if (extraction?.loading && !extraction?.data) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pl-7 pt-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t("documentExtraction.loading")}
      </div>
    );
  }

  if (extraction?.error) {
    return (
      <p className="text-[10px] text-slate-400 pl-7 pt-1 italic">{t("documentExtraction.loadError")}</p>
    );
  }

  const data = extraction?.data;
  if (!data) return null;

  const status = STATUS_META[data.extraction_status] || STATUS_META.pending;
  const StatusIcon = status.icon;
  const fields = Object.entries(data.extracted_fields || {}).filter(
    ([, v]) => v !== null && v !== undefined
  );
  const findings = data.validation_findings || [];
  const severityCounts = SEVERITY_ORDER.map((sev) => ({
    sev,
    count: findings.filter((f) => f.severity === sev).length,
  })).filter((s) => s.count > 0);
  const sortedFindings = [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  return (
    <div className="pl-7">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex flex-wrap items-center gap-1.5 py-1"
      >
        <Sparkles className="w-3 h-3 text-slate-400 shrink-0" />
        <span className="text-[10px] font-semibold text-slate-500">
          {t("documentExtraction.title")}
        </span>
        <span
          className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${status.className}`}
        >
          <StatusIcon className="w-2.5 h-2.5" />
          {t(`documentExtraction.${status.key}`)}
        </span>
        {typeof data.confidence_score === "number" && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-white text-slate-500 border-slate-200">
            {t("documentExtraction.confidence")}: {Math.round(data.confidence_score * 100)}%
          </span>
        )}
        {severityCounts.map(({ sev, count }) => {
          const meta = SEVERITY_META[sev];
          const Icon = meta.icon;
          return (
            <span
              key={sev}
              className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${meta.badgeClassName}`}
            >
              <Icon className="w-2.5 h-2.5" />
              {count} {t(`documentExtraction.${meta.key}`)}
            </span>
          );
        })}
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-slate-400" />
        ) : (
          <ChevronDown className="w-3 h-3 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2.5 pb-2 pt-1">
          {canVerify && (
            <p className="flex items-start gap-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
              <Info className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
              {t("documentExtraction.disclaimer")}
            </p>
          )}

          {/* A 'failed' status means the document was never actually read —
              nothing to do with what fields it does or doesn't contain, and
              nothing to do with which language it's in. Surfacing that
              plainly here, with a way to try again, replaces a generic "no
              fields found" message that was easy to misread as an
              extraction-quality problem when it was really recognition
              never completing at all. */}
          {data.extraction_status === "failed" && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-2">
              <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
              <p className="text-[10px] text-rose-700 flex-1">
                {t("documentExtraction.recognitionFailedExplain")}
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-rose-700 bg-white border border-rose-300 rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50 shrink-0"
                >
                  {retrying ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {retrying ? t("documentExtraction.retrying") : t("documentExtraction.retry")}
                </button>
              )}
            </div>
          )}

          {data.extraction_status === "skipped" && (
            <p className="flex items-start gap-1.5 text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
              <MinusCircle className="w-3 h-3 shrink-0 mt-0.5 text-slate-400" />
              {t("documentExtraction.recognitionSkippedExplain")}
            </p>
          )}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
              {t("documentExtraction.fieldsTitle")}
            </p>
            {fields.length === 0 ? (
              // 'failed' and 'skipped' already have their own explanation in
              // the banners above — repeating "no fields" underneath them
              // would read as a second, different-sounding excuse for the
              // same thing.
              ["succeeded", "pending"].includes(data.extraction_status) && (
                <p className="text-[10px] text-slate-400">
                  {data.extraction_status === "succeeded"
                    ? t("documentExtraction.noFields")
                    : t("documentExtraction.loading")}
                </p>
              )
            ) : (
              <ul className="space-y-1">
                {fields.map(([key, field]) => (
                  <li key={key} className="flex items-start justify-between gap-2 text-[11px]">
                    <span className="text-slate-500 shrink-0">{fieldLabel(key)}</span>
                    <span className="text-slate-800 font-medium text-right break-words">
                      {renderValue(field?.value)}
                      {typeof field?.confidence === "number" && (
                        <span className="ml-1.5 text-[9px] font-normal text-slate-400">
                          ({Math.round(field.confidence * 100)}%)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
              {t("documentExtraction.findingsTitle")}
            </p>
            {sortedFindings.length === 0 ? (
              <p className="text-[10px] text-slate-400">{t("documentExtraction.noFindings")}</p>
            ) : (
              <ul className="space-y-1.5">
                {sortedFindings.map((finding, idx) => {
                  const meta = SEVERITY_META[finding.severity] || SEVERITY_META.info;
                  const Icon = meta.icon;
                  return (
                    <li
                      key={`${finding.code}-${idx}`}
                      className={`flex items-start gap-1.5 text-[11px] border rounded-lg px-2.5 py-1.5 ${meta.rowClassName}`}
                    >
                      <Icon className="w-3 h-3 shrink-0 mt-0.5" />
                      <span className="text-slate-700">
                        {/* Server-composed, quoting the document's own values — left exactly as returned, not run through i18n. */}
                        {finding.message}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

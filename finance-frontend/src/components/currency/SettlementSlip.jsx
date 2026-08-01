import { useTranslation } from "react-i18next";
import { PURPOSE_CODE_OPTIONS, STATUS_META } from "../../constants/fxExchange";

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

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const formatLkr = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function Row({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-dashed border-slate-200 text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

/**
 * Printable settlement slip — hidden on screen (`hidden print:block`),
 * rendered only by the browser's print output. The bank workflow this
 * feature implements has no in-app settlement (§9.6 — settlement happens
 * physically at a branch); this is the paper the customer takes there.
 * Not a receipt of money moved — the amounts here are what was quoted and
 * requested, matching fx_exchange_requests, not a ledger entry.
 */
export default function SettlementSlip({ request }) {
  const { t } = useTranslation();
  if (!request) return null;

  const purposeLabel =
    PURPOSE_CODE_OPTIONS.find((p) => p.value === request.purpose_code)?.label || request.purpose_code;
  const statusLabel = STATUS_META[request.status]?.label || request.status;

  return (
    <div className="hidden print:block text-slate-900 p-8">
      <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4 mb-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider">
            {t("customer.settlementSlip.title")}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">{t("customer.settlementSlip.subtitle")}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">
            {t("customer.settlementSlip.reference")}
          </p>
          <p className="font-mono text-lg font-bold">{request.reference_no}</p>
        </div>
      </div>

      <Row label={t("customer.settlementSlip.status")} value={statusLabel} />
      <Row
        label={request.direction === "buy" ? t("customer.settlementSlip.buying") : t("customer.settlementSlip.selling")}
        value={`${Number(request.foreign_amount).toLocaleString()} ${request.currency_code}`}
        mono
      />
      <Row
        label={t("customer.settlementSlip.exactRate")}
        value={`${formatRate(request.quoted_rate)} LKR / ${request.currency_code}`}
        mono
      />
      <Row label={t("customer.settlementSlip.spreadApplied")} value={`${(request.spread_bps_applied / 100).toFixed(2)}%`} mono />
      <Row label={t("customer.settlementSlip.lkrAmount")} value={formatLkr(request.quoted_lkr_amount)} mono />
      <Row label={t("customer.settlementSlip.purpose")} value={purposeLabel} />
      <Row label={t("customer.settlementSlip.branch")} value={request.branch} />
      <Row label={t("customer.settlementSlip.settlementDate")} value={formatDate(request.settlement_date)} />
      <Row label={t("customer.settlementSlip.submittedAt")} value={formatDateTime(request.created_at)} />

      <p className="text-[10px] text-slate-500 leading-relaxed mt-4">
        {t("customer.settlementSlip.disclaimer")}
      </p>

      <div className="flex items-end justify-between mt-10 pt-4">
        <div className="w-56">
          <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">
            {t("customer.settlementSlip.staffSignature")}
          </div>
        </div>
        <div className="w-40">
          <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">
            {t("customer.settlementSlip.branchStamp")}
          </div>
        </div>
      </div>

      <p className="text-[9px] text-slate-400 mt-6">
        {t("customer.settlementSlip.printedAt", { time: formatDateTime(new Date().toISOString()) })}
      </p>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CreditCard,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  FileDown,
  ShieldCheck,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import { formatCurrency, formatDate } from "../../pages/customer/dashboardFormat";

/**
 * Customer-facing repayment (040).
 *
 * Every amount shown here comes from GET /repayment-options — this component
 * deliberately computes NOTHING. The instalment figure, the settlement quote
 * and the outstanding balance are all decided server-side from the schedule,
 * and the Pay request sends only a `kind`. A tampered client can therefore
 * pick a different kind of payment but can never change what it is charged;
 * see repaymentQuote.service.js.
 *
 * The custom-amount field is the one exception, and even it is only a bounded
 * REQUEST: the server re-validates it against the real outstanding balance and
 * rejects an overpayment before any card is charged.
 */

const KINDS = { INSTALLMENT: "installment", SETTLEMENT: "settlement", CUSTOM: "custom" };

export default function RepaymentPanel({ applicationId, refreshKey = 0 }) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customError, setCustomError] = useState("");
  const [payments, setPayments] = useState([]);

  // `refreshKey` is bumped by the dashboard once a returning payment has
  // settled, so the panel re-reads the new balance without needing to know
  // anything about redirects or query strings.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        // The options and the payment history are always read together —
        // fetching them apart would just be two renders of the same view.
        const [opts, pmts] = await Promise.all([
          api.get(`/loans/${applicationId}/repayment-options`),
          api.get(`/loans/${applicationId}/payments`),
        ]);
        if (cancelled) return;
        setOptions(opts.data);
        setPayments(pmts.data?.payments || []);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || t("customer.repayment.loadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applicationId, refreshKey, t]);

  const startPayment = async (kind) => {
    if (paying) return;
    setCustomError("");

    if (kind === KINDS.CUSTOM) {
      const value = Number(customAmount);
      // Mirrored client-side purely for instant feedback — the server is the
      // authority and re-checks both bounds.
      if (!Number.isFinite(value) || value <= 0) {
        setCustomError(t("customer.repayment.customInvalid"));
        return;
      }
      if (value > Number(options?.outstanding?.total || 0)) {
        setCustomError(
          t("customer.repayment.customTooLarge", {
            amount: formatCurrency(options?.outstanding?.total),
          })
        );
        return;
      }
      if (value < Number(options?.min_payment || 0)) {
        setCustomError(
          t("customer.repayment.customTooSmall", {
            amount: formatCurrency(options?.min_payment),
          })
        );
        return;
      }
    }

    setPaying(kind);
    try {
      const res = await api.post(`/loans/${applicationId}/payments/checkout`, {
        kind,
        amount: kind === KINDS.CUSTOM ? Number(customAmount) : undefined,
      });
      // Hand off to the gateway's hosted page. No card data ever passes
      // through this app.
      window.location.assign(res.data.checkout_url);
    } catch (err) {
      setPaying("");
      showToast({
        type: "error",
        title: t("customer.repayment.payFailedTitle"),
        message: err.response?.data?.message || t("customer.repayment.payFailedDefault"),
      });
    }
  };

  const downloadReceipt = async (payment) => {
    try {
      const res = await api.get(
        `/loans/${applicationId}/payments/${payment.payment_id}/receipt.pdf`,
        { responseType: "blob" }
      );
      const blobUrl = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `receipt-${payment.reference_no || payment.payment_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch {
      showToast({
        type: "error",
        title: t("customer.repayment.receiptFailedTitle"),
        message: t("customer.repayment.receiptFailedDefault"),
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("customer.repayment.loading")}
      </div>
    );
  }
  if (error) {
    return <p className="text-xs text-rose-600 py-2">{error}</p>;
  }
  if (!options) return null;

  const busy = Boolean(paying);
  const canPay = options.payable && options.gateway_available;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
      <h6 className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
        <CreditCard className="w-3.5 h-3.5" /> {t("customer.repayment.heading")}
      </h6>

      {!options.payable && (
        <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {t("customer.repayment.nothingOwed")}
        </p>
      )}

      {options.payable && !options.gateway_available && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {t("customer.repayment.gatewayUnavailable")}
        </p>
      )}

      {/* Dust sitting on the very last instalment, with no following row for
          the server to roll it into (see repaymentQuote.service's
          nextInstallmentDue). Shown as a fact rather than a button certain
          to come back as a 409 — a card gateway will not process a few
          rupees, and this is the one case the server's own roll-forward
          cannot fix. */}
      {canPay &&
        options.next_installment &&
        !options.next_installment.through_installment_no &&
        options.next_installment.amount < (options.min_payment || 100) && (
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            {t("customer.repayment.tooSmallToPayOnline", {
              amount: formatCurrency(options.next_installment.amount),
            })}
          </p>
        )}

      {canPay && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {options.next_installment &&
              (options.next_installment.through_installment_no ||
                options.next_installment.amount >= (options.min_payment || 100)) && (
                <PayOption
                  label={
                    options.next_installment.through_installment_no
                      ? t("customer.repayment.nextInstallmentRangeLabel", {
                          from: options.next_installment.installment_no,
                          through: options.next_installment.through_installment_no,
                        })
                      : t("customer.repayment.nextInstallmentLabel", {
                          no: options.next_installment.installment_no,
                        })
                  }
                  sub={
                    options.next_installment.through_installment_no
                      ? t("customer.repayment.installmentRolledForwardHint", {
                          no: options.next_installment.installment_no,
                          through: options.next_installment.through_installment_no,
                        })
                      : t("customer.repayment.dueOn", {
                          date: formatDate(options.next_installment.due_date),
                        })
                  }
                  amount={options.next_installment.amount}
                  cta={t("customer.repayment.payCta")}
                  busy={paying === KINDS.INSTALLMENT}
                  disabled={busy}
                  onClick={() => startPayment(KINDS.INSTALLMENT)}
                />
              )}
            {options.settlement && (
              <PayOption
                label={t("customer.repayment.settlementLabel")}
                sub={
                  options.settlement.interestWaived > 0
                    ? t("customer.repayment.settlementSaving", {
                        amount: formatCurrency(options.settlement.interestWaived),
                      })
                    : t("customer.repayment.settlementSub")
                }
                amount={options.settlement.total}
                cta={t("customer.repayment.settleCta")}
                accent
                busy={paying === KINDS.SETTLEMENT}
                disabled={busy}
                onClick={() => startPayment(KINDS.SETTLEMENT)}
              />
            )}
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2">
            <label className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">
              {t("customer.repayment.customLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setCustomError("");
                }}
                placeholder={t("customer.repayment.customPlaceholder")}
                className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary"
              />
              <button
                type="button"
                onClick={() => startPayment(KINDS.CUSTOM)}
                disabled={busy || !customAmount}
                className="px-3 py-1.5 text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/90 rounded-lg disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                {paying === KINDS.CUSTOM && <Loader2 className="w-3 h-3 animate-spin" />}
                {t("customer.repayment.payCta")}
              </button>
            </div>
            {customError && <p className="text-[10px] text-rose-600">{customError}</p>}
            <p className="text-[10px] text-slate-400">
              {t("customer.repayment.outstandingHint", {
                amount: formatCurrency(options.outstanding?.total),
              })}
            </p>
          </div>

          <p className="text-[10px] text-slate-400 flex items-start gap-1.5">
            <ShieldCheck className="w-3 h-3 shrink-0 mt-0.5" />
            {t("customer.repayment.securityNote")}
          </p>
        </>
      )}

      {payments.length > 0 && (
        <div className="pt-2 space-y-1.5">
          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
            {t("customer.repayment.historyHeading")}
          </p>
          <ul className="space-y-1">
            {payments.map((p) => (
              <li
                key={p.payment_id}
                className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-100 rounded-lg px-2.5 py-1.5"
              >
                <span className="min-w-0">
                  <span className="font-mono font-bold text-slate-700">
                    {formatCurrency(p.amount)}
                  </span>
                  <span className="text-slate-400">
                    {" · "}
                    {formatDate(p.paid_on)}
                    {" · "}
                    {p.reference_no}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => downloadReceipt(p)}
                  className="flex items-center gap-1 text-brand-primary hover:underline font-semibold shrink-0"
                >
                  <FileDown className="w-3 h-3" /> {t("customer.repayment.receiptCta")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PayOption({ label, sub, amount, cta, accent, busy, disabled, onClick }) {
  return (
    <div
      className={`rounded-xl border p-3 flex flex-col gap-2 ${
        accent ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white"
      }`}
    >
      <div>
        <p className="text-[11px] font-bold text-slate-700">{label}</p>
        <p className="text-[10px] text-slate-400">{sub}</p>
      </div>
      <p className="text-base font-bold font-mono text-slate-900">{formatCurrency(amount)}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full px-3 py-1.5 text-xs font-bold rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5 ${
          accent
            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
            : "bg-brand-primary hover:bg-brand-primary/90 text-white"
        }`}
      >
        {busy && <Loader2 className="w-3 h-3 animate-spin" />}
        {cta}
      </button>
    </div>
  );
}

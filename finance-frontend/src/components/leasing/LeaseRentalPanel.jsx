import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CreditCard,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  Table2,
  Receipt,
  Info,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

/**
 * The lessee paying their own rentals (L10).
 *
 * Every amount shown here comes from GET /leases/:id/rentals/options — this
 * component computes NOTHING. The rental figure, the arrears total and the
 * settlement quote are all decided server-side from the schedule and the
 * ledger, and the Pay request sends only a `kind`. A tampered client can
 * pick a different kind of payment but can never change what it is charged.
 *
 * The custom-amount field is the one exception, and even it is a bounded
 * REQUEST: the server re-validates it against the real outstanding balance,
 * and again inside the settlement transaction, before any card is charged.
 *
 * WHY SETTLEMENT IS ITS OWN BUTTON rather than a number you could type into
 * the custom box: settling costs LESS than the remaining rentals, because
 * the unearned finance charge is rebated. Reaching that price by typing it
 * would buy a part payment, not a discharge — so the discount has to be an
 * act the server recognises, not an amount the client guesses.
 */

const lkr = (v) =>
  v === null || v === undefined
    ? "—"
    : `LKR ${Number(v).toLocaleString("en-LK", { maximumFractionDigits: 2 })}`;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" }) : "—";
const humanize = (s) => String(s || "").replace(/_/g, " ");

/**
 * Mirrors leaseRentalQuote.service's MIN_PAYMENT. The server is the real
 * authority — this only pre-empts a click that is certain to come back as a
 * 409, on the one case the server's own roll-forward cannot fix: dust
 * sitting on the very last rental of the schedule, with no following row to
 * combine it into.
 */
const MIN_ONLINE_PAYMENT = 100;

function Figure({ label, value, hint, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    rose: "text-rose-700",
    emerald: "text-emerald-700",
  };
  return (
    <div>
      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{label}</p>
      <p className={`font-mono font-bold ${tones[tone]}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export default function LeaseRentalPanel({
  applicationId,
  onShowSchedule,
  refreshKey = 0,
  showSummary = true,
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customError, setCustomError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api.get(`/leases/${applicationId}/rentals/options`);
      setOptions(res.data);
    } catch (err) {
      setError(err.response?.data?.message || t("customer.leaseRentals.loadError"));
    } finally {
      setLoading(false);
    }
  }, [applicationId, t]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load, refreshKey]);

  const startPayment = async (kind) => {
    if (paying) return;
    setCustomError("");

    if (kind === "custom") {
      const amount = Number(customAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setCustomError(t("customer.leaseRentals.enterAmount"));
        return;
      }
      if (amount > options.maxPayment) {
        setCustomError(
          t("customer.leaseRentals.tooMuch", { max: lkr(options.maxPayment) })
        );
        return;
      }
    }

    setPaying(kind);
    try {
      const res = await api.post(`/leases/${applicationId}/rentals/checkout`, {
        kind,
        ...(kind === "custom" ? { amount: Number(customAmount) } : {}),
      });
      // Leaving the app entirely — no state to clean up, and the return
      // trip reconciles through the status endpoint.
      window.location.assign(res.data.checkout_url);
    } catch (err) {
      setPaying("");
      showToast({
        type: "error",
        title: t("customer.leaseRentals.paymentFailedTitle"),
        message: err.response?.data?.message || t("customer.leaseRentals.paymentFailed"),
      });
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <p className="text-xs text-rose-600 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </p>
      </div>
    );
  }

  // No agreement yet — rentals begin once the vehicle is registered to us.
  if (!options || options.agreement_no === undefined) {
    return null;
  }

  const {
    payable,
    gateway_available: gatewayAvailable,
    nextRental,
    arrears,
    settlement,
    outstanding,
    received,
    rentalsPaid,
    rentalsTotal,
    monthly_rental: monthlyRental,
    rentals = [],
    agreement_status: agreementStatus,
  } = options;

  const busy = Boolean(paying);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" /> {t("customer.leaseRentals.title")}
        </h2>
        {onShowSchedule && (
          <button
            type="button"
            onClick={onShowSchedule}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-brand-primary"
          >
            <Table2 className="w-3.5 h-3.5" />
            {t("customer.leaseRentals.viewSchedule")}
          </button>
        )}
      </div>

      {/* Suppressed on the lease page, where the dashboard tiles overhead
          already carry these exact four figures — printing them twice, one
          card apart, is how two copies of "what do I owe?" end up
          disagreeing. Kept for any surface that renders this panel on its
          own. */}
      {showSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Figure label={t("customer.leaseRentals.monthlyRental")} value={lkr(monthlyRental)} />
          <Figure
            label={t("customer.leaseRentals.paidSoFar")}
            value={`${rentalsPaid} / ${rentalsTotal}`}
            hint={lkr(received)}
          />
          <Figure
            label={t("customer.leaseRentals.outstanding")}
            value={lkr(outstanding)}
            tone={outstanding > 0 ? "slate" : "emerald"}
          />
          <Figure
            label={t("customer.leaseRentals.nextDue")}
            value={nextRental ? fmtDate(nextRental.dueDate) : "—"}
            hint={
              nextRental
                ? nextRental.throughRentalNo
                  ? t("customer.leaseRentals.rentalRange", {
                      from: nextRental.rentalNo,
                      through: nextRental.throughRentalNo,
                    })
                  : `${t("customer.leaseRentals.rentalNo")} ${nextRental.rentalNo}`
                : undefined
            }
          />
        </div>
      )}

      {arrears && (
        <p className="flex items-start gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {t("customer.leaseRentals.arrearsWarning", {
            count: arrears.count,
            amount: lkr(arrears.amount),
            since: fmtDate(arrears.oldestDueDate),
          })}
        </p>
      )}

      {!payable && (
        <p className="flex items-start gap-2 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {agreementStatus === "active"
            ? t("customer.leaseRentals.allPaid")
            : t("customer.leaseRentals.notPayable", { status: humanize(agreementStatus) })}
        </p>
      )}

      {payable && !gatewayAvailable && (
        <p className="flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {t("customer.leaseRentals.gatewayDown")}
        </p>
      )}

      {payable && gatewayAvailable && (
        <div className="space-y-3">
          {/* Dust sitting on the very last rental, with no following row for
              the server to roll it into — the one case its own roll-forward
              cannot fix. Shown as a fact, not a clickable button that is
              certain to come back as a 409. */}
          {nextRental && !nextRental.throughRentalNo && nextRental.amount < MIN_ONLINE_PAYMENT && (
            <p className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("customer.leaseRentals.tooSmallToPayOnline", { amount: lkr(nextRental.amount) })}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {nextRental && nextRental.amount >= MIN_ONLINE_PAYMENT && (
              <button
                type="button"
                onClick={() => startPayment("rental")}
                disabled={busy}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-brand-primary/30 bg-brand-primary/5 hover:bg-brand-primary/10 transition-colors disabled:opacity-50 text-left"
              >
                <span>
                  <span className="block text-xs font-bold text-slate-800">
                    {nextRental.throughRentalNo
                      ? t("customer.leaseRentals.payRentalRange", {
                          from: nextRental.rentalNo,
                          through: nextRental.throughRentalNo,
                        })
                      : t("customer.leaseRentals.payRental", { no: nextRental.rentalNo })}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {nextRental.throughRentalNo
                      ? t("customer.leaseRentals.rolledForwardHint", {
                          no: nextRental.rentalNo,
                          through: nextRental.throughRentalNo,
                        })
                      : nextRental.partiallyPaid
                        ? t("customer.leaseRentals.partiallyPaidHint", {
                            full: lkr(nextRental.rentalAmount),
                          })
                        : t("customer.leaseRentals.dueOn", { date: fmtDate(nextRental.dueDate) })}
                  </span>
                </span>
                <span className="font-mono font-bold text-sm text-brand-primary shrink-0">
                  {paying === "rental" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    lkr(nextRental.amount)
                  )}
                </span>
              </button>
            )}

            {arrears && (
              <button
                type="button"
                onClick={() => startPayment("arrears")}
                disabled={busy}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 transition-colors disabled:opacity-50 text-left"
              >
                <span>
                  <span className="block text-xs font-bold text-rose-800">
                    {t("customer.leaseRentals.clearArrears")}
                  </span>
                  <span className="block text-[10px] text-rose-600">
                    {t("customer.leaseRentals.arrearsCount", { count: arrears.count })}
                  </span>
                </span>
                <span className="font-mono font-bold text-sm text-rose-700 shrink-0">
                  {paying === "arrears" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    lkr(arrears.amount)
                  )}
                </span>
              </button>
            )}
          </div>

          {settlement && settlement.amount > 0 && (
            <button
              type="button"
              onClick={() => startPayment("settlement")}
              disabled={busy}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition-colors disabled:opacity-50 text-left"
            >
              <span>
                <span className="block text-xs font-bold text-emerald-900">
                  {t("customer.leaseRentals.settleEarly")}
                </span>
                <span className="block text-[10px] text-emerald-700">
                  {t("customer.leaseRentals.settleHint", {
                    remaining: settlement.rentalsRemaining,
                    saving: lkr(settlement.saving),
                  })}
                </span>
              </span>
              <span className="font-mono font-bold text-sm text-emerald-800 shrink-0">
                {paying === "settlement" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  lkr(settlement.amount)
                )}
              </span>
            </button>
          )}

          <div className="border-t border-slate-100 pt-3">
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2">
              {t("customer.leaseRentals.payAnother")}
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1 min-w-[160px]">
                <input
                  type="number"
                  min="0"
                  step="any"
                  max={options.maxPayment}
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setCustomError("");
                  }}
                  placeholder={t("customer.leaseRentals.amountPlaceholder")}
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
                {customError && <p className="text-[10px] text-rose-600 mt-1">{customError}</p>}
              </div>
              <button
                type="button"
                onClick={() => startPayment("custom")}
                disabled={busy || !customAmount}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-primary hover:bg-brand-primary/90 disabled:opacity-50"
              >
                {paying === "custom" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CreditCard className="w-3.5 h-3.5" />
                )}
                {t("customer.leaseRentals.pay")}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              {t("customer.leaseRentals.maxHint", { max: lkr(options.maxPayment) })}
            </p>
          </div>
        </div>
      )}

      {rentals.length > 0 && (
        <div className="border-t border-slate-100 pt-4">
          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
            <Receipt className="w-3 h-3" /> {t("customer.leaseRentals.history")}
          </p>
          <ul className="space-y-1.5">
            {rentals.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 text-[11px]">
                <span className="text-slate-500">
                  {fmtDate(r.paid_on)} · {humanize(r.method)}
                  {r.rental_type === "settlement" && (
                    <span className="ml-1.5 text-emerald-700 font-semibold">
                      · {t("customer.leaseRentals.settlementTag")}
                    </span>
                  )}
                  {r.reference_no ? ` · ${r.reference_no}` : ""}
                </span>
                <span className="font-mono text-slate-700 shrink-0">{lkr(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

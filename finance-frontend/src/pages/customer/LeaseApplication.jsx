import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Car,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";

/**
 * Apply for a vehicle lease.
 *
 * A single page rather than a multi-step wizard, unlike the loan form. A
 * lease asks for far less — the vehicle and the term — because the applicant
 * profile already holds everything the risk model needs, and the vehicle's
 * price and the amount financed only make sense side by side.
 *
 * THE DOWN PAYMENT IS NOT A FIELD. It is the gap between the vehicle price
 * and the amount being financed, shown live so that relationship is visible
 * while typing. The server derives it the same way, so the two cannot
 * disagree.
 */

// Mirrors MIN_DOWN_PAYMENT_PERCENT in the backend's leasing.service.js.
// Duplicated deliberately: this drives feedback on every keystroke, and a
// round trip per character to say "that is too little" would be worse than a
// constant that could drift. The SERVER remains the authority and re-checks.
const MIN_DOWN_PAYMENT_PERCENT = { brand_new: 20, reconditioned: 25, used: 30 };

// Labels/hints resolved via t() at render time (see CONDITIONS usage below) —
// the array only fixes the ORDER and the canonical `value` sent to the
// server, which must stay in English regardless of UI language.
const CONDITION_KEYS = [
  { value: "brand_new", labelKey: "conditionBrandNew", hintKey: "conditionBrandNewHint" },
  { value: "reconditioned", labelKey: "conditionReconditioned", hintKey: "conditionReconditionedHint" },
  { value: "used", labelKey: "conditionUsed", hintKey: "conditionUsedHint" },
];

const FUEL_TYPES = ["petrol", "diesel", "hybrid", "electric", "other"];
const TRANSMISSIONS = ["manual", "automatic"];

const lkr = (v) => `LKR ${Number(v || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

function Field({ label, optional, optionalLabel, hint, children }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="block text-xs font-semibold text-slate-700">{label}</label>
        {optional && (
          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-mono">
            {optionalLabel}
          </span>
        )}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

const inputClass =
  "w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary";

export default function LeaseApplication() {
  const { t } = useTranslation();
  // Every string this page owns lives under one namespace — shortened here
  // so ~50 call sites don't each repeat "customer.leaseApplication.".
  // useCallback (not a plain function) so its identity only changes when `t`
  // does — the consent-loading effect below depends on it, and a fresh
  // function reference every render would make that effect refire every
  // render too.
  const lt = useCallback((key, params) => t(`customer.leaseApplication.${key}`, params), [t]);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [products, setProducts] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [productId, setProductId] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [financedAmount, setFinancedAmount] = useState("");

  const [condition, setCondition] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [chassisNo, setChassisNo] = useState("");
  const [engineNo, setEngineNo] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [transmission, setTransmission] = useState("");
  const [mileageKm, setMileageKm] = useState("");
  const [invoicePrice, setInvoicePrice] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  // Consent (J1). The server refuses /leases/apply with a 403 until these
  // are granted — the SAME gate the loan path enforces, because a lease is
  // underwritten by the same model against the same personal data. This page
  // previously had no consent step at all, so a customer who had never
  // applied for a loan could never submit a lease application: the form was
  // valid, and the server rejected it every time with nothing on screen to
  // act on.
  const [consentPolicies, setConsentPolicies] = useState([]);
  const [missingConsents, setMissingConsents] = useState([]);
  const [consentChecks, setConsentChecks] = useState({});
  const [consentError, setConsentError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, d, policies, status] = await Promise.all([
          api.get("/leases/products"),
          api.get("/leases/dealers").catch(() => ({ data: { dealers: [] } })),
          api.get("/consents/policies").catch(() => null),
          api.get("/consents/status").catch(() => null),
        ]);
        if (cancelled) return;
        const list = p.data?.products || [];
        setProducts(list);
        if (list.length) setProductId(String(list[0].id));
        setDealers(d.data?.dealers || []);

        // A failure to read consent state is NOT treated as "nothing is
        // missing" — that would re-hide the gate and put us back to a form
        // that submits and 403s. It surfaces as an error instead.
        if (policies && status) {
          setConsentPolicies(policies.data?.policies || []);
          setMissingConsents(status.data?.missing || []);
        } else {
          setConsentError(lt("consentLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lt]);

  const toggleConsentCheck = (consentType) =>
    setConsentChecks((prev) => ({ ...prev, [consentType]: !prev[consentType] }));

  const allConsentsChecked = missingConsents.every((type) => consentChecks[type]);

  const product = products.find((p) => String(p.id) === productId);
  const minDownPercent = MIN_DOWN_PAYMENT_PERCENT[condition] ?? 30;

  const down = useMemo(() => {
    const price = Number(invoicePrice);
    const financed = Number(financedAmount);
    if (!invoicePrice || !financedAmount || !(price > financed)) return null;
    const amount = Number((price - financed).toFixed(2));
    const percent = Number(((amount / price) * 100).toFixed(2));
    return { amount, percent, ok: percent >= minDownPercent };
  }, [invoicePrice, financedAmount, minDownPercent]);

  const amountInRange =
    !product ||
    financedAmount === "" ||
    (Number(financedAmount) >= Number(product.min_financed_amount) &&
      Number(financedAmount) <= Number(product.max_financed_amount));
  const termInRange =
    !product ||
    termMonths === "" ||
    (Number(termMonths) >= product.min_term_months && Number(termMonths) <= product.max_term_months);

  const canSubmit = Boolean(
    productId &&
      financedAmount &&
      termMonths &&
      amountInRange &&
      termInRange &&
      condition &&
      make.trim() &&
      model.trim() &&
      year &&
      invoicePrice &&
      (condition !== "used" || registrationNo.trim()) &&
      down?.ok &&
      // Unchecked consent disables Submit rather than letting the click go
      // to a server that will only refuse it.
      (missingConsents.length === 0 || allConsentsChecked) &&
      !submitting
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      // Grant anything still outstanding first — the apply call 403s
      // otherwise. Consents already current are not resent.
      if (missingConsents.length) {
        const grantRes = await api.post("/consents", {
          consents: missingConsents.map((type) => ({
            consent_type: type,
            policy_version: consentPolicies.find((p) => p.consent_type === type)?.version,
          })),
        });
        setMissingConsents(grantRes.data?.missing || []);
      }

      const res = await api.post("/leases/apply", {
        product_id: Number(productId),
        financed_amount: Number(financedAmount),
        term_months: Number(termMonths),
        vehicle: {
          supplier_id: supplierId ? Number(supplierId) : undefined,
          condition_type: condition,
          make: make.trim(),
          model: model.trim(),
          year_of_manufacture: Number(year),
          registration_no: registrationNo.trim() || undefined,
          chassis_no: chassisNo.trim() || undefined,
          engine_no: engineNo.trim() || undefined,
          fuel_type: fuelType || undefined,
          transmission: transmission || undefined,
          mileage_km: mileageKm !== "" ? Number(mileageKm) : undefined,
          invoice_price: Number(invoicePrice),
          invoice_no: invoiceNo.trim() || undefined,
          invoice_date: invoiceDate || undefined,
        },
      });
      setResult(res.data);
    } catch (err) {
      setSubmitError(err.response?.data?.message || lt("submitErrorDefault"));
      showToast({
        type: "error",
        title: lt("submitFailedToastTitle"),
        message: err.response?.data?.message || lt("submitFailedToastDefault"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
            <Car className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t("customer.leasing.eyebrow")}</p>
            <h1 className="text-lg font-bold text-slate-800">{t("customer.leasing.applyTitle")}</h1>
          </div>
        </div>

        <div className="flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-[11px] text-slate-500">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
{t("customer.leasing.ownershipNote")}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* --- Facility ------------------------------------------------ */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">
              {lt("facilityHeading")}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Field label={lt("leaseProductLabel")}>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className={`${inputClass} bg-white`}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({Number(p.interest_rate).toFixed(2)}% {p.rate_type})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={lt("amountToFinanceLabel")}
                hint={
                  product
                    ? `${Number(product.min_financed_amount).toLocaleString("en-LK")} – ${Number(
                        product.max_financed_amount
                      ).toLocaleString("en-LK")}`
                    : undefined
                }
              >
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={financedAmount}
                  onChange={(e) => setFinancedAmount(e.target.value)}
                  placeholder={lt("amountPlaceholder")}
                  className={`${inputClass} ${amountInRange ? "" : "border-rose-300"}`}
                />
              </Field>
              <Field
                label={lt("termMonthsLabel")}
                hint={product ? `${product.min_term_months} – ${product.max_term_months}` : undefined}
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                  placeholder={lt("termPlaceholder")}
                  className={`${inputClass} ${termInRange ? "" : "border-rose-300"}`}
                />
              </Field>
            </div>
          </div>

          {/* --- Vehicle -------------------------------------------------- */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">
              {lt("vehicleHeading")}
            </h2>

            <Field label={lt("conditionLabel")}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CONDITION_KEYS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCondition(c.value)}
                    className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                      condition === c.value
                        ? "bg-brand-primary text-white border-brand-primary"
                        : "bg-white text-slate-700 border-slate-200 hover:border-brand-primary"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{lt(c.labelKey)}</span>
                    <span
                      className={`block text-[10px] mt-0.5 ${
                        condition === c.value ? "text-white/80" : "text-slate-400"
                      }`}
                    >
                      {lt(c.hintKey)} · {lt("minDownSuffix", { percent: MIN_DOWN_PAYMENT_PERCENT[c.value] })}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label={lt("makeLabel")}>
                <input value={make} onChange={(e) => setMake(e.target.value)} maxLength={60} placeholder={lt("makePlaceholder")} className={inputClass} />
              </Field>
              <Field label={lt("modelLabel")}>
                <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} placeholder={lt("modelPlaceholder")} className={inputClass} />
              </Field>
              <Field label={lt("yearLabel")}>
                <input type="number" min="1950" max={new Date().getFullYear() + 1} step="1" value={year} onChange={(e) => setYear(e.target.value)} placeholder={lt("yearPlaceholder")} className={inputClass} />
              </Field>
              <Field label={lt("mileageLabel")} optional optionalLabel={lt("optionalBadge")}>
                <input type="number" min="0" step="any" value={mileageKm} onChange={(e) => setMileageKm(e.target.value)} className={inputClass} />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Field
                label={lt("registrationNoLabel")}
                optional={condition !== "used"}
                optionalLabel={lt("optionalBadge")}
                hint={condition === "used" ? lt("registrationRequiredHint") : undefined}
              >
                <input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} maxLength={20} placeholder="e.g. CAB-1234" className={inputClass} />
              </Field>
              <Field label={lt("chassisNoLabel")} optional optionalLabel={lt("optionalBadge")}>
                <input value={chassisNo} onChange={(e) => setChassisNo(e.target.value)} maxLength={50} className={inputClass} />
              </Field>
              <Field label={lt("engineNoLabel")} optional optionalLabel={lt("optionalBadge")}>
                <input value={engineNo} onChange={(e) => setEngineNo(e.target.value)} maxLength={50} className={inputClass} />
              </Field>
              {/* FUEL_TYPES/TRANSMISSIONS stay untranslated by design — the
                  same "canonical category values" policy CustomerProfile's
                  marital/education/occupation dropdowns follow. */}
              <Field label={lt("fuelTypeLabel")} optional optionalLabel={lt("optionalBadge")}>
                <select value={fuelType} onChange={(e) => setFuelType(e.target.value)} className={`${inputClass} bg-white`}>
                  <option value="">—</option>
                  {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              <Field label={lt("transmissionLabel")} optional optionalLabel={lt("optionalBadge")}>
                <select value={transmission} onChange={(e) => setTransmission(e.target.value)} className={`${inputClass} bg-white`}>
                  <option value="">—</option>
                  {TRANSMISSIONS.map((tr) => <option key={tr} value={tr}>{tr}</option>)}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label={lt("vehiclePriceLabel")} hint={lt("vehiclePriceHint")}>
                <input type="number" min="1" step="any" value={invoicePrice} onChange={(e) => setInvoicePrice(e.target.value)} placeholder={lt("vehiclePricePlaceholder")} className={inputClass} />
              </Field>
              <Field label={lt("dealerLabel")} optional optionalLabel={lt("optionalBadge")} hint={lt("dealerHint")}>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inputClass} bg-white`}>
                  <option value="">{lt("dealerPrivateOption")}</option>
                  {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label={lt("invoiceNoLabel")} optional optionalLabel={lt("optionalBadge")}>
                <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={50} className={inputClass} />
              </Field>
              <Field label={lt("invoiceDateLabel")} optional optionalLabel={lt("optionalBadge")}>
                <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputClass} />
              </Field>
            </div>
          </div>

          {/* --- Down payment, derived ------------------------------------ */}
          <div
            className={`rounded-2xl border px-5 py-4 ${
              !down
                ? "bg-slate-50 border-slate-100"
                : down.ok
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-amber-50 border-amber-200"
            }`}
          >
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">
              {lt("downPaymentHeading")}
            </p>
            {!down ? (
              <p className="text-sm text-slate-500">{lt("downPaymentEmptyHint")}</p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-bold font-mono text-slate-900">{lkr(down.amount)}</span>
                <span className="text-sm font-semibold text-slate-600">({down.percent}%)</span>
                <span className={`text-xs ${down.ok ? "text-emerald-700" : "text-amber-800"}`}>
                  {down.ok
                    ? lt("downPaymentMeetsMin", { percent: minDownPercent })
                    : lt("downPaymentBelowMin", { percent: minDownPercent })}
                </span>
              </div>
            )}
          </div>

          {/* Consent (J1). Only asks for what is actually missing or out of
              date — someone who already consented when applying for a loan
              sees nothing extra here, because it is the same grant. */}
          {missingConsents.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-3">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {lt("consentHeading")}
                </h2>
              </div>
              <p className="text-[11px] text-slate-500">{lt("consentIntro")}</p>
              {missingConsents.map((type) => {
                const policy = consentPolicies.find((p) => p.consent_type === type);
                return (
                  <label
                    key={type}
                    className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0"
                      checked={!!consentChecks[type]}
                      onChange={() => toggleConsentCheck(type)}
                    />
                    <span className="text-xs text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-800 block">
                        {policy ? t(policy.title_key) : type}
                      </span>
                      {policy && t(policy.body_key)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {consentError && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{consentError}</span>
            </div>
          )}

          {submitError && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-6 py-3 rounded-xl text-sm font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {submitting ? lt("submittingButton") : lt("submitButton")}
            </button>
          </div>
        </form>
      </div>

      {/* --- Result modal ------------------------------------------------- */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.18 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="bg-emerald-500 text-white p-2 rounded-full shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-base text-slate-900">
                      {lt("resultTitle")}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {lt("resultReference", { id: result.application_id })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/leases")}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 shrink-0"
                  aria-label={t("common.close")}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-6 py-5 space-y-4 overflow-y-auto text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{lt("resultMonthlyRental")}</p>
                    <p className="font-mono font-bold text-slate-800">{lkr(result.quote?.rental)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{lt("resultDownPayment")}</p>
                    <p className="font-mono font-bold text-slate-800">
                      {lkr(result.down_payment?.amount)} ({result.down_payment?.percent}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{lt("resultRate")}</p>
                    <p className="font-mono font-bold text-slate-800">
                      {lt("resultRateFlat", { rate: result.interest_rate })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">{lt("resultTerm")}</p>
                    <p className="font-mono font-bold text-slate-800">
                      {lt("resultTermMonths", { term: result.quote?.tenureMonths })}
                    </p>
                  </div>
                </div>

                {result.valuation_required && (
                  <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 text-xs text-sky-800">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {lt("resultValuationNote")}
                  </div>
                )}

                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                  {lt("resultIndicativeNote")}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/leases")}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-brand-primary text-white hover:bg-brand-primary/90"
                >
                  {lt("viewMyLeases")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

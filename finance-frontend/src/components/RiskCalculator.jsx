import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calculator,
  AlertTriangle,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
  Sparkles,
  Wallet,
  Percent,
  Loader2,
  Info,
  RotateCcw,
  X,
} from "lucide-react";

import api from "../api/axios";
import CreditPolicyPanel from "./CreditPolicyPanel";
import {
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  OCCUPATION_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  EMPLOYER_CATEGORY_OPTIONS,
} from "../constants/loanCategories";

const RISK_STYLES = {
  0: { badge: "bg-emerald-100 text-emerald-800 border-emerald-200", bar: "bg-emerald-500", icon: ShieldCheck, iconWrap: "bg-emerald-500" },
  1: { badge: "bg-amber-100 text-amber-800 border-amber-200", bar: "bg-amber-500", icon: ShieldQuestion, iconWrap: "bg-amber-500" },
  2: { badge: "bg-rose-100 text-rose-800 border-rose-200", bar: "bg-rose-500", icon: ShieldAlert, iconWrap: "bg-rose-500" },
};

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

// Form is split into tabs instead of one long scrolling column — this is a
// tool staff/admin run many times a day, so bounded height per screen beats
// a forced linear wizard (no next/back friction; submit works from any tab
// once the required "core" fields are filled).
const FORM_TABS = [
  { id: "core", label: "Applicant & Loan" },
  { id: "employment", label: "Employment & Background" },
  { id: "credit", label: "Credit & Guarantor" },
];

function YesNoField({ label, hint, value, onChange, yesLabel = "Yes", noLabel = "No" }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {hint && <p className="text-[11px] text-slate-400 mb-1.5">{hint}</p>}
      <div className="flex gap-2">
        {[
          { key: "yes", label: yesLabel },
          { key: "no", label: noLabel },
        ].map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`flex-1 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors ${
              value === opt.key
                ? "bg-brand-primary text-white border-brand-primary"
                : "bg-white text-slate-600 border-slate-200 hover:border-brand-primary"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options, placeholder, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <select
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step, placeholder, required }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <input
        type="number"
        required={required}
        min={min}
        max={max}
        // A plain <input type="number"> defaults to step="1", so a decimal
        // like an interest rate of 14.5 silently fails native HTML5
        // validation on submit — the browser blocks the form's submit event
        // entirely, with no visible error unless the field happens to be
        // focused when the browser draws its own validation tooltip. "any"
        // is the correct default here: none of this form's numeric fields
        // are meant to be constrained to whole numbers.
        step={step ?? "any"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
      />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      <input
        type="text"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
      />
    </div>
  );
}

function buildPayload(s) {
  return {
    age: Number(s.age),
    gender: s.gender,
    employment_type: s.employmentType,
    monthly_income: Number(s.monthlyIncome),
    monthly_expense: Number(s.monthlyExpense),
    requested_amount: Number(s.requestedAmount),
    tenure_months: Number(s.tenureMonths),
    interest_rate: Number(s.interestRate),
    purpose: s.purpose.trim() || undefined,
    marital_status: s.maritalStatus || undefined,
    education_level: s.educationLevel || undefined,
    occupation: s.occupation || undefined,
    employer_category: s.employerCategory || undefined,
    years_employed: s.yearsEmployed !== "" ? Number(s.yearsEmployed) : undefined,
    additional_income:
      s.hasAdditionalIncome === "yes"
        ? Number(s.additionalIncome || 0)
        : s.hasAdditionalIncome === "no"
          ? 0
          : undefined,
    existing_loans:
      s.hasExistingLoans === "yes"
        ? Number(s.existingLoans || 1)
        : s.hasExistingLoans === "no"
          ? 0
          : undefined,
    previous_defaults:
      s.hasPreviousDefaults === "yes"
        ? Number(s.previousDefaults || 1)
        : s.hasPreviousDefaults === "no"
          ? 0
          : undefined,
    crib_score:
      s.knowsCribScore === "yes" && s.cribScore !== "" ? Number(s.cribScore) : undefined,
    guarantor_exposure:
      s.isGuarantor === "yes"
        ? Number(s.guarantorExposure || 0)
        : s.isGuarantor === "no"
          ? 0
          : undefined,
    guarantor_defaults:
      s.isGuarantor === "yes"
        ? s.guarantorCalled === "yes"
          ? Number(s.guarantorDefaults || 1)
          : 0
        : s.isGuarantor === "no"
          ? 0
          : undefined,
  };
}

// Standalone risk calculator for admin/staff — the caller supplies the full
// applicant profile manually (no customer account required) and nothing is
// persisted. See POST /api/loans/manual-assess.
export default function RiskCalculator() {
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [monthlyExpense, setMonthlyExpense] = useState("");

  const [requestedAmount, setRequestedAmount] = useState("");
  const [tenureMonths, setTenureMonths] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [purpose, setPurpose] = useState("");

  // Loan product picker — purely a client-side convenience to prefill the
  // interest rate from the real catalog (POST /manual-assess only takes a
  // raw interest_rate, not a product_id), so staff don't have to remember
  // rates by heart. Picking a product just fills the field; it stays editable.
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productId, setProductId] = useState("");

  const [activeFormTab, setActiveFormTab] = useState("core");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [occupation, setOccupation] = useState("");
  const [employerCategory, setEmployerCategory] = useState("");
  const [yearsEmployed, setYearsEmployed] = useState("");
  const [hasAdditionalIncome, setHasAdditionalIncome] = useState("");
  const [additionalIncome, setAdditionalIncome] = useState("");
  const [hasExistingLoans, setHasExistingLoans] = useState("");
  const [existingLoans, setExistingLoans] = useState("");
  const [hasPreviousDefaults, setHasPreviousDefaults] = useState("");
  const [previousDefaults, setPreviousDefaults] = useState("");
  const [isGuarantor, setIsGuarantor] = useState("");
  const [guarantorExposure, setGuarantorExposure] = useState("");
  const [guarantorCalled, setGuarantorCalled] = useState("");
  const [guarantorDefaults, setGuarantorDefaults] = useState("");
  const [knowsCribScore, setKnowsCribScore] = useState("");
  const [cribScore, setCribScore] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  const requiredFilled =
    age && gender && employmentType && monthlyIncome && monthlyExpense !== "" &&
    requestedAmount && tenureMonths && interestRate !== "";

  const employmentHasData = Boolean(
    maritalStatus || educationLevel || occupation || employerCategory || yearsEmployed
  );
  const creditHasData = Boolean(
    hasAdditionalIncome || hasExistingLoans || hasPreviousDefaults || isGuarantor || knowsCribScore
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/loans/products");
        if (!cancelled) setProducts(res.data?.products || []);
      } catch {
        // Non-critical — the interest rate field still works as free text.
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the result modal WITHOUT touching the form — staff routinely tweak
  // one figure (e.g. the requested amount) and re-run rather than starting
  // over, so dismissing the result must not discard what they just typed.
  // "New Assessment" (resetForm) is the deliberate, explicit way to clear
  // everything instead.
  const closeResult = () => setResult(null);

  // Esc closes the result modal the same way the backdrop click does.
  useEffect(() => {
    if (!result) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeResult();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [result]);

  const handleSelectProduct = (id) => {
    setProductId(id);
    const product = products.find((p) => String(p.id) === id);
    if (product) setInterestRate(String(product.interest_rate));
  };

  const resetForm = () => {
    setAge("");
    setGender("");
    setEmploymentType("");
    setMonthlyIncome("");
    setMonthlyExpense("");
    setRequestedAmount("");
    setTenureMonths("");
    setInterestRate("");
    setPurpose("");
    setProductId("");
    setActiveFormTab("core");
    setMaritalStatus("");
    setEducationLevel("");
    setOccupation("");
    setEmployerCategory("");
    setYearsEmployed("");
    setHasAdditionalIncome("");
    setAdditionalIncome("");
    setHasExistingLoans("");
    setExistingLoans("");
    setHasPreviousDefaults("");
    setPreviousDefaults("");
    setIsGuarantor("");
    setGuarantorExposure("");
    setGuarantorCalled("");
    setGuarantorDefaults("");
    setKnowsCribScore("");
    setCribScore("");
    setSubmitError("");
    setResult(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!requiredFilled || submitting) return;

    setSubmitting(true);
    setSubmitError("");
    setResult(null);

    try {
      const res = await api.post(
        "/loans/manual-assess",
        buildPayload({
          age, gender, employmentType, monthlyIncome, monthlyExpense,
          requestedAmount, tenureMonths, interestRate, purpose,
          maritalStatus, educationLevel, occupation, employerCategory, yearsEmployed,
          hasAdditionalIncome, additionalIncome,
          hasExistingLoans, existingLoans,
          hasPreviousDefaults, previousDefaults,
          isGuarantor, guarantorExposure, guarantorCalled, guarantorDefaults,
          knowsCribScore, cribScore,
        })
      );
      setResult(res.data);
    } catch (err) {
      setSubmitError(
        err.response?.data?.message ||
          "Failed to run the risk assessment. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const riskStyle = result ? RISK_STYLES[result.risk?.label] : null;
  const RiskIcon = riskStyle?.icon;

  return (
    <div className="w-full">
      {/* Form — fills the full content width (sidebar/header untouched by
          this component; they live in the parent admin/staff shell). The
          result now renders in a modal instead of a side column, so this no
          longer needs to share horizontal space with a panel that used to
          sit empty ("Awaiting Input") for most of a working day — and with
          that space back, each tab lays its fields out in more columns
          instead of stacking them, so a tab is a glance, not a scroll. */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="font-display font-bold text-xl text-slate-900 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-brand-primary" />
            Risk Calculator
          </h3>
          <button
            type="button"
            onClick={resetForm}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-brand-primary transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          Enter an applicant's details manually to get an instant, indicative
          risk assessment. Nothing here is saved as a real application.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Tab bar — capped to a comfortable reading width even though the
              form itself now spans the full page, so the three labels don't
              stretch into three barely-there slivers on a wide monitor. */}
          <div className="flex gap-1.5 p-1 bg-slate-50 border border-slate-200 rounded-xl max-w-xl">
            {FORM_TABS.map((tab) => {
              const hasData =
                tab.id === "employment" ? employmentHasData : tab.id === "credit" ? creditHasData : false;
              const isActive = activeFormTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFormTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-center transition-colors ${
                    isActive
                      ? "bg-white text-brand-primary shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  <span>{tab.label}</span>
                  {hasData && !isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-accent shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeFormTab}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
            >
              {activeFormTab === "core" && (
                <div className="space-y-5">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3">
                      Applicant Profile
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                      <NumberField label="Age" min="18" max="100" placeholder="e.g. 34" value={age} onChange={setAge} required />
                      <SelectField label="Gender" value={gender} onChange={setGender} options={GENDER_OPTIONS} placeholder="Select" required />
                      <SelectField label="Employment Type" value={employmentType} onChange={setEmploymentType} options={EMPLOYMENT_TYPE_OPTIONS} placeholder="Select" required />
                      <NumberField label="Monthly Income (LKR)" min="0" placeholder="e.g. 150000" value={monthlyIncome} onChange={setMonthlyIncome} required />
                      <NumberField label="Monthly Expenses (LKR)" min="0" placeholder="e.g. 80000" value={monthlyExpense} onChange={setMonthlyExpense} required />
                    </div>
                  </div>

                  <div className="pt-1 border-t border-slate-100">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3 mt-4">
                      Loan Request
                    </span>
                    {/* Loan Product gets its own full-width row — product
                        names plus their rate ranges run long, and truncating
                        them into a shared column would defeat the point of
                        listing the rate at all. */}
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Loan Product{" "}
                        <span className="text-slate-400 font-normal normal-case">
                          (optional — prefills the rate below)
                        </span>
                      </label>
                      <select
                        value={productId}
                        onChange={(e) => handleSelectProduct(e.target.value)}
                        disabled={productsLoading}
                        className="w-full max-w-xl px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white disabled:opacity-60"
                      >
                        <option value="">
                          {productsLoading ? "Loading products…" : "None — enter a rate manually"}
                        </option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.interest_rate}% {p.rate_type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <NumberField label="Requested Amount (LKR)" min="1" placeholder="e.g. 2500000" value={requestedAmount} onChange={setRequestedAmount} required />
                      <NumberField label="Tenure (months)" min="1" placeholder="e.g. 36" value={tenureMonths} onChange={setTenureMonths} required />
                      <NumberField label="Interest Rate (%)" min="0" max="60" placeholder="e.g. 14.5" value={interestRate} onChange={setInterestRate} required />
                      <TextField label="Purpose" placeholder="e.g. Home renovation" value={purpose} onChange={setPurpose} maxLength={150} />
                    </div>
                  </div>
                </div>
              )}

              {activeFormTab === "employment" && (
                <div className="space-y-6">
                  <p className="text-sm text-slate-500">
                    Optional — improves the model's accuracy but isn't required to run an assessment.
                  </p>
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3">
                      Personal Background
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      <SelectField label="Marital Status" value={maritalStatus} onChange={setMaritalStatus} options={MARITAL_STATUS_OPTIONS} placeholder="Unknown" />
                      <SelectField label="Education Level" value={educationLevel} onChange={setEducationLevel} options={EDUCATION_LEVEL_OPTIONS} placeholder="Unknown" />
                      <SelectField label="Occupation" value={occupation} onChange={setOccupation} options={OCCUPATION_OPTIONS} placeholder="Unknown" />
                    </div>
                  </div>
                  <div className="pt-1 border-t border-slate-100">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3 mt-4">
                      Employment Details
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      <SelectField label="Employer Category" value={employerCategory} onChange={setEmployerCategory} options={EMPLOYER_CATEGORY_OPTIONS} placeholder="Unknown" />
                      <NumberField label="Years With Current Employer" min="0" max="50" placeholder="e.g. 5" value={yearsEmployed} onChange={setYearsEmployed} />
                    </div>
                  </div>
                </div>
              )}

              {activeFormTab === "credit" && (
                <div className="space-y-6">
                  <p className="text-sm text-slate-500">
                    Optional — self-declared credit history and guarantor exposure.
                  </p>

                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-3">
                      Credit History &amp; Guarantor
                    </span>
                    {/* Five independent yes/no questions (including guarantor
                        status itself, which only grows a third column when
                        answered "yes") laid out three-per-row on wide screens
                        instead of stacked one-per-row, so answering every
                        optional question at once still fits one screen —
                        verified directly, since this tab's worst case is
                        exactly that: every question answered and every
                        cascade, including the guarantor's own nested one,
                        expanded simultaneously. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      <div className="space-y-3 p-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
                        <YesNoField label="Any income besides the main salary?" value={hasAdditionalIncome} onChange={setHasAdditionalIncome} />
                        {hasAdditionalIncome === "yes" && (
                          <NumberField label="Additional Monthly Income (LKR)" min="0" placeholder="e.g. 20000" value={additionalIncome} onChange={setAdditionalIncome} />
                        )}
                      </div>

                      <div className="space-y-3 p-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
                        <YesNoField label="Any other active loans?" value={hasExistingLoans} onChange={setHasExistingLoans} />
                        {hasExistingLoans === "yes" && (
                          <NumberField label="How many?" min="1" max="20" placeholder="e.g. 1" value={existingLoans} onChange={setExistingLoans} />
                        )}
                      </div>

                      <div className="space-y-3 p-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
                        <YesNoField label="Any previous loan defaults?" value={hasPreviousDefaults} onChange={setHasPreviousDefaults} />
                        {hasPreviousDefaults === "yes" && (
                          <NumberField label="How many times?" min="1" max="20" placeholder="e.g. 1" value={previousDefaults} onChange={setPreviousDefaults} />
                        )}
                      </div>

                      <div className="space-y-3 p-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
                        <YesNoField label="Do you know their CRIB score?" hint="Only if actually known — otherwise leave blank." value={knowsCribScore} onChange={setKnowsCribScore} />
                        {knowsCribScore === "yes" && (
                          <NumberField label="CRIB Score" min="300" max="900" placeholder="e.g. 720" value={cribScore} onChange={setCribScore} />
                        )}
                      </div>

                      <div className="space-y-3 p-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
                        <YesNoField label="Currently a guarantor for someone else's loan?" value={isGuarantor} onChange={setIsGuarantor} />
                        {isGuarantor === "yes" && (
                          <NumberField label="Outstanding Exposure (LKR)" min="0" placeholder="e.g. 500000" value={guarantorExposure} onChange={setGuarantorExposure} />
                        )}
                      </div>

                      {/* Only appears once there IS a guarantee to ask about —
                          the second half of the same question, kept as its own
                          cell so the grid can place it wherever there's room
                          rather than forcing a full-width break. */}
                      {isGuarantor === "yes" && (
                        <div className="space-y-3 p-4 bg-slate-50/70 border border-slate-100 rounded-2xl">
                          <YesNoField label="Has that guarantee ever been called on?" value={guarantorCalled} onChange={setGuarantorCalled} />
                          {guarantorCalled === "yes" && (
                            <NumberField label="How many times?" min="1" max="10" placeholder="e.g. 1" value={guarantorDefaults} onChange={setGuarantorDefaults} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {submitError && (
            <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !requiredFilled}
            className="w-full bg-brand-primary text-white py-3.5 rounded-xl font-semibold hover:bg-brand-primary/95 transition-all duration-200 flex items-center justify-center space-x-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running Assessment…</span>
              </>
            ) : (
              <span>Run Risk Assessment</span>
            )}
          </button>
          {!submitting && !requiredFilled && (
            <p className="text-center text-[11px] text-slate-400">
              {activeFormTab === "core"
                ? "Fill in the fields marked "
                : "Missing required fields in "}
              {activeFormTab !== "core" && (
                <button
                  type="button"
                  onClick={() => setActiveFormTab("core")}
                  className="font-semibold text-brand-primary hover:underline"
                >
                  Applicant & Loan
                </button>
              )}
              {activeFormTab === "core" && <span className="text-rose-500">*</span>}
              {activeFormTab === "core" ? " to continue." : "."}
            </p>
          )}
        </form>
      </div>

      {/* Result modal — appears after a successful submit instead of a
          side-by-side panel. The old two-column layout pushed the risk band,
          probabilities, recommendation and AI explanation below the fold on
          anything short of a tall desktop screen, and left an empty
          "Awaiting Input" placeholder taking up half the page the rest of
          the time. A sticky header (verdict always visible) and sticky
          footer (actions always reachable) bracket a scrollable body, so
          nothing needed to read the result — or to get back out — is ever
          scrolled away at once. */}
      <AnimatePresence>
        {result && !submitting && (
          <motion.div
            key="risk-result-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={closeResult}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
            >
              {/* Header — the headline verdict, never scrolls. */}
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`${riskStyle?.iconWrap} text-white p-2 rounded-full shrink-0`}>
                    {RiskIcon && <RiskIcon className="w-5 h-5" />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-base text-slate-900 truncate">
                      Risk Assessment Result
                    </h3>
                    <span
                      className={`inline-block mt-0.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase border ${riskStyle?.badge}`}
                    >
                      {result.risk?.category}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeResult}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body — everything else, scrolls internally within the
                  modal's own bounded height rather than the page. */}
              <div className="px-6 py-5 space-y-6 overflow-y-auto">
                <div className="flex items-start gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-[11px] text-slate-500">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                  Indicative estimate only — nothing has been saved.
                </div>

                <div className="space-y-3">
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold tracking-wider">
                    Risk Probabilities
                  </span>
                  {Object.entries(result.risk?.probabilities || {}).map(([label, prob]) => {
                    const idx = label === "Low Risk" ? 0 : label === "Medium Risk" ? 1 : 2;
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-mono font-semibold text-slate-800">{formatPercent(prob)}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round(Number(prob || 0) * 100)}%` }}
                            transition={{ duration: 0.6 }}
                            className={`h-full ${RISK_STYLES[idx].bar}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                      <Wallet className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-semibold tracking-wider">Recommended Amount</span>
                    </div>
                    <span className="text-sm font-bold text-slate-800 font-mono">
                      {formatCurrency(result.recommendation?.recommended_amount)}
                    </span>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-1.5 text-slate-400 mb-1.5">
                      <Percent className="w-3.5 h-3.5" />
                      <span className="text-[10px] uppercase font-semibold tracking-wider">Recommended EMI</span>
                    </div>
                    <span className="text-sm font-bold text-slate-800 font-mono">
                      {formatCurrency(result.recommendation?.recommended_emi)} / mo
                    </span>
                  </div>
                </div>

                {result.recommendation?.loan_type && (
                  <div className="text-xs text-slate-500">
                    Suggested loan type:{" "}
                    <span className="font-semibold text-slate-700">{result.recommendation.loan_type}</span>
                  </div>
                )}

                {/* The what-if check runs the same policy engine as a real
                    application, so staff see whether the prospect would clear
                    the mandatory criteria and not just how the model scores
                    them. Nothing here is persisted. */}
                <CreditPolicyPanel policy={result.policy} detailed />

                {result.explanation && (
                  <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-4 flex items-start space-x-3">
                    <Sparkles className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wider">AI Explanation</h4>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed">{result.explanation}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer — always reachable regardless of how long the body
                  above runs. "Close" keeps the form exactly as filled in, for
                  the common case of tweaking one figure and re-running;
                  "New Assessment" is the explicit, separate action for
                  clearing everything before the next applicant. */}
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
                <button
                  type="button"
                  onClick={closeResult}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex items-center justify-center gap-1.5 border border-slate-200 text-slate-600 hover:border-brand-primary hover:text-brand-primary px-5 py-2.5 rounded-xl text-xs font-semibold transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  New Assessment
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

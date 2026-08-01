import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Send,
  AlertTriangle,
  ShieldCheck,
  ShieldQuestion,
  ShieldAlert,
  Sparkles,
  Wallet,
  Percent,
  X,
  Pencil,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import {
  MARITAL_STATUS_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  OCCUPATION_OPTIONS,
  EMPLOYER_CATEGORY_OPTIONS,
} from "../../constants/loanCategories";

const RISK_STYLES = {
  0: {
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    bar: "bg-emerald-500",
    icon: ShieldCheck,
    iconWrap: "bg-emerald-500",
    hero: "from-emerald-500 to-emerald-600",
  },
  1: {
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    bar: "bg-amber-500",
    icon: ShieldQuestion,
    iconWrap: "bg-amber-500",
    hero: "from-amber-500 to-amber-600",
  },
  2: {
    badge: "bg-rose-100 text-rose-800 border-rose-200",
    bar: "bg-rose-500",
    icon: ShieldAlert,
    iconWrap: "bg-rose-500",
    hero: "from-rose-500 to-rose-600",
  },
};

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", {
    maximumFractionDigits: 0,
  })}`;

const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

const STEP_META = [
  { titleKey: "customer.loanApplication.step0Title", subtitleKey: "customer.loanApplication.step0Subtitle" },
  { titleKey: "customer.loanApplication.step1Title", subtitleKey: "customer.loanApplication.step1Subtitle" },
  { titleKey: "customer.loanApplication.step2Title", subtitleKey: "customer.loanApplication.step2Subtitle" },
  { titleKey: "customer.loanApplication.step3Title", subtitleKey: "customer.loanApplication.step3Subtitle" },
  { titleKey: "customer.loanApplication.step4Title", subtitleKey: "customer.loanApplication.step4Subtitle" },
  { titleKey: "customer.loanApplication.step5Title", subtitleKey: "customer.loanApplication.step5Subtitle" },
];

// A plain Yes/No question rendered as two selectable buttons — friendlier
// than a raw checkbox/boolean input for applicants who don't think in terms
// of "true/false".
function YesNoField({ label, hint, value, onChange, yesLabel, noLabel }) {
  const { t } = useTranslation();
  const yes = yesLabel ?? t("customer.common.yes");
  const no = noLabel ?? t("customer.common.no");
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      {hint && <p className="text-[11px] text-slate-400 mb-2">{hint}</p>}
      <div className="flex gap-2">
        {[
          { key: "yes", label: yes },
          { key: "no", label: no },
        ].map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
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

function SelectField({ label, value, onChange, options, placeholder }) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("customer.loanApplication.preferNotToSay");
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white"
      >
        <option value="">{resolvedPlaceholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
      />
    </div>
  );
}

// Builds the POST /loans/assess body. "Yes" answers require (and send) the
// follow-up number; "No" answers send an explicit, real 0 (a confirmed fact,
// not a guess); an unanswered ("") toggle sends nothing so the gateway's
// neutral default applies, exactly as before this form existed.
function buildAssessPayload(s) {
  return {
    product_id: Number(s.productId),
    requested_amount: Number(s.requestedAmount),
    tenure_months: Number(s.tenureMonths),
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

export default function LoanApplication() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");

  const [step, setStep] = useState(0);

  // Step 0 — Loan Request (required)
  const [productId, setProductId] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [tenureMonths, setTenureMonths] = useState("");
  const [purpose, setPurpose] = useState("");

  // Step 1 — About You (all optional)
  const [maritalStatus, setMaritalStatus] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [occupation, setOccupation] = useState("");
  const [employerCategory, setEmployerCategory] = useState("");
  const [yearsEmployed, setYearsEmployed] = useState("");
  const [hasAdditionalIncome, setHasAdditionalIncome] = useState("");
  const [additionalIncome, setAdditionalIncome] = useState("");

  // Step 2 — Existing Credit (all optional)
  const [hasExistingLoans, setHasExistingLoans] = useState("");
  const [existingLoans, setExistingLoans] = useState("");
  const [hasPreviousDefaults, setHasPreviousDefaults] = useState("");
  const [previousDefaults, setPreviousDefaults] = useState("");

  // Step 3 — Guarantor Details (all optional)
  const [isGuarantor, setIsGuarantor] = useState("");
  const [guarantorExposure, setGuarantorExposure] = useState("");
  const [guarantorCalled, setGuarantorCalled] = useState("");
  const [guarantorDefaults, setGuarantorDefaults] = useState("");

  // Step 4 — CRIB (optional)
  const [knowsCribScore, setKnowsCribScore] = useState("");
  const [cribScore, setCribScore] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const loadProducts = async () => {
      try {
        const res = await api.get("/loans/products");
        const list = res.data?.products || [];
        if (cancelled) return;
        setProducts(list);
        if (list.length) setProductId(String(list[0].id));
      } catch {
        if (cancelled) return;
        setProductsError(t("customer.loanApplication.loadProductsError"));
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    };

    loadProducts();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const stepValid = (() => {
    if (step === 0) return Boolean(productId && requestedAmount && tenureMonths);
    if (step === 1)
      return (
        hasAdditionalIncome !== "yes" ||
        (additionalIncome !== "" && Number(additionalIncome) >= 0)
      );
    if (step === 2)
      return (
        (hasExistingLoans !== "yes" ||
          (existingLoans !== "" && Number(existingLoans) >= 1)) &&
        (hasPreviousDefaults !== "yes" ||
          (previousDefaults !== "" && Number(previousDefaults) >= 1))
      );
    if (step === 3)
      return (
        isGuarantor !== "yes" ||
        (guarantorExposure !== "" &&
          Number(guarantorExposure) >= 0 &&
          (guarantorCalled !== "yes" ||
            (guarantorDefaults !== "" && Number(guarantorDefaults) >= 1)))
      );
    if (step === 4)
      return (
        knowsCribScore !== "yes" ||
        (cribScore !== "" && Number(cribScore) >= 300 && Number(cribScore) <= 900)
      );
    return true;
  })();

  const goNext = () => setStep((s) => Math.min(s + 1, STEP_META.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const resetForm = () => {
    setStep(0);
    setProductId(products.length ? String(products[0].id) : "");
    setRequestedAmount("");
    setTenureMonths("");
    setPurpose("");
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
    setResult(null);
    setSubmitError("");
    setModalOpen(false);
  };

  const handleSubmit = async () => {
    if (submitting) return;

    setSubmitting(true);
    setSubmitError("");
    setResult(null);
    setModalOpen(true);

    try {
      const res = await api.post(
        "/loans/assess",
        buildAssessPayload({
          productId,
          requestedAmount,
          tenureMonths,
          purpose,
          maritalStatus,
          educationLevel,
          occupation,
          employerCategory,
          yearsEmployed,
          hasAdditionalIncome,
          additionalIncome,
          hasExistingLoans,
          existingLoans,
          hasPreviousDefaults,
          previousDefaults,
          isGuarantor,
          guarantorExposure,
          guarantorCalled,
          guarantorDefaults,
          knowsCribScore,
          cribScore,
        })
      );

      setResult(res.data);
      showToast({
        type: "success",
        title: t("customer.loanApplication.assessedToastTitle"),
        message: t("customer.loanApplication.assessedToastMessage", {
          category: res.data?.risk?.category || "",
        }),
      });
    } catch (err) {
      const message =
        err.response?.data?.message ||
        t("customer.loanApplication.assessmentFailedDefault");
      setSubmitError(message);
      showToast({
        type: "error",
        title: t("customer.loanApplication.assessmentFailedTitle"),
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const riskStyle = result ? RISK_STYLES[result.risk?.label] : null;
  const RiskIcon = riskStyle?.icon;

  const reviewRows = [
    { step: 0, label: t("customer.loanApplication.loanProductLabel"), value: products.find((p) => String(p.id) === productId)?.name },
    { step: 0, label: t("customer.loanApplication.reviewRequestedAmount"), value: requestedAmount && formatCurrency(requestedAmount) },
    { step: 0, label: t("customer.loanApplication.reviewTenure"), value: tenureMonths && t("customer.loanApplication.valueMonths", { count: Number(tenureMonths) }) },
    { step: 0, label: t("customer.loanApplication.purposeLabel"), value: purpose || null },
    { step: 1, label: t("customer.loanApplication.maritalStatusLabel"), value: maritalStatus || null },
    { step: 1, label: t("customer.loanApplication.educationLevelLabel"), value: educationLevel || null },
    { step: 1, label: t("customer.loanApplication.occupationLabel"), value: occupation || null },
    { step: 1, label: t("customer.loanApplication.employerCategoryLabel"), value: employerCategory || null },
    { step: 1, label: t("customer.loanApplication.yearsEmployedLabel"), value: yearsEmployed !== "" ? yearsEmployed : null },
    {
      step: 1,
      label: t("customer.loanApplication.reviewAdditionalIncome"),
      value:
        hasAdditionalIncome === "yes"
          ? formatCurrency(additionalIncome)
          : hasAdditionalIncome === "no"
            ? t("customer.loanApplication.valueNone")
            : null,
    },
    {
      step: 2,
      label: t("customer.loanApplication.reviewOtherActiveLoans"),
      value:
        hasExistingLoans === "yes"
          ? existingLoans
          : hasExistingLoans === "no"
            ? t("customer.loanApplication.valueNone")
            : null,
    },
    {
      step: 2,
      label: t("customer.loanApplication.reviewPreviousDefaults"),
      value:
        hasPreviousDefaults === "yes"
          ? previousDefaults
          : hasPreviousDefaults === "no"
            ? t("customer.loanApplication.valueNone")
            : null,
    },
    {
      step: 3,
      label: t("customer.loanApplication.reviewGuarantorExposure"),
      value:
        isGuarantor === "yes"
          ? formatCurrency(guarantorExposure)
          : isGuarantor === "no"
            ? t("customer.loanApplication.valueNotGuarantor")
            : null,
    },
    {
      step: 3,
      label: t("customer.loanApplication.reviewGuaranteeCalledOn"),
      value:
        isGuarantor === "yes"
          ? guarantorCalled === "yes"
            ? t("customer.loanApplication.valueYesTimes", { count: Number(guarantorDefaults || 1) })
            : t("customer.common.no")
          : null,
    },
    {
      step: 4,
      label: t("customer.loanApplication.cribScoreLabel"),
      value: knowsCribScore === "yes" ? cribScore : null,
    },
  ].filter((row) => row.value !== null && row.value !== undefined && row.value !== "");

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-slate-900">
            {t("customer.loanApplication.pageTitle")}
          </h1>
          <p className="text-slate-500 text-sm mt-1.5">
            {t("customer.loanApplication.pageSubtitle")}
          </p>
        </div>

        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100">
          {productsError ? (
            <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{productsError}</span>
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="mb-8">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-primary">
                    {t("customer.loanApplication.stepOf", { current: step + 1, total: STEP_META.length })}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {Math.round(((step + 1) / STEP_META.length) * 100)}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-brand-primary"
                    animate={{ width: `${((step + 1) / STEP_META.length) * 100}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="font-display font-bold text-lg text-slate-900 mb-1">
                    {t(STEP_META[step].titleKey)}
                  </h2>
                  <p className="text-xs text-slate-500 mb-6">
                    {t(STEP_META[step].subtitleKey)}
                  </p>

                  {/* Step 0 — Loan Request */}
                  {step === 0 && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          {t("customer.loanApplication.loanProductLabel")}
                        </label>
                        <select
                          disabled={productsLoading}
                          value={productId}
                          onChange={(e) => setProductId(e.target.value)}
                          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          {productsLoading && <option>{t("customer.loanApplication.loadingProductsOption")}</option>}
                          {!productsLoading && products.length === 0 && (
                            <option>{t("customer.loanApplication.noProductsOption")}</option>
                          )}
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.interest_rate}% {p.rate_type})
                            </option>
                          ))}
                        </select>
                      </div>

                      <NumberField
                        label={t("customer.loanApplication.requestedAmountLabel")}
                        min="1"
                        placeholder="e.g. 2500000"
                        value={requestedAmount}
                        onChange={setRequestedAmount}
                      />

                      <NumberField
                        label={t("customer.loanApplication.tenureMonthsLabel")}
                        min="1"
                        placeholder="e.g. 36"
                        value={tenureMonths}
                        onChange={setTenureMonths}
                      />

                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="block text-xs font-semibold text-slate-700">
                            {t("customer.loanApplication.purposeLabel")}
                          </label>
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-mono">
                            {t("customer.common.optional")}
                          </span>
                        </div>
                        <input
                          type="text"
                          maxLength={150}
                          placeholder="e.g. Home renovation"
                          value={purpose}
                          onChange={(e) => setPurpose(e.target.value)}
                          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
                        />
                      </div>
                    </div>
                  )}

                  {/* Step 1 — About You */}
                  {step === 1 && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <SelectField
                          label={t("customer.loanApplication.maritalStatusLabel")}
                          value={maritalStatus}
                          onChange={setMaritalStatus}
                          options={MARITAL_STATUS_OPTIONS}
                        />
                        <SelectField
                          label={t("customer.loanApplication.educationLevelLabel")}
                          value={educationLevel}
                          onChange={setEducationLevel}
                          options={EDUCATION_LEVEL_OPTIONS}
                        />
                        <SelectField
                          label={t("customer.loanApplication.occupationLabel")}
                          value={occupation}
                          onChange={setOccupation}
                          options={OCCUPATION_OPTIONS}
                        />
                        <SelectField
                          label={t("customer.loanApplication.employerCategoryLabel")}
                          value={employerCategory}
                          onChange={setEmployerCategory}
                          options={EMPLOYER_CATEGORY_OPTIONS}
                        />
                      </div>

                      <NumberField
                        label={t("customer.loanApplication.yearsEmployedLabel")}
                        min="0"
                        max="50"
                        placeholder="e.g. 5"
                        value={yearsEmployed}
                        onChange={setYearsEmployed}
                      />

                      <div className="pt-2 border-t border-slate-100" />

                      <YesNoField
                        label={t("customer.loanApplication.hasAdditionalIncomeQuestion")}
                        value={hasAdditionalIncome}
                        onChange={setHasAdditionalIncome}
                      />
                      {hasAdditionalIncome === "yes" && (
                        <NumberField
                          label={t("customer.loanApplication.additionalIncomeLabel")}
                          min="0"
                          placeholder="e.g. 20000"
                          value={additionalIncome}
                          onChange={setAdditionalIncome}
                        />
                      )}
                    </div>
                  )}

                  {/* Step 2 — Existing Credit */}
                  {step === 2 && (
                    <div className="space-y-4">
                      <YesNoField
                        label={t("customer.loanApplication.hasExistingLoansQuestion")}
                        value={hasExistingLoans}
                        onChange={setHasExistingLoans}
                      />
                      {hasExistingLoans === "yes" && (
                        <NumberField
                          label={t("customer.loanApplication.existingLoansCountLabel")}
                          min="1"
                          max="20"
                          placeholder="e.g. 1"
                          value={existingLoans}
                          onChange={setExistingLoans}
                        />
                      )}

                      <div className="pt-2 border-t border-slate-100" />

                      <YesNoField
                        label={t("customer.loanApplication.hasPreviousDefaultsQuestion")}
                        value={hasPreviousDefaults}
                        onChange={setHasPreviousDefaults}
                      />
                      {hasPreviousDefaults === "yes" && (
                        <NumberField
                          label={t("customer.common.howManyTimes")}
                          min="1"
                          max="20"
                          placeholder="e.g. 1"
                          value={previousDefaults}
                          onChange={setPreviousDefaults}
                        />
                      )}
                    </div>
                  )}

                  {/* Step 3 — Guarantor Details */}
                  {step === 3 && (
                    <div className="space-y-4">
                      <YesNoField
                        label={t("customer.loanApplication.isGuarantorQuestion")}
                        hint={t("customer.loanApplication.isGuarantorHint")}
                        value={isGuarantor}
                        onChange={setIsGuarantor}
                      />

                      {isGuarantor === "yes" && (
                        <>
                          <NumberField
                            label={t("customer.loanApplication.guarantorExposureLabel")}
                            min="0"
                            placeholder="e.g. 500000"
                            value={guarantorExposure}
                            onChange={setGuarantorExposure}
                          />

                          <div className="pt-2 border-t border-slate-100" />

                          <YesNoField
                            label={t("customer.loanApplication.guarantorCalledQuestion")}
                            hint={t("customer.loanApplication.guarantorCalledHint")}
                            value={guarantorCalled}
                            onChange={setGuarantorCalled}
                          />
                          {guarantorCalled === "yes" && (
                            <NumberField
                              label={t("customer.common.howManyTimes")}
                              min="1"
                              max="10"
                              placeholder="e.g. 1"
                              value={guarantorDefaults}
                              onChange={setGuarantorDefaults}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Step 4 — CRIB */}
                  {step === 4 && (
                    <div className="space-y-4">
                      <YesNoField
                        label={t("customer.loanApplication.knowsCribScoreQuestion")}
                        hint={t("customer.loanApplication.knowsCribScoreHint")}
                        value={knowsCribScore}
                        onChange={setKnowsCribScore}
                      />
                      {knowsCribScore === "yes" && (
                        <NumberField
                          label={t("customer.loanApplication.cribScoreLabel")}
                          min="300"
                          max="900"
                          placeholder="e.g. 720"
                          value={cribScore}
                          onChange={setCribScore}
                        />
                      )}
                    </div>
                  )}

                  {/* Step 5 — Review */}
                  {step === 5 && (
                    <div className="space-y-2">
                      {reviewRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex items-center justify-between py-2.5 px-3 rounded-lg odd:bg-slate-50"
                        >
                          <span className="text-xs text-slate-500">{row.label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-800 text-right">
                              {row.value}
                            </span>
                            <button
                              type="button"
                              onClick={() => setStep(row.step)}
                              className="text-slate-300 hover:text-brand-primary transition-colors"
                              aria-label={`Edit ${row.label}`}
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-slate-400 pt-3 leading-relaxed">
                        {t("customer.loanApplication.reviewFooterNote")}
                      </p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Nav buttons */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={step === 0}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-0 disabled:pointer-events-none transition-colors flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {t("common.back")}
                </button>

                {step < STEP_META.length - 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!stepValid}
                    className="px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    {t("common.next")}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || productsLoading || !products.length}
                    className="px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {t("customer.loanApplication.submitApplication")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Results modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => {
              if (!submitting) setModalOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto relative [&::-webkit-scrollbar]:hidden"
            >
              {!submitting && (
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className={`absolute top-4 right-4 z-10 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                    !submitError && result
                      ? "bg-white/15 hover:bg-white/25 text-white"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-500"
                  }`}
                  aria-label={t("common.close")}
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {submitting && (
                <div className="flex flex-col items-center justify-center text-center py-20 px-8">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 bg-brand-primary/10 rounded-full animate-ping absolute" />
                    <div className="w-20 h-20 bg-brand-primary/20 rounded-full flex items-center justify-center relative">
                      <Sparkles className="w-9 h-9 text-brand-primary animate-pulse" />
                    </div>
                  </div>
                  <h4 className="font-display font-bold text-xl text-slate-800">
                    {t("customer.loanApplication.assessingTitle")}
                  </h4>
                  <p className="text-slate-500 text-sm max-w-sm mt-2 leading-relaxed animate-pulse">
                    {t("customer.loanApplication.assessingSubtext")}
                  </p>
                </div>
              )}

              {!submitting && submitError && (
                <div className="flex flex-col items-center justify-center text-center py-16 px-8">
                  <div className="w-16 h-16 rounded-full bg-rose-100 flex items-center justify-center mb-4">
                    <AlertTriangle className="w-7 h-7 text-rose-600" />
                  </div>
                  <h4 className="font-display font-bold text-xl text-slate-800 mb-1">
                    {t("customer.loanApplication.assessmentFailedTitle")}
                  </h4>
                  <p className="text-slate-500 text-sm max-w-sm mb-6">
                    {submitError}
                  </p>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 transition-colors"
                  >
                    {t("customer.loanApplication.tryAgain")}
                  </button>
                </div>
              )}

              {!submitting && !submitError && result && (
                <>
                  {/* Hero band */}
                  <div
                    className={`relative overflow-hidden bg-gradient-to-br ${riskStyle?.hero} px-8 sm:px-10 py-10 sm:py-12`}
                  >
                    <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-white/10 blur-3xl" />
                    <div className="absolute -left-16 -bottom-16 w-56 h-56 rounded-full bg-black/10 blur-3xl" />
                    <div className="relative flex items-center gap-5">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                        {RiskIcon && (
                          <RiskIcon className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                        )}
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-white/70 font-semibold mb-1">
                          {t("customer.loanApplication.applicationHash", { id: result.application_id })}
                        </p>
                        <h3 className="font-display font-bold text-2xl sm:text-3xl text-white">
                          {result.risk?.category}
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 sm:p-10 space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Probabilities */}
                      <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 sm:p-6 space-y-4">
                        <span className="text-[11px] text-slate-400 block uppercase font-semibold tracking-wider">
                          {t("customer.widgets.riskProbabilities")}
                        </span>
                        {Object.entries(result.risk?.probabilities || {}).map(
                          ([label, prob]) => {
                            const idx =
                              label === "Low Risk"
                                ? 0
                                : label === "Medium Risk"
                                  ? 1
                                  : 2;
                            return (
                              <div key={label}>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-slate-600 font-medium">
                                    {label}
                                  </span>
                                  <span className="font-mono font-semibold text-slate-800">
                                    {formatPercent(prob)}
                                  </span>
                                </div>
                                <div className="w-full h-2.5 bg-slate-200/70 rounded-full overflow-hidden">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{
                                      width: `${Math.round(Number(prob || 0) * 100)}%`,
                                    }}
                                    transition={{ duration: 0.6 }}
                                    className={`h-full ${RISK_STYLES[idx].bar}`}
                                  />
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>

                      {/* Recommendation */}
                      <div className="space-y-4">
                        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 flex items-center gap-4">
                          <div className="w-11 h-11 rounded-xl bg-brand-primary/10 flex items-center justify-center shrink-0">
                            <Wallet className="w-5 h-5 text-brand-primary" />
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block">
                              {t("customer.widgets.recommendedAmount")}
                            </span>
                            <span className="text-xl font-bold text-slate-800 font-mono">
                              {formatCurrency(
                                result.recommendation?.recommended_amount
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 flex items-center gap-4">
                          <div className="w-11 h-11 rounded-xl bg-brand-accent/10 flex items-center justify-center shrink-0">
                            <Percent className="w-5 h-5 text-brand-accent" />
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block">
                              {t("customer.widgets.recommendedEmi")}
                            </span>
                            <span className="text-xl font-bold text-slate-800 font-mono">
                              {formatCurrency(
                                result.recommendation?.recommended_emi
                              )}{" "}
                              <span className="text-xs font-normal text-slate-400">
                                {t("customer.widgets.perMonth")}
                              </span>
                            </span>
                          </div>
                        </div>

                        {result.recommendation?.loan_type && (
                          <div className="text-xs text-slate-500 px-1">
                            {t("customer.loanApplication.suggestedLoanType")}{" "}
                            <span className="font-semibold text-slate-700">
                              {result.recommendation.loan_type}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Explanation */}
                    {result.explanation && (
                      <div className="bg-gradient-to-br from-brand-primary/5 to-brand-primary/10 border border-brand-primary/10 rounded-2xl p-6 sm:p-7 flex items-start gap-4">
                        <div className="w-9 h-9 rounded-xl bg-brand-primary flex items-center justify-center shrink-0">
                          <Sparkles className="w-4.5 h-4.5 text-white" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-brand-primary uppercase tracking-wider mb-1.5">
                            {t("customer.widgets.aiExplanation")}
                          </h4>
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {result.explanation}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 pt-1">
                      <button
                        type="button"
                        onClick={resetForm}
                        className="flex-1 bg-slate-100 text-slate-700 py-3.5 rounded-xl font-semibold hover:bg-slate-200 transition-colors text-sm"
                      >
                        {t("customer.loanApplication.applyAnotherLoan")}
                      </button>
                      <Link
                        to="/dashboard"
                        className="flex-1 bg-brand-accent text-white py-3.5 rounded-xl font-semibold hover:bg-brand-accent/95 transition-colors block text-center text-sm shadow-sm"
                      >
                        {t("customer.loanApplication.backToDashboard")}
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
  Save,
  History,
  Loader2,
} from "lucide-react";

import api from "../../api/axios";
import { useToast } from "../../components/toast/useToast";
import CreditPolicyPanel from "../../components/CreditPolicyPanel";
import PricingBadge from "../../components/PricingBadge";
import AdverseActionPanel from "../../components/AdverseActionPanel";
import { creditPolicyLabels } from "./creditPolicyLabels";
import { pricingLabels } from "./pricingLabels";
import { adverseActionLabels } from "./adverseActionLabels";
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
  { titleKey: "customer.loanApplication.step6Title", subtitleKey: "customer.loanApplication.step6Subtitle" },
];

// Shared field chrome. The disabled variant is deliberately DARK-on-grey, not
// the usual faded grey-on-white: a locked field here is showing a real value
// carried over from the applicant's last application (H1), so it must read as
// "filled in and locked", never as an empty field showing placeholder text.
const LOCKED_FIELD_CLASS =
  "bg-white border-slate-200 disabled:bg-slate-100 disabled:text-slate-800 " +
  "disabled:border-slate-200 disabled:cursor-not-allowed disabled:opacity-100";

// A plain Yes/No question rendered as two selectable buttons — friendlier
// than a raw checkbox/boolean input for applicants who don't think in terms
// of "true/false".
function YesNoField({ label, hint, value, onChange, yesLabel, noLabel, disabled }) {
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
            disabled={disabled}
            onClick={() => onChange(opt.key)}
            // A locked-but-CHOSEN answer must still read as chosen: the whole
            // point of the prefill is showing the applicant what we already
            // know, so the selected option keeps brand colour (just muted)
            // rather than fading into the unselected one.
            className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
              disabled
                ? value === opt.key
                  ? "bg-brand-primary/15 text-brand-primary border-brand-primary/30 cursor-not-allowed"
                  : "bg-slate-50 text-slate-400 border-slate-100 cursor-not-allowed"
                : value === opt.key
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

function SelectField({ label, value, onChange, options, placeholder, disabled }) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("customer.loanApplication.preferNotToSay");
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary ${LOCKED_FIELD_CLASS}`}
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

function NumberField({ label, value, onChange, min, max, placeholder, disabled }) {
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
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary ${LOCKED_FIELD_CLASS}`}
      />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, maxLength, disabled }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary ${LOCKED_FIELD_CLASS}`}
      />
    </div>
  );
}

// H1 — shown at the top of a declared-info step when prior-application data
// was used to prefill it. Locks that step's fields until the applicant
// explicitly reaffirms (or flags as changed) via the bundled YesNoField.
function ReaffirmBanner({ date, question, value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="p-4 bg-sky-50 border border-sky-100 rounded-xl space-y-2">
      <p className="text-[11px] text-slate-500">
        {t("customer.loanApplication.reaffirmIntro", { date })}
      </p>
      <YesNoField label={question} value={value} onChange={onChange} />
    </div>
  );
}

// Matches collateralGuarantor.service.js NIC_PATTERN exactly — client-side
// only for immediate feedback; the server is the real authority.
const NIC_PATTERN = /^([0-9]{9}[VvXx]|[0-9]{12})$/;

// Values match collateralGuarantor.service.js COLLATERAL_TYPES exactly —
// sent to the server verbatim; labels are the only thing translated.
const COLLATERAL_TYPE_OPTIONS = [
  { value: "property", labelKey: "customer.loanApplication.collateralType.property" },
  { value: "vehicle", labelKey: "customer.loanApplication.collateralType.vehicle" },
  { value: "gold_jewellery", labelKey: "customer.loanApplication.collateralType.goldJewellery" },
  { value: "fixed_deposit", labelKey: "customer.loanApplication.collateralType.fixedDeposit" },
  { value: "other", labelKey: "customer.loanApplication.collateralType.other" },
];

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
    // D5 — real guarantor/collateral backing THIS loan. Omitted entirely
    // (not an empty array) when the applicant said "no" or left it blank,
    // so the request body matches exactly what was actually offered.
    guarantors:
      s.hasGuarantorForLoan === "yes"
        ? [
            {
              nic: s.guarantorNic.trim().toUpperCase(),
              full_name: s.guarantorFullName.trim(),
              phone: s.guarantorPhone.trim() || undefined,
              address: s.guarantorAddress.trim() || undefined,
              relationship_to_applicant: s.guarantorRelationship.trim() || undefined,
              guaranteed_amount: Number(s.guarantorAmount),
            },
          ]
        : undefined,
    collateral:
      s.hasCollateral === "yes" && s.collateralItems.length > 0
        ? s.collateralItems.map((c) => ({
            collateral_type: c.type,
            description: c.description.trim() || undefined,
            estimated_value: Number(c.estimatedValue),
            ownership_reference: c.ownershipReference.trim() || undefined,
          }))
        : undefined,
  };
}

// MySQL returns DECIMAL columns as strings ("25000.00"), which would land in
// an <input type="number"> verbatim and show the applicant "25000.00" where
// they originally typed "25000". Round-trip through Number to drop the
// trailing zeros the database added.
const numToInput = (n) => {
  const parsed = Number(n);
  return Number.isFinite(parsed) ? String(parsed) : "";
};

// "Yes"/">0" answers carry their number; a stored 0 is a real "No" (see
// buildAssessPayload above); null/undefined means the applicant left that
// question unanswered last time, so we don't prefill it.
const yesNoAndValue = (n) =>
  n === null || n === undefined
    ? ["", ""]
    : [Number(n) > 0 ? "yes" : "no", Number(n) > 0 ? numToInput(n) : ""];

// Applies a previous application's `declared` fields onto the wizard's
// setters. Shared by the initial prior-application fetch and by resetForm,
// so prefill still applies if the applicant submits and starts another one.
function applyDeclaredPrefill(d, setters) {
  const {
    setMaritalStatus, setEducationLevel, setOccupation, setEmployerCategory, setYearsEmployed,
    setHasAdditionalIncome, setAdditionalIncome,
    setHasExistingLoans, setExistingLoans, setHasPreviousDefaults, setPreviousDefaults,
    setIsGuarantor, setGuarantorExposure, setGuarantorCalled, setGuarantorDefaults,
    setKnowsCribScore, setCribScore,
  } = setters;

  if (d.marital_status) setMaritalStatus(d.marital_status);
  if (d.education_level) setEducationLevel(d.education_level);
  if (d.occupation) setOccupation(d.occupation);
  if (d.employer_category) setEmployerCategory(d.employer_category);
  if (d.years_employed !== null && d.years_employed !== undefined)
    setYearsEmployed(numToInput(d.years_employed));

  const [incomeFlag, incomeVal] = yesNoAndValue(d.additional_income);
  if (incomeFlag) {
    setHasAdditionalIncome(incomeFlag);
    setAdditionalIncome(incomeVal);
  }

  const [loansFlag, loansVal] = yesNoAndValue(d.existing_loans);
  if (loansFlag) {
    setHasExistingLoans(loansFlag);
    setExistingLoans(loansVal);
  }

  const [defaultsFlag, defaultsVal] = yesNoAndValue(d.previous_defaults);
  if (defaultsFlag) {
    setHasPreviousDefaults(defaultsFlag);
    setPreviousDefaults(defaultsVal);
  }

  const [exposureFlag, exposureVal] = yesNoAndValue(d.guarantor_exposure);
  if (exposureFlag) {
    setIsGuarantor(exposureFlag);
    setGuarantorExposure(exposureVal);
  }

  if (d.guarantor_defaults !== null && d.guarantor_defaults !== undefined) {
    const [calledFlag, calledVal] = yesNoAndValue(d.guarantor_defaults);
    setGuarantorCalled(calledFlag);
    setGuarantorDefaults(calledVal);
  }

  if (d.crib_score !== null && d.crib_score !== undefined) {
    setKnowsCribScore("yes");
    setCribScore(numToInput(d.crib_score));
  }
}

// H2 — overlays customer_profiles' 5 stable fields on top of whatever
// applyDeclaredPrefill already set from the prior application. Profile wins
// when present, since it's the more current source; a field the profile
// doesn't have yet (e.g. it predates this feature) leaves the prior
// application's value in place rather than clearing it.
function applyProfileOverlay(profile, setters) {
  const { setMaritalStatus, setEducationLevel, setOccupation, setEmployerCategory, setYearsEmployed } = setters;
  if (!profile) return;

  if (profile.marital_status) setMaritalStatus(profile.marital_status);
  if (profile.education_level) setEducationLevel(profile.education_level);
  if (profile.occupation) setOccupation(profile.occupation);
  if (profile.employer_category) setEmployerCategory(profile.employer_category);
  if (profile.years_employed !== null && profile.years_employed !== undefined)
    setYearsEmployed(numToInput(profile.years_employed));
}

// H3 — the wizard fields a draft round-trips. Kept in ONE list so
// buildDraftPayload and applyDraftPayload can never drift apart; must stay in
// sync with DRAFT_FIELDS in finance-backend/src/services/loanDraft.service.js,
// which whitelists the same names server-side (anything absent there is
// silently dropped on save).
const DRAFT_SCALAR_FIELDS = [
  "productId", "requestedAmount", "tenureMonths", "purpose",
  "maritalStatus", "educationLevel", "occupation", "employerCategory",
  "yearsEmployed", "hasAdditionalIncome", "additionalIncome",
  "hasExistingLoans", "existingLoans", "hasPreviousDefaults", "previousDefaults",
  "isGuarantor", "guarantorExposure", "guarantorCalled", "guarantorDefaults",
  "knowsCribScore", "cribScore",
  "hasGuarantorForLoan", "guarantorNic", "guarantorFullName", "guarantorPhone",
  "guarantorAddress", "guarantorRelationship", "guarantorAmount", "hasCollateral",
  "aboutYouReaffirm", "creditReaffirm", "guarantorReaffirm", "cribReaffirm",
];

// H3 — snapshot the wizard's current state for PUT /loans/draft.
function buildDraftPayload(state) {
  const payload = {};
  for (const field of DRAFT_SCALAR_FIELDS) payload[field] = state[field] ?? "";
  payload.collateralItems = state.collateralItems || [];
  return payload;
}

// H3 — hydrate a saved draft back into the wizard.
//
// Merges key-by-key rather than replacing state wholesale, so a draft written
// before a field existed simply leaves that field at its default instead of
// blanking or breaking it — the same schema-evolution guard useChartFilters.js
// applies to its persisted blob. `setters` is keyed by field name (not the
// setSomething names) so it can be driven straight off DRAFT_SCALAR_FIELDS.
function applyDraftPayload(payload, setters) {
  if (!payload) return;

  for (const field of DRAFT_SCALAR_FIELDS) {
    const value = payload[field];
    if (value === undefined || value === null) continue;
    const setter = setters[field];
    if (setter) setter(typeof value === "string" ? value : String(value));
  }

  if (Array.isArray(payload.collateralItems) && setters.collateralItems) {
    // Normalise each item to the shape addCollateralItem() creates, so a
    // partial/older saved item can't render an undefined-valued input.
    setters.collateralItems(
      payload.collateralItems.map((item) => ({
        type: item?.type ?? "",
        description: item?.description ?? "",
        estimatedValue: item?.estimatedValue ?? "",
        ownershipReference: item?.ownershipReference ?? "",
      }))
    );
  }
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

  // H1 — prefill from the applicant's most recent application (any status),
  // gated behind an explicit per-section "still accurate?" reaffirmation
  // rather than silently trusting possibly-stale data.
  const [priorApplication, setPriorApplication] = useState(null); // { declared, created_at } | null
  // H2 — marital_status/education_level/occupation/employer_category/
  // years_employed now live on customer_profiles too, and take priority over
  // priorApplication's copy of the same 5 fields (profile is the more
  // current source; priorApplication remains the ONLY source for the other
  // 6 truly per-application fields, e.g. additional_income).
  const [profileDeclared, setProfileDeclared] = useState(null);
  const [aboutYouReaffirm, setAboutYouReaffirm] = useState("");
  const [creditReaffirm, setCreditReaffirm] = useState("");
  const [guarantorReaffirm, setGuarantorReaffirm] = useState("");
  const [cribReaffirm, setCribReaffirm] = useState("");

  // Step 5 — Security: a real guarantor/collateral backing THIS loan (D5,
  // all optional). Deliberately separate state from step 3's isGuarantor —
  // that question is about the APPLICANT's own liability as guarantor for
  // someone ELSE's loan; this is who is backing the applicant's OWN loan.
  const [hasGuarantorForLoan, setHasGuarantorForLoan] = useState("");
  const [guarantorNic, setGuarantorNic] = useState("");
  const [guarantorFullName, setGuarantorFullName] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [guarantorAddress, setGuarantorAddress] = useState("");
  const [guarantorRelationship, setGuarantorRelationship] = useState("");
  const [guarantorAmount, setGuarantorAmount] = useState("");

  const [hasCollateral, setHasCollateral] = useState("");
  // [{ type, description, estimatedValue, ownershipReference }]
  const [collateralItems, setCollateralItems] = useState([]);
  const addCollateralItem = () =>
    setCollateralItems((prev) => [
      ...prev,
      { type: "", description: "", estimatedValue: "", ownershipReference: "" },
    ]);
  const updateCollateralItem = (index, field, value) =>
    setCollateralItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  const removeCollateralItem = (index) =>
    setCollateralItems((prev) => prev.filter((_, i) => i !== index));

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  // J1 — consent management. `consentPolicies` is the current policy
  // text/version for each required consent type; `missingConsents` is what
  // the server says the applicant still needs to grant (empty once granted
  // this session or in a prior one, so a returning applicant isn't asked
  // again). `consentChecks` is purely local UI state for the checkboxes.
  const [consentPolicies, setConsentPolicies] = useState([]);
  const [missingConsents, setMissingConsents] = useState([]);
  const [consentChecks, setConsentChecks] = useState({});
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentError, setConsentError] = useState("");

  // H3 — save & continue later. `savedDraft` is the fetched draft awaiting the
  // applicant's Resume/Start-fresh choice; `draftPromptOpen` gates that modal.
  // `draftResolved` flips true once they've chosen (or there was no draft),
  // which is what releases the H1/H2 prefill effect — a resumed draft is the
  // applicant's own in-progress work and must not be overwritten by prefill.
  const [savedDraft, setSavedDraft] = useState(null);
  const [draftPromptOpen, setDraftPromptOpen] = useState(false);
  const [draftResolved, setDraftResolved] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

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

  // J1 — load consent policies and the applicant's current status once.
  useEffect(() => {
    let cancelled = false;

    const loadConsents = async () => {
      try {
        const [policiesRes, statusRes] = await Promise.all([
          api.get("/consents/policies"),
          api.get("/consents/status"),
        ]);
        if (cancelled) return;
        setConsentPolicies(policiesRes.data?.policies || []);
        setMissingConsents(statusRes.data?.missing || []);
      } catch {
        if (cancelled) return;
        setConsentError(t("customer.loanApplication.consentLoadError"));
      } finally {
        if (!cancelled) setConsentLoading(false);
      }
    };

    loadConsents();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const toggleConsentCheck = (consentType) =>
    setConsentChecks((prev) => ({ ...prev, [consentType]: !prev[consentType] }));

  const allConsentsChecked = missingConsents.every((type) => consentChecks[type]);

  const declaredSetters = {
    setMaritalStatus, setEducationLevel, setOccupation, setEmployerCategory, setYearsEmployed,
    setHasAdditionalIncome, setAdditionalIncome,
    setHasExistingLoans, setExistingLoans, setHasPreviousDefaults, setPreviousDefaults,
    setIsGuarantor, setGuarantorExposure, setGuarantorCalled, setGuarantorDefaults,
    setKnowsCribScore, setCribScore,
  };

  // H3 — keyed by FIELD name (not setter name) so applyDraftPayload can drive
  // it straight off DRAFT_SCALAR_FIELDS.
  const draftSetters = {
    productId: setProductId,
    requestedAmount: setRequestedAmount,
    tenureMonths: setTenureMonths,
    purpose: setPurpose,
    maritalStatus: setMaritalStatus,
    educationLevel: setEducationLevel,
    occupation: setOccupation,
    employerCategory: setEmployerCategory,
    yearsEmployed: setYearsEmployed,
    hasAdditionalIncome: setHasAdditionalIncome,
    additionalIncome: setAdditionalIncome,
    hasExistingLoans: setHasExistingLoans,
    existingLoans: setExistingLoans,
    hasPreviousDefaults: setHasPreviousDefaults,
    previousDefaults: setPreviousDefaults,
    isGuarantor: setIsGuarantor,
    guarantorExposure: setGuarantorExposure,
    guarantorCalled: setGuarantorCalled,
    guarantorDefaults: setGuarantorDefaults,
    knowsCribScore: setKnowsCribScore,
    cribScore: setCribScore,
    hasGuarantorForLoan: setHasGuarantorForLoan,
    guarantorNic: setGuarantorNic,
    guarantorFullName: setGuarantorFullName,
    guarantorPhone: setGuarantorPhone,
    guarantorAddress: setGuarantorAddress,
    guarantorRelationship: setGuarantorRelationship,
    guarantorAmount: setGuarantorAmount,
    hasCollateral: setHasCollateral,
    aboutYouReaffirm: setAboutYouReaffirm,
    creditReaffirm: setCreditReaffirm,
    guarantorReaffirm: setGuarantorReaffirm,
    cribReaffirm: setCribReaffirm,
    collateralItems: setCollateralItems,
  };

  // Snapshot of everything a draft persists — read by both save paths.
  const currentDraftState = {
    productId, requestedAmount, tenureMonths, purpose,
    maritalStatus, educationLevel, occupation, employerCategory, yearsEmployed,
    hasAdditionalIncome, additionalIncome,
    hasExistingLoans, existingLoans, hasPreviousDefaults, previousDefaults,
    isGuarantor, guarantorExposure, guarantorCalled, guarantorDefaults,
    knowsCribScore, cribScore,
    hasGuarantorForLoan, guarantorNic, guarantorFullName, guarantorPhone,
    guarantorAddress, guarantorRelationship, guarantorAmount, hasCollateral,
    aboutYouReaffirm, creditReaffirm, guarantorReaffirm, cribReaffirm,
    collateralItems,
  };

  // H3 — look for a saved draft FIRST. Until the applicant has chosen
  // Resume or Start fresh, the prefill effect below stays parked, so prefill
  // can never overwrite work they haven't decided about yet.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get("/loans/draft");
        const draft = res.data?.draft;
        if (cancelled) return;
        if (draft && draft.payload) {
          setSavedDraft(draft);
          setDraftPromptOpen(true);
          return; // stay parked until the applicant chooses
        }
      } catch {
        // No draft, or the lookup failed — fall through to normal prefill.
      }
      if (!cancelled) setDraftResolved(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPriorApplication = async () => {
      try {
        const res = await api.get("/loans/my-applications");
        const list = res.data?.applications || [];
        if (cancelled || !list.length) return;

        const latest = list[0];
        const d = latest.declared || {};
        setPriorApplication({ declared: d, created_at: latest.created_at });
        applyDeclaredPrefill(d, declaredSetters);
      } catch {
        // No prior application, or the lookup failed — behave exactly like
        // a first-time applicant. This is a UX nicety, not required data.
      }
    };

    // H2 — customer_profiles' 5 stable fields take priority over the prior
    // application's copy of the same 5 (see applyProfileOverlay). Applied
    // AFTER loadPriorApplication so it overlays, never races it.
    const loadProfile = async () => {
      try {
        const res = await api.get("/user/profile");
        const p = res.data?.profile;
        if (cancelled || !p) return;
        setProfileDeclared(p);
        applyProfileOverlay(p, declaredSetters);
      } catch {
        // No profile data for these fields yet — leave applyDeclaredPrefill's
        // result (if any) as-is.
      }
    };

    // H3 — parked until the draft question is settled. Resuming a draft skips
    // prefill entirely; "Start fresh" sets draftResolved and lets it run.
    if (!draftResolved) return undefined;

    (async () => {
      await loadPriorApplication();
      await loadProfile();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftResolved]);

  const priorDeclared = priorApplication?.declared || null;
  const priorAboutYou = Boolean(
    (priorDeclared &&
      (priorDeclared.marital_status ||
        priorDeclared.education_level ||
        priorDeclared.occupation ||
        priorDeclared.employer_category ||
        (priorDeclared.years_employed !== null && priorDeclared.years_employed !== undefined) ||
        (priorDeclared.additional_income !== null && priorDeclared.additional_income !== undefined))) ||
      // H2 — a customer_profiles-only value (e.g. edited on the profile page,
      // with no matching application yet) still counts as "prior data".
      (profileDeclared &&
        (profileDeclared.marital_status ||
          profileDeclared.education_level ||
          profileDeclared.occupation ||
          profileDeclared.employer_category ||
          (profileDeclared.years_employed !== null && profileDeclared.years_employed !== undefined)))
  );
  const priorCredit = Boolean(
    priorDeclared &&
      ((priorDeclared.existing_loans !== null && priorDeclared.existing_loans !== undefined) ||
        (priorDeclared.previous_defaults !== null && priorDeclared.previous_defaults !== undefined))
  );
  const priorGuarantor = Boolean(
    priorDeclared &&
      ((priorDeclared.guarantor_exposure !== null && priorDeclared.guarantor_exposure !== undefined) ||
        (priorDeclared.guarantor_defaults !== null && priorDeclared.guarantor_defaults !== undefined))
  );
  const priorCrib = Boolean(
    priorDeclared && priorDeclared.crib_score !== null && priorDeclared.crib_score !== undefined
  );
  const priorApplicationDate = priorApplication?.created_at
    ? new Date(priorApplication.created_at).toLocaleDateString("en-LK", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "";
  const aboutYouLocked = priorAboutYou && aboutYouReaffirm !== "no";
  const creditLocked = priorCredit && creditReaffirm !== "no";
  const guarantorLocked = priorGuarantor && guarantorReaffirm !== "no";
  const cribLocked = priorCrib && cribReaffirm !== "no";

  const selectedProduct = products.find((p) => String(p.id) === productId);
  const amountInRange =
    !selectedProduct ||
    requestedAmount === "" ||
    (Number(requestedAmount) >= Number(selectedProduct.min_amount) &&
      Number(requestedAmount) <= Number(selectedProduct.max_amount));
  const tenureInRange =
    !selectedProduct ||
    tenureMonths === "" ||
    (Number(tenureMonths) >= Number(selectedProduct.min_tenure_months) &&
      Number(tenureMonths) <= Number(selectedProduct.max_tenure_months));

  const stepValid = (() => {
    if (step === 0)
      return Boolean(
        productId &&
          requestedAmount &&
          tenureMonths &&
          amountInRange &&
          tenureInRange
      );
    if (step === 1)
      return (
        (!priorAboutYou || aboutYouReaffirm !== "") &&
        (hasAdditionalIncome !== "yes" ||
          (additionalIncome !== "" && Number(additionalIncome) >= 0))
      );
    if (step === 2)
      return (
        (!priorCredit || creditReaffirm !== "") &&
        (hasExistingLoans !== "yes" ||
          (existingLoans !== "" && Number(existingLoans) >= 1)) &&
        (hasPreviousDefaults !== "yes" ||
          (previousDefaults !== "" && Number(previousDefaults) >= 1))
      );
    if (step === 3)
      return (
        (!priorGuarantor || guarantorReaffirm !== "") &&
        (isGuarantor !== "yes" ||
          (guarantorExposure !== "" &&
            Number(guarantorExposure) >= 0 &&
            (guarantorCalled !== "yes" ||
              (guarantorDefaults !== "" && Number(guarantorDefaults) >= 1))))
      );
    if (step === 4)
      return (
        (!priorCrib || cribReaffirm !== "") &&
        (knowsCribScore !== "yes" ||
          (cribScore !== "" && Number(cribScore) >= 300 && Number(cribScore) <= 900))
      );
    if (step === 5)
      return (
        (hasGuarantorForLoan !== "yes" ||
          (NIC_PATTERN.test(guarantorNic.trim()) &&
            guarantorFullName.trim().length >= 2 &&
            guarantorAmount !== "" &&
            Number(guarantorAmount) > 0 &&
            Number(guarantorAmount) <= Number(requestedAmount || 0))) &&
        (hasCollateral !== "yes" ||
          (collateralItems.length > 0 &&
            collateralItems.every(
              (c) => c.type && c.estimatedValue !== "" && Number(c.estimatedValue) > 0
            )))
      );
    return true;
  })();

  // H3 — persist the wizard as it stands. `silent` is the auto-save path
  // (step changes): it must never block navigation or surface an error, since
  // a failed background save is not the applicant's problem to solve
  // mid-form. The explicit button awaits and reports.
  const persistDraft = async (atStep, { silent = true } = {}) => {
    try {
      await api.put("/loans/draft", {
        step: atStep,
        payload: buildDraftPayload(currentDraftState),
      });
      return true;
    } catch (err) {
      if (!silent) throw err;
      console.warn("Draft auto-save failed:", err?.message);
      return false;
    }
  };

  const goNext = () =>
    setStep((s) => {
      const next = Math.min(s + 1, STEP_META.length - 1);
      persistDraft(next);
      return next;
    });
  const goBack = () =>
    setStep((s) => {
      const prev = Math.max(s - 1, 0);
      persistDraft(prev);
      return prev;
    });

  const handleSaveAndExit = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      await persistDraft(step, { silent: false });
      showToast({
        type: "success",
        title: t("customer.loanApplication.draftSavedTitle"),
        message: t("customer.loanApplication.draftSavedMessage"),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: t("customer.loanApplication.draftSaveFailedTitle"),
        message:
          err.response?.data?.message ||
          t("customer.loanApplication.draftSaveFailedDefault"),
      });
    } finally {
      setSavingDraft(false);
    }
  };

  // H3 — "Resume": hydrate the saved draft and jump back to where they were.
  // Prefill stays skipped (draftResolved is never set on this path), because
  // the draft already reflects whatever the applicant decided last time.
  const handleResumeDraft = () => {
    applyDraftPayload(savedDraft?.payload, draftSetters);
    setStep(Math.min(savedDraft?.step ?? 0, STEP_META.length - 1));
    setDraftPromptOpen(false);
  };

  // H3 — "Start fresh": throw the draft away and fall through to the normal
  // H1/H2 prefill path.
  const handleDiscardDraft = async () => {
    setDraftPromptOpen(false);
    setSavedDraft(null);
    setDraftResolved(true);
    try {
      await api.delete("/loans/draft");
    } catch (err) {
      console.warn("Draft discard failed:", err?.message);
    }
  };

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
    setAboutYouReaffirm("");
    setCreditReaffirm("");
    setGuarantorReaffirm("");
    setCribReaffirm("");
    // Step 5 (D5 security) — previously missed here, so a guarantor and any
    // collateral nominated on one application silently carried into the next
    // "apply again". Clearing it is also what makes "Start fresh" honest.
    setHasGuarantorForLoan("");
    setGuarantorNic("");
    setGuarantorFullName("");
    setGuarantorPhone("");
    setGuarantorAddress("");
    setGuarantorRelationship("");
    setGuarantorAmount("");
    setHasCollateral("");
    setCollateralItems([]);
    if (priorDeclared) applyDeclaredPrefill(priorDeclared, declaredSetters);
    if (profileDeclared) applyProfileOverlay(profileDeclared, declaredSetters);
    setResult(null);
    setSubmitError("");
    setModalOpen(false);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (missingConsents.length && !allConsentsChecked) return;

    setSubmitting(true);
    setSubmitError("");
    setResult(null);
    setModalOpen(true);

    try {
      // J1 — grant any still-missing consents before the server will accept
      // an assessment. Already-current consents are simply not resent.
      if (missingConsents.length) {
        const grantRes = await api.post("/consents", {
          consents: missingConsents.map((type) => ({
            consent_type: type,
            policy_version: consentPolicies.find((p) => p.consent_type === type)?.version,
          })),
        });
        setMissingConsents(grantRes.data?.missing || []);
      }

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
          hasGuarantorForLoan,
          guarantorNic,
          guarantorFullName,
          guarantorPhone,
          guarantorAddress,
          guarantorRelationship,
          guarantorAmount,
          hasCollateral,
          collateralItems,
        })
      );

      setResult(res.data);

      // H3 — the wizard is now a real application; its draft is spent.
      // Best-effort: a failed cleanup must not turn a successful submission
      // into an error the applicant sees.
      setSavedDraft(null);
      api.delete("/loans/draft").catch((err) => {
        console.warn("Draft cleanup after submit failed:", err?.message);
      });

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
    {
      step: 5,
      label: t("customer.loanApplication.reviewGuarantorForLoan"),
      value:
        hasGuarantorForLoan === "yes" && guarantorFullName.trim()
          ? `${guarantorFullName.trim()} (${formatCurrency(guarantorAmount)})`
          : hasGuarantorForLoan === "no"
            ? t("customer.loanApplication.valueNone")
            : null,
    },
    {
      step: 5,
      label: t("customer.loanApplication.reviewCollateral"),
      value:
        hasCollateral === "yes" && collateralItems.length > 0
          ? t("customer.loanApplication.reviewCollateralCount", { count: collateralItems.length })
          : hasCollateral === "no"
            ? t("customer.loanApplication.valueNone")
            : null,
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
                          {products.map((p) => {
                            // D3: a product with a configured risk-pricing
                            // range (031) shows that range rather than one
                            // flat figure — the applicant's actual rate
                            // depends on their risk assessment, determined
                            // only after they submit. See pricingLabels.js
                            // and PricingBadge for where the RESOLVED rate
                            // is shown, once known.
                            const hasRange =
                              p.min_interest_rate !== null &&
                              p.min_interest_rate !== undefined &&
                              p.max_interest_rate !== null &&
                              p.max_interest_rate !== undefined;
                            const rateLabel = hasRange
                              ? `${Number(p.min_interest_rate).toFixed(2)}%–${Number(p.max_interest_rate).toFixed(2)}%`
                              : `${Number(p.interest_rate).toFixed(2)}%`;
                            return (
                              <option key={p.id} value={p.id}>
                                {p.name} ({rateLabel} {p.rate_type})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <NumberField
                          label={t("customer.loanApplication.requestedAmountLabel")}
                          min={selectedProduct?.min_amount ?? "1"}
                          max={selectedProduct?.max_amount}
                          placeholder={t("customer.loanApplication.amountPlaceholder")}
                          value={requestedAmount}
                          onChange={setRequestedAmount}
                        />
                        {selectedProduct && (
                          <p
                            className={`mt-1 text-[11px] ${
                              amountInRange ? "text-slate-400" : "text-rose-600"
                            }`}
                          >
                            {t(
                              amountInRange
                                ? "customer.loanApplication.amountRangeHint"
                                : "customer.loanApplication.amountOutOfRangeError",
                              {
                                min: Number(selectedProduct.min_amount).toLocaleString("en-LK"),
                                max: Number(selectedProduct.max_amount).toLocaleString("en-LK"),
                              }
                            )}
                          </p>
                        )}
                      </div>

                      <div>
                        <NumberField
                          label={t("customer.loanApplication.tenureMonthsLabel")}
                          min={selectedProduct?.min_tenure_months ?? "1"}
                          max={selectedProduct?.max_tenure_months}
                          placeholder={t("customer.loanApplication.tenurePlaceholder")}
                          value={tenureMonths}
                          onChange={setTenureMonths}
                        />
                        {selectedProduct && (
                          <p
                            className={`mt-1 text-[11px] ${
                              tenureInRange ? "text-slate-400" : "text-rose-600"
                            }`}
                          >
                            {t(
                              tenureInRange
                                ? "customer.loanApplication.tenureRangeHint"
                                : "customer.loanApplication.tenureOutOfRangeError",
                              {
                                min: selectedProduct.min_tenure_months,
                                max: selectedProduct.max_tenure_months,
                              }
                            )}
                          </p>
                        )}
                      </div>

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
                          placeholder={t("customer.loanApplication.purposePlaceholder")}
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
                      {priorAboutYou && (
                        <ReaffirmBanner
                          date={priorApplicationDate}
                          question={t("customer.loanApplication.reaffirmAboutYouQuestion")}
                          value={aboutYouReaffirm}
                          onChange={setAboutYouReaffirm}
                        />
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <SelectField
                          label={t("customer.loanApplication.maritalStatusLabel")}
                          value={maritalStatus}
                          onChange={setMaritalStatus}
                          options={MARITAL_STATUS_OPTIONS}
                          disabled={aboutYouLocked}
                        />
                        <SelectField
                          label={t("customer.loanApplication.educationLevelLabel")}
                          value={educationLevel}
                          onChange={setEducationLevel}
                          options={EDUCATION_LEVEL_OPTIONS}
                          disabled={aboutYouLocked}
                        />
                        <SelectField
                          label={t("customer.loanApplication.occupationLabel")}
                          value={occupation}
                          onChange={setOccupation}
                          options={OCCUPATION_OPTIONS}
                          disabled={aboutYouLocked}
                        />
                        <SelectField
                          label={t("customer.loanApplication.employerCategoryLabel")}
                          value={employerCategory}
                          onChange={setEmployerCategory}
                          options={EMPLOYER_CATEGORY_OPTIONS}
                          disabled={aboutYouLocked}
                        />
                      </div>

                      <NumberField
                        label={t("customer.loanApplication.yearsEmployedLabel")}
                        min="0"
                        max="50"
                        placeholder={t("customer.loanApplication.yearsEmployedPlaceholder")}
                        value={yearsEmployed}
                        onChange={setYearsEmployed}
                        disabled={aboutYouLocked}
                      />

                      <div className="pt-2 border-t border-slate-100" />

                      <YesNoField
                        label={t("customer.loanApplication.hasAdditionalIncomeQuestion")}
                        value={hasAdditionalIncome}
                        onChange={setHasAdditionalIncome}
                        disabled={aboutYouLocked}
                      />
                      {hasAdditionalIncome === "yes" && (
                        <NumberField
                          label={t("customer.loanApplication.additionalIncomeLabel")}
                          min="0"
                          placeholder={t("customer.loanApplication.additionalIncomePlaceholder")}
                          value={additionalIncome}
                          onChange={setAdditionalIncome}
                          disabled={aboutYouLocked}
                        />
                      )}
                    </div>
                  )}

                  {/* Step 2 — Existing Credit */}
                  {step === 2 && (
                    <div className="space-y-4">
                      {priorCredit && (
                        <ReaffirmBanner
                          date={priorApplicationDate}
                          question={t("customer.loanApplication.reaffirmCreditQuestion")}
                          value={creditReaffirm}
                          onChange={setCreditReaffirm}
                        />
                      )}
                      <YesNoField
                        label={t("customer.loanApplication.hasExistingLoansQuestion")}
                        value={hasExistingLoans}
                        onChange={setHasExistingLoans}
                        disabled={creditLocked}
                      />
                      {hasExistingLoans === "yes" && (
                        <NumberField
                          label={t("customer.loanApplication.existingLoansCountLabel")}
                          min="1"
                          max="20"
                          placeholder={t("customer.loanApplication.existingLoansCountPlaceholder")}
                          value={existingLoans}
                          onChange={setExistingLoans}
                          disabled={creditLocked}
                        />
                      )}

                      <div className="pt-2 border-t border-slate-100" />

                      <YesNoField
                        label={t("customer.loanApplication.hasPreviousDefaultsQuestion")}
                        value={hasPreviousDefaults}
                        onChange={setHasPreviousDefaults}
                        disabled={creditLocked}
                      />
                      {hasPreviousDefaults === "yes" && (
                        <NumberField
                          label={t("customer.common.howManyTimes")}
                          min="1"
                          max="20"
                          placeholder={t("customer.loanApplication.previousDefaultsCountPlaceholder")}
                          value={previousDefaults}
                          onChange={setPreviousDefaults}
                          disabled={creditLocked}
                        />
                      )}
                    </div>
                  )}

                  {/* Step 3 — Guarantor Details */}
                  {step === 3 && (
                    <div className="space-y-4">
                      {priorGuarantor && (
                        <ReaffirmBanner
                          date={priorApplicationDate}
                          question={t("customer.loanApplication.reaffirmGuarantorQuestion")}
                          value={guarantorReaffirm}
                          onChange={setGuarantorReaffirm}
                        />
                      )}
                      <YesNoField
                        label={t("customer.loanApplication.isGuarantorQuestion")}
                        hint={t("customer.loanApplication.isGuarantorHint")}
                        value={isGuarantor}
                        onChange={setIsGuarantor}
                        disabled={guarantorLocked}
                      />

                      {isGuarantor === "yes" && (
                        <>
                          <NumberField
                            label={t("customer.loanApplication.guarantorExposureLabel")}
                            min="0"
                            placeholder={t("customer.loanApplication.guarantorExposurePlaceholder")}
                            value={guarantorExposure}
                            onChange={setGuarantorExposure}
                            disabled={guarantorLocked}
                          />

                          <div className="pt-2 border-t border-slate-100" />

                          <YesNoField
                            label={t("customer.loanApplication.guarantorCalledQuestion")}
                            hint={t("customer.loanApplication.guarantorCalledHint")}
                            value={guarantorCalled}
                            onChange={setGuarantorCalled}
                            disabled={guarantorLocked}
                          />
                          {guarantorCalled === "yes" && (
                            <NumberField
                              label={t("customer.common.howManyTimes")}
                              min="1"
                              max="10"
                              placeholder={t("customer.loanApplication.guarantorDefaultsCountPlaceholder")}
                              value={guarantorDefaults}
                              onChange={setGuarantorDefaults}
                              disabled={guarantorLocked}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Step 4 — CRIB */}
                  {step === 4 && (
                    <div className="space-y-4">
                      {priorCrib && (
                        <ReaffirmBanner
                          date={priorApplicationDate}
                          question={t("customer.loanApplication.reaffirmCribQuestion")}
                          value={cribReaffirm}
                          onChange={setCribReaffirm}
                        />
                      )}
                      <YesNoField
                        label={t("customer.loanApplication.knowsCribScoreQuestion")}
                        hint={t("customer.loanApplication.knowsCribScoreHint")}
                        value={knowsCribScore}
                        onChange={setKnowsCribScore}
                        disabled={cribLocked}
                      />
                      {knowsCribScore === "yes" && (
                        <NumberField
                          label={t("customer.loanApplication.cribScoreLabel")}
                          min="300"
                          max="900"
                          placeholder={t("customer.loanApplication.cribScorePlaceholder")}
                          value={cribScore}
                          disabled={cribLocked}
                          onChange={setCribScore}
                        />
                      )}
                    </div>
                  )}

                  {/* Step 5 — Security: guarantor + collateral for THIS loan (D5) */}
                  {step === 5 && (
                    <div className="space-y-5">
                      <YesNoField
                        label={t("customer.loanApplication.hasGuarantorQuestion")}
                        hint={t("customer.loanApplication.hasGuarantorHint")}
                        value={hasGuarantorForLoan}
                        onChange={setHasGuarantorForLoan}
                      />
                      {hasGuarantorForLoan === "yes" && (
                        <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                          <TextField
                            label={t("customer.loanApplication.guarantorFullNameLabel")}
                            placeholder={t("customer.loanApplication.guarantorFullNamePlaceholder")}
                            maxLength={150}
                            value={guarantorFullName}
                            onChange={setGuarantorFullName}
                          />
                          <TextField
                            label={t("customer.loanApplication.guarantorNicLabel")}
                            placeholder={t("customer.loanApplication.guarantorNicPlaceholder")}
                            maxLength={20}
                            value={guarantorNic}
                            onChange={setGuarantorNic}
                          />
                          {guarantorNic.trim() !== "" && !NIC_PATTERN.test(guarantorNic.trim()) && (
                            <p className="text-[11px] text-rose-600">
                              {t("customer.loanApplication.guarantorNicInvalid")}
                            </p>
                          )}
                          <TextField
                            label={t("customer.loanApplication.guarantorPhoneLabel")}
                            placeholder={t("customer.loanApplication.guarantorPhonePlaceholder")}
                            maxLength={20}
                            value={guarantorPhone}
                            onChange={setGuarantorPhone}
                          />
                          <TextField
                            label={t("customer.loanApplication.guarantorAddressLabel")}
                            maxLength={500}
                            value={guarantorAddress}
                            onChange={setGuarantorAddress}
                          />
                          <TextField
                            label={t("customer.loanApplication.guarantorRelationshipLabel")}
                            placeholder={t("customer.loanApplication.guarantorRelationshipPlaceholder")}
                            maxLength={50}
                            value={guarantorRelationship}
                            onChange={setGuarantorRelationship}
                          />
                          <NumberField
                            label={t("customer.loanApplication.guarantorAmountLabel")}
                            min="0"
                            max={requestedAmount || undefined}
                            placeholder={requestedAmount || "e.g. 500000"}
                            value={guarantorAmount}
                            onChange={setGuarantorAmount}
                          />
                          {guarantorAmount !== "" &&
                            requestedAmount !== "" &&
                            Number(guarantorAmount) > Number(requestedAmount) && (
                              <p className="text-[11px] text-rose-600">
                                {t("customer.loanApplication.guarantorAmountTooHigh")}
                              </p>
                            )}
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-100" />

                      <YesNoField
                        label={t("customer.loanApplication.hasCollateralQuestion")}
                        hint={t("customer.loanApplication.hasCollateralHint")}
                        value={hasCollateral}
                        onChange={setHasCollateral}
                      />
                      {hasCollateral === "yes" && (
                        <div className="space-y-3">
                          {collateralItems.map((item, index) => (
                            <div
                              key={index}
                              className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100 relative"
                            >
                              <button
                                type="button"
                                onClick={() => removeCollateralItem(index)}
                                className="absolute top-3 right-3 text-slate-300 hover:text-rose-500 transition-colors"
                                aria-label={t("customer.loanApplication.removeCollateralItem")}
                              >
                                <X className="w-4 h-4" />
                              </button>
                              {/* A plain <select>, not the shared SelectField:
                                  that component assumes value === label,
                                  but collateral types need a translated
                                  label distinct from their raw enum value. */}
                              <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                  {t("customer.loanApplication.collateralTypeLabel")}
                                </label>
                                <select
                                  value={item.type}
                                  onChange={(e) => updateCollateralItem(index, "type", e.target.value)}
                                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary bg-white"
                                >
                                  <option value="">
                                    {t("customer.loanApplication.collateralTypeSelectPlaceholder")}
                                  </option>
                                  {COLLATERAL_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {t(opt.labelKey)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <TextField
                                label={t("customer.loanApplication.collateralDescriptionLabel")}
                                placeholder={t("customer.loanApplication.collateralDescriptionPlaceholder")}
                                maxLength={1000}
                                value={item.description}
                                onChange={(v) => updateCollateralItem(index, "description", v)}
                              />
                              <NumberField
                                label={t("customer.loanApplication.collateralValueLabel")}
                                min="0"
                                placeholder={t("customer.loanApplication.collateralValuePlaceholder")}
                                value={item.estimatedValue}
                                onChange={(v) => updateCollateralItem(index, "estimatedValue", v)}
                              />
                              <TextField
                                label={t("customer.loanApplication.collateralOwnershipRefLabel")}
                                placeholder={t("customer.loanApplication.collateralOwnershipRefPlaceholder")}
                                maxLength={255}
                                value={item.ownershipReference}
                                onChange={(v) => updateCollateralItem(index, "ownershipReference", v)}
                              />
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={addCollateralItem}
                            className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 text-xs font-semibold text-slate-500 hover:border-brand-primary hover:text-brand-primary transition-colors"
                          >
                            + {t("customer.loanApplication.addCollateralItem")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 6 — Review */}
                  {step === 6 && (
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

                      {/* J1 — consent. Only asks for what's actually
                          missing/outdated; a returning applicant who already
                          granted current consent sees nothing extra here. */}
                      {!consentLoading && missingConsents.length > 0 && (
                        <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
                          <h4 className="text-xs font-bold text-slate-700">
                            {t("customer.loanApplication.consentSectionTitle")}
                          </h4>
                          {missingConsents.map((type) => {
                            const policy = consentPolicies.find((p) => p.consent_type === type);
                            return (
                              <label
                                key={type}
                                className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
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
                        <p className="text-[11px] text-rose-500 pt-2">{consentError}</p>
                      )}
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
                    disabled={
                      submitting ||
                      productsLoading ||
                      !products.length ||
                      consentLoading ||
                      (missingConsents.length > 0 && !allConsentsChecked)
                    }
                    className="px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {t("customer.loanApplication.submitApplication")}
                  </button>
                )}
              </div>

              {/* H3 — explicit save. Progress is already auto-saved on every
                  step change; this is the reassuring, visible version of that
                  for an applicant who wants to leave deliberately. */}
              <div className="flex justify-center mt-4">
                <button
                  type="button"
                  onClick={handleSaveAndExit}
                  disabled={savingDraft}
                  className="px-4 py-2 rounded-xl text-[11px] font-semibold text-slate-500 hover:text-brand-primary disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {savingDraft ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {t("customer.loanApplication.saveAndContinueLater")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* H3 — resume prompt. Shown before anything is prefilled, so the
          applicant explicitly chooses between their own saved work and a
          clean start rather than having either silently imposed. */}
      <AnimatePresence>
        {draftPromptOpen && savedDraft && (
          <motion.div
            key="draft-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8"
            >
              <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center mb-4">
                <History className="w-6 h-6 text-brand-primary" />
              </div>
              <h3 className="font-display font-bold text-lg text-slate-900">
                {t("customer.loanApplication.draftFoundTitle")}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t("customer.loanApplication.draftFoundBody", {
                  date: savedDraft.updated_at
                    ? new Date(savedDraft.updated_at).toLocaleDateString("en-LK", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "",
                  step: Math.min(savedDraft.step ?? 0, STEP_META.length - 1) + 1,
                  total: STEP_META.length,
                })}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleResumeDraft}
                  className="flex-1 px-5 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 transition-colors"
                >
                  {t("customer.loanApplication.draftResume")}
                </button>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="flex-1 px-5 py-3 rounded-xl text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:border-brand-primary transition-colors"
                >
                  {t("customer.loanApplication.draftStartFresh")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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

                        {/* The rate recommendedEmi above was actually
                            computed from (D3) — shown as its own tile so a
                            rate that differs from the product's advertised
                            one is explained, not just displayed. */}
                        <PricingBadge pricing={result.pricing} labels={pricingLabels(t)} detailed />

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

                    {/* When the credit policy declined this application
                        outright, the system rejects it automatically (D2)
                        — shown first and prominently, since it's the
                        headline of the result the applicant is reading. */}
                    <AdverseActionPanel
                      adverseAction={result.adverse_action}
                      labels={adverseActionLabels(t)}
                    />

                    {/* Credit policy — the deterministic checks, shown
                        beside the model's opinion rather than folded into
                        it. See CreditPolicyPanel. */}
                    <CreditPolicyPanel
                      policy={result.policy}
                      labels={creditPolicyLabels(t)}
                    />

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

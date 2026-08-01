// Must match loan-risk-model/src/data_generator.py exactly — these are the
// categories the risk model was actually trained on (see
// finance-backend/src/services/mlClient.service.js CATEGORY_VALUES).
export const GENDER_OPTIONS = ["Male", "Female"];
export const MARITAL_STATUS_OPTIONS = ["Single", "Married", "Divorced"];
export const EDUCATION_LEVEL_OPTIONS = [
  "Below O/L",
  "O/L",
  "A/L",
  "Bachelor",
  "Master or Higher",
];
export const OCCUPATION_OPTIONS = [
  "Private Sector",
  "Government",
  "Business Owner",
  "Teacher",
  "Driver",
  "IT/Tech",
  "Garment",
  "Other",
];
export const EMPLOYMENT_TYPE_OPTIONS = [
  "Permanent",
  "Contract",
  "Self-Employed",
  "Government",
];
export const EMPLOYER_CATEGORY_OPTIONS = [
  "Large Corporate",
  "SME",
  "Government",
  "Startup",
  "Other",
];

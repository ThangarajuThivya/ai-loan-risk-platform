const express = require("express");

const router = express.Router();

const { body } = require("express-validator");
const loanController = require("../controllers/loan.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { CATEGORY_VALUES } = require("../services/mlClient.service");

// Optional applicant-declared fields (mlClient.service.js DECLARABLE_FIELDS)
// — improve model input fidelity beyond the neutral defaults. Every field
// here is optional; omit/leave blank to keep the existing neutral default.
// Shared by /assess (customer, profile-backed) and /manual-assess
// (admin/staff, fully manual) since both accept the same declarable set.
const DECLARABLE_VALIDATORS = [
  body("marital_status")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.marital_status)
    .withMessage(`marital_status must be one of: ${CATEGORY_VALUES.marital_status.join(", ")}`),
  body("education_level")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.education_level)
    .withMessage(`education_level must be one of: ${CATEGORY_VALUES.education_level.join(", ")}`),
  body("occupation")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.occupation)
    .withMessage(`occupation must be one of: ${CATEGORY_VALUES.occupation.join(", ")}`),
  body("employer_category")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.employer_category)
    .withMessage(`employer_category must be one of: ${CATEGORY_VALUES.employer_category.join(", ")}`),
  body("years_employed")
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0, max: 50 })
    .withMessage("years_employed must be between 0 and 50")
    .toInt(),
  body("additional_income")
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage("additional_income must be zero or greater")
    .toFloat(),
  body("existing_loans")
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0, max: 20 })
    .withMessage("existing_loans must be between 0 and 20")
    .toInt(),
  body("previous_defaults")
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0, max: 20 })
    .withMessage("previous_defaults must be between 0 and 20")
    .toInt(),
  body("crib_score")
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 300, max: 900 })
    .withMessage("crib_score must be between 300 and 900")
    .toInt(),
  body("guarantor_exposure")
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0 })
    .withMessage("guarantor_exposure must be zero or greater")
    .toFloat(),
  body("guarantor_defaults")
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 0, max: 10 })
    .withMessage("guarantor_defaults must be between 0 and 10")
    .toInt(),
];

// POST /api/loans/assess — score + recommend for the logged-in customer.
router.post(
  "/assess",
  verifyToken,
  allowRoles("customer"),
  [
    body("product_id")
      .exists({ checkFalsy: true })
      .withMessage("product_id is required")
      .isInt({ gt: 0 })
      .withMessage("product_id must be a positive integer")
      .toInt(),
    body("requested_amount")
      .exists({ checkFalsy: true })
      .withMessage("requested_amount is required")
      .isFloat({ gt: 0 })
      .withMessage("requested_amount must be a positive number")
      .toFloat(),
    body("tenure_months")
      .exists({ checkFalsy: true })
      .withMessage("tenure_months is required")
      .isInt({ gt: 0 })
      .withMessage("tenure_months must be a positive integer")
      .toInt(),
    body("purpose")
      .optional({ nullable: true })
      .isString()
      .withMessage("purpose must be a string")
      .trim()
      .isLength({ max: 150 })
      .withMessage("purpose must be 150 characters or fewer"),
    body("language")
      .optional({ nullable: true })
      .isIn(["english", "sinhala", "tamil"])
      .withMessage("language must be one of: english, sinhala, tamil"),
    ...DECLARABLE_VALIDATORS,
  ],
  loanController.assess
);

// POST /api/loans/manual-assess — admin/staff standalone risk calculator.
// Unlike /assess, the caller supplies the full applicant profile directly
// (no customer_profiles row involved) and nothing is persisted — this is a
// quick what-if check, not a real loan application.
router.post(
  "/manual-assess",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    body("age")
      .exists({ checkFalsy: true })
      .withMessage("age is required")
      .isInt({ min: 18, max: 100 })
      .withMessage("age must be between 18 and 100")
      .toInt(),
    body("gender")
      .exists({ checkFalsy: true })
      .withMessage("gender is required")
      .isIn(["Male", "Female"])
      .withMessage("gender must be one of: Male, Female"),
    body("employment_type")
      .exists({ checkFalsy: true })
      .withMessage("employment_type is required")
      .isIn(["Permanent", "Contract", "Self-Employed", "Government"])
      .withMessage(
        "employment_type must be one of: Permanent, Contract, Self-Employed, Government"
      ),
    body("monthly_income")
      .exists({ checkFalsy: true })
      .withMessage("monthly_income is required")
      .isFloat({ gt: 0 })
      .withMessage("monthly_income must be a positive number")
      .toFloat(),
    body("monthly_expense")
      .exists({ checkFalsy: true })
      .withMessage("monthly_expense is required")
      .isFloat({ min: 0 })
      .withMessage("monthly_expense must be zero or greater")
      .toFloat(),
    body("requested_amount")
      .exists({ checkFalsy: true })
      .withMessage("requested_amount is required")
      .isFloat({ gt: 0 })
      .withMessage("requested_amount must be a positive number")
      .toFloat(),
    body("tenure_months")
      .exists({ checkFalsy: true })
      .withMessage("tenure_months is required")
      .isInt({ gt: 0 })
      .withMessage("tenure_months must be a positive integer")
      .toInt(),
    body("interest_rate")
      .exists({ checkFalsy: true })
      .withMessage("interest_rate is required")
      .isFloat({ min: 0, max: 60 })
      .withMessage("interest_rate must be between 0 and 60")
      .toFloat(),
    body("purpose")
      .optional({ nullable: true })
      .isString()
      .withMessage("purpose must be a string")
      .trim()
      .isLength({ max: 150 })
      .withMessage("purpose must be 150 characters or fewer"),
    body("language")
      .optional({ nullable: true })
      .isIn(["english", "sinhala", "tamil"])
      .withMessage("language must be one of: english, sinhala, tamil"),
    ...DECLARABLE_VALIDATORS,
  ],
  loanController.manualAssess
);

// POST /api/loans/emi-preview — public EMI calculator, no auth/persistence.
router.post(
  "/emi-preview",
  [
    body("principal")
      .exists({ checkFalsy: true })
      .withMessage("principal is required")
      .isFloat({ gt: 0 })
      .withMessage("principal must be a positive number")
      .toFloat(),
    body("annualRatePct")
      .exists()
      .withMessage("annualRatePct is required")
      .isFloat({ min: 0 })
      .withMessage("annualRatePct must be zero or greater")
      .toFloat(),
    body("tenureMonths")
      .exists({ checkFalsy: true })
      .withMessage("tenureMonths is required")
      .isInt({ gt: 0 })
      .withMessage("tenureMonths must be a positive integer")
      .toInt(),
  ],
  loanController.emiPreview
);

// GET /api/loans/products — public catalog (marketing /loans page + the
// customer apply form both read this; the data itself isn't sensitive).
router.get("/products", loanController.getProducts);

// GET /api/loans/my-applications — the logged-in customer's own applications.
router.get(
  "/my-applications",
  verifyToken,
  allowRoles("customer"),
  loanController.getMyApplications
);

// GET /api/loans/:id — one application (owner or admin only).
router.get("/:id", verifyToken, loanController.getApplicationById);

module.exports = router;

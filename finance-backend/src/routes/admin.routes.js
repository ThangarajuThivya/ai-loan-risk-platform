const router = require("express").Router();
const { body, param, query } = require("express-validator");
const admin = require("../controllers/admin.controller");
const loanController = require("../controllers/loan.controller");
const loanReportsController = require("../controllers/loanReports.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const {
  APPLICATION_STATUSES,
  targetStatusesForRoles,
} = require("../services/applicationStatus.service");
const { FEE_TYPES, CALC_METHODS } = require("../services/loanFees.service");

// Statuses a reviewer can ever move an application TO, derived from the
// status machine rather than hardcoded — whether a specific move is legal
// *from the application's current status* is decided in the model, under
// the row lock. This validator only rejects targets that are nonsense for
// a reviewer in any circumstances.
const REVIEWER_TARGET_STATUSES = targetStatusesForRoles("staff", "admin");

const {
  MIN_OFFER_VALIDITY_DAYS,
  MAX_OFFER_VALIDITY_DAYS,
} = require("../services/loanOffer.service");
const { OVERRIDE_REASON_CODES } = require("../services/decisionMatrix.service");
const { REASON_CODES: ADVERSE_ACTION_REASON_CODES } = require("../services/adverseAction.service");
const { VERIFICATION_STATUSES: DOCUMENT_VERIFICATION_STATUSES } = require("../services/loanDocument.service");

/**
 * Shape checks for staff-supplied offer terms. Shared by the approve route
 * (nested under `offer.`) and the standalone re-offer route (top level), so
 * both accept an identical body. Every field is optional — omitting them
 * all means "offer the recommended terms".
 *
 * Deliberately only checks TYPES and absolute sanity here. Whether an
 * amount is legal for the product, and what the EMI works out to, belongs
 * to loanOffer.service.js — duplicating it here would let the two drift.
 * Note there is no `emi` field at any level: the instalment is always
 * computed server-side and must not be settable by a client.
 */
const OFFER_TERM_VALIDATORS = (prefix) => [
  body(`${prefix}amount`)
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ gt: 0 })
    .withMessage("offer amount must be a positive number")
    .toFloat(),
  body(`${prefix}tenure_months`)
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ gt: 0 })
    .withMessage("offer tenure_months must be a positive integer")
    .toInt(),
  body(`${prefix}interest_rate`)
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0, max: 60 })
    .withMessage("offer interest_rate must be between 0 and 60")
    .toFloat(),
  body(`${prefix}validity_days`)
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: MIN_OFFER_VALIDITY_DAYS, max: MAX_OFFER_VALIDITY_DAYS })
    .withMessage(
      `offer validity_days must be between ${MIN_OFFER_VALIDITY_DAYS} and ${MAX_OFFER_VALIDITY_DAYS}`
    )
    .toInt(),
  // Fee waivers (I1). Which fees exist is decided server-side from the
  // product's config — this only says which of them staff are waiving.
  body(`${prefix}fee_waivers`)
    .optional({ nullable: true })
    .isArray()
    .withMessage("fee_waivers must be an array"),
  body(`${prefix}fee_waivers.*.fee_type`)
    .exists({ checkFalsy: true })
    .withMessage("each fee waiver needs a fee_type")
    .isIn(FEE_TYPES)
    .withMessage(`fee_type must be one of: ${FEE_TYPES.join(", ")}`),
  // Waiving a fee is discretionary pricing, so it must be justified — the
  // same rule the reject route applies to adverse-action notes and the
  // late-fee waiver applies to its own note.
  body(`${prefix}fee_waivers.*.reason`)
    .exists({ checkFalsy: true })
    .withMessage("a reason is required to waive a fee")
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("fee waiver reason must be 500 characters or fewer"),
];

// Staff get read access to the customer list (needed to advise applicants)
// but not the product-catalog write routes further down, which stay
// admin-only.
router.get(
  "/getAllCustomer",
  verifyToken,
  allowRoles("admin", "staff"),
  admin.getAllCustomers
);

// PATCH /api/admin/customers/:userId/kyc/verify (E2) — sign off on, or
// reject, a customer's declared NIC. See admin.controller.js
// verifyCustomerKyc.
router.patch(
  "/customers/:userId/kyc/verify",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("userId").isInt({ gt: 0 }).withMessage("userId must be a positive integer").toInt(),
    body("kyc_status")
      .exists({ checkFalsy: true })
      .withMessage("kyc_status is required")
      .isIn(["verified", "rejected"])
      .withMessage("kyc_status must be 'verified' or 'rejected'"),
    body("kyc_notes")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("kyc_notes must be a string")
      .trim()
      .isLength({ max: 500 })
      .withMessage("kyc_notes must be 500 characters or fewer"),
    // Rejecting without saying why leaves the customer with no idea what to
    // fix — same reasoning as the loan-document-verify route's note check.
    body("kyc_notes").custom((value, { req }) => {
      if (req.body.kyc_status === "rejected" && !String(value || "").trim()) {
        throw new Error("kyc_notes is required when rejecting a customer's KYC");
      }
      return true;
    }),
  ],
  admin.verifyCustomerKyc
);

// PATCH /api/admin/customers/:userId (K3) — edit a customer's contact
// details and declared monthly income on their behalf. See
// admin.controller.js updateCustomer.
router.patch(
  "/customers/:userId",
  verifyToken,
  allowRoles("admin"),
  [
    param("userId").isInt({ gt: 0 }).withMessage("userId must be a positive integer").toInt(),
    body("firstName")
      .exists({ checkFalsy: true })
      .withMessage("firstName is required")
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage("firstName must be 100 characters or fewer"),
    body("lastName")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage("lastName must be 100 characters or fewer"),
    body("email")
      .exists({ checkFalsy: true })
      .withMessage("email is required")
      .isEmail()
      .withMessage("email must be a valid email address")
      .normalizeEmail(),
    body("phone")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .trim()
      .isLength({ max: 20 })
      .withMessage("phone must be 20 characters or fewer"),
    body("monthlyIncome")
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage("monthlyIncome must be zero or greater")
      .toFloat(),
  ],
  admin.updateCustomer
);

// PATCH /api/admin/customers/:userId/status (K3) — activate, deactivate, or
// suspend a customer account. See admin.controller.js updateCustomerStatus.
router.patch(
  "/customers/:userId/status",
  verifyToken,
  allowRoles("admin"),
  [
    param("userId").isInt({ gt: 0 }).withMessage("userId must be a positive integer").toInt(),
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(["active", "inactive", "suspended"])
      .withMessage("status must be one of: active, inactive, suspended"),
  ],
  admin.updateCustomerStatus
);

// GET /api/admin/customers/:userId/bank-accounts (039) — every account this
// customer holds with the bank. See admin.controller.js
// listCustomerBankAccounts.
router.get(
  "/customers/:userId/bank-accounts",
  verifyToken,
  allowRoles("admin", "staff"),
  [param("userId").isInt({ gt: 0 }).withMessage("userId must be a positive integer").toInt()],
  admin.listCustomerBankAccounts
);

// POST /api/admin/customers/:userId/bank-accounts (039) — register an account
// the customer already holds at a branch, so offer acceptance reuses it
// instead of issuing a duplicate. Staff-only by design: see
// admin.controller.js registerCustomerBankAccount. Field shape is checked
// there via bankAccount.service.validateRegistration (which reuses the same
// isValidAccountNumber/isValidTextField rules as everything else), so these
// validators only cover presence and type.
router.post(
  "/customers/:userId/bank-accounts",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("userId").isInt({ gt: 0 }).withMessage("userId must be a positive integer").toInt(),
    body("branch").exists({ checkFalsy: true }).withMessage("branch is required").isString(),
    body("account_number")
      .exists({ checkFalsy: true })
      .withMessage("account_number is required")
      .isString(),
    body("account_holder")
      .exists({ checkFalsy: true })
      .withMessage("account_holder is required")
      .isString(),
  ],
  admin.registerCustomerBankAccount
);

// Loan product terms, shared by create + update (PUT sends the whole form,
// same as create — there is no partial-patch endpoint).
const PRODUCT_VALIDATORS = [
  body("name")
    .exists({ checkFalsy: true })
    .withMessage("name is required")
    .isString()
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage("name must be between 2 and 150 characters"),
  body("type")
    .exists({ checkFalsy: true })
    .withMessage("type is required")
    .isString()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("type must be between 2 and 50 characters"),
  body("min_amount")
    .exists({ checkFalsy: true })
    .withMessage("min_amount is required")
    .isFloat({ gt: 0 })
    .withMessage("min_amount must be a positive number")
    .toFloat(),
  body("max_amount")
    .exists({ checkFalsy: true })
    .withMessage("max_amount is required")
    .isFloat({ gt: 0 })
    .withMessage("max_amount must be a positive number")
    .toFloat(),
  body("min_tenure_months")
    .exists({ checkFalsy: true })
    .withMessage("min_tenure_months is required")
    .isInt({ gt: 0 })
    .withMessage("min_tenure_months must be a positive integer")
    .toInt(),
  body("max_tenure_months")
    .exists({ checkFalsy: true })
    .withMessage("max_tenure_months is required")
    .isInt({ gt: 0 })
    .withMessage("max_tenure_months must be a positive integer")
    .toInt(),
  body("interest_rate")
    .exists({ checkFalsy: true })
    .withMessage("interest_rate is required")
    .isFloat({ min: 0, max: 60 })
    .withMessage("interest_rate must be between 0 and 60")
    .toFloat(),
  // D3's risk-based pricing range (031). Both optional — a product with
  // neither prices every applicant at the flat interest_rate, exactly as
  // before D3. Shape only here; the both-or-neither and min ≤ rate ≤ max
  // rules are the body() custom validator below, because they need more
  // than one field to check.
  body("min_interest_rate")
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0, max: 60 })
    .withMessage("min_interest_rate must be between 0 and 60")
    .toFloat(),
  body("max_interest_rate")
    .optional({ nullable: true, checkFalsy: true })
    .isFloat({ min: 0, max: 60 })
    .withMessage("max_interest_rate must be between 0 and 60")
    .toFloat(),
  body("rate_type")
    .exists({ checkFalsy: true })
    .withMessage("rate_type is required")
    .isIn(["reducing", "flat"])
    .withMessage("rate_type must be one of: reducing, flat"),
  body("description")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("description must be 1000 characters or fewer"),
  body().custom((value) => {
    if (Number(value.max_amount) <= Number(value.min_amount)) {
      throw new Error("max_amount must be greater than min_amount");
    }
    if (Number(value.max_tenure_months) < Number(value.min_tenure_months)) {
      throw new Error(
        "max_tenure_months must be greater than or equal to min_tenure_months"
      );
    }
    // D3 pricing range — both-or-neither, so interestPricing.service.js
    // never has to guess whether a product missing ONE bound meant to be
    // risk-priced or flat. A blank field can arrive as undefined (omitted),
    // "" (an emptied input), or null (the admin UI's explicit "cleared"
    // value) — all three mean "not provided" here.
    const isBlank = (v) => v === undefined || v === null || v === "";
    const hasMin = !isBlank(value.min_interest_rate);
    const hasMax = !isBlank(value.max_interest_rate);
    if (hasMin !== hasMax) {
      throw new Error(
        "min_interest_rate and max_interest_rate must be set together, or both left blank"
      );
    }
    if (hasMin && hasMax) {
      const min = Number(value.min_interest_rate);
      const max = Number(value.max_interest_rate);
      const base = Number(value.interest_rate);
      if (min > max) {
        throw new Error("min_interest_rate must not be greater than max_interest_rate");
      }
      if (base < min || base > max) {
        throw new Error(
          "interest_rate must fall within min_interest_rate and max_interest_rate"
        );
      }
    }
    return true;
  }),
];

// POST /api/admin/products — add a loan product to the catalog.
router.post(
  "/products",
  verifyToken,
  allowRoles("admin"),
  PRODUCT_VALIDATORS,
  loanController.createProduct
);

// PUT /api/admin/products/:id — update a loan product's terms.
router.put(
  "/products/:id",
  verifyToken,
  allowRoles("admin"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    ...PRODUCT_VALIDATORS,
  ],
  loanController.updateProduct
);

// DELETE /api/admin/products/:id — remove a loan product (rejected if any
// loan applications reference it).
router.delete(
  "/products/:id",
  verifyToken,
  allowRoles("admin"),
  [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()],
  loanController.deleteProduct
);

// GET /api/admin/products/:id/fees (I1) — a product's configured fee
// schedule. Staff may read it (they need to explain a fee to a customer);
// only admin may change it. See loan.controller.js getProductFees.
router.get(
  "/products/:id/fees",
  verifyToken,
  allowRoles("admin", "staff"),
  [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()],
  loanController.getProductFees
);

// PUT /api/admin/products/:id/fees (I1) — replace the whole fee schedule.
// See loan.controller.js replaceProductFees.
router.put(
  "/products/:id/fees",
  verifyToken,
  allowRoles("admin"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("fees").isArray().withMessage("fees must be an array"),
    body("fees.*.fee_type")
      .exists({ checkFalsy: true })
      .withMessage("fee_type is required")
      .isIn(FEE_TYPES)
      .withMessage(`fee_type must be one of: ${FEE_TYPES.join(", ")}`),
    body("fees.*.label")
      .exists({ checkFalsy: true })
      .withMessage("label is required")
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage("label must be 100 characters or fewer"),
    body("fees.*.calc_method")
      .exists({ checkFalsy: true })
      .withMessage("calc_method is required")
      .isIn(CALC_METHODS)
      .withMessage(`calc_method must be one of: ${CALC_METHODS.join(", ")}`),
    body("fees.*.rate_or_amount")
      .exists()
      .withMessage("rate_or_amount is required")
      .isFloat({ min: 0 })
      .withMessage("rate_or_amount must be zero or greater")
      .toFloat(),
    body("fees.*.min_amount")
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0 })
      .withMessage("min_amount must be zero or greater")
      .toFloat(),
    body("fees.*.max_amount")
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0 })
      .withMessage("max_amount must be zero or greater")
      .toFloat(),
    body("fees.*.active").optional().isBoolean().withMessage("active must be a boolean").toBoolean(),
  ],
  loanController.replaceProductFees
);

// GET /api/admin/portfolio-dashboard (F1) — approval rates, disbursement
// volumes, portfolio-at-risk, and product/risk distribution across the
// whole book. See loanReports.controller.js.
router.get(
  "/portfolio-dashboard",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    query("months")
      .optional({ nullable: true, checkFalsy: true })
      .isInt({ min: 1, max: 36 })
      .withMessage("months must be between 1 and 36")
      .toInt(),
  ],
  loanReportsController.getPortfolioDashboard
);

// GET /api/admin/applications — all loan applications, optional ?status= filter.
// Staff review applications too, same as admin.
router.get(
  "/applications",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    query("status")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(APPLICATION_STATUSES)
      .withMessage(`status must be one of: ${APPLICATION_STATUSES.join(", ")}`),
  ],
  loanController.getAllApplications
);

// GET /api/admin/override-reasons — the standardized D2 override reason
// codes, optionally narrowed to one direction. See loan.controller.js
// getOverrideReasons.
router.get(
  "/override-reasons",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    query("direction")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["lenient", "strict"])
      .withMessage("direction must be 'lenient' or 'strict'"),
  ],
  loanController.getOverrideReasons
);

// GET /api/admin/adverse-action-reasons — the standardized D4 adverse-
// action reason codes. See loan.controller.js getAdverseActionReasons.
router.get(
  "/adverse-action-reasons",
  verifyToken,
  allowRoles("admin", "staff"),
  loanController.getAdverseActionReasons
);

// PATCH /api/admin/applications/:id/status — move an application along its
// lifecycle (see src/services/applicationStatus.service.js).
router.patch(
  "/applications/:id/status",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(REVIEWER_TARGET_STATUSES)
      .withMessage(`status must be one of: ${REVIEWER_TARGET_STATUSES.join(", ")}`),
    body("note")
      .optional({ nullable: true })
      .isString()
      .withMessage("note must be a string")
      .trim()
      .isLength({ max: 500 })
      .withMessage("note must be 500 characters or fewer"),
    // Requesting more info without saying what's needed would leave the
    // applicant staring at a status change with no explanation — the note
    // IS the request, so it can't be optional for this one target status.
    body("note").custom((value, { req }) => {
      if (req.body.status === "more_info_required" && !String(value || "").trim()) {
        throw new Error("note is required when requesting more information");
      }
      return true;
    }),
    // D2 override justification. Only the SHAPE is checked here — whether an
    // override is required at all, and whether this particular code is
    // appropriate for the direction it is going, depends on the
    // application's stored matrix recommendation and is decided in
    // loan.controller.js via decisionMatrix.service.js requiresOverride.
    body("override_reason_code")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(OVERRIDE_REASON_CODES)
      .withMessage(
        `override_reason_code must be one of: ${OVERRIDE_REASON_CODES.join(", ")}`
      ),
    // D4 adverse-action reasons. Only the SHAPE is checked here — whether
    // it's REQUIRED (status === 'rejected') and non-empty is decided in
    // loan.controller.js, which also has the application's own state to
    // build a suggested list from.
    body("reason_codes")
      .optional({ nullable: true })
      .isArray()
      .withMessage("reason_codes must be an array"),
    body("reason_codes.*")
      .isIn(ADVERSE_ACTION_REASON_CODES)
      .withMessage(
        `each reason code must be one of: ${ADVERSE_ACTION_REASON_CODES.join(", ")}`
      ),
    // Optional counter-offer terms, only meaningful when approving. Shape
    // is validated here; whether the numbers are sane for the product is
    // decided by loanOffer.service.js buildOfferTerms, which owns the
    // fallbacks and the product-limit checks.
    ...OFFER_TERM_VALIDATORS("offer."),
  ],
  loanController.updateApplicationStatus
);

// POST /api/admin/applications/:id/offer — (re-)issue an offer against an
// application already in 'approved'. See loan.controller.js reissueOffer.
router.post(
  "/applications/:id/offer",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("note")
      .optional({ nullable: true })
      .isString()
      .withMessage("note must be a string")
      .trim()
      .isLength({ max: 500 })
      .withMessage("note must be 500 characters or fewer"),
    ...OFFER_TERM_VALIDATORS(""),
  ],
  loanController.reissueOffer
);

// POST /api/admin/applications/:id/payments — record a repayment received
// against a disbursed loan. See loan.controller.js recordPayment.
router.post(
  "/applications/:id/payments",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("amount")
      .exists({ checkFalsy: true })
      .withMessage("amount is required")
      .isFloat({ gt: 0 })
      .withMessage("amount must be a positive number")
      .toFloat(),
    // The VALUE date, which may legitimately precede today — a Friday
    // branch deposit keyed in on Monday is still a Friday payment, and
    // arrears must be judged on when the money arrived. Future dates are
    // refused: nobody can pay tomorrow.
    body("paid_on")
      .exists({ checkFalsy: true })
      .withMessage("paid_on is required")
      .isISO8601({ strict: true })
      .withMessage("paid_on must be a YYYY-MM-DD date")
      .custom((value) => {
        const today = new Date();
        const asDay = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
        const todayUtc = new Date(
          Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
        );
        if (asDay > todayUtc) throw new Error("paid_on cannot be in the future");
        return true;
      }),
    body("method")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["cash", "bank_transfer", "cheque", "standing_order", "other"])
      .withMessage("method must be one of: cash, bank_transfer, cheque, standing_order, other"),
    body("payment_type")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["installment", "settlement"])
      .withMessage("payment_type must be one of: installment, settlement"),
    body("external_ref")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage("external_ref must be 100 characters or fewer"),
    body("note")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("note must be 500 characters or fewer"),
  ],
  loanController.recordPayment
);

// PATCH /api/admin/applications/:id/schedule/:scheduleId/waive-fee — waive
// whatever remains of one installment's late fee. See
// loan.controller.js waiveLateFee.
router.patch(
  "/applications/:id/schedule/:scheduleId/waive-fee",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("scheduleId")
      .isInt({ gt: 0 })
      .withMessage("scheduleId must be a positive integer")
      .toInt(),
    body("note")
      .optional({ nullable: true })
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage("note must be 500 characters or fewer"),
  ],
  loanController.waiveLateFee
);

// GET /api/admin/applications/:id/beneficiary-account (H4) — where a
// disbursement would send funds, and whether that's even possible yet. See
// loan.controller.js getApplicationBeneficiaryAccount.
router.get(
  "/applications/:id/beneficiary-account",
  verifyToken,
  allowRoles("admin", "staff"),
  loanController.getApplicationBeneficiaryAccount
);

// PATCH /api/admin/applications/:id/collateral/:collateralId/verify — sign
// off on, or reject, one pledged collateral item (D5). See
// loan.controller.js verifyCollateral.
router.patch(
  "/applications/:id/collateral/:collateralId/verify",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("collateralId")
      .isInt({ gt: 0 })
      .withMessage("collateralId must be a positive integer")
      .toInt(),
    body("verification_status")
      .exists({ checkFalsy: true })
      .withMessage("verification_status is required")
      .isIn(["verified", "rejected"])
      .withMessage("verification_status must be 'verified' or 'rejected'"),
  ],
  loanController.verifyCollateral
);

// PATCH /api/admin/applications/:id/documents/:docId/verify — sign off on,
// or reject, one uploaded document (E1). Advisory only — does not touch the
// application's own status. See loan.controller.js verifyDocument.
router.patch(
  "/applications/:id/documents/:docId/verify",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("docId").isInt({ gt: 0 }).withMessage("docId must be a positive integer").toInt(),
    body("verification_status")
      .exists({ checkFalsy: true })
      .withMessage("verification_status is required")
      .isIn(DOCUMENT_VERIFICATION_STATUSES.filter((s) => s !== "pending"))
      .withMessage("verification_status must be 'verified' or 'rejected'"),
    body("verification_notes")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("verification_notes must be a string")
      .trim()
      .isLength({ max: 500 })
      .withMessage("verification_notes must be 500 characters or fewer"),
    // Rejecting without saying why would leave the customer with no idea
    // what to fix — same reasoning as the more_info_required note check on
    // the application status route above.
    body("verification_notes").custom((value, { req }) => {
      if (req.body.verification_status === "rejected" && !String(value || "").trim()) {
        throw new Error("verification_notes is required when rejecting a document");
      }
      return true;
    }),
  ],
  loanController.verifyDocument
);

// GET /api/admin/guarantors/:nic/exposure — one guarantor's full standing
// across the system (D5). See loan.controller.js getGuarantorExposure.
router.get(
  "/guarantors/:nic/exposure",
  verifyToken,
  allowRoles("admin", "staff"),
  loanController.getGuarantorExposure
);

// GET /api/admin/staff — list staff accounts.
router.get("/staff", verifyToken, allowRoles("admin"), admin.getAllStaff);

// Name/email/phone, shared by create + update (PUT sends the whole form,
// same as create minus password — there is no partial-patch endpoint).
const STAFF_DETAIL_VALIDATORS = [
  body("firstName")
    .exists({ checkFalsy: true })
    .withMessage("firstName is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("firstName must be 100 characters or fewer"),
  body("lastName")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage("lastName must be 100 characters or fewer"),
  body("email")
    .exists({ checkFalsy: true })
    .withMessage("email is required")
    .isEmail()
    .withMessage("email must be a valid email address")
    .normalizeEmail(),
  body("phone")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 20 })
    .withMessage("phone must be 20 characters or fewer"),
];

// POST /api/admin/createStaff — provision a new staff account. Staff have no
// self-service signup path, so this is the only way one gets created; login
// itself is already role-agnostic (POST /api/auth/login), so no separate
// staff login endpoint is needed.
router.post(
  "/createStaff",
  verifyToken,
  allowRoles("admin"),
  [
    ...STAFF_DETAIL_VALIDATORS,
    body("password")
      .exists({ checkFalsy: true })
      .withMessage("password is required")
      .isLength({ min: 8 })
      .withMessage("password must be at least 8 characters"),
  ],
  admin.createStaff
);

// PUT /api/admin/staff/:id — edit a staff account's name/email/phone.
router.put(
  "/staff/:id",
  verifyToken,
  allowRoles("admin"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    ...STAFF_DETAIL_VALIDATORS,
  ],
  admin.updateStaff
);

// PATCH /api/admin/staff/:id/status — activate/deactivate/suspend a staff account.
router.patch(
  "/staff/:id/status",
  verifyToken,
  allowRoles("admin"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(["active", "inactive", "suspended"])
      .withMessage("status must be one of: active, inactive, suspended"),
  ],
  admin.updateStaffStatus
);

// DELETE /api/admin/staff/:id — remove a staff account.
router.delete(
  "/staff/:id",
  verifyToken,
  allowRoles("admin"),
  [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()],
  admin.deleteStaff
);

module.exports = router;
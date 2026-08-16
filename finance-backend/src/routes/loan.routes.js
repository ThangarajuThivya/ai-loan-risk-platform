const express = require("express");

const router = express.Router();

const { body, param } = require("express-validator");
const loanController = require("../controllers/loan.controller");
const { loanDocumentUpload } = require("../config/multer");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { CATEGORY_VALUES } = require("../services/mlClient.service");
const {
  COLLATERAL_TYPES,
  isValidNic,
} = require("../services/collateralGuarantor.service");
const { DOCUMENT_TYPES, DOCUMENT_SIDES } = require("../services/loanDocument.service");
const repaymentController = require("../controllers/repayment.controller");
const { PAYMENT_KINDS } = require("../services/repaymentQuote.service");

// Multer reports a rejected file (too large, wrong type) by calling next()
// with an error, which would otherwise fall through to Express's default
// HTML error page as a 500. Wrapping the middleware turns those into the
// 400 + JSON shape every other endpoint in this router returns. Mirrors
// fxExchange.routes.js's uploadSupportingDocument.
function uploadLoanDocument(req, res, next) {
  loanDocumentUpload.single("document")(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "The file is too large — supporting documents must be 5 MB or smaller."
        : err.message || "Failed to read the uploaded file.";
    return res.status(400).json({ message });
  });
}

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

// D5 — real guarantor(s)/collateral nominated FOR this application
// (migration 033), distinct from the self-declared guarantor_* fields
// above (the applicant's OWN liability elsewhere — see
// creditPolicy.service.js GUARANTOR_RELIABILITY vs GUARANTOR_DEFAULTS).
// Shape only here; NIC-lookup-based exposure, the guaranteed_amount ≤
// requested_amount cross-check, and persistence all happen in
// loan.controller.js#assess, which has requested_amount to compare against
// and the DB access this module deliberately doesn't.
const SECURITY_VALIDATORS = [
  body("guarantors")
    .optional({ nullable: true })
    .isArray({ max: 5 })
    .withMessage("guarantors must be an array of at most 5 entries"),
  body("guarantors.*.nic")
    .exists({ checkFalsy: true })
    .withMessage("each guarantor's nic is required")
    .custom((value) => isValidNic(value))
    .withMessage(
      "each guarantor's nic must be a valid Sri Lankan NIC (9 digits + V/X, or 12 digits)"
    ),
  body("guarantors.*.full_name")
    .exists({ checkFalsy: true })
    .withMessage("each guarantor's full_name is required")
    .isString()
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage("each guarantor's full_name must be between 2 and 150 characters"),
  body("guarantors.*.phone")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 20 })
    .withMessage("each guarantor's phone must be 20 characters or fewer"),
  body("guarantors.*.address")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage("each guarantor's address must be 500 characters or fewer"),
  body("guarantors.*.relationship_to_applicant")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage("each guarantor's relationship_to_applicant must be 50 characters or fewer"),
  body("guarantors.*.guaranteed_amount")
    .exists({ checkFalsy: true })
    .withMessage("each guarantor's guaranteed_amount is required")
    .isFloat({ gt: 0 })
    .withMessage("each guarantor's guaranteed_amount must be a positive number")
    .toFloat(),
  body("collateral")
    .optional({ nullable: true })
    .isArray({ max: 10 })
    .withMessage("collateral must be an array of at most 10 entries"),
  body("collateral.*.collateral_type")
    .exists({ checkFalsy: true })
    .withMessage("each collateral item's collateral_type is required")
    .isIn(COLLATERAL_TYPES)
    .withMessage(`each collateral item's collateral_type must be one of: ${COLLATERAL_TYPES.join(", ")}`),
  body("collateral.*.description")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("each collateral item's description must be 1000 characters or fewer"),
  body("collateral.*.estimated_value")
    .exists({ checkFalsy: true })
    .withMessage("each collateral item's estimated_value is required")
    .isFloat({ gt: 0 })
    .withMessage("each collateral item's estimated_value must be a positive number")
    .toFloat(),
  body("collateral.*.valuation_date")
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage("each collateral item's valuation_date must be a valid date (YYYY-MM-DD)"),
  body("collateral.*.ownership_reference")
    .optional({ nullable: true, checkFalsy: true })
    .isString()
    .trim()
    .isLength({ max: 255 })
    .withMessage("each collateral item's ownership_reference must be 255 characters or fewer"),
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
    ...SECURITY_VALIDATORS,
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

// /api/loans/draft — the logged-in customer's single unsubmitted wizard
// draft (H3). MUST stay above the "/:id" catch-all below, or "draft" is
// parsed as an application id. Always scoped to the token's user_id, so
// there is no id to tamper with.
router.get("/draft", verifyToken, allowRoles("customer"), loanController.getDraft);
router.put("/draft", verifyToken, allowRoles("customer"), loanController.saveDraft);
router.delete("/draft", verifyToken, allowRoles("customer"), loanController.deleteDraft);

// GET /api/loans/:id — one application (owner or admin only).
router.get("/:id", verifyToken, loanController.getApplicationById);

// GET /api/loans/:id/history — the full transition audit trail (owner,
// staff, or admin). See loan.controller.js getApplicationHistory.
router.get("/:id/history", verifyToken, loanController.getApplicationHistory);

// GET /api/loans/:id/adverse-actions — the full adverse-action history
// (owner, staff, or admin; D4). See loan.controller.js
// getApplicationAdverseActions.
router.get(
  "/:id/adverse-actions",
  verifyToken,
  loanController.getApplicationAdverseActions
);

// GET /api/loans/:id/security — the guarantor(s)/collateral pledged against
// this application (owner, staff, or admin; D5). See loan.controller.js
// getApplicationSecurity.
router.get("/:id/security", verifyToken, loanController.getApplicationSecurity);

// GET /api/loans/:id/schedule — the repayment calendar (owner, staff, or
// admin). See loan.controller.js getRepaymentSchedule.
router.get("/:id/schedule", verifyToken, loanController.getRepaymentSchedule);

// GET /api/loans/:id/decision-letter (F3) — a formatted PDF letter
// confirming an approval or rejection (owner, staff, or admin). See
// loan.controller.js getDecisionLetter.
router.get("/:id/decision-letter", verifyToken, loanController.getDecisionLetter);

// GET /api/loans/:id/statement.csv (F3) — the repayment schedule as a CSV
// statement (owner, staff, or admin). See loan.controller.js
// getLoanStatementCsv.
router.get("/:id/statement.csv", verifyToken, loanController.getLoanStatementCsv);

// GET /api/loans/:id/payments — payments recorded against this loan
// (owner, staff, or admin).
router.get("/:id/payments", verifyToken, loanController.getPayments);

// --- Customer-initiated repayments (040) -----------------------------------
// All borrower-only: paying is something only the borrower does, so these are
// role-gated to 'customer' AND ownership-checked in the controller, unlike the
// read endpoints above which also admit staff. Staff record payments through
// POST /api/admin/applications/:id/payments instead.

// GET /api/loans/:id/repayment-options — every amount payable right now.
router.get(
  "/:id/repayment-options",
  verifyToken,
  allowRoles("customer"),
  [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()],
  repaymentController.getRepaymentOptions
);

// POST /api/loans/:id/payments/checkout — open a gateway session.
//
// `amount` is validated only for shape. It is IGNORED unless kind is
// 'custom', and even then repaymentQuote.service.js bounds it against the
// real outstanding balance — the server, not this body, decides the charge.
router.post(
  "/:id/payments/checkout",
  verifyToken,
  allowRoles("customer"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("kind")
      .exists({ checkFalsy: true })
      .withMessage("kind is required")
      .isIn(PAYMENT_KINDS)
      .withMessage(`kind must be one of: ${PAYMENT_KINDS.join(", ")}`),
    body("amount")
      .optional({ nullable: true })
      .isFloat({ gt: 0 })
      .withMessage("amount must be a positive number")
      .toFloat(),
    body("amount").custom((value, { req }) => {
      if (req.body.kind === "custom" && (value === undefined || value === null || value === "")) {
        throw new Error("amount is required when kind is 'custom'");
      }
      return true;
    }),
  ],
  repaymentController.createCheckout
);

// GET /api/loans/:id/payments/intents/:sessionId — poll an attempt, and
// reconcile it against the gateway if the webhook has not landed.
router.get(
  "/:id/payments/intents/:sessionId",
  verifyToken,
  allowRoles("customer"),
  [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()],
  repaymentController.getIntentStatus
);

// GET /api/loans/:id/payments/:paymentId/receipt.pdf — owner, staff or admin.
// Declared AFTER the /payments/intents route so 'intents' is never captured
// as a :paymentId.
router.get(
  "/:id/payments/:paymentId/receipt.pdf",
  verifyToken,
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("paymentId").isInt({ gt: 0 }).withMessage("paymentId must be a positive integer").toInt(),
  ],
  repaymentController.getPaymentReceipt
);

// PATCH /api/loans/:id/withdraw — a customer pulls back their own
// application. See loan.controller.js withdrawApplication for why a
// missing application and someone else's application both come back 404.
router.patch(
  "/:id/withdraw",
  verifyToken,
  allowRoles("customer"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("note")
      .optional({ nullable: true })
      .isString()
      .withMessage("note must be a string")
      .trim()
      .isLength({ max: 500 })
      .withMessage("note must be 500 characters or fewer"),
  ],
  loanController.withdrawApplication
);

// PATCH /api/loans/:id/respond — a customer answers a staff "more
// information required" request. Unlike withdraw's note, this one is
// required: the whole point of the endpoint is to record what the
// applicant said, so an empty response would defeat it.
router.patch(
  "/:id/respond",
  verifyToken,
  allowRoles("customer"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("note")
      .exists({ checkFalsy: true })
      .withMessage("note is required — describe what you're providing")
      .isString()
      .withMessage("note must be a string")
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage("note must be between 1 and 1000 characters"),
  ],
  loanController.respondToInfoRequest
);

// Applicant's two possible answers to an outstanding offer (migration 023).
// The note is optional on both — unlike /respond, the meaning of the action
// is carried by which endpoint was called, not by what was typed.
const OFFER_RESPONSE_VALIDATORS = [
  param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
  body("note")
    .optional({ nullable: true })
    .isString()
    .withMessage("note must be a string")
    .trim()
    .isLength({ max: 500 })
    .withMessage("note must be 500 characters or fewer"),
];

// PATCH /api/loans/:id/offer/accept — accept the offer; application → accepted.
router.patch(
  "/:id/offer/accept",
  verifyToken,
  allowRoles("customer"),
  OFFER_RESPONSE_VALIDATORS,
  loanController.acceptOffer
);

// PATCH /api/loans/:id/offer/decline — decline the offer; application → withdrawn.
router.patch(
  "/:id/offer/decline",
  verifyToken,
  allowRoles("customer"),
  OFFER_RESPONSE_VALIDATORS,
  loanController.declineOffer
);

// POST /api/loans/:id/documents (customer, own) — upload one supporting
// document (E1). Multipart — the file field is named "document". auth runs
// before multer so an unauthenticated request never triggers a disk write;
// mirrors fxExchange.routes.js's document upload route ordering.
router.post(
  "/:id/documents",
  verifyToken,
  allowRoles("customer"),
  uploadLoanDocument,
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("document_type")
      .exists({ checkFalsy: true })
      .withMessage("document_type is required")
      .isIn(DOCUMENT_TYPES)
      .withMessage(`document_type must be one of: ${DOCUMENT_TYPES.join(", ")}`),
    // Optional: only meaningful for a two-sided document submitted as a
    // photo (see TWO_SIDED_DOCUMENT_TYPES) — loanController.uploadDocument
    // rejects it for any other document_type.
    body("side")
      .optional({ checkFalsy: true })
      .isIn(DOCUMENT_SIDES)
      .withMessage(`side must be one of: ${DOCUMENT_SIDES.join(", ")}`),
  ],
  loanController.uploadDocument
);

// GET /api/loans/:id/documents — metadata only (owner, staff, or admin; E1).
router.get(
  "/:id/documents",
  verifyToken,
  [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()],
  loanController.listDocuments
);

// GET /api/loans/:id/documents/:docId/download (owner, staff, or admin; E1).
router.get(
  "/:id/documents/:docId/download",
  verifyToken,
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("docId").isInt({ gt: 0 }).withMessage("docId must be a positive integer").toInt(),
  ],
  loanController.downloadDocument
);

// GET /api/loans/:id/documents/:docId/extraction — the advisory OCR /
// extraction result for one document. Same guard as the download route
// above (owner, staff, or admin), because it exposes the document's
// contents in field form.
router.get(
  "/:id/documents/:docId/extraction",
  verifyToken,
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("docId").isInt({ gt: 0 }).withMessage("docId must be a positive integer").toInt(),
  ],
  loanController.getDocumentExtraction
);

// POST /api/loans/:id/documents/:docId/extraction/retry — re-run OCR/
// extraction on demand (owner, staff, or admin). See loan.controller.js
// retryDocumentExtraction.
router.post(
  "/:id/documents/:docId/extraction/retry",
  verifyToken,
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("docId").isInt({ gt: 0 }).withMessage("docId must be a positive integer").toInt(),
  ],
  loanController.retryDocumentExtraction
);

// DELETE /api/loans/:id/documents/:docId (customer, own; E1) — only while
// the document is still pending review. See loan.controller.js
// deleteDocument for why an already-reviewed document 409s instead.
router.delete(
  "/:id/documents/:docId",
  verifyToken,
  allowRoles("customer"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    param("docId").isInt({ gt: 0 }).withMessage("docId must be a positive integer").toInt(),
  ],
  loanController.deleteDocument
);

module.exports = router;

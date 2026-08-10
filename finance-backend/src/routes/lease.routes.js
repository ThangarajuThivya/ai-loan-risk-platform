"use strict";

/**
 * Lease routes — mounted at /api/leases.
 *
 * A sibling of loan.routes.js, not a section within it. Leasing is a
 * distinct financing type, and the URL space says so: a lease is never
 * /api/loans/anything.
 */

const express = require("express");

const router = express.Router();

const { body, param } = require("express-validator");
const lease = require("../controllers/leaseApplication.controller");
const review = require("../controllers/leaseReview.controller");
const downPayment = require("../controllers/leaseDownPayment.controller");
const rental = require("../controllers/leaseRental.controller");
const { targetStatusesForRoles } = require("../services/leaseStatus.service");
const { LEASE_FEE_TYPES } = require("../services/leaseFees.service");

/** Every status staff/admin can move a lease application to. */
const STAFF_TARGET_STATUSES = targetStatusesForRoles("staff", "admin");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const { loanDocumentUpload } = require("../config/multer");
const { CATEGORY_VALUES } = require("../services/mlClient.service");
const { VEHICLE_CONDITIONS } = require("../services/leasing.service");
const { FUEL_TYPES, TRANSMISSIONS } = require("../services/leaseVehicle.service");

/** Document types a lease application accepts (045's ENUM). */
const LEASE_DOCUMENT_TYPES = [
  "national_id",
  "payslip",
  "bank_statement",
  "vehicle_invoice",
  "valuation_report",
  "cr_copy",
  "lease_agreement",
  "release_letter",
  "other",
];

// Multer signals a rejected file (too large, wrong type) by calling next()
// with an error, which would otherwise surface as Express's HTML 500 page.
// This turns those into the 400 + JSON shape every other endpoint returns.
function uploadLeaseDocument(req, res, next) {
  loanDocumentUpload.single("document")(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "The file is too large — supporting documents must be 5 MB or smaller."
        : err.message || "Failed to read the uploaded file.";
    return res.status(400).json({ message });
  });
}

/**
 * Optional applicant-declared model inputs, shared with the loan path.
 * Identical set, because the SAME model scores both and a lessee must not be
 * describable in a way a borrower is not.
 */
const DECLARABLE_VALIDATORS = [
  body("marital_status")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.marital_status),
  body("education_level")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.education_level),
  body("occupation").optional({ nullable: true, checkFalsy: true }).isIn(CATEGORY_VALUES.occupation),
  body("employer_category")
    .optional({ nullable: true, checkFalsy: true })
    .isIn(CATEGORY_VALUES.employer_category),
  body("years_employed").optional({ nullable: true, checkFalsy: true }).isInt({ min: 0, max: 50 }).toInt(),
  body("additional_income").optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).toFloat(),
  body("existing_loans").optional({ nullable: true, checkFalsy: true }).isInt({ min: 0, max: 20 }).toInt(),
  body("previous_defaults").optional({ nullable: true, checkFalsy: true }).isInt({ min: 0, max: 20 }).toInt(),
  body("crib_score").optional({ nullable: true, checkFalsy: true }).isInt({ min: 300, max: 900 }).toInt(),
  body("guarantor_exposure").optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).toFloat(),
  body("guarantor_defaults").optional({ nullable: true, checkFalsy: true }).isInt({ min: 0, max: 10 }).toInt(),
];

/**
 * The vehicle. Unlike the loan path's reverted equivalent, `vehicle` itself
 * is REQUIRED here — a lease without one is not a lease. Field-level
 * coherence (a used vehicle needing a registration number, the price leaving
 * room for a down payment) is decided in leaseVehicle.service, which can
 * report every problem at once; this layer polices shape and range.
 */
const VEHICLE_VALIDATORS = [
  body("vehicle").exists().withMessage("vehicle is required").isObject(),
  body("vehicle.supplier_id").optional({ nullable: true, checkFalsy: true }).isInt({ gt: 0 }).toInt(),
  body("vehicle.condition_type")
    .exists({ checkFalsy: true })
    .withMessage("vehicle.condition_type is required")
    .isIn(VEHICLE_CONDITIONS)
    .withMessage(`vehicle.condition_type must be one of: ${VEHICLE_CONDITIONS.join(", ")}`),
  body("vehicle.make").exists({ checkFalsy: true }).isString().trim().isLength({ max: 60 }),
  body("vehicle.model").exists({ checkFalsy: true }).isString().trim().isLength({ max: 80 }),
  body("vehicle.year_of_manufacture").exists({ checkFalsy: true }).isInt({ min: 1950, max: 2200 }).toInt(),
  body("vehicle.registration_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 20 }),
  body("vehicle.chassis_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 50 }),
  body("vehicle.engine_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 50 }),
  body("vehicle.fuel_type").optional({ nullable: true, checkFalsy: true }).isIn(FUEL_TYPES),
  body("vehicle.transmission").optional({ nullable: true, checkFalsy: true }).isIn(TRANSMISSIONS),
  body("vehicle.mileage_km").optional({ nullable: true, checkFalsy: true }).isInt({ min: 0, max: 2000000 }).toInt(),
  body("vehicle.invoice_price")
    .exists({ checkFalsy: true })
    .withMessage("vehicle.invoice_price is required")
    .isFloat({ gt: 0 })
    .toFloat(),
  body("vehicle.invoice_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 50 }),
  body("vehicle.invoice_date").optional({ nullable: true, checkFalsy: true }).isISO8601(),
];

const idParam = [param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt()];

// --- Catalogue ------------------------------------------------------------

router.get("/products", lease.getProducts);
router.get("/dealers", verifyToken, lease.getDealers);

// --- Application ----------------------------------------------------------

router.post(
  "/apply",
  verifyToken,
  allowRoles("customer"),
  [
    body("product_id").exists({ checkFalsy: true }).isInt({ gt: 0 }).toInt(),
    body("financed_amount")
      .exists({ checkFalsy: true })
      .withMessage("financed_amount is required")
      .isFloat({ gt: 0 })
      .toFloat(),
    body("term_months").exists({ checkFalsy: true }).isInt({ gt: 0 }).toInt(),
    ...DECLARABLE_VALIDATORS,
    ...VEHICLE_VALIDATORS,
  ],
  lease.apply
);

router.get("/my-applications", verifyToken, allowRoles("customer"), lease.getMyApplications);

// --- Documents ------------------------------------------------------------
// Declared BEFORE /:id so "documents" can never be read as an id.

router.post(
  "/:id/documents",
  verifyToken,
  allowRoles("customer"),
  uploadLeaseDocument,
  [
    ...idParam,
    body("document_type")
      .exists({ checkFalsy: true })
      .withMessage("document_type is required")
      .isIn(LEASE_DOCUMENT_TYPES)
      .withMessage(`document_type must be one of: ${LEASE_DOCUMENT_TYPES.join(", ")}`),
  ],
  lease.uploadDocument
);
router.get("/:id/documents", verifyToken, idParam, lease.listDocuments);
router.get("/:id/documents/:docId", verifyToken, idParam, lease.downloadDocument);

// Staff sign-off. Lives on /api/leases rather than /api/admin because a
// lease is not an admin sub-resource of the loan book — the loan equivalent
// sits under /api/admin/applications only for historical reasons.
router.patch(
  "/:id/documents/:docId/verify",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    param("docId").isInt({ gt: 0 }).toInt(),
    body("verification_status")
      .exists({ checkFalsy: true })
      .withMessage("verification_status is required")
      .isIn(["verified", "rejected"])
      .withMessage("verification_status must be one of: verified, rejected"),
    // A rejection with no stated reason is unactionable — the lessee is told
    // "no" and cannot tell what to send instead.
    body("verification_notes")
      .if(body("verification_status").equals("rejected"))
      .exists({ checkFalsy: true })
      .withMessage("a rejection needs a reason")
      .isString()
      .trim()
      .isLength({ min: 3, max: 500 }),
    body("verification_notes").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  lease.verifyDocument
);

router.delete(
  "/:id/documents/:docId",
  verifyToken,
  allowRoles("customer"),
  idParam,
  lease.deleteDocument
);

// --- Staff / admin review (L3.1) -----------------------------------------
// Declared before /:id so "review" is never parsed as an application id.

router.get("/review/portfolio", verifyToken, allowRoles("admin", "staff"), review.getPortfolio);

router.get(
  "/review/queue",
  verifyToken,
  allowRoles("admin", "staff"),
  review.getQueue
);

// Readable by the lessee too — "a valuation is outstanding" is the answer to
// "why is my application still pending?".
router.get("/:id/valuations", verifyToken, idParam, review.listValuations);

router.post(
  "/:id/valuations",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("valuer_id").optional({ nullable: true, checkFalsy: true }).isInt({ gt: 0 }).toInt(),
  ],
  review.requestValuation
);

router.patch(
  "/:id/valuations/:valuationId",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    param("valuationId").isInt({ gt: 0 }).toInt(),
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(["completed", "rejected"])
      .withMessage("status must be one of: completed, rejected"),
    body("valuation_amount").optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }).toFloat(),
    body("valuation_date").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("report_reference").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 100 }),
    body("condition_notes").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 2000 }),
  ],
  review.recordValuation
);

router.patch(
  "/:id/status",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(STAFF_TARGET_STATUSES)
      .withMessage(`status must be one of: ${STAFF_TARGET_STATUSES.join(", ")}`),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
    body("override_reason").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  review.updateStatus
);

// --- Quotations (L4.1) ----------------------------------------------------

const QUOTATION_TERM_VALIDATORS = [
  body("vehicle_price").optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }).toFloat(),
  body("financed_amount").optional({ nullable: true, checkFalsy: true }).isFloat({ gt: 0 }).toFloat(),
  body("term_months").optional({ nullable: true, checkFalsy: true }).isInt({ gt: 0 }).toInt(),
  body("interest_rate").optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 60 }).toFloat(),
  body("note").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body("fee_waivers").optional({ nullable: true }).isArray({ max: 10 }),
  body("fee_waivers.*.fee_type")
    .exists({ checkFalsy: true })
    .isIn(LEASE_FEE_TYPES)
    .withMessage(`fee_waivers[].fee_type must be one of: ${LEASE_FEE_TYPES.join(", ")}`),
  // A waiver without a reason is a discount nobody can audit. Enforced in
  // the controller too, since a fee can also arrive pre-waived.
  body("fee_waivers.*.reason")
    .exists({ checkFalsy: true })
    .withMessage("each fee waiver needs a reason")
    .isString()
    .trim()
    .isLength({ min: 3, max: 500 }),
];

router.get("/:id/quotations", verifyToken, idParam, review.listQuotations);

router.post(
  "/:id/quotations/preview",
  verifyToken,
  allowRoles("admin", "staff"),
  [...idParam, ...QUOTATION_TERM_VALIDATORS],
  review.previewQuotation
);

router.post(
  "/:id/quotations",
  verifyToken,
  allowRoles("admin", "staff"),
  [...idParam, ...QUOTATION_TERM_VALIDATORS],
  review.issueQuotation
);

// The lessee's answer. Accepting is what makes the terms binding, so the
// status machine grants this to 'customer' alone.
router.patch(
  "/:id/quotations/:quotationId",
  verifyToken,
  allowRoles("customer"),
  [
    ...idParam,
    param("quotationId").isInt({ gt: 0 }).toInt(),
    body("decision")
      .exists({ checkFalsy: true })
      .withMessage("decision is required")
      .isIn(["accept", "decline"])
      .withMessage("decision must be one of: accept, decline"),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  ],
  review.answerQuotation
);

router.get("/:id/agreement.pdf", verifyToken, idParam, review.getAgreementPdf);

// --- Down payment (L5) ----------------------------------------------------
// Both channels settle into one ledger; see leaseDownPayment.controller.

router.get("/:id/down-payment", verifyToken, idParam, downPayment.getPosition);

// Offline: staff assert money arrived, and their id is recorded.
router.post(
  "/:id/down-payment/receipts",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("amount")
      .exists({ checkFalsy: true })
      .withMessage("amount is required")
      .isFloat({ gt: 0 })
      .toFloat(),
    body("method")
      .exists({ checkFalsy: true })
      .withMessage("method is required")
      .isIn(["cash", "bank_transfer", "cheque", "other"])
      .withMessage("method must be one of: cash, bank_transfer, cheque, other"),
    body("reference_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 100 }),
    body("paid_on").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  downPayment.recordReceipt
);

// Online: the lessee pays by card. No amount in the body — the server
// decides it from the accepted quotation.
router.post(
  "/:id/down-payment/checkout",
  verifyToken,
  allowRoles("customer"),
  idParam,
  downPayment.createCheckout
);

router.get("/:id/down-payment/status", verifyToken, idParam, downPayment.getIntentStatus);

// --- Purchase and title (L6) ----------------------------------------------
// Readable by the lessee: "we've bought the vehicle and registered it" is
// exactly what they are waiting to hear.

router.get("/:id/purchase", verifyToken, idParam, review.getPurchaseState);

router.post(
  "/:id/purchase/payout",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("method")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["bank_transfer", "cheque", "other"])
      .withMessage("method must be one of: bank_transfer, cheque, other"),
    body("reference_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 100 }),
    body("paid_on").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  review.recordPayout
);

/**
 * PATCH /:id/purchase/supplier — attach (or detach) the approved dealer.
 *
 * The lessee picks a dealer on the application form, but the field is
 * optional and most applicants leave it blank, which silently books the
 * purchase as "a private seller". Staff reviewing the file with the invoice
 * in front of them are the ones who actually know who is selling the car, so
 * they get to correct it — up until the money leaves, after which the record
 * is history and not editable. Null clears it back to a private seller.
 */
router.patch(
  "/:id/purchase/supplier",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("supplier_id")
      .optional({ nullable: true })
      .custom((v) => v === null || (Number.isInteger(Number(v)) && Number(v) > 0))
      .withMessage("supplier_id must be a positive integer or null"),
  ],
  review.assignSupplier
);

router.patch(
  "/:id/purchase/registration",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(["submitted", "registered"])
      .withMessage("status must be one of: submitted, registered"),
    body("reference").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 100 }),
    body("cr_number").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 50 }),
    body("registration_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 20 }),
    body("absolute_owner").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 150 }),
    body("registered_user").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 150 }),
    body("submitted_at").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("registered_at").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("notes").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  review.updateRegistration
);

// --- Agreement, rentals and release of title (L7) -------------------------

router.get("/:id/agreement", verifyToken, idParam, review.getAgreement);

router.post(
  "/:id/agreement/activate",
  verifyToken,
  allowRoles("admin", "staff"),
  [...idParam, body("first_rental_date").optional({ nullable: true, checkFalsy: true }).isISO8601()],
  review.activateAgreement
);

router.post(
  "/:id/agreement/rentals",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("amount").exists({ checkFalsy: true }).isFloat({ gt: 0 }).toFloat(),
    body("method")
      .exists({ checkFalsy: true })
      .isIn(["cash", "bank_transfer", "cheque", "standing_order", "card", "other"])
      .withMessage("method must be a recognised payment method"),
    body("rental_type").optional({ nullable: true, checkFalsy: true }).isIn(["rental", "settlement"]),
    body("paid_on").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("reference_no").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 100 }),
    body("note").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  ],
  review.recordRental
);

router.post(
  "/:id/agreement/release",
  verifyToken,
  allowRoles("admin", "staff"),
  idParam,
  review.issueRelease
);

router.patch(
  "/:id/agreement/transfer",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    ...idParam,
    body("transferred_at").optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body("reference").optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 100 }),
  ],
  review.recordTransfer
);

// --- The lessee paying their own rentals (L10) -----------------------------
// Declared before the catch-all /:id. Reading is open to staff too, because
// "what does this lessee owe today?" is a question a collections officer
// asks; paying is the lessee's alone.

router.get("/:id/rentals/options", verifyToken, idParam, rental.getOptions);

router.post(
  "/:id/rentals/checkout",
  verifyToken,
  allowRoles("customer"),
  [
    ...idParam,
    body("kind")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["rental", "arrears", "settlement", "custom"])
      .withMessage("kind must be one of: rental, arrears, settlement, custom"),
    // Only consulted for kind=custom, and even then re-checked against the
    // real outstanding balance server-side. The bound here is a sanity
    // filter, not the control.
    body("amount")
      .if(body("kind").equals("custom"))
      .exists({ checkFalsy: true })
      .withMessage("amount is required for a custom payment")
      .isFloat({ gt: 0 })
      .toFloat(),
  ],
  rental.createCheckout
);

router.get("/:id/rentals/status", verifyToken, idParam, rental.getIntentStatus);

router.get("/:id/release-letter.pdf", verifyToken, idParam, review.getReleaseLetterPdf);

router.get("/:id", verifyToken, idParam, lease.getApplicationById);

module.exports = router;

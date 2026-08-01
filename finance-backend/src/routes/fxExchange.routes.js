"use strict";

const express = require("express");

const router = express.Router();

const { body, param, query } = require("express-validator");
const fxExchangeController = require("../controllers/fxExchange.controller");
const { fxDocumentUpload } = require("../config/multer");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

// Multer reports a rejected file (too large, wrong type) by calling next()
// with an error, which would otherwise fall through to Express's default
// HTML error page as a 500. Wrapping the middleware turns those into the
// 400 + JSON shape every other endpoint in this router returns.
function uploadSupportingDocument(req, res, next) {
  fxDocumentUpload.single("document")(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "The file is too large — supporting documents must be 5 MB or smaller."
        : err.message || "Failed to read the uploaded file.";
    return res.status(400).json({ message });
  });
}

// A closed set of declared reasons for exchanging currency — mirrors how
// loan.routes.js validates against mlClient.service.js's CATEGORY_VALUES
// rather than accepting free text for a field staff/compliance rely on.
const PURPOSE_CODES = [
  "travel",
  "education",
  "medical",
  "family_maintenance",
  "investment",
  "import_payment",
  "gift",
  "other",
];

const STATUS_VALUES = [
  "pending_review",
  "approved",
  "ready_for_settlement",
  "settled",
  "rejected",
  "cancelled",
  "expired",
];

const CODE_VALIDATOR = param("code")
  .exists({ checkFalsy: true })
  .withMessage("currency code is required")
  .isAlpha()
  .withMessage("currency code must be alphabetic")
  .isLength({ min: 3, max: 3 })
  .withMessage("currency code must be 3 letters");

const REF_VALIDATOR = param("ref")
  .exists({ checkFalsy: true })
  .withMessage("reference number is required")
  .matches(/^FX-\d{6,}$/)
  .withMessage("reference number must look like FX-000123");

// POST /api/currency/exchange/quote (customer) — indicative quote, locked.
router.post(
  "/quote",
  verifyToken,
  allowRoles("customer"),
  [
    body("direction")
      .exists({ checkFalsy: true })
      .withMessage("direction is required")
      .isIn(["buy", "sell"])
      .withMessage("direction must be buy or sell"),
    body("currency_code")
      .exists({ checkFalsy: true })
      .withMessage("currency_code is required")
      .isAlpha()
      .isLength({ min: 3, max: 3 })
      .withMessage("currency_code must be a 3-letter code"),
    // Exactly one of foreign_amount / lkr_amount — a customer either knows
    // how much foreign currency they need, or how much LKR they have to
    // spend (e.g. "LKR 500,000 for tuition"); fxQuote.service.js inverts
    // the rate calculation when lkr_amount is supplied.
    body("foreign_amount")
      .optional()
      .isFloat({ gt: 0 })
      .withMessage("foreign_amount must be a positive number")
      .toFloat(),
    body("lkr_amount")
      .optional()
      .isFloat({ gt: 0 })
      .withMessage("lkr_amount must be a positive number")
      .toFloat(),
    body().custom((value) => {
      const hasForeign = value.foreign_amount !== undefined;
      const hasLkr = value.lkr_amount !== undefined;
      if (hasForeign === hasLkr) {
        throw new Error("Provide exactly one of foreign_amount or lkr_amount.");
      }
      return true;
    }),
  ],
  fxExchangeController.getQuote
);

// POST /api/currency/exchange/requests (customer) — submit against a live quote id.
router.post(
  "/requests",
  verifyToken,
  allowRoles("customer"),
  [
    body("quote_id").exists({ checkFalsy: true }).withMessage("quote_id is required").isString(),
    body("purpose_code")
      .exists({ checkFalsy: true })
      .withMessage("purpose_code is required")
      .isIn(PURPOSE_CODES)
      .withMessage(`purpose_code must be one of: ${PURPOSE_CODES.join(", ")}`),
    body("branch")
      .exists({ checkFalsy: true })
      .withMessage("branch is required")
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage("branch must be 1-100 characters"),
    body("settlement_date")
      .exists({ checkFalsy: true })
      .withMessage("settlement_date is required")
      .isISO8601()
      .withMessage("settlement_date must be a YYYY-MM-DD date"),
  ],
  fxExchangeController.submitRequest
);

// GET /api/currency/exchange/requests (customer) — own requests, filterable.
router.get(
  "/requests",
  verifyToken,
  allowRoles("customer"),
  [
    query("status").optional().isIn(STATUS_VALUES),
    query("currency").optional().isAlpha().isLength({ min: 3, max: 3 }),
    query("limit").optional().isInt({ min: 1, max: 200 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  fxExchangeController.listMyRequests
);

// GET /api/currency/exchange/admin/queue (staff, admin) — review queue.
router.get(
  "/admin/queue",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    query("status")
      .optional()
      .isIn([...STATUS_VALUES, "all"]),
    query("currency").optional().isAlpha().isLength({ min: 3, max: 3 }),
    query("limit").optional().isInt({ min: 1, max: 500 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  fxExchangeController.listQueue
);

// GET /api/currency/exchange/admin/limits (admin).
router.get("/admin/limits", verifyToken, allowRoles("admin"), fxExchangeController.listLimits);

// PATCH /api/currency/exchange/admin/limits (admin).
router.patch(
  "/admin/limits",
  verifyToken,
  allowRoles("admin"),
  [
    body("currency_code")
      .optional()
      .isString()
      .customSanitizer((v) => String(v).toUpperCase())
      .custom((v) => v === "ALL" || /^[A-Z]{3}$/.test(v))
      .withMessage("currency_code must be a 3-letter code or ALL"),
    body("max_per_transaction_lkr").optional().isFloat({ gt: 0 }).toFloat(),
    body("max_per_customer_per_day_lkr").optional().isFloat({ gt: 0 }).toFloat(),
    // Explicit null is meaningful — "this currency needs no documentation" —
    // so this validator must accept it rather than only a positive number.
    // `{ nullable: true }` lets null through to the model, which
    // distinguishes it from an absent field.
    body("document_threshold_lkr")
      .optional({ nullable: true })
      .custom((v) => v === null || (typeof v === "number" && v > 0) || Number(v) > 0)
      .withMessage("document_threshold_lkr must be a positive number or null")
      .customSanitizer((v) => (v === null ? null : Number(v))),
  ],
  fxExchangeController.updateLimits
);

// GET /api/currency/exchange/admin/spreads (admin).
router.get("/admin/spreads", verifyToken, allowRoles("admin"), fxExchangeController.listSpreads);

// PATCH /api/currency/exchange/admin/spreads/:code (admin).
router.patch(
  "/admin/spreads/:code",
  verifyToken,
  allowRoles("admin"),
  [
    CODE_VALIDATOR,
    body("buy_spread_bps").optional().isInt({ min: 0, max: 10000 }).toInt(),
    body("sell_spread_bps").optional().isInt({ min: 0, max: 10000 }).toInt(),
    body("is_tradable").optional().isBoolean().toBoolean(),
  ],
  fxExchangeController.updateSpread
);

// GET /api/currency/exchange/admin/position (admin) — net FX exposure.
router.get("/admin/position", verifyToken, allowRoles("admin"), fxExchangeController.getPosition);

// --- bank-wide FX inventory (Task 3) -------------------------------------
// One notional vault per currency — no branch dimension. Every write goes
// through fxInventoryModel.applyMovement (see the controller); there is no
// direct SQL UPDATE of balances anywhere in this stack.

// GET /api/currency/exchange/admin/inventory (admin, staff) — read-only for
// staff, who need to see stock levels in the review queue (Task 7) before
// approving a 'buy' request. Writes below stay admin-only.
router.get(
  "/admin/inventory",
  verifyToken,
  allowRoles("admin", "staff"),
  fxExchangeController.listInventory
);

// PATCH /api/currency/exchange/admin/inventory/:code (admin) — opening
// balance (absolute target) or adjustment (signed delta).
router.patch(
  "/admin/inventory/:code",
  verifyToken,
  allowRoles("admin"),
  [
    CODE_VALIDATOR,
    body("action")
      .exists({ checkFalsy: true })
      .withMessage("action is required")
      .isIn(["opening_balance", "adjustment"])
      .withMessage("action must be one of: opening_balance, adjustment"),
    body("amount")
      .exists()
      .withMessage("amount is required")
      .isFloat()
      .withMessage("amount must be a number")
      .toFloat(),
    body("note").optional().isString().trim().isLength({ max: 500 }),
    // opening_balance sets an absolute stock level, so a negative target
    // makes no physical sense; adjustment is a signed delta and a zero
    // delta is a no-op that shouldn't create a ledger row.
    body().custom((value) => {
      if (value.action === "opening_balance" && !(value.amount >= 0)) {
        throw new Error("amount must be zero or positive for an opening balance.");
      }
      if (value.action === "adjustment" && value.amount === 0) {
        throw new Error("amount must be non-zero for an adjustment.");
      }
      return true;
    }),
  ],
  fxExchangeController.updateInventory
);

// GET /api/currency/exchange/admin/inventory/:code/movements (admin).
router.get(
  "/admin/inventory/:code/movements",
  verifyToken,
  allowRoles("admin"),
  [
    CODE_VALIDATOR,
    query("limit").optional().isInt({ min: 1, max: 500 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  fxExchangeController.listInventoryMovements
);

const REPORT_QUERY_VALIDATORS = [
  query("from").optional().isISO8601().withMessage("from must be a YYYY-MM-DD date"),
  query("to").optional().isISO8601().withMessage("to must be a YYYY-MM-DD date"),
  query("currency")
    .optional()
    .isAlpha()
    .isLength({ min: 3, max: 3 })
    .withMessage("currency must be a 3-letter code"),
];

// GET /api/currency/exchange/admin/reports (admin) — status-rate,
// volume-by-currency and spread-revenue aggregates over a date range.
router.get(
  "/admin/reports",
  verifyToken,
  allowRoles("admin"),
  REPORT_QUERY_VALIDATORS,
  fxExchangeController.getReports
);

// GET /api/currency/exchange/admin/reports/export (admin) — the same rows
// as a CSV download, optionally narrowed by status.
router.get(
  "/admin/reports/export",
  verifyToken,
  allowRoles("admin"),
  [...REPORT_QUERY_VALIDATORS, query("status").optional().isIn([...STATUS_VALUES, "all"])],
  fxExchangeController.exportReportsCsv
);

// GET /api/currency/exchange/requests/:ref — customer (own), staff/admin (any).
router.get(
  "/requests/:ref",
  verifyToken,
  [REF_VALIDATOR],
  fxExchangeController.getRequestByRef
);

// POST /api/currency/exchange/requests/:ref/cancel (customer, own, pending_review only).
router.post(
  "/requests/:ref/cancel",
  verifyToken,
  allowRoles("customer"),
  [REF_VALIDATOR],
  fxExchangeController.cancelRequest
);

// --- compliance documents ------------------------------------------------
// Reads are open to the owner and to staff/admin (staff must be able to
// review the evidence); writes are owner-only, since staff review evidence
// rather than supply it.

const DOCUMENT_ID_VALIDATOR = param("id")
  .exists({ checkFalsy: true })
  .withMessage("document id is required")
  .isInt({ min: 1 })
  .withMessage("document id must be a positive integer");

// POST /api/currency/exchange/requests/:ref/documents (customer, own).
// Multipart — the file field is named "document".
router.post(
  "/requests/:ref/documents",
  verifyToken,
  allowRoles("customer"),
  uploadSupportingDocument,
  [REF_VALIDATOR],
  fxExchangeController.uploadDocument
);

// GET /api/currency/exchange/requests/:ref/documents — metadata list.
router.get(
  "/requests/:ref/documents",
  verifyToken,
  [REF_VALIDATOR],
  fxExchangeController.listDocuments
);

// GET /api/currency/exchange/requests/:ref/documents/:id/download — the only
// path by which a stored compliance document can be read back; secure-uploads/
// is not served statically. See migration 014's header.
router.get(
  "/requests/:ref/documents/:id/download",
  verifyToken,
  [REF_VALIDATOR, DOCUMENT_ID_VALIDATOR],
  fxExchangeController.downloadDocument
);

// DELETE /api/currency/exchange/requests/:ref/documents/:id (customer, own).
router.delete(
  "/requests/:ref/documents/:id",
  verifyToken,
  allowRoles("customer"),
  [REF_VALIDATOR, DOCUMENT_ID_VALIDATOR],
  fxExchangeController.deleteDocument
);

// POST /api/currency/exchange/requests/:ref/review (staff, admin) — approve/reject/counter.
router.post(
  "/requests/:ref/review",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    REF_VALIDATOR,
    body("action")
      .exists({ checkFalsy: true })
      .withMessage("action is required")
      .isIn(["approve", "reject", "counter"])
      .withMessage("action must be one of: approve, reject, counter"),
    body("note").optional().isString().trim().isLength({ max: 500 }),
    body("countered_rate").optional().isFloat({ gt: 0 }).toFloat(),
  ],
  fxExchangeController.reviewRequest
);

// POST /api/currency/exchange/requests/:ref/settle (staff, admin).
router.post(
  "/requests/:ref/settle",
  verifyToken,
  allowRoles("admin", "staff"),
  [REF_VALIDATOR, body("note").optional().isString().trim().isLength({ max: 500 })],
  fxExchangeController.settleRequest
);

module.exports = router;

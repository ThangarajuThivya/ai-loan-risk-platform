const express = require("express");

const router = express.Router();

const { param, query, body } = require("express-validator");
const currencyController = require("../controllers/currency.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

// Shared :code validator — a 3-letter ISO currency code. Whether it's a
// *real* H.10 currency (and, separately, a *trained* one) is validated by
// the Python service itself for /analyze; findRateHistory just queries by
// code and returns an empty list for one with no rows, so no stricter
// format check is needed here.
const CODE_VALIDATOR = param("code")
  .exists({ checkFalsy: true })
  .withMessage("currency code is required")
  .isAlpha()
  .withMessage("currency code must be alphabetic")
  .isLength({ min: 3, max: 3 })
  .withMessage("currency code must be 3 letters");

// GET /api/currency/currencies — supported currencies (customer, staff, admin).
router.get("/currencies", verifyToken, currencyController.listCurrencies);

// GET /api/currency/rates/:code — historical rate series for charts, from
// the DB's currency_rate_history table (customer, staff, admin). Supports
// either ?limit= (most recent N, default 90) or a ?from=&to= date range,
// optionally narrowed by ?source= (Phase 7 — see CURRENCY_FEATURE.md §9.1).
router.get(
  "/rates/:code",
  verifyToken,
  [
    CODE_VALIDATOR,
    query("limit").optional().isInt({ min: 1, max: 20000 }).toInt(),
    query("from").optional().isISO8601().withMessage("from must be a YYYY-MM-DD date"),
    query("to").optional().isISO8601().withMessage("to must be a YYYY-MM-DD date"),
    query("source")
      .optional()
      .isIn(["h10-historical", "live-er-api", "demo-seed"])
      .withMessage("source must be h10-historical, live-er-api, or demo-seed"),
  ],
  currencyController.getRateHistory
);

// GET /api/currency/board — live buy/sell rate board, LKR per unit of
// foreign currency (customer, staff, admin). Genuinely live data, not a
// model output — see currency.controller.js's file header.
router.get("/board", verifyToken, currencyController.getBoard);

// GET /api/currency/live-forecast/:code?horizon= — naive short-term trend
// projection computed from live rates only (customer, staff, admin). This
// is NOT the trained ML model's output — see
// src/services/liveForecast.service.js and CURRENCY_FEATURE.md §16.
router.get(
  "/live-forecast/:code",
  verifyToken,
  [
    CODE_VALIDATOR,
    query("horizon")
      .optional()
      .isInt({ min: 1, max: 30 })
      .withMessage("horizon must be an integer between 1 and 30 days"),
  ],
  currencyController.liveForecast
);

// GET /api/currency/analyze/:code — forecast+trend+volatility+anomaly.
// Response is role-shaped inside the controller: customer gets a simplified
// forecast-only view (no trend direction — see §18), staff/admin get the full
// analysis (role matrix, CURRENCY_FEATURE.md §6).
router.get(
  "/analyze/:code",
  verifyToken,
  [CODE_VALIDATOR],
  currencyController.analyze
);

// GET /api/currency/anomalies — recent flagged-anomaly history (staff, admin).
router.get(
  "/anomalies",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    query("currency")
      .optional()
      .isAlpha()
      .isLength({ min: 3, max: 3 })
      .withMessage("currency must be a 3-letter code"),
    query("plane")
      .optional()
      .isIn(["model-series", "live-feed"])
      .withMessage("plane must be 'model-series' or 'live-feed'"),
    query("limit").optional().isInt({ min: 1, max: 500 }).toInt(),
  ],
  currencyController.listAnomalies
);

// GET /api/currency/live-anomaly/:code — Isolation Forest over the trailing
// LIVE rate window (staff, admin — same access as the anomaly log above).
// Separate from /analyze's anomaly block, which scores the model's own
// 2017-anchored series; the two planes are never merged (§10.2/§30).
router.get(
  "/live-anomaly/:code",
  verifyToken,
  allowRoles("admin", "staff"),
  [CODE_VALIDATOR],
  currencyController.liveAnomaly
);

// GET /api/currency/admin/model-status — model versions, live Python health,
// and per-currency cache freshness (admin).
router.get(
  "/admin/model-status",
  verifyToken,
  allowRoles("admin"),
  currencyController.adminModelStatus
);

// PATCH /api/currency/admin/currencies/:code/status — toggle a currency
// active/inactive (admin).
router.patch(
  "/admin/currencies/:code/status",
  verifyToken,
  allowRoles("admin"),
  [
    CODE_VALIDATOR,
    body("is_active")
      .exists()
      .withMessage("is_active is required")
      .isBoolean()
      .withMessage("is_active must be a boolean")
      .toBoolean(),
  ],
  currencyController.adminSetCurrencyActive
);

// POST /api/currency/admin/analyze/:code/refresh — bypass the cache and
// recompute immediately (admin).
router.post(
  "/admin/analyze/:code/refresh",
  verifyToken,
  allowRoles("admin"),
  [CODE_VALIDATOR],
  currencyController.adminRefreshAnalysis
);

// POST /api/currency/admin/rates/refresh — force an immediate live rate
// pull, bypassing the hourly schedule (admin).
router.post(
  "/admin/rates/refresh",
  verifyToken,
  allowRoles("admin"),
  currencyController.adminRefreshRates
);

module.exports = router;

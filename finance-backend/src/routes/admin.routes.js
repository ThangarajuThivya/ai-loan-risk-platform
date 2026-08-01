const router = require("express").Router();
const { body, param } = require("express-validator");
const admin = require("../controllers/admin.controller");
const loanController = require("../controllers/loan.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

// Staff get read access to the customer list (needed to advise applicants)
// but not the product-catalog write routes further down, which stay
// admin-only.
router.get(
  "/getAllCustomer",
  verifyToken,
  allowRoles("admin", "staff"),
  admin.getAllCustomers
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

// GET /api/admin/applications — all loan applications, optional ?status= filter.
// Staff review applications too, same as admin.
router.get(
  "/applications",
  verifyToken,
  allowRoles("admin", "staff"),
  loanController.getAllApplications
);

// PATCH /api/admin/applications/:id/status — approve/reject a pending application.
router.patch(
  "/applications/:id/status",
  verifyToken,
  allowRoles("admin", "staff"),
  [
    param("id").isInt({ gt: 0 }).withMessage("id must be a positive integer").toInt(),
    body("status")
      .exists({ checkFalsy: true })
      .withMessage("status is required")
      .isIn(["approved", "rejected"])
      .withMessage("status must be one of: approved, rejected"),
    body("note")
      .optional({ nullable: true })
      .isString()
      .withMessage("note must be a string")
      .trim()
      .isLength({ max: 500 })
      .withMessage("note must be 500 characters or fewer"),
  ],
  loanController.updateApplicationStatus
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
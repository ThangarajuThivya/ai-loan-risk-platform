const express = require("express");

const router = express.Router();

const { body } = require("express-validator");
const faqController = require("../controllers/faq.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

// Sinhala/Tamil are optional on every field: English is the source of truth
// and the read path COALESCEs back to it, so a partly-translated FAQ is a
// valid state rather than a validation error. Empty string is accepted and
// normalised to NULL so clearing a field in the editor actually clears it.
const optionalTranslation = (field, max) =>
  body(field)
    .optional({ nullable: true })
    .trim()
    .isLength({ max })
    .withMessage(`${field} must be at most ${max} characters`)
    .customSanitizer((v) => (v === "" ? null : v));

const FAQ_VALIDATORS = [
  body("category")
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("category is required (max 50 characters)"),
  body("question")
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("question must be 5-500 characters"),
  body("answer")
    .trim()
    .isLength({ min: 5, max: 5000 })
    .withMessage("answer must be 5-5000 characters"),

  optionalTranslation("category_si", 50),
  optionalTranslation("category_ta", 50),
  optionalTranslation("question_si", 500),
  optionalTranslation("question_ta", 500),
  optionalTranslation("answer_si", 5000),
  optionalTranslation("answer_ta", 5000),
];

// GET /api/faqs — public catalog, read by the marketing /faq page.
router.get("/", faqController.getAllFaqs);

router.post(
  "/",
  verifyToken,
  allowRoles("admin", "staff"),
  FAQ_VALIDATORS,
  faqController.createFaq
);

router.put(
  "/:id",
  verifyToken,
  allowRoles("admin", "staff"),
  FAQ_VALIDATORS,
  faqController.updateFaq
);

router.delete(
  "/:id",
  verifyToken,
  allowRoles("admin", "staff"),
  faqController.deleteFaq
);

module.exports = router;

"use strict";

const { validationResult } = require("express-validator");

const faqModel = require("../models/faqModel");

// GET /api/faqs — public, no auth. Read by the marketing /faq page.
//   ?lang=si|ta  serve Sinhala/Tamil text, falling back to English per field
//   ?translations=1  also return the raw *_si/*_ta columns, for the
//                    admin/staff editor which has to show all three languages
exports.getAllFaqs = async (req, res) => {
  try {
    const faqs = await faqModel.findAll({
      lang: req.query.lang,
      includeTranslations: req.query.translations === "1",
    });
    return res.status(200).json({ faqs });
  } catch (err) {
    console.error("GET FAQS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch FAQs." });
  }
};

// POST /api/faqs (admin/staff): add a new FAQ.
exports.createFaq = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  try {
    const faq = await faqModel.create(req.body);
    return res.status(201).json(faq);
  } catch (err) {
    console.error("CREATE FAQ ERROR:", err);
    return res.status(500).json({ message: "Failed to create FAQ." });
  }
};

// PUT /api/faqs/:id (admin/staff): update a FAQ's fields.
exports.updateFaq = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const faqId = Number(req.params.id);
  try {
    const faq = await faqModel.update(faqId, req.body);
    if (!faq) {
      return res.status(404).json({ message: "FAQ not found." });
    }
    return res.status(200).json(faq);
  } catch (err) {
    console.error("UPDATE FAQ ERROR:", err);
    return res.status(500).json({ message: "Failed to update FAQ." });
  }
};

// DELETE /api/faqs/:id (admin/staff): remove a FAQ.
exports.deleteFaq = async (req, res) => {
  const faqId = Number(req.params.id);
  try {
    const result = await faqModel.remove(faqId);
    if (result.notFound) {
      return res.status(404).json({ message: "FAQ not found." });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("DELETE FAQ ERROR:", err);
    return res.status(500).json({ message: "Failed to delete FAQ." });
  }
};

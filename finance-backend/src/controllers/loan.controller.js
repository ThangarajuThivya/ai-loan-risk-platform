"use strict";

/**
 * Loan controller — the assessment spine (GUIDANCE.md §5 Day 1, §8; ARCHITECTURE.md §7).
 *
 * POST /api/loans/assess (customer):
 *   1. Load the caller's customer_profiles row.
 *   2. Merge it with the request (product_id, requested_amount, tenure_months, purpose).
 *   3. Map to the 35 model fields and call the Python risk model (mlClient).
 *   4. Persist loan_applications (pending) + risk_assessments + recommendations
 *      in one transaction.
 *   5. Return { risk, recommendation, explanation } (GUIDANCE.md §8 shape).
 */

const { validationResult } = require("express-validator");

const loanModel = require("../models/loanModel");
const {
  mapProfileToModelFields,
  predictRisk,
  isProvided,
  DECLARABLE_FIELDS,
} = require("../services/mlClient.service");
const {
  buildRecommendation,
  computeEmi,
} = require("../services/recommendation.service");
const { explainRisk } = require("../services/gemini.service");

/**
 * Pull prob_low/medium/high out of the model's probabilities object, which is
 * keyed by human labels ("Low Risk", …). Missing keys default to 0.
 */
function splitProbabilities(probabilities = {}) {
  return {
    probLow: Number(probabilities["Low Risk"] || 0),
    probMedium: Number(probabilities["Medium Risk"] || 0),
    probHigh: Number(probabilities["High Risk"] || 0),
  };
}

/**
 * Shape a joined loan_applications+risk_assessments+recommendations row into
 * the same { risk, recommendation, explanation } response shape as assess().
 */
function serializeApplication(row) {
  const hasRisk = row.risk_label !== null && row.risk_label !== undefined;
  const hasRec = row.recommended_amount !== null && row.recommended_amount !== undefined;
  return {
    application_id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    requested_amount: row.requested_amount,
    tenure_months: row.tenure_months,
    purpose: row.purpose,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    declared: {
      marital_status: row.marital_status,
      education_level: row.education_level,
      occupation: row.occupation,
      employer_category: row.employer_category,
      years_employed: row.years_employed,
      additional_income: row.additional_income,
      existing_loans: row.existing_loans,
      previous_defaults: row.previous_defaults,
      crib_score: row.crib_score,
      guarantor_exposure: row.guarantor_exposure,
      guarantor_defaults: row.guarantor_defaults,
    },
    risk: hasRisk
      ? {
          label: row.risk_label,
          category: row.risk_category,
          probabilities: {
            "Low Risk": Number(row.prob_low),
            "Medium Risk": Number(row.prob_medium),
            "High Risk": Number(row.prob_high),
          },
        }
      : null,
    recommendation: hasRec
      ? {
          recommended_amount: row.recommended_amount,
          recommended_emi: row.recommended_emi,
        }
      : null,
    explanation: row.gemini_explanation || null,
  };
}

// POST /api/loans/emi-preview — public, no persistence. Reuses the same
// reducing-balance EMI engine as the assess flow's recommendation.
exports.emiPreview = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const { principal, annualRatePct, tenureMonths } = req.body;

  try {
    const emi = computeEmi(principal, annualRatePct, tenureMonths);
    const totalPayable = emi * tenureMonths;
    const totalInterest = totalPayable - principal;

    return res.status(200).json({
      emi: Math.round(emi * 100) / 100,
      totalPayable: Math.round(totalPayable * 100) / 100,
      totalInterest: Math.round(totalInterest * 100) / 100,
    });
  } catch (err) {
    console.error("EMI PREVIEW ERROR:", err);
    return res.status(500).json({ message: "Failed to compute EMI preview." });
  }
};

// ?lang=si|ta serves the translated name/description, falling back to English
// per field when a product has no translation (migration 012).
exports.getProducts = async (req, res) => {
  try {
    const products = await loanModel.findAllProducts({ lang: req.query.lang });
    return res.status(200).json({ products });
  } catch (err) {
    console.error("GET LOAN PRODUCTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch loan products." });
  }
};

// POST /api/admin/products (admin): add a new loan product to the catalog.
exports.createProduct = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  try {
    const product = await loanModel.createProduct(req.body);
    return res.status(201).json(product);
  } catch (err) {
    console.error("CREATE LOAN PRODUCT ERROR:", err);
    return res.status(500).json({ message: "Failed to create loan product." });
  }
};

// PUT /api/admin/products/:id (admin): update a loan product's terms.
exports.updateProduct = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const productId = Number(req.params.id);
  try {
    const product = await loanModel.updateProduct(productId, req.body);
    if (!product) {
      return res.status(404).json({ message: "Loan product not found." });
    }
    return res.status(200).json(product);
  } catch (err) {
    console.error("UPDATE LOAN PRODUCT ERROR:", err);
    return res.status(500).json({ message: "Failed to update loan product." });
  }
};

// DELETE /api/admin/products/:id (admin): remove a loan product. Rejected if
// any loan_applications still reference it (loan_products has no ON DELETE
// CASCADE, by design).
exports.deleteProduct = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const productId = Number(req.params.id);
  try {
    const result = await loanModel.deleteProduct(productId);
    if (result.notFound) {
      return res.status(404).json({ message: "Loan product not found." });
    }
    return res.status(204).send();
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        message:
          "This product has existing loan applications and cannot be deleted.",
      });
    }
    console.error("DELETE LOAN PRODUCT ERROR:", err);
    return res.status(500).json({ message: "Failed to delete loan product." });
  }
};

exports.getMyApplications = async (req, res) => {
  try {
    const rows = await loanModel.findApplicationsByUserId(req.user.user_id);
    return res.status(200).json({ applications: rows.map(serializeApplication) });
  } catch (err) {
    console.error("GET MY APPLICATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch applications." });
  }
};

exports.getApplicationById = async (req, res) => {
  const applicationId = Number(req.params.id);
  try {
    const row = await loanModel.findApplicationById(applicationId);
    if (!row) {
      return res.status(404).json({ message: "Application not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Permission denied" });
    }
    return res.status(200).json(serializeApplication(row));
  } catch (err) {
    console.error("GET APPLICATION BY ID ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch application." });
  }
};

exports.getAllApplications = async (req, res) => {
  const { status } = req.query;
  try {
    const rows = await loanModel.findAllApplications(status);
    const applications = rows.map((row) => ({
      ...serializeApplication(row),
      applicant: {
        user_id: row.user_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
      },
    }));
    return res.status(200).json({ applications });
  } catch (err) {
    console.error("GET ALL APPLICATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch applications." });
  }
};

// PATCH /api/admin/applications/:id/status (admin): approve/reject a pending
// application and notify the applicant.
exports.updateApplicationStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const applicationId = Number(req.params.id);
  const { status, note } = req.body;

  try {
    const result = await loanModel.updateApplicationStatus({
      applicationId,
      status,
      note,
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Application not found." });
    }
    if (result.conflict) {
      return res.status(409).json({
        message: `Application is already ${result.status}; only pending applications can be decided.`,
      });
    }

    const row = await loanModel.findApplicationById(applicationId);
    return res.status(200).json(serializeApplication(row));
  } catch (err) {
    console.error("UPDATE APPLICATION STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to update application status." });
  }
};

exports.assess = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const userId = req.user.user_id;
  const { product_id, requested_amount, tenure_months, purpose } = req.body;

  // Applicant-declared overrides for otherwise-hardcoded model fields (see
  // mlClient.service.js NEUTRAL_DEFAULTS / DECLARABLE_FIELDS) — all optional,
  // validated in loan.routes.js. Left-blank fields stay undefined here and
  // fall back to the neutral default inside mapProfileToModelFields.
  const declared = {};
  for (const field of DECLARABLE_FIELDS) {
    if (isProvided(req.body[field])) declared[field] = req.body[field];
  }

  try {
    // 1. Profile — required to build the model inputs.
    const profile = await loanModel.findProfileByUserId(userId);
    if (!profile) {
      return res.status(400).json({
        message:
          "No customer profile found. Complete your profile before applying.",
      });
    }

    // 2. Product — drives interest rate / rate type and validates product_id.
    const product = await loanModel.findProductById(product_id);
    if (!product) {
      return res.status(400).json({
        message: `Unknown loan product (product_id=${product_id}).`,
      });
    }

    const interestRate = Number(product.interest_rate);
    const monthlyIncome = Number(profile.monthly_income) || 0;
    const monthlyExpense = Number(profile.monthly_expense) || 0;
    // Net (disposable) income drives the affordability ceiling.
    const netIncome = Math.max(0, monthlyIncome - monthlyExpense);

    // 3. Map to the 35 raw model fields and score via the Python service.
    const modelFields = mapProfileToModelFields(
      profile,
      { requested_amount, tenure_months, interest_rate: interestRate },
      declared
    );
    const risk = await predictRisk(modelFields);

    // 4. Deterministic recommendation (loan type, affordable amount, EMI).
    const recommendation = buildRecommendation({
      netIncome,
      riskLabel: risk.risk_label,
      annualRatePct: interestRate,
      tenureMonths: tenure_months,
      requestedAmount: requested_amount,
      purpose,
    });

    // 5. Persist application + assessment + recommendation atomically.
    const probs = splitProbabilities(risk.probabilities);
    const { applicationId } = await loanModel.runAssessmentTransaction({
      userId,
      productId: product_id,
      requestedAmount: requested_amount,
      tenureMonths: tenure_months,
      purpose,
      declared,
      risk: {
        risk_label: risk.risk_label,
        risk_category: risk.risk_category,
        ...probs,
      },
      recommendation,
      recommendedProductId: product_id,
    });

    // 6. Natural-language explanation (Gemini, with deterministic fallback).
    //    The four factors that most influence the result — DTI is computed the
    //    same way the model derives it; the rest come from the mapped fields.
    const totalIncome =
      Number(modelFields.monthly_salary) + Number(modelFields.additional_income);
    const factors = {
      dti: totalIncome > 0 ? Number(requested_amount) / 12 / totalIncome : null,
      cribScore: modelFields.crib_score,
      // Flags so the explanation never asserts a self-declared/neutral-default
      // number as if it were a verified credit-bureau record.
      cribProvided: isProvided(declared.crib_score),
      guarantorExposure: modelFields.guarantor_exposure,
      guarantorProvided: isProvided(declared.guarantor_exposure),
      savingsRatio: modelFields.savings_ratio,
    };
    // explainRisk never throws — it degrades to a fallback string on any Gemini
    // failure, so the assess response always carries a non-empty explanation.
    const explanation = await explainRisk({
      riskCategory: risk.risk_category,
      probabilities: risk.probabilities,
      factors,
      language: req.body.language,
    });
    // Persist the explanation outside the assess transaction; a failed UPDATE
    // must not discard the risk/recommendation already saved and returned.
    try {
      await loanModel.updateRecommendationExplanation(applicationId, explanation);
    } catch (updateErr) {
      console.error("GEMINI EXPLANATION PERSIST ERROR:", updateErr);
    }

    return res.status(201).json({
      application_id: applicationId,
      risk: {
        label: risk.risk_label,
        category: risk.risk_category,
        probabilities: risk.probabilities,
      },
      recommendation,
      explanation,
    });
  } catch (err) {
    console.error("LOAN ASSESS ERROR:", err);
    // A model-service failure is an upstream/gateway problem, not a client one.
    const isModelError = /risk model/i.test(err.message || "");
    return res.status(isModelError ? 502 : 500).json({
      message: isModelError
        ? "The risk model service is unavailable. Please try again shortly."
        : "Failed to assess the loan application.",
      error: err.message,
    });
  }
};

// POST /api/loans/manual-assess (admin/staff): a standalone risk calculator.
// The caller supplies the full applicant profile directly instead of it
// coming from a customer_profiles row — there is no target customer account,
// and nothing is persisted (no loan_applications/risk_assessments/
// recommendations rows). Useful for a quick what-if check on a prospect who
// isn't (yet) a registered customer.
exports.manualAssess = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const {
    age,
    gender,
    employment_type,
    monthly_income,
    monthly_expense,
    requested_amount,
    tenure_months,
    interest_rate,
    purpose,
  } = req.body;

  const declared = {};
  for (const field of DECLARABLE_FIELDS) {
    if (isProvided(req.body[field])) declared[field] = req.body[field];
  }

  try {
    const profile = { age, gender, employment_type, monthly_income, monthly_expense };

    const modelFields = mapProfileToModelFields(
      profile,
      { requested_amount, tenure_months, interest_rate },
      declared
    );
    const risk = await predictRisk(modelFields);

    const netIncome = Math.max(0, Number(monthly_income) - Number(monthly_expense));
    const recommendation = buildRecommendation({
      netIncome,
      riskLabel: risk.risk_label,
      annualRatePct: Number(interest_rate),
      tenureMonths: tenure_months,
      requestedAmount: requested_amount,
      purpose,
    });

    const totalIncome =
      Number(modelFields.monthly_salary) + Number(modelFields.additional_income);
    const factors = {
      dti: totalIncome > 0 ? Number(requested_amount) / 12 / totalIncome : null,
      cribScore: modelFields.crib_score,
      cribProvided: isProvided(declared.crib_score),
      guarantorExposure: modelFields.guarantor_exposure,
      guarantorProvided: isProvided(declared.guarantor_exposure),
      savingsRatio: modelFields.savings_ratio,
    };
    const explanation = await explainRisk({
      riskCategory: risk.risk_category,
      probabilities: risk.probabilities,
      factors,
      language: req.body.language,
    });

    return res.status(200).json({
      risk: {
        label: risk.risk_label,
        category: risk.risk_category,
        probabilities: risk.probabilities,
      },
      recommendation,
      explanation,
    });
  } catch (err) {
    console.error("MANUAL ASSESS ERROR:", err);
    const isModelError = /risk model/i.test(err.message || "");
    return res.status(isModelError ? 502 : 500).json({
      message: isModelError
        ? "The risk model service is unavailable. Please try again shortly."
        : "Failed to run the risk assessment.",
      error: err.message,
    });
  }
};

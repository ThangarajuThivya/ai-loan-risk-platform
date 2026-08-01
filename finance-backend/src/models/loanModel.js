"use strict";

/**
 * Loan data-access layer — SQL for the assess flow.
 *
 * Reads: the caller's customer_profiles row and the chosen loan_products row.
 * Writes: loan_applications → risk_assessments → recommendations, as a single
 * transaction (see runAssessmentTransaction) so a failed step never leaves
 * orphan rows.
 *
 * The pool in src/config/db.js is the callback-style mysql2 pool; we use its
 * promise wrapper (db.promise()) here for async/await + transactions.
 */

const db = require("../config/db");
const { langSuffix, localizedColumn } = require("../utils/i18nContent");

const pool = db.promise();

/**
 * Load a customer's profile (the fields the model + recommendation need).
 * @param {number} userId
 * @returns {Promise<object|undefined>} the customer_profiles row, or undefined
 */
async function findProfileByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT user_id, date_of_birth, gender, address, employment_type,
            company_name, monthly_income, monthly_expense
       FROM customer_profiles
      WHERE user_id = ?`,
    [userId]
  );
  return rows[0];
}

/**
 * Load a loan product by id.
 * @param {number} productId
 * @returns {Promise<object|undefined>} the loan_products row, or undefined
 */
async function findProductById(productId, { lang } = {}) {
  const suffix = langSuffix(lang);
  const [rows] = await pool.query(
    `SELECT id, ${localizedColumn("name", suffix)}, type,
            min_amount, max_amount, min_tenure_months,
            max_tenure_months, interest_rate, rate_type,
            ${localizedColumn("description", suffix)}
       FROM loan_products
      WHERE id = ?`,
    [productId]
  );
  return rows[0];
}

/**
 * All loan products, for populating an "apply" form's product picker.
 * @param {object} [opts]
 * @param {string} [opts.lang] "si" | "ta" | anything else → English
 * @returns {Promise<object[]>}
 */
async function findAllProducts({ lang } = {}) {
  const suffix = langSuffix(lang);
  // Ordered by the English name in every language: the alias shadows `name`,
  // so ordering by it would reorder the catalogue per language for no reason.
  const [rows] = await pool.query(
    `SELECT id, ${localizedColumn("name", suffix)}, type,
            min_amount, max_amount, min_tenure_months,
            max_tenure_months, interest_rate, rate_type,
            ${localizedColumn("description", suffix)}
       FROM loan_products
      ORDER BY loan_products.name`
  );
  return rows;
}

/**
 * Create a loan product.
 * @param {object} data name, type, min_amount, max_amount, min_tenure_months,
 *   max_tenure_months, interest_rate, rate_type, description
 * @returns {Promise<object>} the created loan_products row
 */
async function createProduct(data) {
  const [result] = await pool.query(
    `INSERT INTO loan_products
       (name, type, min_amount, max_amount, min_tenure_months, max_tenure_months,
        interest_rate, rate_type, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.type,
      data.min_amount,
      data.max_amount,
      data.min_tenure_months,
      data.max_tenure_months,
      data.interest_rate,
      data.rate_type,
      data.description || null,
    ]
  );
  return findProductById(result.insertId);
}

/**
 * Update a loan product's fields.
 * @param {number} productId
 * @param {object} data same shape as createProduct
 * @returns {Promise<object|null>} the updated row, or null if not found
 */
async function updateProduct(productId, data) {
  const [result] = await pool.query(
    `UPDATE loan_products
        SET name = ?, type = ?, min_amount = ?, max_amount = ?,
            min_tenure_months = ?, max_tenure_months = ?, interest_rate = ?,
            rate_type = ?, description = ?
      WHERE id = ?`,
    [
      data.name,
      data.type,
      data.min_amount,
      data.max_amount,
      data.min_tenure_months,
      data.max_tenure_months,
      data.interest_rate,
      data.rate_type,
      data.description || null,
      productId,
    ]
  );
  if (result.affectedRows === 0) return null;
  return findProductById(productId);
}

/**
 * Delete a loan product. Fails with a FK error (thrown, caller handles it)
 * if any loan_applications still reference it — loan_products has no
 * ON DELETE CASCADE/SET NULL, by design (never silently orphan a real
 * application's product reference).
 * @param {number} productId
 * @returns {Promise<{notFound:true}|{deleted:true}>}
 */
async function deleteProduct(productId) {
  const [result] = await pool.query(`DELETE FROM loan_products WHERE id = ?`, [
    productId,
  ]);
  if (result.affectedRows === 0) return { notFound: true };
  return { deleted: true };
}

/**
 * Run the full assess persistence as one transaction:
 *   loan_applications (pending) → risk_assessments → recommendations.
 * Rolls back on any failure. gemini_explanation is left NULL for now.
 *
 * @param {object} p
 * @param {number} p.userId
 * @param {number} p.productId
 * @param {number} p.requestedAmount
 * @param {number} p.tenureMonths
 * @param {string} [p.purpose]
 * @param {object} p.risk           { risk_label, risk_category, probLow, probMedium, probHigh }
 * @param {object} p.recommendation { loan_type, recommended_amount, recommended_emi }
 * @param {number} [p.recommendedProductId]
 * @param {object} [p.declared]     applicant-declared model-field overrides (see
 *                                  mlClient.service.js DECLARABLE_FIELDS) — stored
 *                                  alongside the application for reference/audit;
 *                                  any field omitted here is stored as NULL.
 * @returns {Promise<{applicationId:number, assessmentId:number, recommendationId:number}>}
 */
async function runAssessmentTransaction(p) {
  const conn = await pool.getConnection();
  const d = p.declared || {};
  try {
    await conn.beginTransaction();

    const [appResult] = await conn.query(
      `INSERT INTO loan_applications
         (user_id, product_id, requested_amount, tenure_months, purpose, status,
          marital_status, education_level, occupation, employer_category,
          years_employed, additional_income, existing_loans, previous_defaults,
          crib_score, guarantor_exposure, guarantor_defaults)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.userId,
        p.productId,
        p.requestedAmount,
        p.tenureMonths,
        p.purpose || null,
        d.marital_status ?? null,
        d.education_level ?? null,
        d.occupation ?? null,
        d.employer_category ?? null,
        d.years_employed ?? null,
        d.additional_income ?? null,
        d.existing_loans ?? null,
        d.previous_defaults ?? null,
        d.crib_score ?? null,
        d.guarantor_exposure ?? null,
        d.guarantor_defaults ?? null,
      ]
    );
    const applicationId = appResult.insertId;

    const [assessResult] = await conn.query(
      `INSERT INTO risk_assessments
         (application_id, risk_label, risk_category, prob_low, prob_medium,
          prob_high, model_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        p.risk.risk_label,
        p.risk.risk_category,
        p.risk.probLow,
        p.risk.probMedium,
        p.risk.probHigh,
        p.risk.model_version || null,
      ]
    );

    const [recResult] = await conn.query(
      `INSERT INTO recommendations
         (application_id, recommended_amount, recommended_emi,
          recommended_product_id, gemini_explanation)
       VALUES (?, ?, ?, ?, NULL)`,
      [
        applicationId,
        p.recommendation.recommended_amount,
        p.recommendation.recommended_emi,
        p.recommendedProductId || null,
      ]
    );

    await conn.commit();
    return {
      applicationId,
      assessmentId: assessResult.insertId,
      recommendationId: recResult.insertId,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Attach a Gemini (or fallback) explanation to an application's recommendation
 * row. Called after the assess transaction commits, so a Gemini hiccup can't
 * roll back the risk/recommendation the customer already received.
 * @param {number} applicationId
 * @param {string} explanation
 * @returns {Promise<number>} affected row count
 */
async function updateRecommendationExplanation(applicationId, explanation) {
  const [result] = await pool.query(
    `UPDATE recommendations
        SET gemini_explanation = ?
      WHERE application_id = ?`,
    [explanation, applicationId]
  );
  return result.affectedRows;
}

/**
 * Common SELECT/JOIN list shared by the "my applications" and "application
 * detail" queries: application + product name + risk assessment +
 * recommendation, one row per application.
 */
const APPLICATION_DETAIL_SELECT = `
  SELECT
    la.id, la.user_id, la.product_id, la.requested_amount, la.tenure_months,
    la.purpose, la.status, la.created_at, la.updated_at,
    la.marital_status, la.education_level, la.occupation, la.employer_category,
    la.years_employed, la.additional_income, la.existing_loans,
    la.previous_defaults, la.crib_score, la.guarantor_exposure,
    la.guarantor_defaults,
    lp.name AS product_name, lp.type AS product_type,
    ra.risk_label, ra.risk_category, ra.prob_low, ra.prob_medium, ra.prob_high,
    ra.assessed_at,
    rec.recommended_amount, rec.recommended_emi, rec.recommended_product_id,
    rec.gemini_explanation
  FROM loan_applications la
  LEFT JOIN loan_products lp ON lp.id = la.product_id
  LEFT JOIN risk_assessments ra ON ra.application_id = la.id
  LEFT JOIN recommendations rec ON rec.application_id = la.id
`;

/**
 * All applications for a given customer, newest first.
 * @param {number} userId
 * @returns {Promise<object[]>}
 */
async function findApplicationsByUserId(userId) {
  const [rows] = await pool.query(
    `${APPLICATION_DETAIL_SELECT} WHERE la.user_id = ? ORDER BY la.created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * A single application by id, joined with product/risk/recommendation.
 * @param {number} applicationId
 * @returns {Promise<object|undefined>}
 */
async function findApplicationById(applicationId) {
  const [rows] = await pool.query(
    `${APPLICATION_DETAIL_SELECT} WHERE la.id = ?`,
    [applicationId]
  );
  return rows[0];
}

/**
 * All applications (admin view), joined with applicant name/email and
 * optionally filtered by status.
 * @param {string} [status]
 * @returns {Promise<object[]>}
 */
async function findAllApplications(status) {
  const params = [];
  let where = "";
  if (status) {
    where = "WHERE la.status = ?";
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT
       la.id, la.user_id, la.product_id, la.requested_amount, la.tenure_months,
       la.purpose, la.status, la.created_at, la.updated_at,
       la.marital_status, la.education_level, la.occupation, la.employer_category,
       la.years_employed, la.additional_income, la.existing_loans,
       la.previous_defaults, la.crib_score, la.guarantor_exposure,
       la.guarantor_defaults,
       u.first_name, u.last_name, u.email,
       lp.name AS product_name, lp.type AS product_type,
       ra.risk_label, ra.risk_category, ra.prob_low, ra.prob_medium, ra.prob_high,
       rec.recommended_amount, rec.recommended_emi
     FROM loan_applications la
     JOIN users u ON u.user_id = la.user_id
     LEFT JOIN loan_products lp ON lp.id = la.product_id
     LEFT JOIN risk_assessments ra ON ra.application_id = la.id
     LEFT JOIN recommendations rec ON rec.application_id = la.id
     ${where}
     ORDER BY la.created_at DESC`,
    params
  );
  return rows;
}

/**
 * Transition a pending application to approved/rejected and notify the
 * applicant, as a single transaction (row lock guards concurrent decisions).
 * @param {object} p
 * @param {number} p.applicationId
 * @param {'approved'|'rejected'} p.status
 * @param {string} [p.note]
 * @returns {Promise<{notFound:true}|{conflict:true,status:string}|{userId:number}>}
 */
async function updateApplicationStatus({ applicationId, status, note }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, user_id, status FROM loan_applications WHERE id = ? FOR UPDATE`,
      [applicationId]
    );
    const current = rows[0];
    if (!current) {
      await conn.rollback();
      return { notFound: true };
    }
    if (current.status !== "pending") {
      await conn.rollback();
      return { conflict: true, status: current.status };
    }

    await conn.query(`UPDATE loan_applications SET status = ? WHERE id = ?`, [
      status,
      applicationId,
    ]);

    const title =
      status === "approved" ? "Loan Application Approved" : "Loan Application Rejected";
    const message =
      status === "approved"
        ? `Your loan application #${applicationId} has been approved.${note ? ` Note: ${note}` : ""}`
        : `Your loan application #${applicationId} has been rejected.${note ? ` Note: ${note}` : ""}`;
    await conn.query(
      `INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
      [current.user_id, title, message]
    );

    await conn.commit();
    return { userId: current.user_id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  findProfileByUserId,
  findProductById,
  findAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  runAssessmentTransaction,
  updateRecommendationExplanation,
  findApplicationsByUserId,
  findApplicationById,
  findAllApplications,
  updateApplicationStatus,
};

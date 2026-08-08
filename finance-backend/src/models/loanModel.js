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
const {
  checkTransition,
  isCreditDecision,
  isInfoRequest,
  isInfoResponse,
  buildNotification,
  shouldEmailStatusChange,
} = require("../services/applicationStatus.service");
const { sendApplicationStatusEmail } = require("../utils/mailer");
const { deriveAccountDates } = require("../services/loanSchedule.service");
const { buildAmortizationSchedule } = require("../services/amortization.service");
const {
  allocatePayment,
  computeOutstanding,
  computeSettlement,
  computeSettlementWaivers,
  computeLateFeeAssessments,
  installmentStatus,
  round2,
} = require("../services/repayment.service");
const bankAccountModel = require("./bankAccountModel");

const pool = db.promise();

/**
 * Email the applicant about a status change, if (and only if) this status
 * is one of the "major" transitions worth a real email (G2) and there's
 * notification copy to send. Deliberately called AFTER the caller's own
 * transaction has committed — email is slow/unreliable external I/O and
 * has no business running under a row lock (`FOR UPDATE`), and a failed
 * send must never roll back or fail an already-successful status change,
 * hence the catch-and-log rather than propagate.
 * @param {number} userId
 * @param {string} status
 * @param {{title:string, message:string}|null} notification
 */
async function emailApplicantIfDue(userId, status, notification) {
  if (!notification || !shouldEmailStatusChange(status)) return;
  try {
    const [rows] = await pool.query(`SELECT email FROM users WHERE user_id = ?`, [userId]);
    const email = rows[0]?.email;
    if (email) await sendApplicationStatusEmail(email, notification);
  } catch (err) {
    console.error("APPLICATION STATUS EMAIL FAILED:", err.message);
  }
}

/**
 * Load a customer's profile (the fields the model + recommendation need).
 * @param {number} userId
 * @returns {Promise<object|undefined>} the customer_profiles row, or undefined
 */
async function findProfileByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT user_id, date_of_birth, gender, address, employment_type,
            company_name, monthly_income, monthly_expense,
            marital_status, education_level, occupation, employer_category,
            years_employed
       FROM customer_profiles
      WHERE user_id = ?`,
    [userId]
  );
  return rows[0];
}

/**
 * Write back whichever PROFILE_BACKED_FIELDS (mlClient.service.js) the
 * applicant actually declared on this application (H2) — keeps
 * customer_profiles current so future applications/the profile page see it.
 * Only touches columns present on `fields`; a no-op if none were supplied.
 * Best-effort — callers should catch/log rather than fail the request on error.
 * @param {number} userId
 * @param {object} fields a subset of {marital_status, education_level,
 *                         occupation, employer_category, years_employed}
 */
async function updateProfileDeclaredFields(userId, fields) {
  const columns = Object.keys(fields || {});
  if (!columns.length) return;

  const setClause = columns.map((col) => `${col} = ?`).join(", ");
  const values = columns.map((col) => fields[col]);
  await pool.query(
    `UPDATE customer_profiles SET ${setClause} WHERE user_id = ?`,
    [...values, userId]
  );
}

/**
 * The customer's single in-progress wizard draft (H3/037), or undefined.
 * Deliberately its own table, not a loan_applications row — see the header
 * of migration 037 for why.
 * @param {number} userId
 * @returns {Promise<object|undefined>} {id, user_id, step, payload, created_at, updated_at}
 */
async function findDraftByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, step, payload, created_at, updated_at
       FROM loan_application_drafts
      WHERE user_id = ?`,
    [userId]
  );
  return rows[0];
}

/**
 * Create or replace the customer's draft. UNIQUE(user_id) makes this a plain
 * upsert, which is what enforces one-draft-per-customer — a second save
 * overwrites rather than accumulating rows.
 * @param {number} userId
 * @param {{step:number, payload:object}} draft already sanitized by
 *        loanDraft.service.js — this function does no validation of its own
 */
async function upsertDraft(userId, { step, payload }) {
  await pool.query(
    `INSERT INTO loan_application_drafts (user_id, step, payload)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       step = VALUES(step),
       payload = VALUES(payload)`,
    [userId, step, JSON.stringify(payload)]
  );
}

/**
 * Discard the customer's draft — on an explicit "start fresh", and after a
 * successful submission so a submitted application leaves nothing stale.
 * @param {number} userId
 */
async function deleteDraftByUserId(userId) {
  await pool.query(`DELETE FROM loan_application_drafts WHERE user_id = ?`, [userId]);
}

/**
 * A customer's current loan exposure: how many applications are still
 * "live" and their combined requested amount. Used by the assess flow to
 * cap concurrent applications and total requested exposure per customer
 * (see loan.controller.js MAX_PENDING_APPLICATIONS /
 * MAX_EXPOSURE_MONTHLY_INCOME_MULTIPLE).
 *
 * "Live" = anything not in a terminal state that released the customer:
 * rejected, withdrawn and closed do not count against them. Everything
 * else does, including disbursed — money actually out the door is the most
 * real exposure there is.
 *
 * `undecidedCount` is the narrower "still sitting in someone's queue"
 * figure the concurrent-application cap uses; approved/disbursed loans are
 * live exposure but are no longer waiting on a reviewer, so they must not
 * block the customer from applying again.
 *
 * @param {number} userId
 * @returns {Promise<{undecidedCount:number, activeCount:number, totalActiveAmount:number}>}
 */
async function getActiveExposure(userId) {
  const [rows] = await pool.query(
    `SELECT
       COUNT(*) AS active_count,
       SUM(CASE WHEN status IN ('pending', 'under_review', 'more_info_required')
                THEN 1 ELSE 0 END) AS undecided_count,
       COALESCE(SUM(requested_amount), 0) AS total_active_amount
     FROM loan_applications
     WHERE user_id = ?
       AND status NOT IN ('rejected', 'withdrawn', 'closed')`,
    [userId]
  );
  const row = rows[0] || {};
  return {
    activeCount: Number(row.active_count) || 0,
    undecidedCount: Number(row.undecided_count) || 0,
    totalActiveAmount: Number(row.total_active_amount) || 0,
  };
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
            max_tenure_months, interest_rate,
            min_interest_rate, max_interest_rate, rate_type,
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
            max_tenure_months, interest_rate,
            min_interest_rate, max_interest_rate, rate_type,
            ${localizedColumn("description", suffix)}
       FROM loan_products
      ORDER BY loan_products.name`
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Product fee configuration (migration 041). The CONFIG side of fees — what a
// product charges. The snapshot side (what an offer actually charged) lives
// with the offer functions further down.
// ---------------------------------------------------------------------------

const PRODUCT_FEE_COLUMNS = `id, product_id, fee_type, label, calc_method,
                             rate_or_amount, min_amount, max_amount, active`;

/**
 * A product's configured fees.
 * @param {number} productId
 * @param {object} [opts]
 * @param {boolean} [opts.activeOnly=false] true when resolving fees for a real
 *   offer (an inactive fee must not be charged); false for the admin editor,
 *   which has to show and be able to re-activate them.
 * @returns {Promise<object[]>}
 */
async function findProductFees(productId, { activeOnly = false } = {}) {
  const [rows] = await pool.query(
    `SELECT ${PRODUCT_FEE_COLUMNS} FROM loan_product_fees
      WHERE product_id = ?${activeOnly ? " AND active = 1" : ""}
      ORDER BY FIELD(fee_type,'processing','documentation','credit_life_insurance','other'), id`,
    [productId]
  );
  return rows;
}

/**
 * Replace a product's ENTIRE fee set in one transaction.
 *
 * Replace rather than patch, matching the product endpoints' own "send the
 * whole form" convention — and because a partial update has no sensible
 * answer for "a fee that used to be configured and isn't in this payload".
 * Delete-then-insert inside one transaction so a product is never briefly
 * fee-less to a concurrent offer being issued.
 *
 * Only ever touches CONFIG. Fees already snapshotted onto issued offers are
 * untouched by design — see migration 041's header.
 *
 * @param {number} productId
 * @param {object[]} fees {fee_type, label, calc_method, rate_or_amount, min_amount, max_amount, active}
 * @returns {Promise<object[]>} the product's fees as they now stand
 */
async function replaceProductFees(productId, fees = []) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM loan_product_fees WHERE product_id = ?`, [productId]);
    if (fees.length) {
      await conn.query(
        `INSERT INTO loan_product_fees
           (product_id, fee_type, label, calc_method, rate_or_amount,
            min_amount, max_amount, active)
         VALUES ?`,
        [
          fees.map((f) => [
            productId,
            f.fee_type,
            f.label,
            f.calc_method,
            f.rate_or_amount,
            f.min_amount ?? null,
            f.max_amount ?? null,
            f.active === false || f.active === 0 ? 0 : 1,
          ]),
        ]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return findProductFees(productId);
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
        interest_rate, min_interest_rate, max_interest_rate, rate_type, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      data.type,
      data.min_amount,
      data.max_amount,
      data.min_tenure_months,
      data.max_tenure_months,
      data.interest_rate,
      // Both-or-neither: the validator (admin.routes.js PRODUCT_VALIDATORS)
      // enforces this, but ?? null here means a half-filled request from
      // any other caller can never land only one bound in the database.
      data.min_interest_rate ?? null,
      data.max_interest_rate ?? null,
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
            min_interest_rate = ?, max_interest_rate = ?,
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
      data.min_interest_rate ?? null,
      data.max_interest_rate ?? null,
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
 *   loan_applications (pending) → risk_assessments → recommendations
 *   → credit_policy_evaluations → decision_matrix_evaluations.
 * Rolls back on any failure. gemini_explanation is left NULL for now.
 *
 * When the matrix returns auto_reject this ALSO decides the application —
 * status, decision fields, audit event and notification — in the same
 * transaction. That is the only path on which the system decides by itself;
 * see decisionMatrix.service.js for why approval is not on it.
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
 * @param {object} [p.policy]       the creditPolicy.service evaluation (029) —
 *                                  { policy_version, outcome, reason_codes,
 *                                    metrics, rules }. Omitting it skips the
 *                                  evaluation row rather than failing, so an
 *                                  older caller still persists an application.
 * @param {object} [p.matrix]       the decisionMatrix.service evaluation (030)
 *                                  — { matrix_version, action, policy_outcome,
 *                                    risk_label, risk_category, rationale }.
 *                                  Omitting it skips the evaluation row and
 *                                  leaves the application 'pending'.
 * @param {number} [p.pricedInterestRate] the interestPricing.service rate (031)
 *                                  this application was assessed and quoted
 *                                  at. Omitting it (an older caller, or a
 *                                  product with no configured range) leaves
 *                                  the column NULL.
 * @param {object} [p.adverseAction] the adverseAction.service buildAdverseActionRecord()
 *                                  output (D4/032) — REQUIRED whenever
 *                                  p.matrix.action === 'auto_reject'
 *                                  (enforced by throwing, not silently
 *                                  skipping); ignored otherwise.
 * @param {object[]} [p.guarantors] D5/033 — real guarantor(s) nominated for
 *                                  this application: [{ nic, fullName,
 *                                  phone, address, relationshipToApplicant,
 *                                  guaranteedAmount }]. Each is find-or-
 *                                  created by NIC and linked; omit or leave
 *                                  empty for an unguaranteed application.
 * @param {object[]} [p.collateral] D5/033 — collateral pledged against this
 *                                  application: [{ collateralType,
 *                                  description, estimatedValue,
 *                                  valuationDate, ownershipReference }].
 *                                  Always persisted as 'self_declared'.
 * @returns {Promise<{applicationId:number, assessmentId:number,
 *                    recommendationId:number, policyEvaluationId:number|null,
 *                    matrixEvaluationId:number|null, status:string}>}
 */
async function runAssessmentTransaction(p) {
  const conn = await pool.getConnection();
  const d = p.declared || {};
  // Set only on the auto-reject branch below; fired after commit (G2) —
  // see emailApplicantIfDue's header comment for why email waits until
  // the transaction is safely done.
  let pendingEmail = null;
  try {
    await conn.beginTransaction();

    const [appResult] = await conn.query(
      `INSERT INTO loan_applications
         (user_id, product_id, requested_amount, tenure_months, purpose, status,
          marital_status, education_level, occupation, employer_category,
          years_employed, additional_income, existing_loans, previous_defaults,
          crib_score, guarantor_exposure, guarantor_defaults, priced_interest_rate)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        // The rate this application was actually assessed and quoted at
        // (D3) — snapshotted here so a later product re-price never
        // rewrites what an existing application's policy verdict or
        // recommendation was computed against. NULL when the caller (an
        // older code path, or a product with no configured range) has
        // nothing risk-based to record.
        p.pricedInterestRate ?? null,
      ]
    );
    const applicationId = appResult.insertId;

    // First row in the application's audit trail (022) — from_status NULL
    // marks "the application coming into existence", not a transition
    // between two real statuses.
    await conn.query(
      `INSERT INTO loan_application_events
         (application_id, from_status, to_status, actor_user_id, actor_role, note)
       VALUES (?, NULL, 'pending', ?, 'customer', NULL)`,
      [applicationId, p.userId]
    );

    // D5: guarantor(s) and collateral submitted with the application. Each
    // guarantor is find-or-created by NIC (guarantors is a shared person
    // entity), then linked; collateral rows always start 'self_declared'.
    // All of it lands in the SAME transaction as the application itself —
    // an application row must never exist with only half its declared
    // security recorded.
    for (const guarantor of p.guarantors || []) {
      const guarantorId = await upsertGuarantorWithin(conn, {
        nic: guarantor.nic,
        fullName: guarantor.fullName,
        phone: guarantor.phone,
        address: guarantor.address,
      });
      await insertLoanGuarantorWithin(conn, {
        applicationId,
        guarantorId,
        relationshipToApplicant: guarantor.relationshipToApplicant,
        guaranteedAmount: guarantor.guaranteedAmount,
        addedBy: p.userId,
      });
    }
    for (const item of p.collateral || []) {
      await insertCollateralItemWithin(conn, {
        applicationId,
        collateralType: item.collateralType,
        description: item.description,
        estimatedValue: item.estimatedValue,
        valuationDate: item.valuationDate,
        ownershipReference: item.ownershipReference,
      });
    }

    const [assessResult] = await conn.query(
      `INSERT INTO risk_assessments
         (application_id, risk_label, risk_category, prob_low, prob_medium,
          prob_high, model_version, behavioural_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        p.risk.risk_label,
        p.risk.risk_category,
        p.risk.probLow,
        p.risk.probMedium,
        p.risk.probHigh,
        p.risk.model_version || null,
        // Frozen at decision time (043). Recomputing this on read would show a
        // reviewer today's repayment record beside a decision that never saw
        // it — see the migration header.
        p.risk.behaviouralSnapshot
          ? JSON.stringify(p.risk.behaviouralSnapshot)
          : null,
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

    // The deterministic credit-policy verdict (029), written in the SAME
    // transaction as the application and the risk assessment. An application
    // that exists without the policy verdict that was in force when it was
    // taken is exactly the audit gap D1 exists to close, so the two must
    // commit or roll back together.
    let policyEvaluationId = null;
    if (p.policy) {
      const pm = p.policy.metrics || {};
      const [policyResult] = await conn.query(
        `INSERT INTO credit_policy_evaluations
           (application_id, policy_version, outcome, reason_codes, dti,
            loan_to_income, residual_income, age_at_maturity, rules)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          applicationId,
          p.policy.policy_version,
          p.policy.outcome,
          (p.policy.reason_codes || []).join(",") || null,
          pm.dti ?? null,
          pm.loan_to_income ?? null,
          pm.residual_income ?? null,
          pm.age_at_maturity ?? null,
          JSON.stringify(p.policy.rules || []),
        ]
      );
      policyEvaluationId = policyResult.insertId;
    }

    // The decision matrix (030) — combines the two judgements above into a
    // recommendation, and for auto_reject actually carries it out. All of it
    // rides this same transaction: an application that exists as 'rejected'
    // without the evaluation that rejected it, or an evaluation claiming it
    // `acted` on an application still sitting in 'pending', would each be a
    // lie in the audit trail.
    let matrixEvaluationId = null;
    let autoRejected = false;
    if (p.matrix) {
      autoRejected = p.matrix.action === "auto_reject";

      const [matrixResult] = await conn.query(
        `INSERT INTO decision_matrix_evaluations
           (application_id, matrix_version, action, policy_outcome, risk_label,
            risk_category, rationale, acted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          applicationId,
          p.matrix.matrix_version,
          p.matrix.action,
          p.matrix.policy_outcome,
          p.matrix.risk_label,
          p.matrix.risk_category,
          p.matrix.rationale,
          autoRejected ? 1 : 0,
        ]
      );
      matrixEvaluationId = matrixResult.insertId;

      if (autoRejected) {
        // Validate the automatic move against the SAME machine a human move
        // goes through. The application was created 'pending' three
        // statements ago so this can only fail if someone narrows
        // TRANSITIONS without thinking about the system actor — which is
        // exactly when a silent direct UPDATE here would be worst. Throwing
        // rolls the whole assessment back rather than writing a status the
        // machine says is illegal.
        const check = checkTransition("pending", "rejected", "system");
        if (!check.ok) {
          throw new Error(`Automatic rejection is not a legal transition: ${check.reason}`);
        }

        // decided_by stays NULL — no user made this call. decision_source
        // is what distinguishes that from a deleted staff account, which
        // 019's ON DELETE SET NULL also produces.
        await conn.query(
          `UPDATE loan_applications
              SET status = 'rejected', decided_by = NULL, decision_note = ?,
                  decided_at = CURRENT_TIMESTAMP, decision_source = 'system'
            WHERE id = ?`,
          [p.matrix.rationale, applicationId]
        );

        // A second event row, after the creation row written above: the
        // application was created and then rejected, and flattening the two
        // into one would hide that it ever existed as a live application.
        // actor_role 'system' is a real role in the status machine (see
        // applicationStatus.service.js), not a placeholder.
        await conn.query(
          `INSERT INTO loan_application_events
             (application_id, from_status, to_status, actor_user_id, actor_role, note)
           VALUES (?, 'pending', 'rejected', NULL, 'system', ?)`,
          [applicationId, p.matrix.rationale]
        );

        const notification = buildNotification("rejected", applicationId, p.matrix.rationale);
        if (notification) {
          await conn.query(
            `INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
            [p.userId, notification.title, notification.message]
          );
        }
        // Queued for after commit — see runAssessmentTransaction's return
        // path below, which fires it once the transaction is safely done.
        pendingEmail = { userId: p.userId, status: "rejected", notification };

        // The standardized, immutable "why" (D4) — written in this SAME
        // transaction as the rejection itself, so an application can never
        // end up 'rejected' with no adverse-action record explaining it.
        // p.adverseAction is required whenever the matrix auto-rejects (the
        // controller always builds one from the policy verdict that just
        // declined the application); its absence here would be a caller bug,
        // not a normal condition, so this throws rather than degrading.
        if (!p.adverseAction) {
          throw new Error("Auto-reject requires an adverseAction record (D4).");
        }
        await createAdverseActionRecordWithin(conn, {
          applicationId,
          ...p.adverseAction,
        });
      }
    }

    await conn.commit();
    if (pendingEmail) {
      await emailApplicantIfDue(pendingEmail.userId, pendingEmail.status, pendingEmail.notification);
    }
    return {
      applicationId,
      assessmentId: assessResult.insertId,
      recommendationId: recResult.insertId,
      policyEvaluationId,
      matrixEvaluationId,
      // The controller needs this to report the real status back to the
      // applicant rather than assuming 'pending'.
      status: autoRejected ? "rejected" : "pending",
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
 * The application's most recent offer (023), joined on rather than fetched
 * per-row so the admin list doesn't turn into an N+1. The correlated
 * subquery picks exactly one offer id, which keeps the join 1:1 and means
 * an application with a long offer history still yields a single row.
 *
 * `id`, `status` and `rate_type` are aliased with an `offer_` prefix
 * because loan_applications has columns of the same name; controller
 * serializeOffer reads the prefixed forms.
 */
const LATEST_OFFER_COLUMNS = `
    lo.id AS offer_id, lo.status AS offer_status, lo.rate_type AS offer_rate_type,
    lo.offered_amount, lo.offered_tenure_months, lo.offered_interest_rate,
    lo.offered_emi, lo.offer_note, lo.offered_at, lo.expires_at,
    lo.responded_at AS offer_responded_at, lo.response_note AS offer_response_note,
    offerer.first_name AS offered_by_first_name,
    offerer.last_name AS offered_by_last_name`;

const LATEST_OFFER_JOIN = `
  LEFT JOIN loan_offers lo ON lo.id = (
    SELECT id FROM loan_offers
     WHERE application_id = la.id
     ORDER BY offered_at DESC, id DESC
     LIMIT 1
  )
  LEFT JOIN users offerer ON offerer.user_id = lo.offered_by`;

/**
 * The application's latest deterministic credit-policy verdict (029).
 * Same correlated-subquery shape as the offer join, and for the same reason:
 * re-evaluation under a newer policy_version appends a row rather than
 * overwriting, so "latest by id" is what a reader wants and the join stays
 * 1:1.
 *
 * `outcome`, `rules` and `id` are aliased with a `policy_` prefix — the
 * first would collide with nothing today but reads ambiguously next to
 * loan_applications.status, and controller serializePolicy reads the
 * prefixed forms throughout.
 */
const POLICY_COLUMNS = `
    cpe.id AS policy_id, cpe.outcome AS policy_outcome,
    cpe.policy_version, cpe.reason_codes AS policy_reason_codes,
    cpe.dti AS policy_dti, cpe.loan_to_income AS policy_loan_to_income,
    cpe.residual_income AS policy_residual_income,
    cpe.age_at_maturity AS policy_age_at_maturity,
    cpe.rules AS policy_rules, cpe.evaluated_at AS policy_evaluated_at`;

const POLICY_JOIN = `
  LEFT JOIN credit_policy_evaluations cpe ON cpe.id = (
    SELECT id FROM credit_policy_evaluations
     WHERE application_id = la.id
     ORDER BY id DESC
     LIMIT 1
  )`;

/**
 * The application's latest decision-matrix recommendation (030) — same
 * latest-by-id correlated subquery as the policy and offer joins. Aliased
 * with a `matrix_` prefix throughout: `action`, `rationale` and `acted` are
 * generic enough that unprefixed they would read as belonging to the
 * application itself.
 */
const MATRIX_COLUMNS = `
    dme.id AS matrix_id, dme.action AS matrix_action,
    dme.matrix_version, dme.rationale AS matrix_rationale,
    dme.acted AS matrix_acted, dme.risk_label AS matrix_risk_label,
    dme.policy_outcome AS matrix_policy_outcome,
    dme.evaluated_at AS matrix_evaluated_at`;

const MATRIX_JOIN = `
  LEFT JOIN decision_matrix_evaluations dme ON dme.id = (
    SELECT id FROM decision_matrix_evaluations
     WHERE application_id = la.id
     ORDER BY id DESC
     LIMIT 1
  )`;

/**
 * The application's LATEST adverse-action record (032), if any. Same
 * latest-by-id correlated subquery as policy/matrix/offer — an application
 * rejected, reopened, and rejected again carries more than one record (each
 * one an honest immutable snapshot of its own decision), and a reader wants
 * the current one here. The full history is a separate query
 * (getAdverseActionHistory), the same "latest inline, full history via its
 * own endpoint" split as loan_application_events already uses.
 *
 * `id`, `note` and `decided_by` are aliased with an `aar_` prefix because
 * loan_applications has columns of those names for its OWN (mutable, D2)
 * current-decision fields — controller serializeAdverseAction reads the
 * prefixed forms throughout.
 */
const ADVERSE_ACTION_COLUMNS = `
    aar.id AS aar_id, aar.reason_codes AS aar_reason_codes,
    aar.reasons AS aar_reasons, aar.decision_source AS aar_decision_source,
    aar.decided_by AS aar_decided_by, aar.note AS aar_note,
    aar.risk_label AS aar_risk_label, aar.risk_category AS aar_risk_category,
    aar.model_version AS aar_model_version,
    aar.policy_version AS aar_policy_version,
    aar.matrix_version AS aar_matrix_version,
    aar.created_at AS aar_created_at`;

const ADVERSE_ACTION_JOIN = `
  LEFT JOIN adverse_action_records aar ON aar.id = (
    SELECT id FROM adverse_action_records
     WHERE application_id = la.id
     ORDER BY id DESC
     LIMIT 1
  )`;

/**
 * The loan account opened at drawdown (025), if any. A plain 1:1 join —
 * loan_accounts has UNIQUE(application_id), so no subquery is needed.
 * `status` and `id` are aliased for the same collision reason as the offer
 * columns above.
 */
const ACCOUNT_COLUMNS = `
    acc.id AS account_id, acc.account_no, acc.status AS account_status,
    acc.principal, acc.interest_rate AS account_interest_rate,
    acc.rate_type AS account_rate_type, acc.tenure_months AS account_tenure_months,
    acc.emi AS account_emi, acc.disbursed_at, acc.first_due_date,
    acc.maturity_date, acc.closed_at,
    acc.total_fees_charged, acc.net_disbursed_amount`;

const ACCOUNT_JOIN = `
  LEFT JOIN loan_accounts acc ON acc.application_id = la.id`;

// F2 — when the application last changed status, for processing-age/SLA
// (applicationStatus.service.js computeProcessingAge). loan_application_events
// (022) writes one row per transition, including the creation event, so
// MAX(created_at) per application IS "entered current status at" — richer
// than la.created_at/updated_at, neither of which tracks per-transition time.
const LAST_STATUS_EVENT_COLUMN = `evt.last_status_changed_at`;

const LAST_STATUS_EVENT_JOIN = `
  LEFT JOIN (
    SELECT application_id, MAX(created_at) AS last_status_changed_at
      FROM loan_application_events
     GROUP BY application_id
  ) evt ON evt.application_id = la.id`;

/**
 * Common SELECT/JOIN list shared by the "my applications" and "application
 * detail" queries: application + product name + risk assessment +
 * recommendation + latest offer, one row per application.
 */
const APPLICATION_DETAIL_SELECT = `
  SELECT
    la.id, la.user_id, la.product_id, la.requested_amount, la.tenure_months,
    la.purpose, la.status, la.created_at, la.updated_at,
    la.decided_by, la.decision_note, la.decided_at,
    la.override_reason_code, la.decision_source,
    decider.first_name AS decided_by_first_name, decider.last_name AS decided_by_last_name,
    u.first_name AS applicant_first_name, u.last_name AS applicant_last_name, u.email AS applicant_email,
    la.info_request_note, la.info_requested_at, la.info_response, la.info_responded_at,
    la.marital_status, la.education_level, la.occupation, la.employer_category,
    la.years_employed, la.additional_income, la.existing_loans,
    la.previous_defaults, la.crib_score, la.guarantor_exposure,
    la.guarantor_defaults, la.priced_interest_rate,
    lp.name AS product_name, lp.type AS product_type,
    lp.interest_rate AS product_interest_rate,
    lp.min_interest_rate AS product_min_interest_rate,
    lp.max_interest_rate AS product_max_interest_rate,
    lp.rate_type AS product_rate_type,
    ra.risk_label, ra.risk_category, ra.prob_low, ra.prob_medium, ra.prob_high, ra.model_version,
       ra.behavioural_snapshot,
    ra.assessed_at,
    rec.recommended_amount, rec.recommended_emi, rec.recommended_product_id,
    rec.gemini_explanation,
    ${LATEST_OFFER_COLUMNS},
    ${ACCOUNT_COLUMNS},
    ${POLICY_COLUMNS},
    ${MATRIX_COLUMNS},
    ${ADVERSE_ACTION_COLUMNS},
    ${LAST_STATUS_EVENT_COLUMN}
  FROM loan_applications la
  JOIN users u ON u.user_id = la.user_id
  LEFT JOIN loan_products lp ON lp.id = la.product_id
  LEFT JOIN risk_assessments ra ON ra.application_id = la.id
  LEFT JOIN recommendations rec ON rec.application_id = la.id
  LEFT JOIN users decider ON decider.user_id = la.decided_by
  ${LATEST_OFFER_JOIN}
  ${ACCOUNT_JOIN}
  ${POLICY_JOIN}
  ${MATRIX_JOIN}
  ${ADVERSE_ACTION_JOIN}
  ${LAST_STATUS_EVENT_JOIN}
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
       la.decided_by, la.decision_note, la.decided_at,
       la.override_reason_code, la.decision_source,
       decider.first_name AS decided_by_first_name, decider.last_name AS decided_by_last_name,
       la.info_request_note, la.info_requested_at, la.info_response, la.info_responded_at,
       la.marital_status, la.education_level, la.occupation, la.employer_category,
       la.years_employed, la.additional_income, la.existing_loans,
       la.previous_defaults, la.crib_score, la.guarantor_exposure,
       la.guarantor_defaults, la.priced_interest_rate,
       u.first_name, u.last_name, u.email,
       lp.name AS product_name, lp.type AS product_type,
       lp.interest_rate AS product_interest_rate,
       lp.min_interest_rate AS product_min_interest_rate,
       lp.max_interest_rate AS product_max_interest_rate,
       lp.rate_type AS product_rate_type,
       ra.risk_label, ra.risk_category, ra.prob_low, ra.prob_medium, ra.prob_high, ra.model_version,
       ra.behavioural_snapshot,
       rec.recommended_amount, rec.recommended_emi,
       ${LATEST_OFFER_COLUMNS},
       ${ACCOUNT_COLUMNS},
       ${POLICY_COLUMNS},
       ${MATRIX_COLUMNS},
       ${ADVERSE_ACTION_COLUMNS},
       ${LAST_STATUS_EVENT_COLUMN}
     FROM loan_applications la
     JOIN users u ON u.user_id = la.user_id
     LEFT JOIN loan_products lp ON lp.id = la.product_id
     LEFT JOIN risk_assessments ra ON ra.application_id = la.id
     LEFT JOIN recommendations rec ON rec.application_id = la.id
     LEFT JOIN users decider ON decider.user_id = la.decided_by
     ${LATEST_OFFER_JOIN}
     ${ACCOUNT_JOIN}
     ${POLICY_JOIN}
     ${MATRIX_JOIN}
     ${ADVERSE_ACTION_JOIN}
     ${LAST_STATUS_EVENT_JOIN}
     ${where}
     ORDER BY la.created_at DESC`,
    params
  );
  return rows;
}

/**
 * Every application, portfolio-wide, with just enough joined in for
 * approval-rate/product/risk aggregation (F1). Unlike findAllApplications
 * this carries none of the single-application detail (offers, policy,
 * matrix, adverse actions) — those aren't needed once you're aggregating
 * across the whole book, and skipping the extra joins keeps this cheap to
 * run on every dashboard load.
 * @returns {Promise<object[]>}
 */
async function getPortfolioApplications() {
  const [rows] = await pool.query(
    `SELECT
       la.id, la.status, la.product_id, lp.name AS product_name,
       la.requested_amount, la.created_at, ra.risk_category
     FROM loan_applications la
     LEFT JOIN loan_products lp ON lp.id = la.product_id
     LEFT JOIN risk_assessments ra ON ra.application_id = la.id`
  );
  return rows;
}

/**
 * Every loan account, portfolio-wide (F1) — disbursement volume and the
 * active/closed/written_off split.
 * @returns {Promise<object[]>}
 */
async function getPortfolioAccounts() {
  const [rows] = await pool.query(
    `SELECT id, principal, status, disbursed_at FROM loan_accounts`
  );
  return rows;
}

/**
 * Every repayment_schedule row belonging to a currently ACTIVE loan account
 * (F1, portfolio-at-risk). Scoped to 'active' because closed accounts are
 * repaid and written_off accounts are a separate resolved outcome — neither
 * is "at risk" in the PAR sense. Rows are handed to
 * repayment.service.js#computeOutstanding/computeArrears by
 * loanReports.service.js, grouped by account_id — the arithmetic itself is
 * not reimplemented here.
 * @returns {Promise<object[]>}
 */
async function getActivePortfolioScheduleRows() {
  const [rows] = await pool.query(
    `SELECT rs.*
     FROM repayment_schedule rs
     JOIN loan_accounts acc ON acc.id = rs.account_id
     WHERE acc.status = 'active'`
  );
  return rows;
}

/**
 * Move an application to `status` and notify the applicant, as a single
 * transaction. The legality of the move is re-checked HERE, inside the
 * transaction and under the row lock, rather than only in the controller:
 * two reviewers hitting approve and reject at the same moment both pass a
 * pre-flight check, and only the row lock can decide which one actually
 * happens. The loser gets a conflict, not a silent overwrite.
 *
 * Only credit decisions (approved/rejected) stamp
 * decided_by/decision_note/decided_at — see applicationStatus.service.js
 * isCreditDecision. "Staff opened it" and "funds released" are workflow
 * events and must not overwrite who approved or rejected the loan; a full
 * per-transition audit trail is a separate piece of work.
 *
 * @param {object} p
 * @param {number} p.applicationId
 * @param {string} p.status  target status (validated against the machine)
 * @param {number} p.actorId user_id performing the transition
 * @param {string} p.actorRole 'customer' | 'staff' | 'admin'
 * @param {string} [p.note]
 * @param {string} [p.overrideReasonCode] standardized justification when this
 *   decision deviates from the matrix's recommendation (D2). Whether one is
 *   REQUIRED is decided in the controller via
 *   decisionMatrix.service.js requiresOverride — this layer just records
 *   what it is given, on both the application and the event row.
 * @param {number} [p.requireOwnerId] when set (customer self-service moves,
 *   e.g. withdraw), the application must belong to this user_id — checked
 *   here, under the same row lock as the transition itself, so a customer
 *   can't race a staff decision by hitting withdraw at the same instant
 *   another request is deciding the same row.
 * @param {(conn:object, ctx:object)=>Promise<void>} [p.beforeCommit] runs
 *   inside this transaction once the transition is validated and applied,
 *   before COMMIT — the same hook shape as fxExchangeModel.transitionStatus.
 *   Used to attach side effects that must stand or fall WITH the status
 *   change: issuing a loan offer on approval, marking one accepted, etc.
 *   Throwing from here rolls the whole transition back.
 * @returns {Promise<{notFound:true}
 *   |{forbidden:true}
 *   |{conflict:true, status:string, reason:string}
 *   |{userId:number, from:string, to:string}>}
 */
async function updateApplicationStatus({
  applicationId,
  status,
  actorId,
  actorRole,
  note,
  overrideReasonCode,
  requireOwnerId,
  beforeCommit,
}) {
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

    if (requireOwnerId !== undefined && current.user_id !== requireOwnerId) {
      await conn.rollback();
      return { forbidden: true };
    }

    const check = checkTransition(current.status, status, actorRole);
    if (!check.ok) {
      await conn.rollback();
      return { conflict: true, status: current.status, reason: check.reason };
    }

    if (isCreditDecision(status)) {
      // decision_source 'manual' and the override code are set together: a
      // human is deciding, and either they agreed with the matrix (code
      // NULL) or they didn't and said why. A re-decision after a reopen
      // overwrites both, which is correct — these columns describe the
      // CURRENT decision. The superseded one survives in the event row.
      await conn.query(
        `UPDATE loan_applications
            SET status = ?, decided_by = ?, decision_note = ?,
                decided_at = CURRENT_TIMESTAMP, decision_source = 'manual',
                override_reason_code = ?
          WHERE id = ?`,
        [status, actorId, note || null, overrideReasonCode || null, applicationId]
      );
    } else if (isInfoRequest(status)) {
      // A new request/response cycle starts here — clear any stale reply
      // from a previous round so the UI never shows an old answer next to
      // a new question.
      await conn.query(
        `UPDATE loan_applications
            SET status = ?, info_request_note = ?, info_requested_at = CURRENT_TIMESTAMP,
                info_response = NULL, info_responded_at = NULL
          WHERE id = ?`,
        [status, note || null, applicationId]
      );
    } else if (isInfoResponse(current.status, status, actorRole)) {
      await conn.query(
        `UPDATE loan_applications
            SET status = ?, info_response = ?, info_responded_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [status, note || null, applicationId]
      );
    } else if (current.status === "rejected" && status === "under_review") {
      // Reopening VACATES the rejection (D2). The decision fields describe
      // the application's current decision, and once it is back under
      // review it has none — leaving them stamped would show the applicant
      // and staff "Rejected by …" on a file that is open again. Nothing is
      // lost: the rejection, its note and its actor are all in
      // loan_application_events, and the event row written below records
      // who reopened it and under which reason code.
      await conn.query(
        `UPDATE loan_applications
            SET status = ?, decided_by = NULL, decision_note = NULL,
                decided_at = NULL, decision_source = NULL,
                override_reason_code = NULL
          WHERE id = ?`,
        [status, applicationId]
      );
    } else {
      await conn.query(`UPDATE loan_applications SET status = ? WHERE id = ?`, [
        status,
        applicationId,
      ]);
    }

    if (beforeCommit) {
      await beforeCommit(conn, { userId: current.user_id, from: current.status, to: status });
    }

    // One event row per transition, regardless of which branch above ran —
    // the audit trail (022) is a trace of every legal move, not just credit
    // decisions. Written in the same transaction as the status change
    // itself, so the two can never disagree.
    await conn.query(
      `INSERT INTO loan_application_events
         (application_id, from_status, to_status, actor_user_id, actor_role, note,
          override_reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        current.status,
        status,
        actorId,
        actorRole,
        note || null,
        overrideReasonCode || null,
      ]
    );

    // Skip the notification when the applicant made the move themselves
    // (withdraw, or responding to an info request) — telling someone about
    // their own action a moment ago is noise, not news. Anything staff/admin
    // do always targets a DIFFERENT user (the applicant), so this only ever
    // suppresses self-notifications, never a real one. 'accepted' is
    // carved out (G2): accepting an offer is the one self-action where a
    // confirmation receipt is actually wanted — see NOTIFICATION_BY_STATUS
    // .accepted's comment in applicationStatus.service.js.
    const isSelfAction =
      actorRole === "customer" && actorId === current.user_id && status !== "accepted";
    const notification = isSelfAction ? null : buildNotification(status, applicationId, note);
    if (notification) {
      await conn.query(
        `INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`,
        [current.user_id, notification.title, notification.message]
      );
    }

    await conn.commit();
    // After commit (G2) — see emailApplicantIfDue's header comment.
    await emailApplicantIfDue(current.user_id, status, notification);
    return { userId: current.user_id, from: current.status, to: status };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * The full transition history for one application, oldest first — every row
 * loan_application_events (022) has for it, including the creation event
 * (from_status NULL). Joined with the actor's name the same way
 * APPLICATION_DETAIL_SELECT joins `decider` for A2's decided_by, so the
 * caller doesn't have to resolve user_id → name itself.
 * @param {number} applicationId
 * @returns {Promise<object[]>}
 */
async function getApplicationHistory(applicationId) {
  const [rows] = await pool.query(
    `SELECT
       ev.id, ev.from_status, ev.to_status, ev.actor_user_id, ev.actor_role,
       ev.note, ev.override_reason_code, ev.created_at,
       u.first_name AS actor_first_name, u.last_name AS actor_last_name
     FROM loan_application_events ev
     LEFT JOIN users u ON u.user_id = ev.actor_user_id
     WHERE ev.application_id = ?
     ORDER BY ev.created_at ASC, ev.id ASC`,
    [applicationId]
  );
  return rows;
}

/**
 * Write one adverse-action record (032/D4) inside an ALREADY-OPEN
 * transaction — the caller (runAssessmentTransaction's auto-reject branch,
 * or updateApplicationStatus's beforeCommit for a manual reject) owns
 * BEGIN/COMMIT/ROLLBACK; this only ever INSERTs.
 *
 * Takes the adverseAction.service.js buildAdverseActionRecord() output
 * (already validated: ≥1 real reason code, a real decisionSource) plus
 * applicationId, and writes it verbatim — this layer has no business logic
 * of its own, on purpose, so there is exactly one place (the service
 * module) that decides what a valid adverse-action record looks like.
 *
 * @param {object} conn an open mysql2 connection, mid-transaction
 * @param {object} p
 * @param {number} p.applicationId
 * @param {string[]} p.reasonCodes
 * @param {object[]} p.reasons
 * @param {'system'|'manual'} p.decisionSource
 * @param {number|null} p.decidedBy
 * @param {string|null} p.note
 * @param {number|null} p.riskLabel
 * @param {string|null} p.riskCategory
 * @param {number|null} p.probLow
 * @param {number|null} p.probMedium
 * @param {number|null} p.probHigh
 * @param {string|null} p.modelVersion
 * @param {string|null} p.policyVersion
 * @param {string|null} p.policyOutcome
 * @param {string|null} p.matrixVersion
 * @param {string|null} p.matrixAction
 * @param {number|null} p.pricedInterestRate
 * @returns {Promise<number>} the new adverse_action_records.id
 */
async function createAdverseActionRecordWithin(conn, p) {
  const [result] = await conn.query(
    `INSERT INTO adverse_action_records
       (application_id, reason_codes, reasons, decision_source, decided_by,
        note, risk_label, risk_category, prob_low, prob_medium, prob_high,
        model_version, policy_version, policy_outcome, matrix_version,
        matrix_action, priced_interest_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.applicationId,
      p.reasonCodes.join(","),
      JSON.stringify(p.reasons),
      p.decisionSource,
      p.decidedBy ?? null,
      p.note ?? null,
      p.riskLabel ?? null,
      p.riskCategory ?? null,
      p.probLow ?? null,
      p.probMedium ?? null,
      p.probHigh ?? null,
      p.modelVersion ?? null,
      p.policyVersion ?? null,
      p.policyOutcome ?? null,
      p.matrixVersion ?? null,
      p.matrixAction ?? null,
      p.pricedInterestRate ?? null,
    ]
  );
  return result.insertId;
}

/**
 * The FULL adverse-action history for an application, oldest first — every
 * row 032 has for it. An application rejected, reopened (D2), and rejected
 * again carries more than one; APPLICATION_DETAIL_SELECT's ADVERSE_ACTION_JOIN
 * only ever surfaces the latest, the same "latest inline, full history via
 * its own query" split as loan_application_events/getApplicationHistory.
 * @param {number} applicationId
 * @returns {Promise<object[]>}
 */
async function getAdverseActionHistory(applicationId) {
  const [rows] = await pool.query(
    `SELECT
       aar.id, aar.reason_codes, aar.reasons, aar.decision_source,
       aar.decided_by, aar.note, aar.risk_label, aar.risk_category,
       aar.prob_low, aar.prob_medium, aar.prob_high, aar.model_version,
       aar.policy_version, aar.policy_outcome, aar.matrix_version,
       aar.matrix_action, aar.priced_interest_rate, aar.created_at,
       u.first_name AS decided_by_first_name, u.last_name AS decided_by_last_name
     FROM adverse_action_records aar
     LEFT JOIN users u ON u.user_id = aar.decided_by
     WHERE aar.application_id = ?
     ORDER BY aar.created_at ASC, aar.id ASC`,
    [applicationId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Guarantors and collateral (migration 033, D5). Guarantors are a shared
// person entity keyed by NIC (see the migration header) — reused across
// applications, never deleted; collateral is application-scoped.
// ---------------------------------------------------------------------------

/**
 * Look up each candidate guarantor's EXISTING exposure elsewhere in the
 * system, by NIC — read-only, called BEFORE the assess transaction, so
 * creditPolicy.service.js's GUARANTOR_RELIABILITY rule can be evaluated
 * against real data before this application (and its own loan_guarantors
 * rows) exist. Because those rows don't exist yet at the moment this runs,
 * there is no need to exclude "this" application from the totals — it
 * literally isn't in the table.
 *
 * A NIC with no matching `guarantors` row (brand new person, never
 * nominated before) simply produces no row in the result — the caller
 * treats "absent" as zero prior exposure, not an error.
 *
 * "Distressed" = at least one OTHER active guarantee's account has an
 * overdue (unpaid, past due date) instalment right now — the same
 * `repayment_schedule.status = 'due' AND due_date < CURDATE()` definition
 * repayment.service.js's arrears logic uses, reused here via SQL rather
 * than pulled into JS since it only needs a boolean per account, not the
 * full arrears breakdown.
 *
 * @param {string[]} nics
 * @returns {Promise<object[]>} raw rows for collateralGuarantor.service.js
 *   summarizeGuarantorFindings — {nic, full_name, other_active_guarantees,
 *   other_active_exposure, other_distressed_guarantees}
 */
async function findGuarantorExposureByNic(nics) {
  if (!Array.isArray(nics) || nics.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT
       g.nic, g.full_name,
       COUNT(DISTINCT CASE WHEN la.id IS NOT NULL THEN lg.id END) AS other_active_guarantees,
       COALESCE(SUM(CASE WHEN la.id IS NOT NULL THEN lg.guaranteed_amount END), 0) AS other_active_exposure,
       COUNT(DISTINCT CASE
         WHEN la.id IS NOT NULL AND EXISTS (
           SELECT 1 FROM repayment_schedule rs
            WHERE rs.account_id = acc.id AND rs.status = 'due' AND rs.due_date < CURDATE()
         ) THEN lg.id
       END) AS other_distressed_guarantees
     FROM guarantors g
     LEFT JOIN loan_guarantors lg ON lg.guarantor_id = g.id AND lg.status = 'active'
     LEFT JOIN loan_applications la ON la.id = lg.application_id
       AND la.status NOT IN ('rejected', 'withdrawn', 'closed')
     LEFT JOIN loan_accounts acc ON acc.application_id = la.id
     WHERE g.nic IN (?)
     GROUP BY g.id, g.nic, g.full_name`,
    [nics]
  );
  return rows;
}

/**
 * Find-or-create a guarantor by NIC, inside an already-open transaction.
 * NIC is the natural key (033's UNIQUE constraint): the same person
 * guaranteeing a second application must land on the SAME row, with their
 * contact details refreshed to whatever was just submitted (people move,
 * change numbers — the latest disclosure wins) rather than creating a
 * duplicate person nobody can then aggregate exposure across.
 * @param {object} conn open mysql2 connection, mid-transaction
 * @param {object} p
 * @param {string} p.nic
 * @param {string} p.fullName
 * @param {string} [p.phone]
 * @param {string} [p.address]
 * @returns {Promise<number>} guarantors.id
 */
async function upsertGuarantorWithin(conn, { nic, fullName, phone, address }) {
  await conn.query(
    `INSERT INTO guarantors (nic, full_name, phone, address)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       full_name = VALUES(full_name),
       phone = VALUES(phone),
       address = VALUES(address)`,
    [nic, fullName, phone ?? null, address ?? null]
  );
  const [rows] = await conn.query(`SELECT id FROM guarantors WHERE nic = ?`, [nic]);
  return rows[0].id;
}

/**
 * Link a guarantor to an application, inside an already-open transaction.
 * @param {object} conn
 * @param {object} p
 * @param {number} p.applicationId
 * @param {number} p.guarantorId
 * @param {string} [p.relationshipToApplicant]
 * @param {number} p.guaranteedAmount
 * @param {number} [p.addedBy] user_id of whoever submitted this — the
 *   customer at apply time, or staff if added later
 * @returns {Promise<number>} loan_guarantors.id
 */
async function insertLoanGuarantorWithin(
  conn,
  { applicationId, guarantorId, relationshipToApplicant, guaranteedAmount, addedBy }
) {
  const [result] = await conn.query(
    `INSERT INTO loan_guarantors
       (application_id, guarantor_id, relationship_to_applicant, guaranteed_amount, added_by)
     VALUES (?, ?, ?, ?, ?)`,
    [applicationId, guarantorId, relationshipToApplicant ?? null, guaranteedAmount, addedBy ?? null]
  );
  return result.insertId;
}

/**
 * Pledge one collateral item against an application, inside an
 * already-open transaction. Always starts 'self_declared' — see 033's
 * header note and creditPolicy.service.js COLLATERAL_COVERAGE.
 * @param {object} conn
 * @param {object} p
 * @param {number} p.applicationId
 * @param {string} p.collateralType one of collateralGuarantor.service.js COLLATERAL_TYPES
 * @param {string} [p.description]
 * @param {number} p.estimatedValue
 * @param {string} [p.valuationDate] "YYYY-MM-DD"
 * @param {string} [p.ownershipReference]
 * @returns {Promise<number>} collateral_items.id
 */
async function insertCollateralItemWithin(
  conn,
  { applicationId, collateralType, description, estimatedValue, valuationDate, ownershipReference }
) {
  const [result] = await conn.query(
    `INSERT INTO collateral_items
       (application_id, collateral_type, description, estimated_value, valuation_date, ownership_reference)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      applicationId,
      collateralType,
      description ?? null,
      estimatedValue,
      valuationDate ?? null,
      ownershipReference ?? null,
    ]
  );
  return result.insertId;
}

/**
 * All guarantors linked to one application, most-recently-added first.
 * @param {number} applicationId
 * @returns {Promise<object[]>}
 */
async function getApplicationGuarantors(applicationId) {
  const [rows] = await pool.query(
    `SELECT
       lg.id, lg.guarantor_id, lg.relationship_to_applicant, lg.guaranteed_amount,
       lg.status, lg.added_at, lg.released_at,
       g.nic, g.full_name, g.phone, g.address,
       adder.first_name AS added_by_first_name, adder.last_name AS added_by_last_name
     FROM loan_guarantors lg
     JOIN guarantors g ON g.id = lg.guarantor_id
     LEFT JOIN users adder ON adder.user_id = lg.added_by
     WHERE lg.application_id = ?
     ORDER BY lg.added_at DESC, lg.id DESC`,
    [applicationId]
  );
  return rows;
}

/**
 * All collateral pledged against one application, newest first.
 * @param {number} applicationId
 * @returns {Promise<object[]>}
 */
async function getApplicationCollateral(applicationId) {
  const [rows] = await pool.query(
    `SELECT
       ci.id, ci.collateral_type, ci.description, ci.estimated_value,
       ci.valuation_date, ci.ownership_reference, ci.verification_status,
       ci.verified_by, ci.verified_at, ci.status, ci.created_at,
       verifier.first_name AS verified_by_first_name, verifier.last_name AS verified_by_last_name
     FROM collateral_items ci
     LEFT JOIN users verifier ON verifier.user_id = ci.verified_by
     WHERE ci.application_id = ?
     ORDER BY ci.created_at DESC, ci.id DESC`,
    [applicationId]
  );
  return rows;
}

/**
 * Staff sign off on (or reject) one pledged collateral item. Only a
 * 'self_declared' item may be resolved this way — re-verifying an
 * already-decided item is not offered; if the valuation genuinely changes,
 * the item is released and a new one pledged, which keeps the audit trail
 * honest about WHEN each valuation was actually confirmed.
 * @param {number} collateralId
 * @param {object} p
 * @param {'verified'|'rejected'} p.verificationStatus
 * @param {number} p.verifiedBy user_id
 * @returns {Promise<object|null>} the updated row, or null if not found /
 *   not in 'self_declared' status
 */
async function verifyCollateralItem(collateralId, { verificationStatus, verifiedBy }) {
  const [result] = await pool.query(
    `UPDATE collateral_items
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP
      WHERE id = ? AND verification_status = 'self_declared'`,
    [verificationStatus, verifiedBy, collateralId]
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(`SELECT * FROM collateral_items WHERE id = ?`, [collateralId]);
  return rows[0] || null;
}

/**
 * Record one uploaded supporting document (E1). The file itself has
 * already been written to disk by multer (see config/multer.js
 * loanDocumentUpload) by the time this runs — this only persists metadata.
 * @param {object} p
 * @param {number} p.applicationId
 * @param {string} p.documentType one of loanDocument.service.js DOCUMENT_TYPES
 * @param {number} p.uploadedBy user_id
 * @param {string} p.originalName
 * @param {string} p.storagePath server-side path, never returned to a client
 * @param {string} p.mimeType
 * @param {number} p.sizeBytes
 * @returns {Promise<object>} the inserted row
 */
async function createApplicationDocument({
  applicationId,
  documentType,
  uploadedBy,
  originalName,
  storagePath,
  mimeType,
  sizeBytes,
}) {
  const [result] = await pool.query(
    `INSERT INTO loan_application_documents
       (application_id, document_type, uploaded_by, original_name, storage_path, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [applicationId, documentType, uploadedBy, originalName, storagePath, mimeType, sizeBytes]
  );
  const [rows] = await pool.query(
    `SELECT id, application_id, document_type, original_name, mime_type, size_bytes,
            verification_status, verified_at, verification_notes, created_at
       FROM loan_application_documents WHERE id = ?`,
    [result.insertId]
  );
  return rows[0];
}

/**
 * Metadata for every document uploaded against one application, newest
 * first. storage_path is deliberately excluded — see the security note in
 * migration 034.
 * @param {number} applicationId
 * @returns {Promise<object[]>}
 */
async function getApplicationDocuments(applicationId) {
  const [rows] = await pool.query(
    `SELECT
       lad.id, lad.document_type, lad.original_name, lad.mime_type, lad.size_bytes,
       lad.verification_status, lad.verified_by, lad.verified_at, lad.verification_notes,
       lad.created_at,
       verifier.first_name AS verified_by_first_name, verifier.last_name AS verified_by_last_name
     FROM loan_application_documents lad
     LEFT JOIN users verifier ON verifier.user_id = lad.verified_by
     WHERE lad.application_id = ?
     ORDER BY lad.created_at DESC, lad.id DESC`,
    [applicationId]
  );
  return rows;
}

/**
 * One document's full row, INCLUDING storage_path — for internal use only
 * (download streaming, delete, verify). Never serialize storage_path back
 * to a client.
 * @param {number} documentId
 * @returns {Promise<object|undefined>}
 */
async function getApplicationDocumentById(documentId) {
  const [rows] = await pool.query(
    `SELECT * FROM loan_application_documents WHERE id = ?`,
    [documentId]
  );
  return rows[0];
}

/**
 * Delete a document, but only while it is still 'pending' review — once
 * staff have verified or rejected it, the record is locked for audit and a
 * fresh document must be uploaded instead (see loan.controller.js
 * deleteDocument).
 * @param {number} documentId
 * @returns {Promise<object|undefined>} the deleted row (so the caller can
 *   unlink its file), or undefined if not found / already reviewed
 */
async function deleteApplicationDocument(documentId) {
  const existing = await getApplicationDocumentById(documentId);
  if (!existing || existing.verification_status !== "pending") return undefined;
  const [result] = await pool.query(
    `DELETE FROM loan_application_documents WHERE id = ? AND verification_status = 'pending'`,
    [documentId]
  );
  if (result.affectedRows === 0) return undefined;
  return existing;
}

/**
 * Staff sign off on (or reject) one uploaded document. Same
 * only-while-'pending' rule as verifyCollateralItem, for the same
 * audit-trail reason.
 * @param {number} documentId
 * @param {object} p
 * @param {'verified'|'rejected'} p.verificationStatus
 * @param {number} p.verifiedBy user_id
 * @param {string|null} p.verificationNotes
 * @returns {Promise<object|null>} the updated row, or null if not found /
 *   not 'pending'
 */
async function verifyApplicationDocument(documentId, { verificationStatus, verifiedBy, verificationNotes }) {
  const [result] = await pool.query(
    `UPDATE loan_application_documents
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP,
            verification_notes = ?
      WHERE id = ? AND verification_status = 'pending'`,
    [verificationStatus, verifiedBy, verificationNotes || null, documentId]
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(
    `SELECT id, application_id, document_type, original_name, mime_type, size_bytes,
            verification_status, verified_by, verified_at, verification_notes, created_at
       FROM loan_application_documents WHERE id = ?`,
    [documentId]
  );
  return rows[0] || null;
}

/**
 * One guarantor's full exposure across the system, by NIC — for staff
 * visibility (unlike findGuarantorExposureByNic, this is a single-person
 * lookup for display, not a batch pre-policy-evaluation query, and it also
 * returns WHICH applications/accounts make up the total rather than just
 * the aggregate numbers).
 * @param {string} nic
 * @returns {Promise<{guarantor:object|null, guarantees:object[]}>}
 */
async function getGuarantorExposureDetail(nic) {
  const [guarantorRows] = await pool.query(`SELECT * FROM guarantors WHERE nic = ?`, [nic]);
  const guarantor = guarantorRows[0] || null;
  if (!guarantor) return { guarantor: null, guarantees: [] };

  const [rows] = await pool.query(
    `SELECT
       lg.id AS loan_guarantor_id, lg.application_id, lg.guaranteed_amount,
       lg.status AS guarantee_status, lg.added_at,
       la.status AS application_status, la.requested_amount,
       u.first_name AS applicant_first_name, u.last_name AS applicant_last_name,
       acc.id AS account_id, acc.status AS account_status,
       EXISTS (
         SELECT 1 FROM repayment_schedule rs
          WHERE rs.account_id = acc.id AND rs.status = 'due' AND rs.due_date < CURDATE()
       ) AS is_distressed
     FROM loan_guarantors lg
     JOIN loan_applications la ON la.id = lg.application_id
     JOIN users u ON u.user_id = la.user_id
     LEFT JOIN loan_accounts acc ON acc.application_id = la.id
     WHERE lg.guarantor_id = ?
     ORDER BY lg.added_at DESC`,
    [guarantor.id]
  );
  return { guarantor, guarantees: rows };
}

// ---------------------------------------------------------------------------
// Loan offers (migration 023). An offer is the terms an applicant is asked to
// accept; the application's own status machine
// (applicationStatus.service.js) tracks whether they have.
// ---------------------------------------------------------------------------

/**
 * Issue an offer, superseding whatever offer was outstanding. Takes an
 * existing connection because it always runs inside a caller's transaction
 * — either the approval transition (via updateApplicationStatus's
 * beforeCommit hook) or a standalone re-offer — so the offer and the status
 * change commit together or not at all.
 *
 * Supersede-then-insert is deliberately ordered: at most one offer per
 * application may be 'pending', and doing this inside the caller's
 * transaction (which already holds the application row lock) is what makes
 * that invariant hold under concurrency.
 *
 * @param {object} conn an open transaction connection
 * @param {object} p
 * @param {number} p.applicationId
 * @param {number} p.amount
 * @param {number} p.tenureMonths
 * @param {number} p.interestRate
 * @param {string} p.rateType 'reducing' | 'flat'
 * @param {number} p.emi computed server-side — never taken from a client
 * @param {number} p.validityDays
 * @param {number} p.offeredBy staff/admin user_id
 * @param {string} [p.note]
 * @returns {Promise<number>} the new offer's id
 */
async function createOfferWithin(conn, p) {
  await conn.query(
    `UPDATE loan_offers SET status = 'superseded'
      WHERE application_id = ? AND status = 'pending'`,
    [p.applicationId]
  );

  const [res] = await conn.query(
    `INSERT INTO loan_offers
       (application_id, offered_amount, offered_tenure_months,
        offered_interest_rate, rate_type, offered_emi, offer_note,
        status, offered_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?,
             DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY))`,
    [
      p.applicationId,
      p.amount,
      p.tenureMonths,
      p.interestRate,
      p.rateType,
      p.emi,
      p.note || null,
      p.offeredBy,
      p.validityDays,
    ]
  );
  const offerId = res.insertId;

  // Fee lines are SNAPSHOTTED onto the offer in the same transaction that
  // creates it (041) — an offer must never exist with its fee breakdown
  // missing, or the customer would be quoted a net disbursement the system
  // cannot substantiate. Already resolved and waiver-applied by the caller
  // via loanFees.service.buildOfferFees; this only persists them.
  if (Array.isArray(p.fees) && p.fees.length) {
    await conn.query(
      `INSERT INTO loan_offer_fees
         (offer_id, fee_type, label, calc_method, rate_or_amount, amount,
          waived, waived_by, waived_reason)
       VALUES ?`,
      [
        p.fees.map((f) => [
          offerId,
          f.fee_type,
          f.label,
          f.calc_method,
          f.rate_or_amount,
          f.amount,
          f.waived ? 1 : 0,
          f.waived ? p.offeredBy || null : null,
          f.waived ? f.waived_reason || null : null,
        ]),
      ]
    );
  }

  return offerId;
}

/**
 * The fee lines snapshotted onto one offer (041).
 *
 * A separate query rather than another LEFT JOIN in APPLICATION_DETAIL_SELECT:
 * fees are 1-to-MANY against an offer, so joining them would multiply the
 * application row and break every other joined column. Called only where the
 * breakdown is actually rendered.
 *
 * @param {number} offerId
 * @returns {Promise<object[]>}
 */
async function findOfferFees(offerId) {
  if (!offerId) return [];
  const [rows] = await pool.query(
    `SELECT fee_type, label, calc_method, rate_or_amount, amount,
            waived, waived_reason
       FROM loan_offer_fees
      WHERE offer_id = ?
      ORDER BY FIELD(fee_type,'processing','documentation','credit_life_insurance','other'), id`,
    [offerId]
  );
  return rows;
}

/**
 * Fee lines for MANY offers at once, keyed by offer_id — for list endpoints
 * that would otherwise fire one findOfferFees per row.
 * @param {number[]} offerIds
 * @returns {Promise<Map<number, object[]>>}
 */
async function findOfferFeesForOffers(offerIds = []) {
  const ids = offerIds.filter((id) => Number.isFinite(Number(id)));
  const byOffer = new Map();
  if (!ids.length) return byOffer;
  const [rows] = await pool.query(
    `SELECT offer_id, fee_type, label, calc_method, rate_or_amount, amount,
            waived, waived_reason
       FROM loan_offer_fees
      WHERE offer_id IN (?)
      ORDER BY FIELD(fee_type,'processing','documentation','credit_life_insurance','other'), id`,
    [ids]
  );
  for (const row of rows) {
    if (!byOffer.has(row.offer_id)) byOffer.set(row.offer_id, []);
    byOffer.get(row.offer_id).push(row);
  }
  return byOffer;
}

/**
 * Standalone re-issue of an offer against an application already sitting in
 * 'approved' — the path for a lapsed offer, a renegotiation, or an
 * application approved before offers existed (see migration 024's note on
 * pre-existing rows). Does not touch the application's status, since
 * approved → approved is not a transition.
 *
 * The application row is locked FOR UPDATE first so this can't interleave
 * with a concurrent status change that would invalidate the precondition.
 *
 * @returns {Promise<{notFound:true}|{conflict:true,status:string}|{offerId:number}>}
 */
async function reissueOffer(p) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, status FROM loan_applications WHERE id = ? FOR UPDATE`,
      [p.applicationId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return { notFound: true };
    }
    if (rows[0].status !== "approved") {
      await conn.rollback();
      return { conflict: true, status: rows[0].status };
    }

    const offerId = await createOfferWithin(conn, p);
    await conn.commit();
    return { offerId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Close out the outstanding offer as part of the applicant's response.
 * Called from updateApplicationStatus's beforeCommit hook, so it shares the
 * transition's transaction and row lock.
 *
 * Guards on `status = 'pending' AND expires_at > CURRENT_TIMESTAMP` in the
 * WHERE clause rather than trusting a value read earlier: an offer that
 * lapsed between the read and the write must not be accepted, and the
 * database clock is the only arbiter of that. A zero row count means the
 * offer is gone, already actioned, or expired — the caller turns that into
 * a conflict and the whole transition rolls back.
 *
 * @param {object} conn open transaction connection
 * @param {number} applicationId
 * @param {'accepted'|'declined'} outcome
 * @param {string} [note]
 * @returns {Promise<number>} affected row count
 */
async function respondToOfferWithin(conn, applicationId, outcome, note) {
  const [res] = await conn.query(
    `UPDATE loan_offers
        SET status = ?, responded_at = CURRENT_TIMESTAMP, response_note = ?
      WHERE application_id = ?
        AND status = 'pending'
        AND expires_at > CURRENT_TIMESTAMP`,
    [outcome, note || null, applicationId]
  );
  return res.affectedRows;
}

/**
 * Mark every offer that has passed its expiry as 'expired'. Drives the
 * background sweep (offerExpiry.service.js). Idempotent by construction —
 * only touches rows still 'pending'.
 * @returns {Promise<{expired:number, applicationIds:number[]}>}
 */
async function expireLapsedOffers() {
  const [rows] = await pool.query(
    `SELECT id, application_id FROM loan_offers
      WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`
  );
  if (!rows.length) return { expired: 0, applicationIds: [] };

  const [res] = await pool.query(
    `UPDATE loan_offers SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`
  );
  return {
    expired: res.affectedRows,
    applicationIds: rows.map((r) => r.application_id),
  };
}

// ---------------------------------------------------------------------------
// Loan accounts (migration 025). The live facility created at drawdown, as
// opposed to the application that requested it.
// ---------------------------------------------------------------------------

/**
 * Open the loan account for an application being disbursed. Runs inside the
 * caller's transaction (updateApplicationStatus's beforeCommit hook), so the
 * account and the 'disbursed' status commit together — there is no window in
 * which an application reads as disbursed with no loan behind it.
 *
 * Terms are copied from the ACCEPTED OFFER, never from the application or the
 * product: the account must carry what the borrower agreed to. If no accepted
 * offer exists this throws, which rolls the disbursal back — disbursing
 * against terms nobody accepted is exactly what C1/C2 exist to prevent.
 *
 * @param {object} conn open transaction connection
 * @param {object} p
 * @param {number} p.applicationId
 * @param {number} p.userId      the borrower
 * @param {number} p.disbursedBy staff/admin user_id
 * @returns {Promise<{accountId:number, accountNo:string}>}
 */
async function createAccountWithin(conn, { applicationId, userId, disbursedBy }) {
  const [offers] = await conn.query(
    `SELECT id, offered_amount, offered_tenure_months, offered_interest_rate,
            rate_type, offered_emi
       FROM loan_offers
      WHERE application_id = ? AND status = 'accepted'
      ORDER BY responded_at DESC, id DESC
      LIMIT 1`,
    [applicationId]
  );
  const offer = offers[0];
  if (!offer) {
    throw new Error("NO_ACCEPTED_OFFER");
  }

  // Fees the ACCEPTED offer quoted (041), read inside this transaction and
  // snapshotted onto the account below — the same treatment principal/rate
  // already get, and for the same reason: re-reading the product's fee config
  // at some later date must never change what this loan actually charged.
  //
  // Fees are DEDUCTED, NOT CAPITALISED: principal below stays the full
  // offered amount (that is what is owed and amortised), and the fee total
  // only reduces what is paid out. This is why the repayment schedule
  // generated further down is byte-identical to a no-fee loan's.
  const [feeRows] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM loan_offer_fees WHERE offer_id = ?`,
    [offer.id]
  );
  const totalFees = Number(feeRows[0]?.total || 0);
  const netDisbursed = Math.max(0, round2(Number(offer.offered_amount) - totalFees));

  // Resolve where the money goes, inside THIS transaction (conn, not pool) so
  // it is consistent with everything else being written. Normally the account
  // already exists — offer acceptance opened or reused it (see
  // loan.controller.js respondToOffer) — and this just reads it back.
  //
  // Calling find-or-OPEN rather than find-or-throw is deliberate: it also
  // rescues applications that were accepted before migration 039 shipped,
  // whose customer may have no account yet. Disbursement can therefore never
  // be blocked for want of a destination, which is precisely the dead end the
  // superseded 038 gate (NO_BENEFICIARY_ACCOUNT) created. The call is
  // idempotent, so running it here as well as at acceptance is safe.
  const { account: beneficiary } = await bankAccountModel.findOrOpenWithin(conn, {
    userId,
    openedVia: "auto_offer_acceptance",
  });

  const tenureMonths = Number(offer.offered_tenure_months);
  // Derive the calendar from the SERVER's clock, then store it. The same
  // timestamp is used for disbursed_at so the dates and the drawdown can
  // never disagree by a tick.
  const disbursedAt = new Date();
  const { firstDueDate, maturityDate } = deriveAccountDates({
    disbursedAt,
    tenureMonths,
  });

  const [res] = await conn.query(
    `INSERT INTO loan_accounts
       (application_id, user_id, principal, interest_rate, rate_type,
        tenure_months, emi, total_fees_charged, net_disbursed_amount,
        disbursed_at, first_due_date, maturity_date,
        disbursed_by, status,
        beneficiary_branch, beneficiary_account_number, beneficiary_account_holder)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      applicationId,
      userId,
      // The FULL offered amount — what is owed and amortised. Fees are
      // deducted from the payout (net_disbursed_amount), never from here.
      offer.offered_amount,
      offer.offered_interest_rate,
      offer.rate_type,
      tenureMonths,
      offer.offered_emi,
      totalFees,
      netDisbursed,
      disbursedAt,
      firstDueDate,
      maturityDate,
      disbursedBy,
      // A SNAPSHOT of the bank account as it stood at this exact moment, not a
      // live reference. If the account is later closed or renamed, this
      // already-disbursed loan's record of where ITS money went must never
      // change retroactively (same reasoning as principal/rate).
      beneficiary.branch,
      beneficiary.account_number,
      beneficiary.account_holder,
    ]
  );

  // Human-facing reference derived from the real key, same approach as
  // fx_exchange_requests.reference_no.
  const accountNo = `LN-${String(res.insertId).padStart(6, "0")}`;
  await conn.query(`UPDATE loan_accounts SET account_no = ? WHERE id = ?`, [
    accountNo,
    res.insertId,
  ]);

  // Generate the full repayment calendar now, from the same terms just
  // written, and store it (026) — never recomputed later. Bulk-inserted in
  // one statement rather than tenureMonths round trips.
  const schedule = buildAmortizationSchedule({
    principal: Number(offer.offered_amount),
    tenureMonths,
    annualRatePct: Number(offer.offered_interest_rate),
    rateType: offer.rate_type,
    emi: Number(offer.offered_emi),
    firstDueDate,
  });
  const scheduleValues = schedule.map((row) => [
    res.insertId,
    row.installmentNo,
    row.dueDate,
    row.openingBalance,
    row.principalComponent,
    row.interestComponent,
    row.emi,
    row.closingBalance,
    offer.rate_type,
  ]);
  await conn.query(
    `INSERT INTO repayment_schedule
       (account_id, installment_no, due_date, opening_balance,
        principal_component, interest_component, emi, closing_balance, rate_type)
     VALUES ?`,
    [scheduleValues]
  );

  return { accountId: res.insertId, accountNo };
}

/**
 * Close the account behind an application being closed, in the same
 * transaction as the status change. Guarded on status='active' so closing
 * an already-closed or written-off loan is a no-op rather than resetting
 * closed_at.
 * @param {object} conn open transaction connection
 * @param {number} applicationId
 * @returns {Promise<number>} affected row count
 */
async function closeAccountWithin(conn, applicationId) {
  const [res] = await conn.query(
    `UPDATE loan_accounts
        SET status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE application_id = ? AND status = 'active'`,
    [applicationId]
  );
  return res.affectedRows;
}

/**
 * The full repayment calendar for an application's loan account, oldest
 * installment first. Joins through loan_accounts by application_id (the id
 * callers actually have) rather than requiring the account id.
 * @param {number} applicationId
 * @returns {Promise<object[]>} empty array if no account exists yet
 */
async function getRepaymentSchedule(applicationId) {
  const [rows] = await pool.query(
    `SELECT rs.id, rs.installment_no, rs.due_date, rs.opening_balance,
            rs.principal_component, rs.interest_component, rs.emi,
            rs.closing_balance, rs.principal_paid, rs.interest_paid,
            rs.interest_waived, rs.late_fee_amount, rs.late_fee_paid,
            rs.late_fee_waived, rs.late_fee_charged_at, rs.settled_at, rs.status
       FROM repayment_schedule rs
       JOIN loan_accounts acc ON acc.id = rs.account_id
      WHERE acc.application_id = ?
      ORDER BY rs.installment_no ASC`,
    [applicationId]
  );
  return rows;
}

/**
 * account_id → application_id (040). The gateway webhook knows only which
 * loan account its payment intent belongs to, but everything customer-facing
 * is keyed by application.
 * @param {number} accountId
 * @returns {Promise<number|null>}
 */
async function findApplicationIdByAccountId(accountId) {
  const [rows] = await pool.query(`SELECT application_id FROM loan_accounts WHERE id = ?`, [
    accountId,
  ]);
  return rows[0] ? rows[0].application_id : null;
}

/**
 * One payment plus the ledger rows explaining how it was split (040, for the
 * receipt PDF). Joined up to the account and borrower so the caller has
 * everything a receipt needs in one round trip, and joined DOWN to
 * repayment_schedule so each allocation can name the instalment it cleared
 * rather than an opaque schedule_id.
 *
 * Scoped by application_id as well as payment id so a payment can never be
 * read through the wrong application's URL.
 *
 * @param {number} applicationId
 * @param {number} paymentId
 * @returns {Promise<{payment:object, allocations:object[]}|null>}
 */
async function getPaymentWithAllocations(applicationId, paymentId) {
  const [payments] = await pool.query(
    `SELECT p.id, p.reference_no, p.amount, p.paid_on, p.method, p.payment_type,
            p.external_ref, p.note, p.recorded_at,
            acc.id AS account_id, acc.account_no, acc.application_id, acc.status AS account_status,
            u.first_name, u.last_name,
            rb.first_name AS recorded_by_first_name, rb.last_name AS recorded_by_last_name
       FROM loan_payments p
       JOIN loan_accounts acc ON acc.id = p.account_id
       JOIN users u ON u.user_id = acc.user_id
       LEFT JOIN users rb ON rb.user_id = p.recorded_by
      WHERE p.id = ? AND acc.application_id = ?`,
    [paymentId, applicationId]
  );
  if (!payments[0]) return null;

  const [allocations] = await pool.query(
    `SELECT a.fee_amount, a.interest_amount, a.principal_amount,
            rs.installment_no, rs.due_date
       FROM loan_payment_allocations a
       JOIN repayment_schedule rs ON rs.id = a.schedule_id
      WHERE a.payment_id = ?
      ORDER BY rs.installment_no ASC`,
    [paymentId]
  );

  return { payment: payments[0], allocations };
}

// ---------------------------------------------------------------------------
// Repayments (migration 027).
// ---------------------------------------------------------------------------

/**
 * The loan account for an application, or undefined.
 * @param {number} applicationId
 */
async function findAccountByApplicationId(applicationId) {
  const [rows] = await pool.query(
    `SELECT * FROM loan_accounts WHERE application_id = ?`,
    [applicationId]
  );
  return rows[0];
}

/**
 * Every payment recorded against an application's account, newest first,
 * with the recording officer's name.
 * @param {number} applicationId
 */
async function getPayments(applicationId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.reference_no, p.amount, p.paid_on, p.method, p.payment_type,
            p.external_ref, p.note, p.recorded_at,
            u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name
       FROM loan_payments p
       JOIN loan_accounts acc ON acc.id = p.account_id
       LEFT JOIN users u ON u.user_id = p.recorded_by
      WHERE acc.application_id = ?
      ORDER BY p.paid_on DESC, p.id DESC`,
    [applicationId]
  );
  return rows;
}

/**
 * Record a payment and apply it across the schedule, as one transaction.
 *
 * The account row is locked FOR UPDATE first, which is what serialises
 * concurrent payments on the same loan: two cashiers keying receipts at the
 * same instant would otherwise both read the same "outstanding" and both
 * allocate against it, double-crediting the borrower. With the lock, the
 * second waits and re-reads the schedule the first already updated.
 *
 * Allocation itself is delegated to repayment.service.js — this function's
 * job is persistence and locking, not arithmetic.
 *
 * Overpayment is REFUSED rather than banked: allowing it would create a
 * credit balance this system has nowhere to hold and no rule for refunding.
 *
 * @param {object} p
 * @param {number} p.applicationId
 * @param {number} p.amount
 * @param {string} p.paidOn        YYYY-MM-DD value date
 * @param {string} p.method
 * @param {string} p.paymentType   'installment' | 'settlement'
 * @param {string} [p.externalRef]
 * @param {string} [p.note]
 * @param {number} [p.recordedBy] staff user_id who keyed it in; NULL for a
 *   self-service gateway payment, where no staff member was involved
 * @param {number} [p.accountId] resolve by loan account instead of application
 * @returns {Promise<{notFound:true}|{inactive:true,status:string}
 *   |{overpayment:true, outstanding:number}
 *   |{paymentId:number, referenceNo:string, allocations:object[],
 *     accountClosed:boolean}>}
 */
async function recordPayment(p) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await recordPaymentWithin(conn, p);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * The body of recordPayment, running inside a transaction the CALLER owns.
 *
 * Split out (same pattern as respondToOfferWithin / createAccountWithin /
 * findOrOpenWithin) so a gateway webhook can mark its payment intent settled
 * and post the payment in ONE transaction. Without that, a crash between the
 * two would leave money recorded against an intent still reading 'created',
 * and the next webhook retry would pay the loan twice.
 *
 * Returns rejections as values rather than throwing, exactly as before — the
 * caller must roll back on a rejection, which recordPayment does for the
 * staff path and paymentIntentModel.settleWithin does for the gateway path.
 *
 * @param {object} conn open transaction connection
 * @param {object} p see recordPayment
 */
async function recordPaymentWithin(conn, p) {
  {
    // Either identifier resolves the same account: staff act on an
    // application, the gateway acts on the loan account its intent was
    // created against.
    const [accounts] = p.accountId
      ? await conn.query(`SELECT id, status FROM loan_accounts WHERE id = ? FOR UPDATE`, [
          p.accountId,
        ])
      : await conn.query(
          `SELECT id, status FROM loan_accounts WHERE application_id = ? FOR UPDATE`,
          [p.applicationId]
        );
    const account = accounts[0];
    if (!account) {
      return { notFound: true };
    }
    if (account.status !== "active") {
      return { inactive: true, status: account.status };
    }

    // Read the schedule INSIDE the lock — anything read before it could
    // already be stale by the time we allocate.
    const [installments] = await conn.query(
      `SELECT id, installment_no, due_date, principal_component,
              interest_component, emi, principal_paid, interest_paid,
              interest_waived, late_fee_amount, late_fee_paid, late_fee_waived
         FROM repayment_schedule
        WHERE account_id = ?
        ORDER BY installment_no ASC`,
      [account.id]
    );

    // Early settlement waives interest on installments not yet due, and it
    // must happen BEFORE allocation — see repayment.service.js
    // computeSettlementWaivers for why the order is load-bearing.
    //
    // A settlement is all-or-nothing: the quote must be paid in full. Paying
    // less would otherwise hand the borrower the interest waiver while
    // leaving the loan open, which is not a discount anyone offered. An
    // underpayment is simply a normal installment payment, and the caller is
    // told the exact figure to charge.
    if (p.paymentType === "settlement") {
      const quote = computeSettlement(installments);
      if (round2(p.amount) !== quote.total) {
        return { settlementMismatch: true, expected: quote.total };
      }
      for (const w of computeSettlementWaivers(installments)) {
        const row = installments.find((i) => i.id === w.scheduleId);
        row.interest_waived = round2(Number(row.interest_waived || 0) + w.waive);
        await conn.query(
          `UPDATE repayment_schedule SET interest_waived = ? WHERE id = ?`,
          [row.interest_waived, w.scheduleId]
        );
      }
    }

    const { allocations, unallocated } = allocatePayment({
      amount: p.amount,
      installments,
    });
    if (unallocated > 0) {
      return {
        overpayment: true,
        outstanding: computeOutstanding(installments).total,
      };
    }

    const [res] = await conn.query(
      `INSERT INTO loan_payments
         (account_id, amount, paid_on, method, payment_type, external_ref,
          note, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        p.amount,
        p.paidOn,
        p.method,
        p.paymentType,
        p.externalRef || null,
        p.note || null,
        // NULL for a gateway payment. This column means "the staff member who
        // keyed this in"; writing the borrower's own id would corrupt that.
        // method='card' plus the loan_payment_intents row already identify a
        // self-service payment.
        p.recordedBy ?? null,
      ]
    );
    const paymentId = res.insertId;
    const referenceNo = `PMT-${String(paymentId).padStart(6, "0")}`;
    await conn.query(`UPDATE loan_payments SET reference_no = ? WHERE id = ?`, [
      referenceNo,
      paymentId,
    ]);

    // The ledger (append-only) …
    await conn.query(
      `INSERT INTO loan_payment_allocations
         (payment_id, schedule_id, fee_amount, interest_amount, principal_amount)
       VALUES ?`,
      [
        allocations.map((a) => [
          paymentId,
          a.scheduleId,
          a.feeAmount,
          a.interestAmount,
          a.principalAmount,
        ]),
      ]
    );

    // … and the running totals it must always reconcile with. Applied to the
    // in-memory rows first so the status is re-derived from the complete
    // post-payment position (paid AND waived) rather than guessed per
    // allocation — a row cleared partly by waiver must still read 'paid'.
    for (const a of allocations) {
      const row = installments.find((i) => i.id === a.scheduleId);
      row.principal_paid = round2(Number(row.principal_paid) + a.principalAmount);
      row.interest_paid = round2(Number(row.interest_paid) + a.interestAmount);
      row.late_fee_paid = round2(Number(row.late_fee_paid) + a.feeAmount);
      row.touched = true;
    }

    for (const row of installments.filter((r) => r.touched)) {
      const status = installmentStatus(row);
      await conn.query(
        `UPDATE repayment_schedule
            SET principal_paid = ?, interest_paid = ?, late_fee_paid = ?, status = ?,
                settled_at = ${status === "paid" ? "CURRENT_TIMESTAMP" : "NULL"}
          WHERE id = ?`,
        [row.principal_paid, row.interest_paid, row.late_fee_paid, status, row.id]
      );
    }

    // Fully repaid? Close the ACCOUNT here. The application's own status is
    // moved separately by the controller, through the status machine, so
    // the transition is audited like every other one.
    const accountClosed = computeOutstanding(installments).total <= 0;
    if (accountClosed) {
      await conn.query(
        `UPDATE loan_accounts SET status = 'closed', closed_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'active'`,
        [account.id]
      );
    }

    return { paymentId, referenceNo, allocations, accountClosed, accountId: account.id };
  }
}

/**
 * Charge a late fee on every installment newly eligible for one, across
 * every active loan. Drives the background sweep
 * (lateFeeSweep.service.js) — see computeLateFeeAssessments for the
 * eligibility rule itself, which this function only executes.
 *
 * Scoped to `acc.status = 'active'`: a closed or written-off loan is not
 * still accruing penalties.
 *
 * @returns {Promise<{charged:number, applicationIds:number[]}>}
 */
async function assessLateFees() {
  const [rows] = await pool.query(
    `SELECT rs.id, rs.installment_no, rs.due_date, rs.principal_component,
            rs.interest_component, rs.emi, rs.principal_paid, rs.interest_paid,
            rs.late_fee_charged_at, acc.application_id
       FROM repayment_schedule rs
       JOIN loan_accounts acc ON acc.id = rs.account_id
      WHERE acc.status = 'active'
        AND rs.late_fee_charged_at IS NULL
        AND rs.status != 'paid'`
  );
  if (!rows.length) return { charged: 0, applicationIds: [] };

  const assessments = computeLateFeeAssessments(rows);
  if (!assessments.length) return { charged: 0, applicationIds: [] };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const applicationIds = new Set();
  for (const a of assessments) {
    await pool.query(
      `UPDATE repayment_schedule
          SET late_fee_amount = late_fee_amount + ?, late_fee_charged_at = CURRENT_TIMESTAMP
        WHERE id = ? AND late_fee_charged_at IS NULL`,
      [a.feeAmount, a.scheduleId]
    );
    applicationIds.add(byId.get(a.scheduleId).application_id);
  }

  return { charged: assessments.length, applicationIds: [...applicationIds] };
}

/**
 * Waive whatever is left of an installment's late fee (in full — a partial
 * waiver is not a case this app's staff workflow needs, and half-waiving a
 * penalty is a policy nuance better handled by an explicit new amount than
 * by this endpoint guessing one).
 *
 * Ownership is not checked: this is a staff/admin-only action regardless of
 * which customer the loan belongs to (see admin.routes.js allowRoles).
 *
 * @param {object} p
 * @param {number} p.applicationId
 * @param {number} p.scheduleId
 * @param {number} p.waivedBy
 * @param {string} [p.note]
 * @returns {Promise<{notFound:true}|{nothingToWaive:true}|{waived:number}>}
 */
async function waiveLateFee({ applicationId, scheduleId, waivedBy, note }) {
  const [rows] = await pool.query(
    `SELECT rs.id, rs.late_fee_amount, rs.late_fee_paid, rs.late_fee_waived,
            rs.principal_paid, rs.principal_component, rs.interest_paid,
            rs.interest_component, rs.interest_waived
       FROM repayment_schedule rs
       JOIN loan_accounts acc ON acc.id = rs.account_id
      WHERE acc.application_id = ? AND rs.id = ?`,
    [applicationId, scheduleId]
  );
  const row = rows[0];
  if (!row) return { notFound: true };

  const remaining = round2(
    Math.max(
      0,
      Number(row.late_fee_amount) - Number(row.late_fee_paid) - Number(row.late_fee_waived)
    )
  );
  if (remaining <= 0) return { nothingToWaive: true };

  const newWaived = round2(Number(row.late_fee_waived) + remaining);
  // Waiving a fee can be the ONE thing that completes an installment: a row
  // can have principal and interest fully paid but still read 'partial'
  // solely because its fee was outstanding (see repayment.test.js "an
  // installment is not 'paid' while its fee is still outstanding"). So
  // settled_at is set here exactly when the waiver newly makes it 'paid' —
  // same rule as the equivalent line in recordPayment.
  const status = installmentStatus({ ...row, late_fee_waived: newWaived });
  await pool.query(
    `UPDATE repayment_schedule
        SET late_fee_waived = ?, late_fee_waived_by = ?, late_fee_waived_at = CURRENT_TIMESTAMP,
            late_fee_waived_note = ?, status = ?,
            settled_at = ${status === "paid" ? "CURRENT_TIMESTAMP" : "NULL"}
      WHERE id = ?`,
    [newWaived, waivedBy, note || null, status, scheduleId]
  );

  return { waived: remaining };
}

// ---------------------------------------------------------------------------
// Internal behavioural credit history (v2 risk model).
// ---------------------------------------------------------------------------

/**
 * Summarise everything this institution already knows about how a customer
 * repays, from their own accounts with us.
 *
 * WHY THIS EXISTS: the risk model's strongest inputs — number_of_defaults,
 * overdue_installments, credit_utilization — had no data source, so
 * mlClient.service.js sent hardcoded constants (0, 0, 30) for every applicant.
 * Measured against the trained model, those three carry ~46% of its total
 * gain, so nearly half the model's decision power was pinned to a fixed value.
 * There is no CRIB bureau integration to fix that, but for a returning
 * customer we hold the same facts first-hand.
 *
 * This is the application-scoring vs. behavioural-scoring distinction from the
 * credit literature: a new applicant is judged on declared attributes, an
 * existing customer additionally on observed conduct. A thin file is not an
 * error — it is the normal state of a first-time borrower, and the caller
 * degrades to neutral defaults for it (behaviouralFeatures.service.js).
 *
 * Read-only, and called BEFORE the assess transaction opens, exactly like
 * findGuarantorExposureByNic: the application being assessed does not exist
 * yet, so it cannot contaminate its own history.
 *
 * "Overdue" matches repayment.service.js computeArrears — an instalment with
 * anything still outstanding whose due date has passed. Note this is
 * deliberately broader than the `status = 'due'` test used by the guarantor
 * distress query, which misses a part-paid instalment that is also overdue.
 *
 * @param {number} userId
 * @returns {Promise<object>} raw counters for behaviouralFeatures.service.js
 */
async function findBorrowerCreditHistory(userId) {
  const pool = db.promise();

  const [[accounts]] = await pool.query(
    `SELECT
       COUNT(*)                                       AS total_accounts,
       COALESCE(SUM(status = 'active'), 0)            AS active_accounts,
       COALESCE(SUM(status = 'closed'), 0)            AS closed_accounts,
       COALESCE(SUM(status = 'written_off'), 0)       AS written_off_accounts,
       COALESCE(MAX(principal), 0)                    AS highest_principal
     FROM loan_accounts
     WHERE user_id = ?`,
    [userId]
  );

  // Instalment-level conduct across every account they have ever held.
  // Outstanding is the scheduled component less what has been paid AND less
  // what was waived — mirroring the "component − paid − waived" rule stated
  // in migration 027, so an early settlement's waived interest is not
  // mistaken for an unpaid balance.
  const [[schedule]] = await pool.query(
    `SELECT
       COUNT(*)                                                  AS total_installments,
       COALESCE(SUM(
         rs.due_date < CURDATE() AND (
           GREATEST(rs.principal_component - rs.principal_paid, 0) +
           GREATEST(rs.interest_component - rs.interest_paid - rs.interest_waived, 0)
         ) > 0
       ), 0)                                                     AS overdue_installments,
       COALESCE(SUM(rs.status = 'paid'), 0)                      AS paid_installments
     FROM repayment_schedule rs
     JOIN loan_accounts acc ON acc.id = rs.account_id
     WHERE acc.user_id = ?`,
    [userId]
  );

  // Utilisation across LIVE facilities only: a closed loan consumes no
  // current capacity, so folding settled accounts in would understate how
  // much of their available credit is actually drawn right now.
  const [[utilisation]] = await pool.query(
    `SELECT
       COALESCE(SUM(GREATEST(rs.principal_component - rs.principal_paid, 0)), 0)
                                                     AS outstanding_principal,
       COALESCE(SUM(rs.principal_component), 0)      AS scheduled_principal
     FROM repayment_schedule rs
     JOIN loan_accounts acc ON acc.id = rs.account_id
     WHERE acc.user_id = ? AND acc.status = 'active'`,
    [userId]
  );

  // Instalments settled AFTER their due date, ever. DISTINCT because one
  // instalment can be cleared by several part-payments, which would otherwise
  // count as several separate delinquencies.
  const [[late]] = await pool.query(
    `SELECT COUNT(DISTINCT rs.id) AS late_installments
     FROM repayment_schedule rs
     JOIN loan_accounts acc            ON acc.id = rs.account_id
     JOIN loan_payment_allocations pa  ON pa.schedule_id = rs.id
     JOIN loan_payments p              ON p.id = pa.payment_id
     WHERE acc.user_id = ? AND p.paid_on > rs.due_date`,
    [userId]
  );

  // Applications ever submitted — the closest honest analogue to a bureau
  // "credit inquiry count" available without a CRIB feed. Withdrawn and
  // rejected ones count: an inquiry happened either way.
  const [[applications]] = await pool.query(
    `SELECT COUNT(*) AS application_count
     FROM loan_applications
     WHERE user_id = ?`,
    [userId]
  );

  // Facilities restructured. The account status enum has no 'restructured'
  // state and no endpoint sets one, so this is honestly zero rather than
  // guessed — kept here so the shape is complete and one place changes if a
  // restructure flow is ever built.
  const restructured = 0;

  return {
    total_accounts: Number(accounts.total_accounts) || 0,
    active_accounts: Number(accounts.active_accounts) || 0,
    closed_accounts: Number(accounts.closed_accounts) || 0,
    written_off_accounts: Number(accounts.written_off_accounts) || 0,
    highest_principal: Number(accounts.highest_principal) || 0,
    total_installments: Number(schedule.total_installments) || 0,
    overdue_installments: Number(schedule.overdue_installments) || 0,
    paid_installments: Number(schedule.paid_installments) || 0,
    outstanding_principal: Number(utilisation.outstanding_principal) || 0,
    scheduled_principal: Number(utilisation.scheduled_principal) || 0,
    late_installments: Number(late.late_installments) || 0,
    application_count: Number(applications.application_count) || 0,
    restructured_facilities: restructured,
  };
}

module.exports = {
  findBorrowerCreditHistory,
  findProfileByUserId,
  updateProfileDeclaredFields,
  findDraftByUserId,
  upsertDraft,
  deleteDraftByUserId,
  getActiveExposure,
  findProductById,
  findAllProducts,
  findProductFees,
  replaceProductFees,
  findOfferFees,
  findOfferFeesForOffers,
  createProduct,
  updateProduct,
  deleteProduct,
  runAssessmentTransaction,
  updateRecommendationExplanation,
  findApplicationsByUserId,
  findApplicationById,
  findAllApplications,
  getPortfolioApplications,
  getPortfolioAccounts,
  getActivePortfolioScheduleRows,
  updateApplicationStatus,
  getApplicationHistory,
  createAdverseActionRecordWithin,
  getAdverseActionHistory,
  findGuarantorExposureByNic,
  upsertGuarantorWithin,
  insertLoanGuarantorWithin,
  insertCollateralItemWithin,
  getApplicationGuarantors,
  getApplicationCollateral,
  verifyCollateralItem,
  createApplicationDocument,
  getApplicationDocuments,
  getApplicationDocumentById,
  deleteApplicationDocument,
  verifyApplicationDocument,
  getGuarantorExposureDetail,
  createOfferWithin,
  reissueOffer,
  respondToOfferWithin,
  expireLapsedOffers,
  createAccountWithin,
  closeAccountWithin,
  getRepaymentSchedule,
  findAccountByApplicationId,
  getPayments,
  recordPayment,
  recordPaymentWithin,
  getPaymentWithAllocations,
  findApplicationIdByAccountId,
  assessLateFees,
  waiveLateFee,
};

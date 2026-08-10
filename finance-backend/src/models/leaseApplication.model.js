"use strict";

/**
 * Lease application intake (L1.2) — the lease counterpart of
 * loanModel.runAssessmentTransaction.
 *
 * Deliberately a separate module from loanModel.js. That file is the loan
 * lifecycle; this one is the lease lifecycle, and the two share no tables.
 * What they DO share is the decisioning services — mlClient, creditPolicy,
 * gemini — which take arguments and are called by the controller, not from
 * here. This module only records where those judgements landed.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE LOAN INTAKE: there is no auto-reject.
 *
 *   The loan path runs the decision matrix (030) and can reject outright,
 *   but only because it writes an adverse-action record (032) in the same
 *   transaction — an application may never end up 'rejected' with no
 *   standardized "why" attached. The lease spine has no parallel of those
 *   two tables yet, so auto-rejecting here would reintroduce exactly the
 *   audit gap the loan side closed on purpose.
 *
 *   Until those parallels exist, a policy DECLINE routes the lease to
 *   'under_review' for a human instead. That is the conservative direction:
 *   it costs a staff member a look, where the alternative costs an
 *   applicant an automated refusal nobody recorded a reason for.
 */

// config/db exports the CALLBACK pool; .promise() is what every other model
// in this codebase awaits against (see loanModel.js line 39).
const pool = require("../config/db").promise();
const { langSuffix, localizedColumn } = require("../utils/i18nContent");

/**
 * Map a credit-policy outcome onto the status a fresh lease application
 * should land in.
 *
 * 'pass' still lands in 'pending', not 'approved': clearing the deterministic
 * policy rules is a precondition for approval, never approval itself. A lease
 * additionally cannot be approved before its valuation is back, which is a
 * fact this function has no visibility of.
 *
 * @param {object|null} policy creditPolicy.service evaluation
 * @returns {string} a lease_applications.status value
 */
function statusFromPolicy(policy) {
  if (!policy) return "pending";
  // See the module header: decline routes to a human, it does not auto-reject.
  if (policy.outcome === "decline" || policy.outcome === "refer") return "under_review";
  return "pending";
}

/**
 * Create a lease application and everything decided about it, atomically.
 *
 * Application, vehicle, risk score, policy verdict and the opening audit
 * event all commit or roll back together. A lease application that exists
 * without its vehicle is not underwritable; one that exists without the
 * policy verdict in force when it was taken is an audit gap. Neither is
 * allowed to be a reachable state.
 *
 * @param {object} p
 * @param {number} p.lesseeId
 * @param {number} p.productId
 * @param {number} p.financedAmount   vehicle price − down payment
 * @param {number} p.termMonths
 * @param {object} p.vehicle          normalized vehicle (camelCase keys)
 * @param {object} [p.declared]       applicant-declared model inputs
 * @param {object} [p.risk]           mlClient result: { risk_label,
 *                                    risk_category, probLow, probMedium,
 *                                    probHigh, model_version,
 *                                    behaviouralSnapshot }
 * @param {object} [p.policy]         creditPolicy result: { policy_version,
 *                                    outcome, reason_codes, metrics, rules }
 * @param {object} [p.ltv]            leasing.service assessLtv result
 * @param {number} [p.downPaymentPercent]
 * @param {number} [p.pricedInterestRate]
 * @returns {Promise<{applicationId:number, vehicleId:number,
 *                    riskAssessmentId:number|null,
 *                    policyEvaluationId:number|null, status:string}>}
 */
async function runLeaseApplicationTransaction(p) {
  const conn = await pool.getConnection();
  const d = p.declared || {};
  const status = statusFromPolicy(p.policy);

  try {
    await conn.beginTransaction();

    const [appResult] = await conn.query(
      `INSERT INTO lease_applications
         (lessee_id, product_id, financed_amount, term_months, status,
          marital_status, education_level, occupation, employer_category,
          years_employed, additional_income, existing_loans, previous_defaults,
          crib_score, guarantor_exposure, guarantor_defaults,
          priced_interest_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.lesseeId,
        p.productId,
        p.financedAmount,
        p.termMonths,
        status,
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
        p.pricedInterestRate ?? null,
      ]
    );
    const applicationId = appResult.insertId;

    // First row in the audit trail. from_status NULL marks the application
    // coming into existence, not a transition between two real statuses.
    await conn.query(
      `INSERT INTO lease_application_events
         (application_id, from_status, to_status, actor_user_id, actor_role, note)
       VALUES (?, NULL, ?, ?, 'customer', NULL)`,
      [applicationId, status, p.lesseeId]
    );

    // The asset. Required — validated before we got here, but a lease
    // application row without one would be meaningless, so it rides the
    // same transaction rather than being written afterwards.
    const v = p.vehicle;
    const [vehicleResult] = await conn.query(
      `INSERT INTO lease_vehicles
         (application_id, supplier_id, condition_type, make, model,
          year_of_manufacture, registration_no, chassis_no, engine_no,
          fuel_type, transmission, mileage_km, invoice_price, invoice_no,
          invoice_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        v.supplierId ?? null,
        v.conditionType,
        v.make,
        v.model,
        v.yearOfManufacture,
        v.registrationNo ?? null,
        v.chassisNo ?? null,
        v.engineNo ?? null,
        v.fuelType ?? null,
        v.transmission ?? null,
        v.mileageKm ?? null,
        v.invoicePrice,
        v.invoiceNo ?? null,
        v.invoiceDate ?? null,
      ]
    );
    const vehicleId = vehicleResult.insertId;

    let riskAssessmentId = null;
    if (p.risk) {
      const [riskResult] = await conn.query(
        `INSERT INTO lease_risk_assessments
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
          // Frozen at decision time: recomputing on read would show a
          // reviewer today's repayment record beside a decision that never
          // saw it.
          p.risk.behaviouralSnapshot ? JSON.stringify(p.risk.behaviouralSnapshot) : null,
        ]
      );
      riskAssessmentId = riskResult.insertId;
    }

    let policyEvaluationId = null;
    if (p.policy) {
      const pm = p.policy.metrics || {};
      const ltv = p.ltv || {};
      const [policyResult] = await conn.query(
        `INSERT INTO lease_policy_evaluations
           (application_id, policy_version, outcome, reason_codes, dti,
            residual_income, age_at_maturity, ltv, ltv_base, ltv_base_source,
            down_payment_percent, rules)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          applicationId,
          p.policy.policy_version,
          p.policy.outcome,
          (p.policy.reason_codes || []).join(",") || null,
          pm.dti ?? null,
          pm.residual_income ?? null,
          pm.age_at_maturity ?? null,
          // Recorded even when undecidable (a valuation still outstanding),
          // in which case these stay NULL — which is itself the honest
          // record that LTV could not be judged at intake.
          ltv.ltv ?? null,
          ltv.base ?? null,
          ltv.baseSource ?? null,
          p.downPaymentPercent ?? null,
          JSON.stringify(p.policy.rules || []),
        ]
      );
      policyEvaluationId = policyResult.insertId;
    }

    await conn.commit();
    return { applicationId, vehicleId, riskAssessmentId, policyEvaluationId, status };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Columns shared by the list and detail reads, so the two cannot drift into
 * disagreeing about what a lease application is.
 */
const APPLICATION_COLUMNS = `
  la.id, la.lessee_id, la.product_id, la.financed_amount, la.term_months,
  la.status, la.priced_interest_rate, la.decision_note, la.decided_at,
  la.created_at, la.updated_at,
  lp.name AS product_name, lp.vehicle_class, lp.interest_rate, lp.rate_type,
  v.id AS vehicle_id, v.condition_type, v.make, v.model,
  v.year_of_manufacture, v.registration_no, v.invoice_price, v.supplier_id,
  s.name AS supplier_name
`;

const APPLICATION_JOINS = `
  FROM lease_applications la
  JOIN lease_products lp ON lp.id = la.product_id
  LEFT JOIN lease_vehicles v ON v.application_id = la.id
  LEFT JOIN lease_suppliers s ON s.id = v.supplier_id
`;

/**
 * The milestones a LIST view needs to show how far a lease has got.
 *
 * `lease_applications.status` stops at 'accepted' — everything after that
 * lives in the payout, registration and agreement tables. Without these a
 * list can only ever show a lease as "accepted", however far along it
 * actually is.
 *
 * Correlated subqueries rather than joins, deliberately: each is at most one
 * row per application, and joining four one-row tables would multiply the
 * result set if any assumption about uniqueness ever stopped holding.
 * Down-payment settlement is NOT computed here — it needs the accepted
 * quotation's fee lines, which is real work per row, and the derivation
 * does not need it: after acceptance the next step IS the down payment
 * until a payout exists, which `has_payout` already says.
 */
const PROGRESS_COLUMNS = `
  EXISTS (SELECT 1 FROM lease_quotations q
           WHERE q.application_id = la.id AND q.status = 'accepted') AS has_accepted_quotation,
  EXISTS (SELECT 1 FROM lease_quotations q
           WHERE q.application_id = la.id AND q.status = 'pending') AS has_live_quotation,
  EXISTS (SELECT 1 FROM lease_supplier_payouts p
           WHERE p.application_id = la.id) AS has_payout,
  (SELECT r.status FROM vehicle_registrations r
     WHERE r.vehicle_id = v.id LIMIT 1) AS registration_status,
  (SELECT r.release_letter_no FROM vehicle_registrations r
     WHERE r.vehicle_id = v.id LIMIT 1) AS release_letter_no,
  (SELECT a.status FROM lease_agreements a
     WHERE a.application_id = la.id LIMIT 1) AS agreement_status
`;

/**
 * One lease application with its product, vehicle and dealer.
 * @param {number} applicationId
 * @returns {Promise<object|null>}
 */
async function findLeaseApplicationById(applicationId) {
  const [rows] = await pool.query(
    `SELECT ${APPLICATION_COLUMNS} ${APPLICATION_JOINS} WHERE la.id = ? LIMIT 1`,
    [applicationId]
  );
  return rows[0] || null;
}

/**
 * All of one lessee's applications, newest first.
 * @param {number} lesseeId
 * @returns {Promise<object[]>}
 */
async function findLeaseApplicationsByLessee(lesseeId) {
  const [rows] = await pool.query(
    `SELECT ${APPLICATION_COLUMNS}, ${PROGRESS_COLUMNS} ${APPLICATION_JOINS}
      WHERE la.lessee_id = ?
      ORDER BY la.created_at DESC, la.id DESC`,
    [lesseeId]
  );
  return rows;
}

/**
 * The latest risk assessment and policy verdict for an application.
 *
 * Latest rather than all: the detail view shows the current standing, and a
 * reassessment supersedes rather than accompanies. The full history is in
 * the tables and can be read directly when something needs it.
 *
 * @param {number} applicationId
 * @returns {Promise<{risk:object|null, policy:object|null}>}
 */
async function findLeaseAssessment(applicationId) {
  const [[risk]] = await pool.query(
    `SELECT * FROM lease_risk_assessments
      WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
    [applicationId]
  );
  const [[policy]] = await pool.query(
    `SELECT * FROM lease_policy_evaluations
      WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
    [applicationId]
  );
  return { risk: risk || null, policy: policy || null };
}

/**
 * The application's status history, oldest first.
 * @param {number} applicationId
 * @returns {Promise<object[]>}
 */
async function findLeaseApplicationEvents(applicationId) {
  const [rows] = await pool.query(
    `SELECT e.*, u.first_name AS actor_first_name, u.last_name AS actor_last_name
       FROM lease_application_events e
       LEFT JOIN users u ON u.user_id = e.actor_user_id
      WHERE e.application_id = ?
      ORDER BY e.created_at ASC, e.id ASC`,
    [applicationId]
  );
  return rows;
}

/**
 * How many applications this lessee has awaiting a decision.
 *
 * The lease counterpart of the loan side's pending-application guard: a
 * customer stacking unlimited undecided applications should be stopped at
 * intake, before an ML call and a persisted row.
 *
 * @param {number} lesseeId
 * @returns {Promise<number>}
 */
async function countUndecidedLeaseApplications(lesseeId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n
       FROM lease_applications
      WHERE lessee_id = ?
        AND status IN ('pending','under_review','info_requested','approved','quoted')`,
    [lesseeId]
  );
  return Number(row.n) || 0;
}

/* ------------------------------------------------------------------ *
 * Valuations (L3.1)
 * ------------------------------------------------------------------ */

/**
 * Request a valuation from an approved valuer.
 *
 * A new row every time rather than an upsert: a second opinion after a
 * disputed first is a real situation, and overwriting would destroy the
 * evidence that the first one existed.
 */
async function requestValuation({ vehicleId, valuerId, requestedBy }) {
  const [result] = await pool.query(
    `INSERT INTO vehicle_valuations (vehicle_id, valuer_id, status, requested_by)
     VALUES (?, ?, 'requested', ?)`,
    [vehicleId, valuerId ?? null, requestedBy ?? null]
  );
  return findValuationById(result.insertId);
}

async function findValuationById(id) {
  const [rows] = await pool.query(
    `SELECT vv.*, lv.name AS valuer_name, lv.license_no AS valuer_license_no
       FROM vehicle_valuations vv
       LEFT JOIN lease_valuers lv ON lv.id = vv.valuer_id
      WHERE vv.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/** Every valuation on a vehicle, newest request first. */
async function findValuationsByVehicle(vehicleId) {
  const [rows] = await pool.query(
    `SELECT vv.*, lv.name AS valuer_name, lv.license_no AS valuer_license_no,
            u.first_name AS requested_by_first_name, u.last_name AS requested_by_last_name
       FROM vehicle_valuations vv
       LEFT JOIN lease_valuers lv ON lv.id = vv.valuer_id
       LEFT JOIN users u ON u.user_id = vv.requested_by
      WHERE vv.vehicle_id = ?
      ORDER BY vv.requested_at DESC, vv.id DESC`,
    [vehicleId]
  );
  return rows;
}

/**
 * The valuation LTV should be judged against: the most recent COMPLETED one.
 *
 * Deliberately ignores 'requested' (not back yet — a value that does not
 * exist) and 'rejected' (history, not evidence). Returns null when there is
 * none, which is what makes assessLtv undecidable rather than optimistic.
 */
async function findLatestCompletedValuation(vehicleId) {
  const [rows] = await pool.query(
    `SELECT * FROM vehicle_valuations
      WHERE vehicle_id = ? AND status = 'completed'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1`,
    [vehicleId]
  );
  return rows[0] || null;
}

/**
 * Record a valuer's report, or their refusal to value the vehicle.
 *
 * Only a 'requested' valuation may be completed. Re-recording a finished one
 * would rewrite evidence a credit decision may already have been taken on;
 * the correct move is to request a fresh valuation, which is why requesting
 * is unrestricted and completing is not.
 *
 * @returns {Promise<object|null>} the updated row, or null if it was not
 *          still outstanding
 */
async function completeValuation(id, { status, valuationAmount, valuationDate, reportReference, conditionNotes }) {
  const [result] = await pool.query(
    `UPDATE vehicle_valuations
        SET status = ?, valuation_amount = ?, valuation_date = ?,
            report_reference = ?, condition_notes = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'requested'`,
    [
      status,
      status === "completed" ? valuationAmount : null,
      status === "completed" ? (valuationDate ?? null) : null,
      reportReference ?? null,
      conditionNotes ?? null,
      id,
    ]
  );
  if (!result.affectedRows) return null;
  return findValuationById(id);
}

/**
 * Record a fresh policy verdict against an application.
 *
 * Append-only: a re-evaluation after a valuation arrives does not overwrite
 * the intake verdict. Both are real — the first is what was known then, the
 * second what is known now — and findLeaseAssessment reads the latest.
 */
async function insertPolicyEvaluation(applicationId, { policy, ltv, downPaymentPercent }) {
  const pm = policy.metrics || {};
  const l = ltv || {};
  const [result] = await pool.query(
    `INSERT INTO lease_policy_evaluations
       (application_id, policy_version, outcome, reason_codes, dti,
        residual_income, age_at_maturity, ltv, ltv_base, ltv_base_source,
        down_payment_percent, rules)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      applicationId,
      policy.policy_version,
      policy.outcome,
      (policy.reason_codes || []).join(",") || null,
      pm.dti ?? null,
      pm.residual_income ?? null,
      pm.age_at_maturity ?? null,
      l.ltv ?? null,
      l.base ?? null,
      l.baseSource ?? null,
      downPaymentPercent ?? null,
      JSON.stringify(policy.rules || []),
    ]
  );
  return result.insertId;
}

/**
 * Move an application to a new status and record the move, atomically.
 *
 * The two must commit together: a status that changed with no event
 * explaining it, or an event claiming a move that did not happen, are both
 * lies in the audit trail.
 */
async function transitionApplication(applicationId, { from, to, actorUserId, actorRole, note }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `UPDATE lease_applications
          SET status = ?,
              decision_note = COALESCE(?, decision_note),
              decided_by = CASE WHEN ? IN ('approved','rejected') THEN ? ELSE decided_by END,
              decided_at = CASE WHEN ? IN ('approved','rejected') THEN CURRENT_TIMESTAMP ELSE decided_at END
        WHERE id = ? AND status = ?`,
      [to, note ?? null, to, actorUserId ?? null, to, applicationId, from]
    );
    // Zero rows means the status moved under us between the read and the
    // write — two reviewers acting at once. Roll back rather than emit an
    // event for a transition that did not occur.
    if (!result.affectedRows) {
      await conn.rollback();
      return false;
    }
    await conn.query(
      `INSERT INTO lease_application_events
         (application_id, from_status, to_status, actor_user_id, actor_role, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [applicationId, from, to, actorUserId ?? null, actorRole ?? null, note ?? null]
    );
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Lease applications for the staff queue, newest first.
 * @param {object} [opts]
 * @param {string} [opts.status] filter to one status
 */
async function findAllLeaseApplications({ status } = {}) {
  const [rows] = await pool.query(
    `SELECT ${APPLICATION_COLUMNS}, ${PROGRESS_COLUMNS},
            u.first_name AS lessee_first_name, u.last_name AS lessee_last_name,
            u.email AS lessee_email,
            (SELECT COUNT(*) FROM vehicle_valuations vv
              WHERE vv.vehicle_id = v.id AND vv.status = 'completed') AS completed_valuations,
            (SELECT COUNT(*) FROM vehicle_valuations vv
              WHERE vv.vehicle_id = v.id AND vv.status = 'requested') AS pending_valuations
     ${APPLICATION_JOINS}
       JOIN users u ON u.user_id = la.lessee_id
      ${status ? "WHERE la.status = ?" : ""}
      ORDER BY la.created_at DESC, la.id DESC`,
    status ? [status] : []
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Quotations (L4.1)
 * ------------------------------------------------------------------ */

/** A product's configured fee schedule. */
async function findLeaseProductFees(productId) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_product_fees WHERE product_id = ? AND active = 1 ORDER BY fee_type`,
    [productId]
  );
  return rows;
}

/**
 * Issue a quotation, superseding any live one, with its fee lines — all in
 * one transaction.
 *
 * Superseding is part of issuing, not a separate step: two live quotations
 * on one application would mean two different sets of terms the lessee could
 * accept, and whichever they clicked would be arbitrary. The UNIQUE key on
 * lease_quotation_fees stops a fee type appearing twice on one quotation.
 *
 * @returns {Promise<number>} the new quotation id
 */
async function issueQuotationWithin({ applicationId, terms, fees, quotedBy, expiresAt }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE lease_quotations SET status = 'superseded'
        WHERE application_id = ? AND status = 'pending'`,
      [applicationId]
    );

    const [q] = await conn.query(
      `INSERT INTO lease_quotations
         (application_id, vehicle_price, down_payment_amount, down_payment_percent,
          financed_amount, term_months, interest_rate, rate_type, monthly_rental,
          total_rentals, quotation_note, quoted_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        terms.vehiclePrice,
        terms.downPaymentAmount,
        terms.downPaymentPercent,
        terms.financedAmount,
        terms.termMonths,
        terms.interestRate,
        terms.rateType,
        terms.monthlyRental,
        terms.totalRentals,
        terms.note ?? null,
        quotedBy ?? null,
        expiresAt,
      ]
    );
    const quotationId = q.insertId;

    for (const fee of fees) {
      await conn.query(
        `INSERT INTO lease_quotation_fees
           (quotation_id, fee_type, label, calc_method, rate_or_amount, amount,
            waived, waived_by, waived_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotationId,
          fee.fee_type,
          fee.label,
          fee.calc_method,
          fee.rate_or_amount,
          fee.amount,
          fee.waived ? 1 : 0,
          fee.waived ? quotedBy ?? null : null,
          fee.waived_reason ?? null,
        ]
      );
    }

    await conn.commit();
    return quotationId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findQuotationById(id) {
  const [rows] = await pool.query(`SELECT * FROM lease_quotations WHERE id = ? LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const [fees] = await pool.query(
    `SELECT * FROM lease_quotation_fees WHERE quotation_id = ? ORDER BY fee_type`,
    [id]
  );
  return { ...rows[0], fees };
}

/** The live quotation for an application, if there is one. */
async function findPendingQuotation(applicationId) {
  const [rows] = await pool.query(
    `SELECT id FROM lease_quotations
      WHERE application_id = ? AND status = 'pending'
      ORDER BY quoted_at DESC, id DESC LIMIT 1`,
    [applicationId]
  );
  return rows[0] ? findQuotationById(rows[0].id) : null;
}

/** Every quotation ever issued on an application, newest first. */
async function findQuotationsByApplication(applicationId) {
  const [rows] = await pool.query(
    `SELECT q.*, u.first_name AS quoted_by_first_name, u.last_name AS quoted_by_last_name
       FROM lease_quotations q
       LEFT JOIN users u ON u.user_id = q.quoted_by
      WHERE q.application_id = ?
      ORDER BY q.quoted_at DESC, q.id DESC`,
    [applicationId]
  );
  if (!rows.length) return [];
  const [fees] = await pool.query(
    `SELECT * FROM lease_quotation_fees WHERE quotation_id IN (?) ORDER BY fee_type`,
    [rows.map((r) => r.id)]
  );
  const byQuotation = new Map();
  for (const f of fees) {
    if (!byQuotation.has(f.quotation_id)) byQuotation.set(f.quotation_id, []);
    byQuotation.get(f.quotation_id).push(f);
  }
  return rows.map((r) => ({ ...r, fees: byQuotation.get(r.id) || [] }));
}

/**
 * Record the lessee's answer to a quotation and move the application, in one
 * transaction.
 *
 * Guarded on the quotation still being 'pending' AND the application still
 * being 'quoted': accepting terms that were superseded a second earlier, or
 * answering twice, must both fail rather than race.
 *
 * @returns {Promise<boolean>} false if it was no longer answerable
 */
async function answerQuotation({ quotationId, applicationId, decision, lesseeId, note }) {
  const target = decision === "accept" ? "accepted" : "declined";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [q] = await conn.query(
      `UPDATE lease_quotations
          SET status = ?, responded_at = CURRENT_TIMESTAMP, response_note = ?
        WHERE id = ? AND application_id = ? AND status = 'pending'`,
      [target, note ?? null, quotationId, applicationId]
    );
    if (!q.affectedRows) {
      await conn.rollback();
      return false;
    }

    const [a] = await conn.query(
      `UPDATE lease_applications SET status = ? WHERE id = ? AND status = 'quoted'`,
      [target, applicationId]
    );
    if (!a.affectedRows) {
      await conn.rollback();
      return false;
    }

    await conn.query(
      `INSERT INTO lease_application_events
         (application_id, from_status, to_status, actor_user_id, actor_role, note)
       VALUES (?, 'quoted', ?, ?, 'customer', ?)`,
      [applicationId, target, lesseeId, note ?? null]
    );

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ *
 * Purchase and title (L6)
 * ------------------------------------------------------------------ */

/** The dealer payout for an application, if one has been made. */
async function findPayout(applicationId) {
  const [rows] = await pool.query(
    `SELECT p.*, s.name AS supplier_name,
            u.first_name AS paid_by_first_name, u.last_name AS paid_by_last_name
       FROM lease_supplier_payouts p
       LEFT JOIN lease_suppliers s ON s.id = p.supplier_id
       LEFT JOIN users u ON u.user_id = p.paid_by
      WHERE p.application_id = ? LIMIT 1`,
    [applicationId]
  );
  return rows[0] || null;
}

/**
 * Record the purchase of the vehicle from the dealer.
 *
 * The banking details are SNAPSHOTTED from the supplier rather than left to
 * a join: a dealer changing bank next year must not rewrite where last
 * year's money went. UNIQUE(application_id) makes a double payout impossible
 * at the schema level, so the race between two clerks resolves in the
 * database rather than in application code.
 */
async function recordPayout({
  applicationId,
  supplierId,
  amount,
  method,
  referenceNo,
  paidOn,
  paidBy,
  notes,
  supplier,
}) {
  try {
    const [result] = await pool.query(
      `INSERT INTO lease_supplier_payouts
         (application_id, supplier_id, amount, method, reference_no,
          paid_to_account, paid_to_bank, paid_to_holder, paid_on, paid_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        supplierId ?? null,
        amount,
        method,
        referenceNo ?? null,
        supplier?.bank_account_no ?? null,
        supplier?.bank_name ?? null,
        supplier?.account_holder ?? null,
        paidOn,
        paidBy ?? null,
        notes ?? null,
      ]
    );
    return { payoutId: result.insertId };
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return { alreadyPaid: true };
    throw err;
  }
}

/**
 * Record a registration number obtained after intake.
 *
 * A brand-new vehicle has none when the lease is applied for — it gets one
 * at the same DMT visit that records the lessor as absolute owner.
 */
async function setVehicleRegistrationNo(vehicleId, registrationNo) {
  await pool.query(`UPDATE lease_vehicles SET registration_no = ? WHERE id = ?`, [
    registrationNo,
    vehicleId,
  ]);
}

/**
 * Attach or detach the approved dealer supplying this vehicle.
 *
 * NULL is a real value here, not "unchanged" — it means a private seller,
 * which is a legitimate way to buy a car and the state every application has
 * defaulted to for want of a populated dealer register.
 */
async function setVehicleSupplier(vehicleId, supplierId) {
  await pool.query(`UPDATE lease_vehicles SET supplier_id = ? WHERE id = ?`, [
    supplierId ?? null,
    vehicleId,
  ]);
}

/** The title record for a vehicle, created lazily on first use. */
async function findRegistration(vehicleId) {
  const [rows] = await pool.query(
    `SELECT r.*, u.first_name AS updated_by_first_name, u.last_name AS updated_by_last_name
       FROM vehicle_registrations r
       LEFT JOIN users u ON u.user_id = r.updated_by
      WHERE r.vehicle_id = ? LIMIT 1`,
    [vehicleId]
  );
  return rows[0] || null;
}

/**
 * Advance the title record, creating it on first use.
 *
 * Guarded on the CURRENT status so two people advancing the same stage at
 * once cannot both succeed — the second finds the row already moved and gets
 * a false back rather than silently overwriting the first one's references.
 *
 * @returns {Promise<boolean>} false if it had already moved
 */
async function advanceRegistration(vehicleId, { from, to, fields = {}, updatedBy }) {
  if (from === "not_started") {
    // Create-or-ignore, so the first advance does not need a separate setup
    // call and two concurrent first-advances still resolve to one row.
    await pool.query(
      `INSERT IGNORE INTO vehicle_registrations (vehicle_id, status) VALUES (?, 'not_started')`,
      [vehicleId]
    );
  }

  const columns = Object.keys(fields);
  const assignments = columns.map((c) => `${c} = ?`).join(", ");
  const [result] = await pool.query(
    `UPDATE vehicle_registrations
        SET status = ?${assignments ? ", " + assignments : ""}, updated_by = ?
      WHERE vehicle_id = ? AND status = ?`,
    [to, ...columns.map((c) => fields[c]), updatedBy ?? null, vehicleId, from]
  );
  return result.affectedRows > 0;
}

/**
 * The four aggregate reads the portfolio is built from (L8.1).
 *
 * Deliberately four queries rather than one join: the questions are
 * independent, and joining agreements to rentals to registrations would
 * multiply rows and inflate exactly the counts being reported.
 */
async function getPortfolioRows() {
  const [applications] = await pool.query(`SELECT status FROM lease_applications`);
  const [agreements] = await pool.query(
    `SELECT id, status, financed_amount, total_rentals, vehicle_price FROM lease_agreements`
  );
  const [rentals] = await pool.query(
    `SELECT agreement_id, SUM(amount) AS total FROM lease_rentals GROUP BY agreement_id`
  );
  const [registrations] = await pool.query(
    `SELECT status, COUNT(*) AS n FROM vehicle_registrations GROUP BY status`
  );
  return [applications, agreements, rentals, registrations];
}

/* ------------------------------------------------------------------ *
 * Documents (L2.4)
 * ------------------------------------------------------------------ */

async function createLeaseDocument({
  applicationId,
  documentType,
  uploadedBy,
  originalName,
  storagePath,
  mimeType,
  sizeBytes,
}) {
  const [result] = await pool.query(
    `INSERT INTO lease_application_documents
       (application_id, document_type, uploaded_by, original_name,
        storage_path, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [applicationId, documentType, uploadedBy ?? null, originalName, storagePath, mimeType, sizeBytes]
  );
  const [rows] = await pool.query(`SELECT * FROM lease_application_documents WHERE id = ?`, [
    result.insertId,
  ]);
  return rows[0];
}

async function findLeaseDocuments(applicationId) {
  const [rows] = await pool.query(
    `SELECT d.*, u.first_name AS uploaded_by_first_name, u.last_name AS uploaded_by_last_name
       FROM lease_application_documents d
       LEFT JOIN users u ON u.user_id = d.uploaded_by
      WHERE d.application_id = ?
      ORDER BY d.created_at DESC, d.id DESC`,
    [applicationId]
  );
  return rows;
}

async function findLeaseDocumentById(documentId) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_application_documents WHERE id = ? LIMIT 1`,
    [documentId]
  );
  return rows[0] || null;
}

/**
 * Delete a document, but only while it is still awaiting review.
 *
 * Once staff have verified or rejected it, the record is locked for audit —
 * the lessee uploads a fresh document rather than erasing the trail. Same
 * rule the loan side applies.
 *
 * @returns {Promise<number>} rows deleted; 0 means it was already reviewed
 */
async function deleteLeaseDocumentIfPending(documentId) {
  const [result] = await pool.query(
    `DELETE FROM lease_application_documents
      WHERE id = ? AND verification_status = 'pending'`,
    [documentId]
  );
  return result.affectedRows;
}

/**
 * Sign off on, or reject, one uploaded document.
 *
 * The `verification_status = 'pending'` guard is what makes this decision
 * final: a document cannot be verified, then quietly un-verified, then
 * verified again by someone else. Two officers acting on the same document
 * at once means the second gets null and is told so, rather than silently
 * overwriting the first one's name in `verified_by`. Mirrors
 * loanModel.verifyApplicationDocument.
 *
 * @returns {Promise<object|null>} the updated row, or null if already decided
 */
async function verifyLeaseDocument(
  documentId,
  { verificationStatus, verifiedBy, verificationNotes }
) {
  const [result] = await pool.query(
    `UPDATE lease_application_documents
        SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP,
            verification_notes = ?
      WHERE id = ? AND verification_status = 'pending'`,
    [verificationStatus, verifiedBy, verificationNotes || null, documentId]
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await pool.query(
    `SELECT id, application_id, document_type, original_name, mime_type, size_bytes,
            verification_status, verified_by, verified_at, verification_notes, created_at
       FROM lease_application_documents WHERE id = ?`,
    [documentId]
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

// name + description are the customer-visible free text; the rest is
// machine-read/closed-set, so it's selected as-is rather than through
// localizedColumn. Explicit columns (not `*`) so the _si/_ta sibling columns
// never leak into the API response — the frontend only ever sees `name` and
// `description`, already resolved to the caller's language.
const PRODUCT_COLUMNS = `
  id, ${"NAME_PLACEHOLDER"}, vehicle_class,
  min_financed_amount, max_financed_amount,
  min_term_months, max_term_months,
  interest_rate, rate_type, min_interest_rate, max_interest_rate,
  ${"DESCRIPTION_PLACEHOLDER"}, active, created_at, updated_at
`;

async function findAllLeaseProducts({ activeOnly = true, lang } = {}) {
  const suffix = langSuffix(lang);
  const columns = PRODUCT_COLUMNS.replace("NAME_PLACEHOLDER", localizedColumn("name", suffix)).replace(
    "DESCRIPTION_PLACEHOLDER",
    localizedColumn("description", suffix)
  );
  // Ordered by the English name in every language, same reasoning as
  // loanModel.findAllProducts: the alias shadows `name`, so ordering by it
  // would reorder the catalogue per language for no reason.
  const [rows] = await pool.query(
    `SELECT ${columns} FROM lease_products
      ${activeOnly ? "WHERE active = 1" : ""}
      ORDER BY lease_products.name`
  );
  return rows;
}

async function findLeaseProductById(productId, { lang } = {}) {
  const suffix = langSuffix(lang);
  const columns = PRODUCT_COLUMNS.replace("NAME_PLACEHOLDER", localizedColumn("name", suffix)).replace(
    "DESCRIPTION_PLACEHOLDER",
    localizedColumn("description", suffix)
  );
  const [rows] = await pool.query(`SELECT ${columns} FROM lease_products WHERE id = ? LIMIT 1`, [
    productId,
  ]);
  return rows[0] || null;
}

module.exports = {
  statusFromPolicy,
  runLeaseApplicationTransaction,
  findLeaseApplicationById,
  findLeaseApplicationsByLessee,
  findLeaseAssessment,
  findLeaseApplicationEvents,
  countUndecidedLeaseApplications,
  findAllLeaseApplications,
  requestValuation,
  findValuationById,
  findValuationsByVehicle,
  findLatestCompletedValuation,
  completeValuation,
  insertPolicyEvaluation,
  transitionApplication,
  findLeaseProductFees,
  issueQuotationWithin,
  findQuotationById,
  findPendingQuotation,
  findQuotationsByApplication,
  answerQuotation,
  getPortfolioRows,
  findPayout,
  recordPayout,
  setVehicleRegistrationNo,
  setVehicleSupplier,
  findRegistration,
  advanceRegistration,
  createLeaseDocument,
  findLeaseDocuments,
  findLeaseDocumentById,
  deleteLeaseDocumentIfPending,
  verifyLeaseDocument,
  findAllLeaseProducts,
  findLeaseProductById,
};

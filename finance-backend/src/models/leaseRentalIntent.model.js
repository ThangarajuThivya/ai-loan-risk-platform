"use strict";

/**
 * Card payment of a monthly rental (049).
 *
 * The rental counterpart of leaseDownPayment.model's intent handling, and
 * deliberately the same shape: an intent exists before the gateway session,
 * the session id is the idempotency key, and settlement passes through one
 * gate that a retried webhook and a refreshed return page both hit.
 *
 * WHO ASSERTS WHAT, again. A card rental is the institution OBSERVING money
 * arrive, so `recorded_by` on the resulting `lease_rentals` row is NULL. An
 * offline rental is a member of staff ASSERTING it arrived, and carries
 * their id. Preserving that distinction is the reason the column is
 * nullable; see 046 and leaseDownPayment.controller's header.
 */

// config/db exports the CALLBACK pool; .promise() is what every other model
// in this codebase awaits against (see loanModel.js line 39).
const pool = require("../config/db").promise();
const agreementModel = require("./leaseAgreement.model");

async function createIntent({ agreementId, lesseeId, amount, currency, paymentKind }) {
  const [res] = await pool.query(
    `INSERT INTO lease_rental_intents
       (agreement_id, lessee_id, amount, currency, payment_kind)
     VALUES (?, ?, ?, ?, ?)`,
    [agreementId, lesseeId, amount, currency || "LKR", paymentKind || "rental"]
  );
  const [rows] = await pool.query(`SELECT * FROM lease_rental_intents WHERE id = ?`, [res.insertId]);
  return rows[0];
}

async function attachSession(intentId, sessionId) {
  await pool.query(`UPDATE lease_rental_intents SET provider_session_id = ? WHERE id = ?`, [
    sessionId,
    intentId,
  ]);
}

async function findIntentById(id) {
  const [rows] = await pool.query(`SELECT * FROM lease_rental_intents WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findIntentBySessionId(sessionId) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_rental_intents WHERE provider_session_id = ? LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function markFailedById(intentId, reason) {
  await pool.query(
    `UPDATE lease_rental_intents
        SET status = 'failed', failure_reason = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'created'`,
    [String(reason || "").slice(0, 255), intentId]
  );
}

/**
 * A session that expired or was abandoned. Gated on 'created' so a late
 * cancellation can never undo a payment that already settled.
 */
async function markUnsuccessful(sessionId, status, reason) {
  const [res] = await pool.query(
    `UPDATE lease_rental_intents
        SET status = ?, failure_reason = ?, completed_at = CURRENT_TIMESTAMP
      WHERE provider_session_id = ? AND status = 'created'`,
    [status, String(reason || "").slice(0, 255), sessionId]
  );
  return res.affectedRows > 0;
}

/**
 * Post a confirmed card payment to the rental ledger, exactly once.
 *
 * The intent row is locked and its status checked before anything is
 * written; a retried webhook, a refreshed return page, or the two racing
 * each other all reach the gate and stop.
 *
 * A payment that arrives but CANNOT be posted — the lease was closed or
 * settled by another route while the lessee was on the gateway's page —
 * does NOT roll back. Real money has moved, and the only way anyone learns a
 * refund is owed is if the failure is recorded. Same principle as the down
 * payment path, and as 040 before it.
 */
async function settle({ sessionId, providerPaymentRef, paidOn }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM lease_rental_intents WHERE provider_session_id = ? FOR UPDATE`,
      [sessionId]
    );
    const intent = rows[0];
    if (!intent) {
      await conn.rollback();
      return { notFound: true };
    }

    // THE GATE. A retried webhook, a refreshed return page, or the two
    // racing each other all land here and stop.
    if (intent.status !== "created") {
      await conn.rollback();
      return { alreadySettled: true, intent };
    }

    // Posting the rental joins THIS transaction rather than opening its own.
    // If it opened its own, the gate above would not hold: a second delivery
    // could read 'created' and post the same money again before the first
    // finished writing. One transaction makes claiming and posting a single
    // atomic act.
    const result = await agreementModel.recordRental({
      agreementId: intent.agreement_id,
      amount: Number(intent.amount),
      method: "card",
      paidOn: paidOn || new Date().toISOString().slice(0, 10),
      rentalType: intent.payment_kind === "settlement" ? "settlement" : "rental",
      externalRef: providerPaymentRef || sessionId,
      note: "Paid online by card",
      // NULL: nobody asserted this, the gateway confirmed it.
      recordedBy: null,
      conn,
    });

    const failure =
      (result.notFound && "The agreement no longer exists") ||
      (result.inactive && `The lease is ${result.status}; no further rentals can be posted`) ||
      (result.overpayment &&
        `OVERPAYMENT (outstanding ${result.outstanding} when the card cleared)`) ||
      (result.notSettleable && "The lease can no longer be settled early") ||
      (result.settlementShortfall &&
        `The settlement figure moved to ${result.required} while the payment was in flight`) ||
      null;

    if (failure) {
      // COMMITTED, not rolled back. The card has already been charged; the
      // only way anyone learns a refund is owed is if this record survives.
      await conn.query(
        `UPDATE lease_rental_intents
            SET status = 'failed', failure_reason = ?, provider_payment_ref = ?,
                completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [
          `Gateway payment could not be posted: ${failure}`.slice(0, 255),
          providerPaymentRef || null,
          intent.id,
        ]
      );
      await conn.commit();
      return { rejected: true, reason: failure, intent };
    }

    await conn.query(
      `UPDATE lease_rental_intents
          SET status = 'succeeded', rental_id = ?, provider_payment_ref = ?,
              completed_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [result.rentalId, providerPaymentRef || null, intent.id]
    );

    await conn.commit();
    return {
      settled: true,
      intent,
      rentalId: result.rentalId,
      completed: Boolean(result.completed),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  createIntent,
  attachSession,
  findIntentById,
  findIntentBySessionId,
  markFailedById,
  markUnsuccessful,
  settle,
};

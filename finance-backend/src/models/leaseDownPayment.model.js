"use strict";

/**
 * Lease down payment (L5) — the ledger of money received at signing, and the
 * lifecycle of online attempts to pay it.
 *
 * WHAT IS OWED AT SIGNING is the accepted quotation's down payment PLUS its
 * unwaived fees. That is one number to the lessee standing at a counter, and
 * it is collected as one settlement, so receipts accumulate against the
 * combined total rather than being split across two ledgers. `amountDue`
 * below is the single place that total is computed.
 *
 * THE EXACTLY-ONCE PROBLEM is identical to 040's and is solved identically,
 * because the failure modes are identical — gateways retry webhooks for days
 * and the return redirect can beat them:
 *
 *   TWICE  is prevented by `SELECT ... FOR UPDATE` on the intent plus a
 *          status gate, backed by uk_ldpi_down_payment at the schema level.
 *   ZERO   is prevented by the return page reconciling through the SAME gate.
 *
 * The one thing this adds over 040 is an overpayment guard: unlike a loan
 * repayment, two people can be settling one signing amount (a card payment
 * by the lessee and a cash receipt keyed in at a branch), so the settle path
 * re-checks the outstanding balance inside the transaction.
 */

const pool = require("../config/db").promise();

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * What the lessee owes at signing, and how much has arrived.
 *
 * Returns null when there is no accepted quotation — nothing is owed until
 * terms have been agreed, and quoting a figure before then would invite
 * payment against terms that can still change.
 *
 * @param {number} applicationId
 * @returns {Promise<{dueTotal:number, downPayment:number, fees:number,
 *                    received:number, outstanding:number, settled:boolean,
 *                    quotationId:number}|null>}
 */
async function getSigningPosition(applicationId) {
  const [[quotation]] = await pool.query(
    `SELECT id, down_payment_amount FROM lease_quotations
      WHERE application_id = ? AND status = 'accepted'
      ORDER BY responded_at DESC, id DESC LIMIT 1`,
    [applicationId]
  );
  if (!quotation) return null;

  const [[fees]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN waived = 1 THEN 0 ELSE amount END), 0) AS total
       FROM lease_quotation_fees WHERE quotation_id = ?`,
    [quotation.id]
  );
  const [[paid]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM lease_down_payments WHERE application_id = ?`,
    [applicationId]
  );

  const downPayment = round2(quotation.down_payment_amount);
  const feeTotal = round2(fees.total);
  const dueTotal = round2(downPayment + feeTotal);
  const received = round2(paid.total);

  return {
    quotationId: quotation.id,
    downPayment,
    fees: feeTotal,
    dueTotal,
    received,
    outstanding: round2(Math.max(0, dueTotal - received)),
    // Tolerant of rounding dust in the last cent, deliberately: refusing to
    // call a lease settled over LKR 0.004 would strand it forever.
    settled: received + 0.01 >= dueTotal,
  };
}

/** Every receipt against one application, newest first. */
async function listReceipts(applicationId) {
  const [rows] = await pool.query(
    `SELECT d.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name
       FROM lease_down_payments d
       LEFT JOIN users u ON u.user_id = d.recorded_by
      WHERE d.application_id = ?
      ORDER BY d.paid_on DESC, d.id DESC`,
    [applicationId]
  );
  return rows;
}

/**
 * Record a receipt taken outside the gateway (cash, bank transfer, cheque).
 *
 * Staff-only, and `recordedBy` is required for exactly that reason: an
 * offline receipt IS somebody asserting money arrived, and the audit trail
 * has to name them. A card payment leaves this NULL, which is how the two
 * stay distinguishable forever.
 *
 * The overpayment check is inside the transaction and re-reads the total, so
 * two clerks keying the same cash at once cannot both succeed.
 */
async function recordOfflineReceipt({
  applicationId,
  lesseeId,
  amount,
  method,
  referenceNo,
  paidOn,
  recordedBy,
  notes,
  dueTotal,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[paid]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM lease_down_payments
        WHERE application_id = ? FOR UPDATE`,
      [applicationId]
    );
    const received = round2(paid.total);
    if (received + Number(amount) > dueTotal + 0.01) {
      await conn.rollback();
      return {
        overpayment: true,
        received,
        dueTotal,
        outstanding: round2(Math.max(0, dueTotal - received)),
      };
    }

    const [result] = await conn.query(
      `INSERT INTO lease_down_payments
         (application_id, lessee_id, amount, method, reference_no, paid_on, recorded_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        lesseeId,
        amount,
        method,
        referenceNo ?? null,
        paidOn,
        recordedBy,
        notes ?? null,
      ]
    );

    await conn.commit();
    return { receiptId: result.insertId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ *
 * Online attempts
 * ------------------------------------------------------------------ */

async function createIntent({ applicationId, lesseeId, amount, currency }) {
  const [result] = await pool.query(
    `INSERT INTO lease_down_payment_intents (application_id, lessee_id, amount, currency)
     VALUES (?, ?, ?, ?)`,
    [applicationId, lesseeId, amount, currency]
  );
  return findIntentById(result.insertId);
}

async function attachSession(intentId, sessionId) {
  await pool.query(
    `UPDATE lease_down_payment_intents SET provider_session_id = ? WHERE id = ?`,
    [sessionId, intentId]
  );
}

async function findIntentById(id) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_down_payment_intents WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function findIntentBySessionId(sessionId) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_down_payment_intents WHERE provider_session_id = ? LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function markFailedById(intentId, reason) {
  await pool.query(
    `UPDATE lease_down_payment_intents
        SET status = 'failed', failure_reason = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'created'`,
    [String(reason || "").slice(0, 255), intentId]
  );
}

async function markUnsuccessful(sessionId, status, reason) {
  await pool.query(
    `UPDATE lease_down_payment_intents
        SET status = ?, failure_reason = ?, completed_at = CURRENT_TIMESTAMP
      WHERE provider_session_id = ? AND status = 'created'`,
    [status, String(reason || "").slice(0, 255), sessionId]
  );
}

/**
 * Turn a paid gateway session into a receipt — exactly once.
 *
 * Both callers reach this same gate: the webhook (the authority) and the
 * return-page reconcile (for when the webhook is slow, or was never
 * configured at all).
 *
 * @returns {Promise<{notFound:true}
 *   |{alreadySettled:true, intent:object}
 *   |{rejected:true, reason:string, intent:object}
 *   |{settled:true, intent:object, receiptId:number}>}
 */
async function settle({ sessionId, providerPaymentRef, paidOn }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM lease_down_payment_intents
        WHERE provider_session_id = ? FOR UPDATE`,
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

    // Re-check the outstanding balance under the lock: a branch clerk may
    // have taken cash for the same signing amount while this card payment
    // was in flight. Real money has already moved, so this does NOT roll
    // back — it records why the money could not be posted, which is the only
    // way anyone finds out a refund is owed.
    const [[quotation]] = await conn.query(
      `SELECT id, down_payment_amount FROM lease_quotations
        WHERE application_id = ? AND status = 'accepted'
        ORDER BY responded_at DESC, id DESC LIMIT 1`,
      [intent.application_id]
    );
    if (!quotation) {
      await conn.query(
        `UPDATE lease_down_payment_intents
            SET status = 'failed', failure_reason = ?, provider_payment_ref = ?,
                completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        ["No accepted quotation to settle against", providerPaymentRef || null, intent.id]
      );
      await conn.commit();
      return { rejected: true, reason: "NO_ACCEPTED_QUOTATION", intent };
    }

    const [[fees]] = await conn.query(
      `SELECT COALESCE(SUM(CASE WHEN waived = 1 THEN 0 ELSE amount END), 0) AS total
         FROM lease_quotation_fees WHERE quotation_id = ?`,
      [quotation.id]
    );
    const [[paid]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM lease_down_payments
        WHERE application_id = ? FOR UPDATE`,
      [intent.application_id]
    );
    const dueTotal = round2(Number(quotation.down_payment_amount) + Number(fees.total));
    const received = round2(paid.total);

    if (received + Number(intent.amount) > dueTotal + 0.01) {
      await conn.query(
        `UPDATE lease_down_payment_intents
            SET status = 'failed', failure_reason = ?, provider_payment_ref = ?,
                completed_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [
          `Gateway payment could not be posted: OVERPAYMENT (due ${dueTotal}, already received ${received})`,
          providerPaymentRef || null,
          intent.id,
        ]
      );
      await conn.commit();
      return { rejected: true, reason: "OVERPAYMENT", intent };
    }

    const [receipt] = await conn.query(
      `INSERT INTO lease_down_payments
         (application_id, lessee_id, amount, method, reference_no, paid_on, recorded_by, notes)
       VALUES (?, ?, ?, 'card', ?, ?, NULL, 'Paid online by card')`,
      [
        intent.application_id,
        intent.lessee_id,
        intent.amount,
        providerPaymentRef || sessionId,
        paidOn || new Date().toISOString().slice(0, 10),
      ]
    );

    await conn.query(
      `UPDATE lease_down_payment_intents
          SET status = 'succeeded', down_payment_id = ?, provider_payment_ref = ?,
              completed_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [receipt.insertId, providerPaymentRef || null, intent.id]
    );

    await conn.commit();
    return { settled: true, intent, receiptId: receipt.insertId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getSigningPosition,
  listReceipts,
  recordOfflineReceipt,
  createIntent,
  attachSession,
  findIntentById,
  findIntentBySessionId,
  markFailedById,
  markUnsuccessful,
  settle,
};

"use strict";

/**
 * Data access for loan_payment_intents (040) — the lifecycle of one
 * customer-initiated repayment attempt.
 *
 * settleWithin is the only function here that matters. Everything else is
 * bookkeeping around it.
 *
 * THE PROBLEM IT SOLVES: a gateway confirms a payment more than once. Stripe
 * retries webhooks for days on any non-2xx, the browser return can land before
 * the webhook, and the customer can refresh that return page. Every one of
 * those paths must be able to say "this payment succeeded" without the
 * borrower being charged against their loan twice.
 *
 * The gate is a locked read of the intent row plus a status check. Whichever
 * caller gets there first flips 'created' → 'succeeded' inside the same
 * transaction that writes the payment; every later caller blocks on the lock,
 * then finds a status that is no longer 'created' and does nothing. Because
 * the payment insert and the status flip commit together, there is no window
 * where one exists without the other.
 *
 * uk_lpi_payment backs this at the schema level: even a bypassed gate could
 * not attach two payments to one intent.
 */

const db = require("../config/db");
const loanModel = require("./loanModel");

const pool = db.promise();

const INTENT_COLUMNS = `id, account_id, user_id, amount, currency, payment_type,
                        provider, provider_session_id, provider_payment_ref,
                        status, payment_id, failure_reason, created_at, completed_at`;

/**
 * Open a new attempt, before the gateway session exists. Written first so
 * there is a row to reference in the session's metadata, and so an attempt
 * that dies mid-creation still leaves a trace.
 * @returns {Promise<object>} the created row
 */
async function create({ accountId, userId, amount, currency, paymentType }) {
  const [res] = await pool.query(
    `INSERT INTO loan_payment_intents
       (account_id, user_id, amount, currency, payment_type, provider, status)
     VALUES (?, ?, ?, ?, ?, 'stripe', 'created')`,
    [accountId, userId, amount, currency, paymentType]
  );
  const [rows] = await pool.query(
    `SELECT ${INTENT_COLUMNS} FROM loan_payment_intents WHERE id = ?`,
    [res.insertId]
  );
  return rows[0];
}

/** Attach the gateway's session id once it has been created. */
async function attachSession(intentId, sessionId) {
  await pool.query(
    `UPDATE loan_payment_intents SET provider_session_id = ? WHERE id = ?`,
    [sessionId, intentId]
  );
}

/** @returns {Promise<object|null>} */
async function findBySessionId(sessionId) {
  const [rows] = await pool.query(
    `SELECT ${INTENT_COLUMNS} FROM loan_payment_intents WHERE provider_session_id = ?`,
    [sessionId]
  );
  return rows[0] || null;
}

/** @returns {Promise<object|null>} */
async function findById(intentId) {
  const [rows] = await pool.query(
    `SELECT ${INTENT_COLUMNS} FROM loan_payment_intents WHERE id = ?`,
    [intentId]
  );
  return rows[0] || null;
}

/**
 * Mark an attempt as not-succeeded. Only ever moves a 'created' row, so it can
 * never undo a settled payment — a late 'expired' event arriving after a
 * successful reconcile must not rewrite history.
 * @param {string} sessionId
 * @param {'failed'|'expired'|'cancelled'} status
 * @param {string} [reason]
 */
async function markUnsuccessful(sessionId, status, reason) {
  await pool.query(
    `UPDATE loan_payment_intents
        SET status = ?, failure_reason = ?, completed_at = CURRENT_TIMESTAMP
      WHERE provider_session_id = ? AND status = 'created'`,
    [status, reason ? String(reason).slice(0, 255) : null, sessionId]
  );
}

/**
 * Fail an attempt by its own id, for when the gateway refused to create the
 * session at all — there is no session id to key on yet, and leaving the row
 * 'created' would make an attempt that never reached the gateway look payable.
 * @param {number} intentId
 * @param {string} [reason]
 */
async function markFailedById(intentId, reason) {
  await pool.query(
    `UPDATE loan_payment_intents
        SET status = 'failed', failure_reason = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'created'`,
    [reason ? String(reason).slice(0, 255) : null, intentId]
  );
}

/**
 * Post a confirmed gateway payment to the ledger, exactly once.
 *
 * Runs inside a transaction the CALLER owns, so the intent's status flip and
 * the loan_payments insert commit or roll back together (see module header).
 *
 * Callers, both of which reach the same gate:
 *   - the Stripe webhook (the authority)
 *   - the return-page reconcile, for when the webhook is slow or was never
 *     configured at all
 *
 * `paidOn` is the value date. It comes from the gateway's own clock rather
 * than ours where available, for the same reason recordPayment lets staff
 * backdate: arrears must be judged on when the money actually moved.
 *
 * @param {object} conn open transaction connection
 * @param {object} p
 * @param {string} p.sessionId
 * @param {string} [p.providerPaymentRef]
 * @param {string} [p.paidOn] YYYY-MM-DD, defaults to today
 * @returns {Promise<{notFound:true}
 *   |{alreadySettled:true, intent:object}
 *   |{rejected:true, reason:string, detail:object, intent:object}
 *   |{settled:true, intent:object, payment:object}>}
 */
async function settleWithin(conn, { sessionId, providerPaymentRef, paidOn }) {
  const [rows] = await conn.query(
    `SELECT ${INTENT_COLUMNS} FROM loan_payment_intents
      WHERE provider_session_id = ? FOR UPDATE`,
    [sessionId]
  );
  const intent = rows[0];
  if (!intent) return { notFound: true };

  // THE GATE. A retried webhook, a refreshed return page, or the two racing
  // each other all land here and stop.
  if (intent.status !== "created") {
    return { alreadySettled: true, intent };
  }

  const payment = await loanModel.recordPaymentWithin(conn, {
    accountId: intent.account_id,
    amount: Number(intent.amount),
    paidOn: paidOn || new Date().toISOString().slice(0, 10),
    method: "card",
    paymentType: intent.payment_type,
    externalRef: providerPaymentRef || sessionId,
    note: "Paid online by card",
    // No staff member keyed this in — see recordPaymentWithin's comment on
    // the recorded_by column.
    recordedBy: null,
  });

  // recordPaymentWithin reports refusals as values. Any of them means real
  // money was taken for a payment the ledger will not accept — the loan was
  // paid off or settled by another route between checkout and confirmation.
  // Record WHY against the intent and let the caller decide; the caller must
  // NOT roll back, or the explanation is lost along with the problem.
  const rejection =
    (payment.notFound && "ACCOUNT_NOT_FOUND") ||
    (payment.inactive && `ACCOUNT_${String(payment.status).toUpperCase()}`) ||
    (payment.overpayment && "OVERPAYMENT") ||
    (payment.settlementMismatch && "SETTLEMENT_MISMATCH") ||
    null;

  if (rejection) {
    await conn.query(
      `UPDATE loan_payment_intents
          SET status = 'failed', failure_reason = ?, provider_payment_ref = ?,
              completed_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        `Gateway payment could not be posted: ${rejection}`,
        providerPaymentRef || null,
        intent.id,
      ]
    );
    return { rejected: true, reason: rejection, detail: payment, intent };
  }

  await conn.query(
    `UPDATE loan_payment_intents
        SET status = 'succeeded', payment_id = ?, provider_payment_ref = ?,
            completed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [payment.paymentId, providerPaymentRef || null, intent.id]
  );

  return { settled: true, intent, payment };
}

/**
 * settleWithin in its own transaction, for callers that have no transaction of
 * their own (the webhook handler and the reconcile endpoint both use this).
 * @param {object} p see settleWithin
 */
async function settle(p) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await settleWithin(conn, p);
    // A rejection is committed deliberately, not rolled back: the intent's
    // 'failed' status and its reason are the record of what happened, and
    // discarding them would leave a charged customer with no trace at all.
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  create,
  attachSession,
  findById,
  findBySessionId,
  markUnsuccessful,
  markFailedById,
  settleWithin,
  settle,
};

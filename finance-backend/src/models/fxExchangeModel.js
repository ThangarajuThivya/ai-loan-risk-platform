"use strict";

/**
 * FX exchange-request data-access layer (Phase 10, CURRENCY_FEATURE.md §12).
 * SQL for fx_exchange_requests / fx_request_events / fx_limits
 * (db/migrations/008_fx_exchange_requests.sql), mirroring loanModel.js's
 * shape (transaction-per-write-with-row-lock, same as
 * updateApplicationStatus) since this feature deliberately follows the loan
 * application flow's pattern.
 */

const db = require("../config/db");
const pool = db.promise();

// settlement_date is a plain DATE column — SELECTed via DATE_FORMAT, not
// bare, for the same reason findRateHistory in currencyModel.js does: mysql2
// returns DATE as a JS Date at local midnight with no `dateStrings` option
// on the shared pool, and JSON.stringify-ing that renders it in UTC, which
// on an IST host shifts the calendar date back a day (CURRENCY_FEATURE.md
// §9.4 documents the same bug found and fixed there).
const REQUEST_COLUMNS = `
  id, reference_no, user_id, direction, currency_code, foreign_amount,
  quoted_rate, quoted_lkr_amount, spread_bps_applied, rate_source,
  quote_locked_at, quote_expires_at, purpose_code, requires_documents, branch,
  DATE_FORMAT(settlement_date, '%Y-%m-%d') AS settlement_date,
  status, reviewed_by, review_note, created_at, updated_at,
  (SELECT COUNT(*) FROM fx_request_documents d WHERE d.request_id = fx_exchange_requests.id)
    AS document_count
`;

/**
 * Create a submitted exchange request (status 'pending_review') and its
 * initial audit event, as one transaction. reference_no is NULL through the
 * INSERT and set to FX-<zero-padded id> immediately after, inside the same
 * transaction, so it's never visible as NULL to another connection.
 *
 * Throws a raw mysql2 error (ER_DUP_ENTRY on quote_jti) if this quote token
 * has already been redeemed — the controller handles that by looking the
 * existing row up via findByQuoteJti, making submission idempotent.
 *
 * @param {object} p
 * @returns {Promise<object>} the created row (see REQUEST_COLUMNS)
 */
async function createRequest(p) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO fx_exchange_requests
         (user_id, direction, currency_code, foreign_amount, quoted_rate,
          quoted_lkr_amount, spread_bps_applied, rate_source,
          quote_locked_at, quote_expires_at, quote_jti, purpose_code,
          requires_documents, branch, settlement_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
      [
        p.userId,
        p.direction,
        p.currencyCode,
        p.foreignAmount,
        p.quotedRate,
        p.quotedLkrAmount,
        p.spreadBpsApplied,
        p.rateSource,
        p.quoteLockedAt,
        p.quoteExpiresAt,
        p.quoteJti,
        p.purposeCode,
        p.requiresDocuments ? 1 : 0,
        p.branch,
        p.settlementDate,
      ]
    );
    const id = result.insertId;
    const referenceNo = `FX-${String(id).padStart(6, "0")}`;

    await conn.query(`UPDATE fx_exchange_requests SET reference_no = ? WHERE id = ?`, [
      referenceNo,
      id,
    ]);
    await conn.query(
      `INSERT INTO fx_request_events (request_id, from_status, to_status, actor_user_id, note)
       VALUES (?, NULL, 'pending_review', ?, 'Submitted by customer.')`,
      [id, p.userId]
    );

    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** @returns {Promise<object|undefined>} */
async function findById(id) {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS} FROM fx_exchange_requests WHERE id = ?`,
    [id]
  );
  return rows[0];
}

/** @returns {Promise<object|undefined>} */
async function findByReferenceNo(referenceNo) {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS} FROM fx_exchange_requests WHERE reference_no = ?`,
    [referenceNo]
  );
  return rows[0];
}

/**
 * Look up a request by its quote token's jti — used to make POST /requests
 * idempotent: a duplicate submission of the same quote collides on the
 * quote_jti unique key, and the caller re-fetches via this instead of
 * erroring.
 * @returns {Promise<object|undefined>}
 */
async function findByQuoteJti(quoteJti) {
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS} FROM fx_exchange_requests WHERE quote_jti = ?`,
    [quoteJti]
  );
  return rows[0];
}

/**
 * A customer's own requests, newest first, optionally filtered.
 * @param {number} userId
 * @param {object} [opts]
 * @param {string} [opts.status]
 * @param {string} [opts.currency]
 * @param {number} [opts.limit] default 50
 * @param {number} [opts.offset] default 0
 */
async function findMineByUser(userId, { status, currency, limit = 50, offset = 0 } = {}) {
  const params = [userId];
  let where = "user_id = ?";
  if (status) {
    where += " AND status = ?";
    params.push(status);
  }
  if (currency) {
    where += " AND currency_code = ?";
    params.push(currency);
  }
  params.push(limit, offset);
  const [rows] = await pool.query(
    `SELECT ${REQUEST_COLUMNS} FROM fx_exchange_requests
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    params
  );
  return rows;
}

/**
 * The staff/admin review queue. Defaults to 'pending_review' only (the
 * actual queue of things awaiting action); pass status: 'all' to see every
 * request regardless of status.
 * @param {object} [opts]
 * @param {string} [opts.status] a real status, or 'all'
 * @param {string} [opts.currency]
 * @param {number} [opts.limit] default 100
 * @param {number} [opts.offset] default 0
 */
async function findQueue({ status = "pending_review", currency, limit = 100, offset = 0 } = {}) {
  const params = [];
  let where = "1 = 1";
  if (status && status !== "all") {
    where += " AND r.status = ?";
    params.push(status);
  }
  if (currency) {
    where += " AND r.currency_code = ?";
    params.push(currency);
  }
  params.push(limit, offset);
  const [rows] = await pool.query(
    `SELECT r.id, r.reference_no, r.user_id, r.direction, r.currency_code,
            r.foreign_amount, r.quoted_rate, r.quoted_lkr_amount,
            r.spread_bps_applied, r.rate_source, r.quote_locked_at,
            r.quote_expires_at, r.purpose_code, r.requires_documents, r.branch,
            DATE_FORMAT(r.settlement_date, '%Y-%m-%d') AS settlement_date,
            r.status, r.reviewed_by, r.review_note, r.created_at, r.updated_at,
            u.first_name, u.last_name, u.email,
            (SELECT COUNT(*) FROM fx_request_documents d WHERE d.request_id = r.id)
              AS document_count
       FROM fx_exchange_requests r
       JOIN users u ON u.user_id = r.user_id
      WHERE ${where}
      ORDER BY r.created_at ASC
      LIMIT ? OFFSET ?`,
    params
  );
  return rows;
}

/**
 * Move a request from one of `fromStatuses` to `toStatus`, row-locked so
 * concurrent decisions can't race (same pattern as
 * loanModel.updateApplicationStatus), writing one fx_request_events row.
 * `extraFields` are additional columns to set in the same UPDATE (e.g.
 * reviewed_by/review_note, or a counter-quote's revised rate) — keys must
 * be trusted column names, never user input, since they're interpolated
 * into the SQL (values are still parameterized).
 *
 * `beforeCommit`, if given, runs INSIDE this transaction once the status
 * change and its audit event are written but before the commit, receiving
 * the same connection. It is how side effects that must be atomic with the
 * transition itself participate — the reserve-on-approve inventory gate
 * (fxInventoryModel.applyMovement) is the first such caller. Throwing from
 * it rolls the whole transition back, so a failed reservation leaves the
 * request in its original status with no audit event: the approval simply
 * did not happen. Errors propagate to the caller untouched, `err.status`
 * and all.
 *
 * @param {object} p
 * @param {number} p.id
 * @param {string[]} p.fromStatuses statuses this transition is legal from
 * @param {string} p.toStatus
 * @param {number} [p.actorUserId]
 * @param {string} [p.note]
 * @param {object} [p.extraFields] extra column:value pairs for the UPDATE
 * @param {(conn: object, current: object) => Promise<void>} [p.beforeCommit]
 *   atomic side effect; throwing rolls the transition back
 * @returns {Promise<{notFound:true}|{conflict:true,status:string}|{ok:true,userId:number,previousStatus:string}>}
 */
async function transitionStatus({
  id,
  fromStatuses,
  toStatus,
  actorUserId,
  note,
  extraFields = {},
  beforeCommit,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, user_id, status FROM fx_exchange_requests WHERE id = ? FOR UPDATE`,
      [id]
    );
    const current = rows[0];
    if (!current) {
      await conn.rollback();
      return { notFound: true };
    }
    if (!fromStatuses.includes(current.status)) {
      await conn.rollback();
      return { conflict: true, status: current.status };
    }

    const setClauses = ["status = ?"];
    const params = [toStatus];
    for (const [column, value] of Object.entries(extraFields)) {
      setClauses.push(`${column} = ?`);
      params.push(value);
    }
    params.push(id);
    await conn.query(
      `UPDATE fx_exchange_requests SET ${setClauses.join(", ")} WHERE id = ?`,
      params
    );
    await conn.query(
      `INSERT INTO fx_request_events (request_id, from_status, to_status, actor_user_id, note)
       VALUES (?, ?, ?, ?, ?)`,
      [id, current.status, toStatus, actorUserId || null, note || null]
    );

    // Runs with the request row already locked, so the inventory row is
    // always taken second — a consistent lock order for every writer that
    // touches both, which is what keeps concurrent approvals from
    // deadlocking against each other.
    if (beforeCommit) {
      await beforeCommit(conn, current);
    }

    await conn.commit();
    return { ok: true, userId: current.user_id, previousStatus: current.status };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * requests still in 'pending_review' that were created before `cutoff` —
 * the candidates the expiry sweep moves to 'expired'. See
 * fxExchange.controller.js's sweepExpiredRequests.
 * @param {Date} cutoff
 * @returns {Promise<number[]>} request ids
 */
async function findStalePendingIds(cutoff) {
  const [rows] = await pool.query(
    `SELECT id FROM fx_exchange_requests WHERE status = 'pending_review' AND created_at < ?`,
    [cutoff]
  );
  return rows.map((r) => r.id);
}

/** Audit trail for one request, oldest first. */
async function findEventsForRequest(requestId) {
  const [rows] = await pool.query(
    `SELECT id, request_id, from_status, to_status, actor_user_id, note, created_at
       FROM fx_request_events
      WHERE request_id = ?
      ORDER BY created_at ASC`,
    [requestId]
  );
  return rows;
}

/**
 * Sum of quoted_lkr_amount for a user's requests created today (server's
 * local calendar day), excluding statuses that never represent a real
 * commitment (rejected/cancelled/expired) — the daily-aggregate limit
 * check's running total.
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function sumTodaysCommittedLkr(userId) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(quoted_lkr_amount), 0) AS total
       FROM fx_exchange_requests
      WHERE user_id = ?
        AND DATE(created_at) = CURDATE()
        AND status NOT IN ('rejected', 'cancelled', 'expired')`,
    [userId]
  );
  return Number(rows[0].total);
}

/**
 * The effective limit row for a currency: a per-currency override if one
 * exists, else the 'ALL' global default (always seeded — migration 008).
 * @param {string} currencyCode
 * @returns {Promise<object>} { currency_code, max_per_transaction_lkr, max_per_customer_per_day_lkr, updated_at }
 */
async function getEffectiveLimits(currencyCode) {
  const [rows] = await pool.query(
    `SELECT * FROM fx_limits WHERE currency_code IN (?, 'ALL')
     ORDER BY (currency_code = ?) DESC
     LIMIT 1`,
    [currencyCode, currencyCode]
  );
  return rows[0];
}

/** @returns {Promise<object[]>} every configured limit row */
async function listLimits() {
  const [rows] = await pool.query(
    `SELECT * FROM fx_limits ORDER BY (currency_code = 'ALL') ASC, currency_code`
  );
  return rows;
}

/**
 * Upsert one currency's (or 'ALL''s) limit row. Missing fields fall back to
 * the existing row's value; a brand-new row requires both.
 * @param {object} p
 * @param {string} p.currencyCode
 * @param {number} [p.maxPerTransactionLkr]
 * @param {number} [p.maxPerCustomerPerDayLkr]
 * @returns {Promise<object>} the resulting row
 */
async function upsertLimit({
  currencyCode,
  maxPerTransactionLkr,
  maxPerCustomerPerDayLkr,
  documentThresholdLkr,
}) {
  const [existingRows] = await pool.query(`SELECT * FROM fx_limits WHERE currency_code = ?`, [
    currencyCode,
  ]);
  const existing = existingRows[0];
  const finalTxn = maxPerTransactionLkr ?? existing?.max_per_transaction_lkr;
  const finalDaily = maxPerCustomerPerDayLkr ?? existing?.max_per_customer_per_day_lkr;
  if (finalTxn == null || finalDaily == null) {
    const err = new Error(
      "max_per_transaction_lkr and max_per_customer_per_day_lkr are both required to create a new limit."
    );
    err.status = 400;
    throw err;
  }
  // `undefined` means "leave alone"; an explicit null means "clear the
  // requirement for this currency". Both are legitimate PATCH intents and
  // `??` alone cannot tell them apart, so the distinction is made here.
  const finalThreshold =
    documentThresholdLkr === undefined ? existing?.document_threshold_lkr ?? null : documentThresholdLkr;

  await pool.query(
    `INSERT INTO fx_limits (currency_code, max_per_transaction_lkr, max_per_customer_per_day_lkr, document_threshold_lkr)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       max_per_transaction_lkr = VALUES(max_per_transaction_lkr),
       max_per_customer_per_day_lkr = VALUES(max_per_customer_per_day_lkr),
       document_threshold_lkr = VALUES(document_threshold_lkr)`,
    [currencyCode, finalTxn, finalDaily, finalThreshold]
  );
  const [rows] = await pool.query(`SELECT * FROM fx_limits WHERE currency_code = ?`, [
    currencyCode,
  ]);
  return rows[0];
}

/**
 * Raw counts/sums grouped by currency/direction/status — the admin position
 * view's source data; net-exposure computation happens in the controller
 * (which statuses count as "committed" is a display/business decision, not
 * a data-access one).
 * @returns {Promise<object[]>}
 */
async function getPositionBreakdown() {
  const [rows] = await pool.query(
    `SELECT currency_code, direction, status,
            COUNT(*) AS count,
            SUM(foreign_amount) AS total_foreign_amount,
            SUM(quoted_lkr_amount) AS total_lkr_amount
       FROM fx_exchange_requests
      GROUP BY currency_code, direction, status
      ORDER BY currency_code, direction, status`
  );
  return rows;
}

/**
 * Raw request rows for the admin reports view (Phase 31), filtered by
 * submission date and optionally currency. Every aggregation (status-rate
 * math, volume, spread revenue) and the CSV export are computed from this
 * same row set in the controller — one query, one source of truth, so the
 * on-screen numbers and the exported file can never disagree.
 * @param {object} p
 * @param {string} [p.from] YYYY-MM-DD, inclusive
 * @param {string} [p.to] YYYY-MM-DD, inclusive
 * @param {string} [p.currencyCode]
 * @returns {Promise<object[]>}
 */
async function getReportRows({ from, to, currencyCode } = {}) {
  const params = [];
  let where = "1 = 1";
  if (from) {
    where += " AND DATE(created_at) >= ?";
    params.push(from);
  }
  if (to) {
    where += " AND DATE(created_at) <= ?";
    params.push(to);
  }
  if (currencyCode) {
    where += " AND currency_code = ?";
    params.push(currencyCode);
  }
  const [rows] = await pool.query(
    `SELECT reference_no, direction, currency_code, foreign_amount, quoted_rate,
            quoted_lkr_amount, spread_bps_applied, purpose_code, requires_documents, branch,
            DATE_FORMAT(settlement_date, '%Y-%m-%d') AS settlement_date, status,
            created_at, updated_at
       FROM fx_exchange_requests
      WHERE ${where}
      ORDER BY created_at ASC`,
    params
  );
  return rows;
}

// --- compliance documents ----------------------------------------------
//
// storage_path is deliberately absent from DOCUMENT_COLUMNS: it is a
// server-side filesystem path and no client has any use for it. The
// download route reads it via findDocumentById, which selects it
// explicitly.
const DOCUMENT_COLUMNS = `id, request_id, uploaded_by, original_name, mime_type, size_bytes, created_at`;

/**
 * Record an uploaded supporting document against a request.
 * @param {object} p
 * @param {number} p.requestId
 * @param {number} p.uploadedBy
 * @param {string} p.originalName the customer's filename, for display only
 * @param {string} p.storagePath server-side path under secure-uploads/
 * @param {string} p.mimeType
 * @param {number} p.sizeBytes
 * @returns {Promise<object>} the created row (without storage_path)
 */
async function createDocument({ requestId, uploadedBy, originalName, storagePath, mimeType, sizeBytes }) {
  const [result] = await pool.query(
    `INSERT INTO fx_request_documents
       (request_id, uploaded_by, original_name, storage_path, mime_type, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [requestId, uploadedBy, originalName, storagePath, mimeType, sizeBytes]
  );
  const [rows] = await pool.query(
    `SELECT ${DOCUMENT_COLUMNS} FROM fx_request_documents WHERE id = ?`,
    [result.insertId]
  );
  return rows[0];
}

/** @returns {Promise<object[]>} a request's documents, oldest first */
async function findDocumentsForRequest(requestId) {
  const [rows] = await pool.query(
    `SELECT ${DOCUMENT_COLUMNS} FROM fx_request_documents WHERE request_id = ? ORDER BY created_at ASC, id ASC`,
    [requestId]
  );
  return rows;
}

/**
 * One document INCLUDING storage_path — for the download route only.
 * @returns {Promise<object|undefined>}
 */
async function findDocumentById(id) {
  const [rows] = await pool.query(
    `SELECT ${DOCUMENT_COLUMNS}, storage_path FROM fx_request_documents WHERE id = ?`,
    [id]
  );
  return rows[0];
}

/** @returns {Promise<boolean>} true if a row was actually removed */
async function deleteDocument(id) {
  const [result] = await pool.query(`DELETE FROM fx_request_documents WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

module.exports = {
  createRequest,
  findById,
  findByReferenceNo,
  findByQuoteJti,
  findMineByUser,
  findQueue,
  transitionStatus,
  findStalePendingIds,
  findEventsForRequest,
  sumTodaysCommittedLkr,
  getEffectiveLimits,
  listLimits,
  upsertLimit,
  getPositionBreakdown,
  getReportRows,
  createDocument,
  findDocumentsForRequest,
  findDocumentById,
  deleteDocument,
};

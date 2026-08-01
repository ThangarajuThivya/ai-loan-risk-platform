"use strict";

/**
 * Contact/support messaging data-access layer. SQL for contact_messages /
 * contact_message_replies (db/migrations/010_contact_messages.sql),
 * mirroring fxExchangeModel.js's shape (transaction-per-write with a row
 * lock for the reply/status-transition writes).
 */

const db = require("../config/db");
const pool = db.promise();

const THREAD_COLUMNS = `
  cm.id, cm.customer_id, cm.subject, cm.status,
  cm.last_message_at, cm.created_at, cm.updated_at
`;

/**
 * Create a new thread and its opening message, as one transaction.
 * @param {object} p
 * @param {number} p.customerId
 * @param {string} p.subject
 * @param {string} p.body
 * @returns {Promise<object>} the created thread (see findThreadById)
 */
async function createThread({ customerId, subject, body }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO contact_messages (customer_id, subject, status) VALUES (?, ?, 'open')`,
      [customerId, subject]
    );
    const threadId = result.insertId;

    await conn.query(
      `INSERT INTO contact_message_replies (thread_id, sender_id, sender_role, body)
       VALUES (?, ?, 'customer', ?)`,
      [threadId, customerId, body]
    );

    await conn.commit();
    return findThreadById(threadId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** @returns {Promise<object|undefined>} thread joined with the customer's name/email */
async function findThreadById(id) {
  const [rows] = await pool.query(
    `SELECT ${THREAD_COLUMNS}, u.first_name, u.last_name, u.email
       FROM contact_messages cm
       JOIN users u ON u.user_id = cm.customer_id
      WHERE cm.id = ?`,
    [id]
  );
  return rows[0];
}

/**
 * Full reply history for a thread, oldest first. LEFT JOIN so a reply from
 * a since-deleted account still renders (sender_role is captured at send
 * time on the reply row itself).
 * @param {number} threadId
 */
async function findRepliesByThreadId(threadId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.thread_id, r.sender_id, r.sender_role, r.body, r.created_at,
            u.first_name, u.last_name
       FROM contact_message_replies r
       LEFT JOIN users u ON u.user_id = r.sender_id
      WHERE r.thread_id = ?
      ORDER BY r.created_at ASC`,
    [threadId]
  );
  return rows;
}

/**
 * A customer's own threads, most recently active first.
 * @param {number} customerId
 * @param {object} [opts]
 * @param {string} [opts.status]
 * @param {number} [opts.limit] default 50
 * @param {number} [opts.offset] default 0
 */
async function findThreadsByCustomerId(customerId, { status, limit = 50, offset = 0 } = {}) {
  const params = [customerId];
  let where = "cm.customer_id = ?";
  if (status) {
    where += " AND cm.status = ?";
    params.push(status);
  }
  params.push(limit, offset);
  const [rows] = await pool.query(
    `SELECT ${THREAD_COLUMNS}
       FROM contact_messages cm
      WHERE ${where}
      ORDER BY cm.last_message_at DESC
      LIMIT ? OFFSET ?`,
    params
  );
  return rows;
}

/**
 * The staff/admin shared inbox — every customer's threads, most recently
 * active first, optionally filtered by status and/or a text search across
 * subject/customer name/email.
 * @param {object} [opts]
 * @param {string} [opts.status] a real status, or 'all'/absent for every status
 * @param {string} [opts.q]
 * @param {number} [opts.limit] default 50
 * @param {number} [opts.offset] default 0
 */
async function findAllThreads({ status, q, limit = 50, offset = 0 } = {}) {
  const params = [];
  let where = "1 = 1";
  if (status && status !== "all") {
    where += " AND cm.status = ?";
    params.push(status);
  }
  if (q) {
    where += " AND (cm.subject LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  params.push(limit, offset);
  const [rows] = await pool.query(
    `SELECT ${THREAD_COLUMNS}, u.first_name, u.last_name, u.email
       FROM contact_messages cm
       JOIN users u ON u.user_id = cm.customer_id
      WHERE ${where}
      ORDER BY cm.last_message_at DESC
      LIMIT ? OFFSET ?`,
    params
  );
  return rows;
}

/** @returns {Promise<number>} threads not yet resolved (open or in_progress) */
async function countOpenThreads() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM contact_messages WHERE status IN ('open','in_progress')`
  );
  return Number(rows[0].count);
}

/**
 * Append a reply and advance the thread's status per the reopen rules:
 *   - customer reply: always settles to 'open' (reopens in_progress/resolved)
 *   - staff/admin reply: 'open' -> 'in_progress'; 'resolved' stays 'resolved'
 *     (an already in_progress thread just stays in_progress)
 * Row-locked so two concurrent replies can't race past each other.
 * @param {object} p
 * @param {number} p.threadId
 * @param {number} p.senderId
 * @param {'customer'|'staff'|'admin'} p.senderRole
 * @param {string} p.body
 * @returns {Promise<{notFound:true}|{ok:true,customerId:number,previousStatus:string,newStatus:string}>}
 */
async function addReply({ threadId, senderId, senderRole, body }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, customer_id, status FROM contact_messages WHERE id = ? FOR UPDATE`,
      [threadId]
    );
    const current = rows[0];
    if (!current) {
      await conn.rollback();
      return { notFound: true };
    }

    const newStatus =
      senderRole === "customer" ? "open" : current.status === "resolved" ? "resolved" : "in_progress";

    await conn.query(
      `INSERT INTO contact_message_replies (thread_id, sender_id, sender_role, body) VALUES (?, ?, ?, ?)`,
      [threadId, senderId, senderRole, body]
    );
    await conn.query(
      `UPDATE contact_messages SET status = ?, last_message_at = NOW() WHERE id = ?`,
      [newStatus, threadId]
    );

    await conn.commit();
    return {
      ok: true,
      customerId: current.customer_id,
      previousStatus: current.status,
      newStatus,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Direct staff/admin status change (no reply attached).
 * @param {object} p
 * @param {number} p.threadId
 * @param {'open'|'in_progress'|'resolved'} p.status
 * @returns {Promise<{notFound:true}|{ok:true,customerId:number}>}
 */
async function updateStatus({ threadId, status }) {
  const existing = await findThreadById(threadId);
  if (!existing) {
    return { notFound: true };
  }
  await pool.query(`UPDATE contact_messages SET status = ? WHERE id = ?`, [status, threadId]);
  return { ok: true, customerId: existing.customer_id };
}

module.exports = {
  createThread,
  findThreadById,
  findRepliesByThreadId,
  findThreadsByCustomerId,
  findAllThreads,
  countOpenThreads,
  addReply,
  updateStatus,
};

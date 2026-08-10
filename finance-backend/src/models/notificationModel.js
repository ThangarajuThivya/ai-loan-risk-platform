"use strict";

/**
 * Notification writer and reader, shared by any feature that needs to tell
 * a user something — from request handlers and from background sweeps
 * alike (fxExpirySweep, lateFeeSweep, leaseReminderSweep).
 *
 * loan.controller.js's own flow still inserts directly inside loanModel's
 * transaction rather than calling this; that is left untouched.
 *
 * THE DEDUPE KEY IS THE POINT OF THIS MODULE. A reminder is true for as
 * long as the condition holds — "rental #4 is due in 3 days" stays true for
 * three days — so a sweep on a 6-hour timer would send it a dozen times.
 * `create` therefore treats a UNIQUE violation on `dedupe_key` as SUCCESS,
 * not an error: the notice already exists, which is exactly the desired end
 * state. That makes every reminder safely re-runnable, and it means a sweep
 * can be as dumb as "re-evaluate everything, try to send everything" without
 * anyone having to remember what was already sent.
 *
 * Notifications are BEST EFFORT and must never break the thing they are
 * about. A failed insert is logged and swallowed by `safeCreate` — a lessee
 * whose payment succeeded must not see it fail because a notification row
 * could not be written.
 */

const db = require("../config/db");
const pool = db.promise();

/** Newest-first page size cap. See findForUser. */
const MAX_PAGE_SIZE = 100;

/**
 * Write one notification.
 *
 * @param {object} p
 * @param {number} p.userId
 * @param {string} p.title
 * @param {string} p.message
 * @param {string} [p.category]      'lease' | 'loan' | 'fx' | 'system'
 * @param {string} [p.eventType]     machine-readable, e.g. 'lease_rental_due'
 * @param {string} [p.link]          in-app path, e.g. '/dashboard/leases/12'
 * @param {string} [p.referenceType] e.g. 'lease_application'
 * @param {number} [p.referenceId]
 * @param {string} [p.dedupeKey]     set ONLY for notices that must not repeat
 * @returns {Promise<{created:boolean, id:number|null}>} created:false means
 *          an identical notice already existed — a success, not a failure
 */
async function create({
  userId,
  title,
  message,
  category = null,
  eventType = null,
  link = null,
  referenceType = null,
  referenceId = null,
  dedupeKey = null,
}) {
  try {
    const [res] = await pool.query(
      `INSERT INTO notifications
         (user_id, category, event_type, title, message, link,
          reference_type, reference_id, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        category,
        eventType,
        title,
        message,
        link,
        referenceType,
        referenceId ?? null,
        dedupeKey,
      ]
    );
    return { created: true, id: res.insertId };
  } catch (err) {
    // The dedupe key doing its job. Reported as "already there" rather than
    // thrown, so a sweep does not have to distinguish "I just sent this"
    // from "this was sent yesterday" — both mean the lessee has been told.
    if (err.code === "ER_DUP_ENTRY") return { created: false, id: null };
    throw err;
  }
}

/**
 * Create and never throw. For call sites where the notification is a side
 * effect of something more important that has already succeeded.
 * @returns {Promise<{created:boolean, id:number|null}>}
 */
async function safeCreate(payload) {
  try {
    return await create(payload);
  } catch (err) {
    console.error("[notifications] create failed:", err.message);
    return { created: false, id: null };
  }
}

/**
 * Send the same notification to every active admin and staff member.
 *
 * Used for the events an institution — not an individual — needs to react
 * to: a new application arriving, a lessee accepting terms, a lease falling
 * into arrears. There is no per-officer assignment in this system, so
 * "someone should look at this" genuinely means everyone who could.
 *
 * The dedupe key is namespaced per recipient inside the loop, so one
 * officer already having been told does not suppress the others.
 *
 * @param {object} payload same as create(), minus userId
 * @param {string[]} [roles]
 * @returns {Promise<number>} how many were newly created
 */
async function createForRoles(payload, roles = ["admin", "staff"]) {
  const placeholders = roles.map(() => "?").join(", ");
  const [recipients] = await pool.query(
    `SELECT user_id FROM users WHERE role IN (${placeholders}) AND status = 'active'`,
    roles
  );

  let created = 0;
  for (const { user_id: userId } of recipients) {
    const res = await safeCreate({
      ...payload,
      userId,
      dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:u=${userId}` : null,
    });
    if (res.created) created += 1;
  }
  return created;
}

/**
 * A page of a user's notifications, newest first.
 *
 * BOUNDED, unlike the `SELECT *` this replaces. That query returned every
 * notification a user had ever received — already 4,000+ rows on this
 * database before leasing added any — and every dashboard load paid for all
 * of them. A reminder sweep only makes that worse over time.
 *
 * @param {number} userId
 * @param {object} [opts]
 * @param {number} [opts.limit=30]
 * @param {number} [opts.offset=0]
 * @param {string} [opts.category] restrict to one category
 * @param {boolean} [opts.unreadOnly]
 */
async function findForUser(userId, { limit = 30, offset = 0, category, unreadOnly } = {}) {
  const size = Math.min(Math.max(Number(limit) || 30, 1), MAX_PAGE_SIZE);
  const skip = Math.max(Number(offset) || 0, 0);

  const where = ["user_id = ?"];
  const params = [userId];
  if (category) {
    where.push("category = ?");
    params.push(category);
  }
  if (unreadOnly) where.push("is_read = 0");

  const [rows] = await pool.query(
    `SELECT id, category, event_type, title, message, link,
            reference_type, reference_id, is_read, created_at
       FROM notifications
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...params, size, skip]
  );
  return rows;
}

/**
 * Unread totals — overall and per category, in one round trip.
 *
 * Per-category because the portal badges leasing separately from lending:
 * a lessee with eleven unread FX notices should not see their lease tab
 * flagged.
 */
async function countUnread(userId) {
  const [rows] = await pool.query(
    `SELECT COALESCE(category, 'general') AS category, COUNT(*) AS n
       FROM notifications
      WHERE user_id = ? AND is_read = 0
      GROUP BY COALESCE(category, 'general')`,
    [userId]
  );
  const byCategory = {};
  let total = 0;
  for (const row of rows) {
    byCategory[row.category] = Number(row.n);
    total += Number(row.n);
  }
  return { total, byCategory };
}

/**
 * Mark every one of a user's own notifications as read (K4). Scoped to
 * `user_id = ?` so a caller can only ever mark their own, regardless of
 * what a client sends.
 *
 * `category` narrows it to one product line — reading your leasing notices
 * should not silently clear unrelated FX ones you have not looked at.
 *
 * @param {number} userId
 * @param {string} [category]
 */
async function markAllRead(userId, category) {
  const params = [userId];
  let sql = `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`;
  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }
  const [res] = await pool.query(sql, params);
  return res.affectedRows;
}

/**
 * Mark ONE notification read — for the click-through path, where opening
 * the lease a notice points at should clear that notice and nothing else.
 * Scoped by user_id so an id from another account cannot be touched.
 */
async function markRead(userId, notificationId) {
  const [res] = await pool.query(
    `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
    [notificationId, userId]
  );
  return res.affectedRows > 0;
}

module.exports = {
  MAX_PAGE_SIZE,
  create,
  safeCreate,
  createForRoles,
  findForUser,
  countUnread,
  markAllRead,
  markRead,
};

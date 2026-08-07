"use strict";

/**
 * Data access for user_consents (migration 042). Append-only — there is no
 * update/delete here, only recordConsent (INSERT) and reads. See the
 * migration header for why this is an audit log, not a mutable settings row.
 */

const db = require("../config/db");

const pool = db.promise();

/**
 * The latest grant per consent_type for a user, as a Map keyed by
 * consent_type. Types the user has never consented to are simply absent
 * from the map (not present as null), matching consent.service.js's
 * findMissingConsents, which treats absence and staleness the same way.
 * @param {number} userId
 * @returns {Promise<Map<string, object>>}
 */
async function getLatestConsentsByUser(userId) {
  const [rows] = await pool.query(
    `SELECT uc.id, uc.user_id, uc.consent_type, uc.policy_version, uc.granted,
            uc.ip_address, uc.user_agent, uc.created_at
       FROM user_consents uc
       INNER JOIN (
         SELECT consent_type, MAX(id) AS max_id
           FROM user_consents
          WHERE user_id = ?
          GROUP BY consent_type
       ) latest ON latest.consent_type = uc.consent_type AND latest.max_id = uc.id`,
    [userId]
  );
  return new Map(rows.map((row) => [row.consent_type, row]));
}

/**
 * Appends one consent grant. Never updates an existing row — the previous
 * grant (if any) remains in place as history.
 */
async function recordConsent({
  userId,
  consentType,
  policyVersion,
  ipAddress,
  userAgent,
}) {
  const [result] = await pool.query(
    `INSERT INTO user_consents
       (user_id, consent_type, policy_version, granted, ip_address, user_agent)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [userId, consentType, policyVersion, ipAddress || null, userAgent || null]
  );
  return result.insertId;
}

/**
 * Full history for a user, newest first — the auditable trail an examiner
 * or a support agent would actually want to see, not just the current state.
 */
async function getConsentHistory(userId) {
  const [rows] = await pool.query(
    `SELECT id, user_id, consent_type, policy_version, granted,
            ip_address, user_agent, created_at
       FROM user_consents
      WHERE user_id = ?
      ORDER BY id DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  getLatestConsentsByUser,
  recordConsent,
  getConsentHistory,
};

"use strict";

/**
 * Minimal notification writer, shared by any feature that needs to notify a
 * user outside of a request/response cycle (e.g. fxExpirySweep.service.js's
 * background sweep) as well as request-handling code. loan.controller.js's
 * flow inserts directly via loanModel's own transaction instead of this —
 * left untouched, this is purely additive for the FX exchange feature.
 */

const db = require("../config/db");
const pool = db.promise();

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {string} p.title
 * @param {string} p.message
 */
async function create({ userId, title, message }) {
  await pool.query(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`, [
    userId,
    title,
    message,
  ]);
}

module.exports = { create };

"use strict";

/**
 * Data access for bank_accounts (migration 039) — the customer's account AT
 * THIS BANK, and the destination every loan disbursement resolves to.
 *
 * The one function that matters is findOrOpenWithin. Everything the product
 * needs from this table is "give me this customer's account, opening one if
 * they haven't got one", and expressing that as a single idempotent call is
 * what removes the dead end the superseded 038 design created: there is no
 * caller-visible "no account" branch to forget to handle, because there is no
 * such outcome.
 *
 * Uses the same db.promise() pool as loanModel.js. Functions ending in
 * `Within` take an open transaction connection and must not commit.
 */

const db = require("../config/db");
const {
  DEFAULT_BRANCH,
  formatAccountNumber,
} = require("../services/bankAccount.service");

const pool = db.promise();

const ACCOUNT_COLUMNS = `id, user_id, account_number, branch, account_holder,
                         account_type, status, opened_via, opened_by, opened_at`;

/**
 * The customer's usable account, or null. "Usable" means status='active';
 * a closed account is history, not a disbursement destination.
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function findActiveByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM bank_accounts
      WHERE user_id = ? AND status = 'active'
      ORDER BY id ASC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Every account on file for a customer, newest first — closed ones included,
 * since the customer-facing "Your accounts with us" panel and the staff view
 * both want the full picture, not just the live one.
 * @param {number} userId
 * @returns {Promise<object[]>}
 */
async function listByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM bank_accounts
      WHERE user_id = ?
      ORDER BY status = 'closed' ASC, id DESC`,
    [userId]
  );
  return rows;
}

/**
 * Resolve the customer's disbursement account inside an existing transaction,
 * opening one if they have none. Returns the account either way — the two
 * situations this feature exists to cover collapse into one call site:
 *
 *   already has an account here -> that row is returned, nothing is created
 *   has no account              -> one is opened and returned
 *
 * CONCURRENCY: the customer_profiles row is locked FIRST. `SELECT ... FOR
 * UPDATE` against bank_accounts would lock nothing when the customer has no
 * account yet (there is no row to lock), so two simultaneous acceptances by
 * the same customer would both see "none" and both insert. Locking a row that
 * already exists serializes them, and the loser then finds the account the
 * winner opened.
 *
 * It must NOT be the users row, even though that is the obvious candidate.
 * loan_applications has a foreign key to users, so the caller's own
 * `UPDATE loan_applications SET status=...` has already taken an implicit
 * SHARED lock on that same users row. Asking for an exclusive lock on top of
 * it makes two concurrent acceptances by one customer each hold S and each
 * wait for X — a textbook lock-upgrade deadlock, and an observed one: it threw
 * ER_LOCK_DEADLOCK on every run before this was changed. Nothing in the
 * acceptance path FKs to or writes customer_profiles, so locking there is a
 * plain X-vs-X wait instead: one proceeds, the other queues.
 *
 * A customer with no customer_profiles row locks nothing and could in theory
 * still race. Registration always creates that row, and the worst outcome is a
 * duplicate account rather than an error or a lost disbursement, so this is
 * deliberately not defended further.
 *
 * The account number is issued in a second statement, after the INSERT, because
 * it is derived from the row's own auto-increment id (see
 * bankAccount.service.formatAccountNumber). Same two-step pattern as
 * loan_accounts.account_no. Both statements are on `conn`, so an outside
 * observer never sees the NULL.
 *
 * @param {object} conn open transaction connection
 * @param {object} p
 * @param {number} p.userId
 * @param {'auto_offer_acceptance'|'staff_registered'} p.openedVia
 * @param {number|null} [p.openedBy] staff user_id, for the staff path
 * @param {string} [p.branch] defaults to the bank's configured main branch
 * @returns {Promise<{account:object, opened:boolean}>} `opened` distinguishes
 *   "we just issued this" from "they already had it", which the caller needs
 *   in order to word the customer's notification honestly.
 */
async function findOrOpenWithin(conn, { userId, openedVia, openedBy = null, branch }) {
  await conn.query(`SELECT user_id FROM customer_profiles WHERE user_id = ? FOR UPDATE`, [
    userId,
  ]);

  const [existing] = await conn.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM bank_accounts
      WHERE user_id = ? AND status = 'active'
      ORDER BY id ASC LIMIT 1`,
    [userId]
  );
  if (existing[0]) {
    return { account: existing[0], opened: false };
  }

  // Holder name comes from the registered identity, which always exists.
  // Deliberately NOT gated on kyc_status='verified': migration 035's own
  // header states KYC is advisory and nothing in the status machine reads it,
  // so gating here would recreate exactly the dead end this feature removes.
  const [users] = await conn.query(
    `SELECT first_name, last_name FROM users WHERE user_id = ?`,
    [userId]
  );
  if (!users[0]) throw new Error("USER_NOT_FOUND");
  const accountHolder = `${users[0].first_name || ""} ${users[0].last_name || ""}`.trim();

  const branchName = branch || DEFAULT_BRANCH;
  const [res] = await conn.query(
    `INSERT INTO bank_accounts
       (user_id, branch, account_holder, account_type, status, opened_via, opened_by)
     VALUES (?, ?, ?, 'loan_disbursement', 'active', ?, ?)`,
    [userId, branchName, accountHolder, openedVia, openedBy]
  );

  const accountNumber = formatAccountNumber(branchName, res.insertId);
  await conn.query(`UPDATE bank_accounts SET account_number = ? WHERE id = ?`, [
    accountNumber,
    res.insertId,
  ]);

  const [opened] = await conn.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM bank_accounts WHERE id = ?`,
    [res.insertId]
  );
  return { account: opened[0], opened: true };
}

/**
 * Record an account that already exists at a branch but that this platform
 * did not issue — the staff-only path. Without it, a long-standing walk-in
 * customer applying online looks like a brand-new customer to
 * findOrOpenWithin and gets a duplicate account issued.
 *
 * Staff-only by design: they can check the number against core banking before
 * typing it, which is the only thing that makes a hand-entered account number
 * trustworthy. The number is taken as given rather than derived, since the
 * bank issued it elsewhere.
 *
 * @param {object} p
 * @param {number} p.userId
 * @param {string} p.branch
 * @param {string} p.accountNumber
 * @param {string} p.accountHolder
 * @param {number} p.openedBy staff user_id
 * @returns {Promise<object>} the created row
 * @throws {Error} DUPLICATE_ACCOUNT_NUMBER if the number is already on file
 */
async function registerExisting({ userId, branch, accountNumber, accountHolder, openedBy }) {
  let insertId;
  try {
    const [res] = await pool.query(
      `INSERT INTO bank_accounts
         (user_id, account_number, branch, account_holder, account_type, status,
          opened_via, opened_by)
       VALUES (?, ?, ?, ?, 'savings', 'active', 'staff_registered', ?)`,
      [userId, accountNumber.trim(), branch.trim(), accountHolder.trim(), openedBy]
    );
    insertId = res.insertId;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new Error("DUPLICATE_ACCOUNT_NUMBER");
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM bank_accounts WHERE id = ?`,
    [insertId]
  );
  return rows[0];
}

module.exports = {
  findActiveByUserId,
  listByUserId,
  findOrOpenWithin,
  registerExisting,
};

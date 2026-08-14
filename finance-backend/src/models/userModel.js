const db = require("../config/db");

exports.findUserByEmail = (email) => {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM users WHERE email=?",

      [email],

      (err, result) => {
        if (err) reject(err);
        else resolve(result[0]);
      },
    );
  });
};

exports.saveRefreshToken = (user_id, token) => {
  db.query(
    "UPDATE users SET refresh_token=? WHERE user_id=?",

    [token, user_id],
  );
};

exports.removeRefreshToken = (id) => {
  db.query(
    "UPDATE users SET refresh_token=NULL WHERE user_id=?",

    [id],
  );
};

// Staff have no self-service signup — only an admin creates these, via
// POST /api/admin/createStaff. Uses the promise pool (unlike the other
// callback-style functions in this file) since the caller awaits it.
exports.createStaff = async ({ firstName, lastName, email, phone, hashedPassword }) => {
  const [result] = await db.promise().query(
    `INSERT INTO users (first_name, last_name, email, phone, password, role, status, email_verified)
     VALUES (?, ?, ?, ?, ?, 'staff', 'active', 1)`,
    [firstName, lastName, email, phone || null, hashedPassword],
  );
  return result.insertId;
};

exports.findAllStaff = async () => {
  const [rows] = await db.promise().query(
    `SELECT user_id, first_name, last_name, email, phone, status, created_at
       FROM users
      WHERE role = 'staff'
      ORDER BY created_at DESC`,
  );
  return rows;
};

exports.findStaffById = async (userId) => {
  const [rows] = await db.promise().query(
    `SELECT user_id, first_name, last_name, email, phone, status, created_at
       FROM users
      WHERE user_id = ? AND role = 'staff'`,
    [userId],
  );
  return rows[0];
};

// The `AND role = 'staff'` guard on every query below is deliberate — it
// keeps these staff-management endpoints from being usable (via a guessed
// id) to edit/deactivate/delete an admin or customer account.
exports.updateStaff = async (userId, { firstName, lastName, email, phone }) => {
  const [result] = await db.promise().query(
    `UPDATE users
        SET first_name = ?, last_name = ?, email = ?, phone = ?
      WHERE user_id = ? AND role = 'staff'`,
    [firstName, lastName || null, email, phone || null, userId],
  );
  return result.affectedRows > 0;
};

exports.updateStaffStatus = async (userId, status) => {
  const [result] = await db.promise().query(
    `UPDATE users SET status = ? WHERE user_id = ? AND role = 'staff'`,
    [status, userId],
  );
  return result.affectedRows > 0;
};

exports.deleteStaff = async (userId) => {
  const [result] = await db.promise().query(
    `DELETE FROM users WHERE user_id = ? AND role = 'staff'`,
    [userId],
  );
  return result.affectedRows > 0;
};

// E2 — customer KYC verification. Only a 'pending' review may be resolved
// this way, same reasoning as loanModel.verifyCollateralItem /
// verifyApplicationDocument: re-deciding an already-verified/rejected
// record isn't offered — a rejected customer edits their NIC (which
// re-opens review, see user.controller.js#updateProfile) instead.
exports.getCustomerKycStatus = async (userId) => {
  const [rows] = await db.promise().query(
    `SELECT national_id, kyc_status FROM customer_profiles WHERE user_id = ?`,
    [userId],
  );
  return rows[0];
};

exports.verifyCustomerKyc = async (userId, { kycStatus, verifiedBy, notes }) => {
  const [result] = await db.promise().query(
    `UPDATE customer_profiles
        SET kyc_status = ?, kyc_verified_by = ?, kyc_verified_at = CURRENT_TIMESTAMP, kyc_notes = ?
      WHERE user_id = ? AND kyc_status = 'pending'`,
    [kycStatus, verifiedBy, notes || null, userId],
  );
  if (result.affectedRows === 0) return null;
  const [rows] = await db.promise().query(
    `SELECT national_id, kyc_status, kyc_verified_at, kyc_notes FROM customer_profiles WHERE user_id = ?`,
    [userId],
  );
  return rows[0] || null;
};

// Admin-on-behalf-of-customer management. Same `AND role = 'customer'` guard
// as the staff-management functions above, for the same reason — it keeps
// these endpoints from being usable (via a guessed id) to edit or suspend a
// staff or admin account.
exports.findCustomerById = async (userId) => {
  const [rows] = await db.promise().query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.profile_image,
            u.status, u.created_at,
            cp.employment_type, cp.monthly_income, cp.monthly_expense,
            cp.national_id, cp.kyc_status, cp.kyc_verified_at, cp.kyc_notes
       FROM users u
       LEFT JOIN customer_profiles cp ON cp.user_id = u.user_id
      WHERE u.user_id = ? AND u.role = 'customer'`,
    [userId],
  );
  return rows[0];
};

exports.updateCustomer = async (userId, { firstName, lastName, email, phone, monthlyIncome }) => {
  const [result] = await db.promise().query(
    `UPDATE users
        SET first_name = ?, last_name = ?, email = ?, phone = ?
      WHERE user_id = ? AND role = 'customer'`,
    [firstName, lastName || null, email, phone || null, userId],
  );
  if (result.affectedRows === 0) return false;
  // monthly_income lives on customer_profiles, not users — a second
  // statement rather than a JOIN'd UPDATE, since a customer_profiles row is
  // guaranteed to exist for every real customer (created at registration)
  // but this keeps the two tables' ownership of their own columns clear.
  if (monthlyIncome !== undefined) {
    await db.promise().query(
      `UPDATE customer_profiles SET monthly_income = ? WHERE user_id = ?`,
      [monthlyIncome, userId],
    );
  }
  return true;
};

exports.updateCustomerStatus = async (userId, status) => {
  const [result] = await db.promise().query(
    `UPDATE users SET status = ? WHERE user_id = ? AND role = 'customer'`,
    [status, userId],
  );
  return result.affectedRows > 0;
};

// Every FK from a customer's OWN records down to `users(user_id)` is
// ON DELETE CASCADE (loan_applications, loan_accounts, lease_applications,
// lease_agreements, bank_accounts, consents, ...), and everything hanging
// off THOSE (repayments, rental schedules, decision-matrix rows, adverse
// action records, credit policy evaluations...) cascades again from there.
// A hard DELETE on `users` is therefore not just "remove this login" — for
// a customer who ever applied for credit, it silently erases the audit
// trail a lender is expected to retain (why someone was declined, what a
// loan account's repayment history was), which no "delete my account"
// button should be able to do by itself.
//
// So permanent deletion is gated on this count. Zero means the account is
// a shell — registered, at most a rejected/withdrawn application with no
// money ever attached — and CASCADE-deleting the rest of the shell (drafts,
// consents, an unopened bank account) loses nothing worth keeping.
exports.countCustomerFinancialRecords = async (userId) => {
  const [[row]] = await db.promise().query(
    `SELECT
       (SELECT COUNT(*) FROM loan_applications  WHERE user_id   = ?) AS loan_applications,
       (SELECT COUNT(*) FROM lease_applications WHERE lessee_id = ?) AS lease_applications
     `,
    [userId, userId],
  );
  return {
    loanApplications: Number(row.loan_applications),
    leaseApplications: Number(row.lease_applications),
  };
};

exports.deleteCustomerPermanently = async (userId) => {
  const [result] = await db.promise().query(
    `DELETE FROM users WHERE user_id = ? AND role = 'customer'`,
    [userId],
  );
  return result.affectedRows > 0;
};

// The applicant-declared facts that cross-document validation checks the
// uploaded documents against (documentValidation.service.js's `declared`
// input). Read-only, and deliberately narrow — this is evidence for an
// advisory comparison, not a profile view.
//
// date_of_birth is formatted in SQL rather than handed over as a JS Date:
// nicValidation.crossCheckNic compares String(declaredDob).slice(0, 10)
// against a 'YYYY-MM-DD' string, which a Date object would never match.
//
// The bank account is the customer's active one; a customer with none (they
// have not accepted an offer yet) simply yields null, and the name checks
// that would have used it are skipped rather than failed.
exports.findDeclaredApplicantData = async (userId) => {
  const [rows] = await db.promise().query(
    `SELECT u.first_name, u.last_name,
            DATE_FORMAT(cp.date_of_birth, '%Y-%m-%d') AS date_of_birth,
            cp.gender, cp.monthly_income,
            (SELECT ba.account_holder FROM bank_accounts ba
              WHERE ba.user_id = u.user_id AND ba.status = 'active'
              ORDER BY ba.id DESC LIMIT 1) AS bank_account_holder
       FROM users u
       LEFT JOIN customer_profiles cp ON cp.user_id = u.user_id
      WHERE u.user_id = ?`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    fullName: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
    dateOfBirth: row.date_of_birth || null,
    gender: row.gender || null,
    monthlyIncome: row.monthly_income === null ? null : Number(row.monthly_income),
    bankAccountHolderName: row.bank_account_holder || null,
  };
};

exports.updateUserPassword = (user_id, hashedPassword) => {
  return new Promise((resolve, reject) => {
    db.query(
      "UPDATE users SET password=?, refresh_token=NULL WHERE user_id=?",

      [hashedPassword, user_id],

      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
};

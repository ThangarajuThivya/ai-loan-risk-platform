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

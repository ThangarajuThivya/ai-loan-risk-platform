const db = require("../config/db");

exports.upsertOtp = (user_id, otp_hash, expires_at) => {
  return new Promise((resolve, reject) => {
    db.query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at, attempts, verified, last_sent_at)
       VALUES (?, ?, ?, 0, 0, NOW())
       ON DUPLICATE KEY UPDATE
         otp_hash = VALUES(otp_hash),
         expires_at = VALUES(expires_at),
         attempts = 0,
         verified = 0,
         last_sent_at = NOW()`,

      [user_id, otp_hash, expires_at],

      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
};

exports.findByUserId = (user_id) => {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM password_resets WHERE user_id=?",

      [user_id],

      (err, result) => {
        if (err) reject(err);
        else resolve(result[0]);
      },
    );
  });
};

exports.incrementAttempts = (user_id) => {
  return new Promise((resolve, reject) => {
    db.query(
      "UPDATE password_resets SET attempts = attempts + 1 WHERE user_id=?",

      [user_id],

      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
};

exports.markVerified = (user_id) => {
  return new Promise((resolve, reject) => {
    db.query(
      "UPDATE password_resets SET verified=1 WHERE user_id=?",

      [user_id],

      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
};

exports.deleteByUserId = (user_id) => {
  return new Promise((resolve, reject) => {
    db.query(
      "DELETE FROM password_resets WHERE user_id=?",

      [user_id],

      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
  });
};

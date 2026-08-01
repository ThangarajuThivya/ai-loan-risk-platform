-- Migration 004: OTP-based forgot-password flow. One row per user tracks the
-- current OTP (bcrypt-hashed, never stored in plaintext) and its lifecycle.
-- Works for every role (customer/admin/staff) since it keys off users.user_id.

CREATE TABLE IF NOT EXISTS password_resets (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  otp_hash     VARCHAR(255) NOT NULL,
  expires_at   TIMESTAMP NOT NULL,
  attempts     INT NOT NULL DEFAULT 0,
  verified     TINYINT(1) NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_reset (user_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

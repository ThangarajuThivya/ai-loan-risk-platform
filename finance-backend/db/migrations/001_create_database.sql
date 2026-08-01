-- Migration 001: creates the database and the 3 tables the current backend
-- code already expects (auth, profile, notifications). Matches
-- src/controllers / src/seeds and ../../README.md "Database setup".
-- Applied by npm run migrate, or run directly before 002/003.

CREATE DATABASE IF NOT EXISTS ai_loan;
USE ai_loan;

CREATE TABLE IF NOT EXISTS users (
  user_id        INT AUTO_INCREMENT PRIMARY KEY,
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100),
  email          VARCHAR(150) NOT NULL UNIQUE,
  phone          VARCHAR(20),
  password       VARCHAR(255) NOT NULL,
  role           ENUM('customer','admin','staff') NOT NULL DEFAULT 'customer',
  profile_image  VARCHAR(255),
  status         ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  refresh_token  TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  date_of_birth   DATE,
  gender          VARCHAR(20),
  address         TEXT,
  employment_type VARCHAR(50),
  company_name    VARCHAR(150),
  monthly_income  DECIMAL(12,2),
  monthly_expense DECIMAL(12,2),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  title      VARCHAR(150),
  message    TEXT,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

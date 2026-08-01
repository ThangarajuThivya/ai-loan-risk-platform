-- Migration 010: contact/support messaging feature (admin, staff, customer
-- portals). Adds: contact_messages (one row per support thread/ticket),
-- contact_message_replies (append-only message history for that thread).
-- Idempotent — safe to re-run. Does not touch 001-009.
--
-- Domain model: a customer opens a thread (subject + first message). Staff
-- or admin reply from a shared inbox (both roles see every thread — there
-- is no per-agent assignment in this iteration). Status is a simple
-- 3-state machine: open -> in_progress -> resolved, with reopening rules
-- enforced in contactMessageModel.js's addReply (not in SQL):
--   - staff/admin reply: open -> in_progress (resolved stays resolved)
--   - customer reply:    in_progress/resolved -> open
--   - staff/admin can also PATCH status directly to any of the 3 values.

USE ai_loan;

-- One row per support thread.
CREATE TABLE IF NOT EXISTS contact_messages (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  customer_id      INT NOT NULL,
  subject          VARCHAR(150) NOT NULL,
  status           ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
  -- Bumped only when a reply is inserted (contactMessageModel.js's
  -- addReply) — "most recent message" time, used to sort the inbox by
  -- real activity. Deliberately separate from updated_at (which also
  -- moves on a status-only PATCH with no new message).
  last_message_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(user_id) ON DELETE CASCADE,
  KEY idx_contact_messages_customer_status (customer_id, status),
  KEY idx_contact_messages_status_last_message (status, last_message_at)
);

-- Append-only message history for a thread. The customer's opening message
-- is itself the first row here (sender_role = 'customer') — contact_messages
-- has no body column of its own.
CREATE TABLE IF NOT EXISTS contact_message_replies (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  thread_id    INT NOT NULL,
  -- Nullable + ON DELETE SET NULL (not CASCADE): if an account is later
  -- deleted, the message body and sender_role (captured at send time)
  -- must still render — only the FK link is dropped.
  sender_id    INT NULL,
  sender_role  ENUM('customer','staff','admin') NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES contact_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE SET NULL,
  KEY idx_contact_message_replies_thread (thread_id, created_at)
);

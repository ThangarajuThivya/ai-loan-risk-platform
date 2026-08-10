-- Migration 050: give notifications a subject, a destination, and an
-- identity — so leasing can notify every role without spamming anyone.
--
-- `notifications` has carried (user_id, title, message, is_read) since 001.
-- That is enough for a one-off "your FX request was approved", and it is why
-- 4,000+ rows have accumulated with no way to filter, group, or act on any
-- of them. Three things are missing, and each blocks something leasing
-- specifically needs:
--
--   1. NO SUBJECT. Nothing records that a notification is about leasing
--      rather than a loan or an FX request, so a portal cannot group them,
--      badge them separately, or let someone read only what they care about.
--
--   2. NO DESTINATION. A message says "your quotation is ready" and then
--      leaves the reader to go and find the lease themselves. A deep link
--      turns a notice into an action.
--
--   3. NO IDENTITY — and this is the one that actually blocks reminders.
--      A reminder sweep runs on a timer: "rental #4 is due in 3 days" is
--      true for the whole of those 3 days, so a sweep running every 6 hours
--      would send it twelve times. `dedupe_key` is what makes a reminder
--      sendable exactly once, enforced by a UNIQUE index rather than by
--      remembering to check first — the same reasoning as the payment
--      intents' `uk_*_session`: idempotency belongs in the schema, because
--      code that has to remember is code that eventually forgets.
--
-- Every column is nullable and additive. Existing rows keep working
-- untouched — they simply have no category, no link, and no dedupe key,
-- which is the honest description of notifications written before any of
-- this existed.

USE ai_loan;

SET @schema := DATABASE();

-- What the notification is ABOUT. Varchar rather than ENUM: a new product
-- line should not require a migration to notify anyone, and the read side
-- treats an unknown category as "general" rather than failing.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND column_name = 'category') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD COLUMN category VARCHAR(24) NULL AFTER user_id'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The machine-readable event, e.g. 'lease_quotation_issued'. Distinct from
-- `title`, which is prose a human reads and which may be reworded at any
-- time — anything that needs to reason about WHAT happened must not have to
-- pattern-match on English.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND column_name = 'event_type') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD COLUMN event_type VARCHAR(64) NULL AFTER category'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- An in-app path, never an absolute URL. Storing a host would bake the
-- deployment's own address into rows that outlive it.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND column_name = 'link') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD COLUMN link VARCHAR(255) NULL AFTER message'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Which record this is about. Kept as a loose (type, id) pair rather than a
-- foreign key on purpose: a notification is a historical statement that
-- something happened, and it must survive the deletion of the thing it
-- describes. An FK with ON DELETE CASCADE would erase the audit of a
-- decision along with the application it was about.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND column_name = 'reference_type') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD COLUMN reference_type VARCHAR(32) NULL AFTER link'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND column_name = 'reference_id') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD COLUMN reference_id INT NULL AFTER reference_type'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- THE ONE THAT MAKES REMINDERS POSSIBLE.
--
-- A stable identity for "this exact notice, to this exact person, about this
-- exact thing, at this exact point" — e.g.
--   lease_rental_due:user=54:agreement=16:rental=4:D-3
--
-- NULL for everything that is genuinely allowed to repeat (a payment
-- received is a real event each time it happens), because MySQL's UNIQUE
-- index permits unlimited NULLs. Only reminders and one-shot milestones set
-- it, and for those a second insert fails with ER_DUP_ENTRY rather than
-- producing a duplicate the reader has to ignore.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND column_name = 'dedupe_key') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(160) NULL AFTER reference_id'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND index_name = 'uk_notifications_dedupe') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD UNIQUE KEY uk_notifications_dedupe (dedupe_key)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The read path is always "this user's notifications, newest first", and
-- increasingly "…in this category". Unindexed, that is a full scan of a
-- table that already holds thousands of rows and grows every time a sweep
-- runs.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND index_name = 'idx_notifications_user_created') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD INDEX idx_notifications_user_created (user_id, created_at)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE table_schema = @schema AND table_name = 'notifications'
      AND index_name = 'idx_notifications_user_unread') > 0,
  'SELECT 1',
  'ALTER TABLE notifications ADD INDEX idx_notifications_user_unread (user_id, is_read)'
));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill a category for the rows already here, so an existing customer's
-- history does not all collapse into "uncategorised" the moment the portal
-- starts grouping by category. Matched on the prose these were written with
-- — crude, but it only has to be right about rows that already exist, and
-- anything it misses stays NULL and reads as 'general', which is true.
UPDATE notifications SET category = 'fx'
  WHERE category IS NULL AND (title LIKE 'FX %' OR message LIKE '%FX-%');

UPDATE notifications SET category = 'loan'
  WHERE category IS NULL
    AND (title LIKE '%Loan%' OR title LIKE '%Offer%' OR title LIKE '%Instal%'
      OR title LIKE '%Late Fee%' OR title LIKE '%Repay%' OR title LIKE '%Disburs%'
      OR message LIKE '%loan%');

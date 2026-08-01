-- Migration 012: Sinhala/Tamil translation columns for user-facing DB content.
-- Idempotent — safe to re-run. Does not touch 001-011.
--
-- Design: sibling columns (name_si, name_ta) rather than a separate
-- translations table. The set of translatable columns here is small, fixed,
-- and always fetched alongside its English row, so a join-per-read buys
-- nothing and costs a JOIN on the hottest public endpoints. Every column is
-- NULLable: NULL means "not translated yet", and the read path COALESCEs back
-- to the English column (see src/utils/i18nContent.js), so a half-translated
-- row degrades to English per field rather than rendering blank.
--
-- MySQL 8.0 has no "ALTER TABLE ... ADD COLUMN IF NOT EXISTS", and db/migrate.js
-- sends each file as one multi-statement query — which rules out a stored
-- procedure, since DELIMITER is a mysql-CLI directive the server never sees.
-- So each table gets one dynamic ALTER built from the columns that are
-- actually missing, and collapses to a no-op (DO 0) when there are none.
--
-- No AFTER clauses: physical column order is irrelevant here (nothing reads
-- rows positionally), and omitting it means the columns can be added in any
-- order without one depending on another already existing.

USE ai_loan;

-- ── loan_products ───────────────────────────────────────────────────────────
-- name + description are the only customer-visible free text. `type` is a
-- closed key the frontend maps to its own labels and `rate_type` is
-- machine-read, so neither is translated.
SET @ddl := (
  SELECT GROUP_CONCAT(CONCAT('ADD COLUMN ', w.col, ' ', w.spec) SEPARATOR ', ')
    FROM (
                  SELECT 'name_si'        AS col, 'VARCHAR(120) NULL' AS spec
        UNION ALL SELECT 'name_ta',             'VARCHAR(120) NULL'
        UNION ALL SELECT 'description_si',      'TEXT NULL'
        UNION ALL SELECT 'description_ta',      'TEXT NULL'
    ) w
    LEFT JOIN information_schema.COLUMNS c
           ON c.TABLE_SCHEMA = DATABASE()
          AND c.TABLE_NAME   = 'loan_products'
          AND c.COLUMN_NAME  = w.col
   WHERE c.COLUMN_NAME IS NULL
);
SET @sql := IF(@ddl IS NULL, 'DO 0', CONCAT('ALTER TABLE loan_products ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── faqs ────────────────────────────────────────────────────────────────────
-- category is translated too: it is free text typed by staff and renders as a
-- filter chip on the public page, so leaving it English would strand an
-- English control in the middle of a Sinhala page.
SET @ddl := (
  SELECT GROUP_CONCAT(CONCAT('ADD COLUMN ', w.col, ' ', w.spec) SEPARATOR ', ')
    FROM (
                  SELECT 'category_si' AS col, 'VARCHAR(50) NULL'  AS spec
        UNION ALL SELECT 'category_ta',      'VARCHAR(50) NULL'
        UNION ALL SELECT 'question_si',      'VARCHAR(500) NULL'
        UNION ALL SELECT 'question_ta',      'VARCHAR(500) NULL'
        UNION ALL SELECT 'answer_si',        'TEXT NULL'
        UNION ALL SELECT 'answer_ta',        'TEXT NULL'
    ) w
    LEFT JOIN information_schema.COLUMNS c
           ON c.TABLE_SCHEMA = DATABASE()
          AND c.TABLE_NAME   = 'faqs'
          AND c.COLUMN_NAME  = w.col
   WHERE c.COLUMN_NAME IS NULL
);
SET @sql := IF(@ddl IS NULL, 'DO 0', CONCAT('ALTER TABLE faqs ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

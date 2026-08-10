-- Migration 052: Sinhala/Tamil translation columns for lease_products.
-- Idempotent — safe to re-run. Does not touch 001-051.
--
-- lease_products (045) was created after the loan_products i18n columns (012)
-- existed, and never got the same treatment — so the public Services page's
-- Vehicle Leasing catalogue rendered its five product names and descriptions
-- in English even when every surrounding label was Sinhala/Tamil. Same design
-- as 012: sibling _si/_ta columns, NULL meaning "not translated", COALESCEd
-- back to English by src/utils/i18nContent.js so a half-translated row still
-- renders.

USE ai_loan;

-- ── lease_products ──────────────────────────────────────────────────────────
-- name + description are the only customer-visible free text. vehicle_class
-- and rate_type are closed, machine-read keys the frontend maps to its own
-- labels, so neither is translated.
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
          AND c.TABLE_NAME   = 'lease_products'
          AND c.COLUMN_NAME  = w.col
   WHERE c.COLUMN_NAME IS NULL
);
SET @sql := IF(@ddl IS NULL, 'DO 0', CONCAT('ALTER TABLE lease_products ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Seed translations for the five products created in 045. Matched by the
-- English `name`, which is unique and never localized, rather than by id —
-- an environment that re-seeded lease_products with different ids still gets
-- translated rows.
UPDATE lease_products SET
  name_si        = COALESCE(name_si,        'මෝටර් රථ කල්බදුව'),
  name_ta        = COALESCE(name_ta,        'கார் குத்தகை'),
  description_si = COALESCE(description_si, 'නව හෝ ප්‍රතිසංස්කරණය කරන ලද මෝටර් රථ සඳහා මූල්‍ය කල්බදුව.'),
  description_ta = COALESCE(description_ta, 'புதிய அல்லது புதுப்பிக்கப்பட்ட கார்களுக்கான நிதிக் குத்தகை.')
WHERE name = 'Car Lease';

UPDATE lease_products SET
  name_si        = COALESCE(name_si,        'වෑන් සහ SUV කල්බදුව'),
  name_ta        = COALESCE(name_ta,        'வேன் & SUV குத்தகை'),
  description_si = COALESCE(description_si, 'වෑන්, SUV සහ ක්‍රියු කැබ් රථ සඳහා මූල්‍ය කල්බදුව.'),
  description_ta = COALESCE(description_ta, 'வேன், SUV மற்றும் க்ரூ கேப் வாகனங்களுக்கான நிதிக் குத்தகை.')
WHERE name = 'Van & SUV Lease';

UPDATE lease_products SET
  name_si        = COALESCE(name_si,        'යතුරුපැදි කල්බදුව'),
  name_ta        = COALESCE(name_ta,        'மோட்டார் சைக்கிள் குத்தகை'),
  description_si = COALESCE(description_si, 'යතුරුපැදි සහ ස්කූටර් සඳහා මූල්‍ය කල්බදුව.'),
  description_ta = COALESCE(description_ta, 'மோட்டார் சைக்கிள்கள் மற்றும் ஸ்கூட்டர்களுக்கான நிதிக் குத்தகை.')
WHERE name = 'Motorcycle Lease';

UPDATE lease_products SET
  name_si        = COALESCE(name_si,        'ත්‍රීරෝද කල්බදුව'),
  name_ta        = COALESCE(name_ta,        'முச்சக்கர வாகனக் குத்தகை'),
  description_si = COALESCE(description_si, 'ත්‍රීරෝද රථ සඳහා මූල්‍ය කල්බදුව.'),
  description_ta = COALESCE(description_ta, 'முச்சக்கர வாகனங்களுக்கான நிதிக் குத்தகை.')
WHERE name = 'Three-Wheeler Lease';

UPDATE lease_products SET
  name_si        = COALESCE(name_si,        'වාණිජ වාහන කල්බදුව'),
  name_ta        = COALESCE(name_ta,        'வணிக வாகனக் குத்தகை'),
  description_si = COALESCE(description_si, 'ලොරි, බස් සහ අනෙකුත් වාණිජ වාහන සඳහා මූල්‍ය කල්බදුව.'),
  description_ta = COALESCE(description_ta, 'லாரிகள், பேருந்துகள் மற்றும் பிற வணிக வாகனங்களுக்கான நிதிக் குத்தகை.')
WHERE name = 'Commercial Vehicle Lease';

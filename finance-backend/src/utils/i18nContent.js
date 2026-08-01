"use strict";

/**
 * Helpers for reading the Sinhala/Tamil sibling columns added in migration 012
 * (loan_products.name_si, faqs.answer_ta, …).
 *
 * The column suffix is chosen from a fixed whitelist and NEVER interpolated
 * from the raw request — `?lang=` is attacker-controlled and lands inside a
 * SQL identifier position, where placeholders don't apply. Anything not in the
 * whitelist resolves to null, which makes every caller fall back to the plain
 * English column.
 */

// Request value → column suffix. English is intentionally absent: it IS the
// base column, so it needs no suffix and no COALESCE wrapper.
const LANG_SUFFIX = Object.freeze({
  si: "si",
  sinhala: "si",
  ta: "ta",
  tamil: "ta",
});

/**
 * Resolve a caller-supplied language to a safe column suffix.
 * @param {unknown} lang e.g. req.query.lang
 * @returns {"si"|"ta"|null} null for English/unknown/missing
 */
function langSuffix(lang) {
  if (typeof lang !== "string") return null;
  return LANG_SUFFIX[lang.trim().toLowerCase()] || null;
}

/**
 * A SELECT expression that prefers the translated column and falls back to
 * English, aliased back to the base column name so response shapes never
 * change with language — the frontend reads `faq.answer` regardless.
 *
 * NULLIF folds an empty-string translation (an admin who saved a blank field)
 * into the same fallback path as NULL, so a half-filled row degrades per
 * field rather than rendering an empty paragraph.
 *
 * @param {string} column base column name — must be a trusted literal
 * @param {"si"|"ta"|null} suffix from langSuffix()
 * @returns {string} SQL fragment
 */
function localizedColumn(column, suffix) {
  if (!suffix) return column;
  return `COALESCE(NULLIF(${column}_${suffix}, ''), ${column}) AS ${column}`;
}

/**
 * Convenience for a list of columns.
 * @param {string[]} columns trusted literals
 * @param {"si"|"ta"|null} suffix
 * @returns {string} comma-separated SELECT list
 */
function localizedColumns(columns, suffix) {
  return columns.map((c) => localizedColumn(c, suffix)).join(", ");
}

module.exports = { langSuffix, localizedColumn, localizedColumns };

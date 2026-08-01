"use strict";

/**
 * FAQ data-access layer — plain CRUD over the faqs table.
 */

const db = require("../config/db");
const { langSuffix, localizedColumns } = require("../utils/i18nContent");

const pool = db.promise();

// Free-text columns with si/ta siblings (migration 012).
const TRANSLATABLE = ["category", "question", "answer"];

// Every si/ta column, for the admin/staff editor which needs the raw
// per-language values rather than the COALESCEd public view.
const TRANSLATION_COLUMNS = [
  "category_si",
  "category_ta",
  "question_si",
  "question_ta",
  "answer_si",
  "answer_ta",
];

/**
 * @param {object} [opts]
 * @param {string} [opts.lang] "si" | "ta" | anything else → English
 * @param {boolean} [opts.includeTranslations] also return the raw *_si/*_ta
 *   columns. Admin/staff editor only — the public list stays lean.
 */
async function findAll({ lang, includeTranslations = false } = {}) {
  const suffix = langSuffix(lang);
  const extra = includeTranslations ? `, ${TRANSLATION_COLUMNS.join(", ")}` : "";
  const [rows] = await pool.query(
    `SELECT id, ${localizedColumns(TRANSLATABLE, suffix)}${extra},
            created_at, updated_at
       FROM faqs
      ORDER BY category ASC, created_at ASC`
  );
  return rows;
}

async function findById(id, { lang, includeTranslations = false } = {}) {
  const suffix = langSuffix(lang);
  const extra = includeTranslations ? `, ${TRANSLATION_COLUMNS.join(", ")}` : "";
  const [rows] = await pool.query(
    `SELECT id, ${localizedColumns(TRANSLATABLE, suffix)}${extra},
            created_at, updated_at
       FROM faqs
      WHERE id = ?`,
    [id]
  );
  return rows[0];
}

// Translations are optional on write: a FAQ saved with English only is valid
// and simply falls back to English on the Sinhala/Tamil site.
function translationValues(data) {
  return TRANSLATION_COLUMNS.map((c) => data[c] ?? null);
}

async function create(data) {
  const { category, question, answer } = data;
  const [result] = await pool.query(
    `INSERT INTO faqs (category, question, answer, ${TRANSLATION_COLUMNS.join(", ")})
     VALUES (?, ?, ?, ${TRANSLATION_COLUMNS.map(() => "?").join(", ")})`,
    [category, question, answer, ...translationValues(data)]
  );
  return findById(result.insertId, { includeTranslations: true });
}

async function update(id, data) {
  const { category, question, answer } = data;
  const [result] = await pool.query(
    `UPDATE faqs
        SET category = ?, question = ?, answer = ?,
            ${TRANSLATION_COLUMNS.map((c) => `${c} = ?`).join(", ")}
      WHERE id = ?`,
    [category, question, answer, ...translationValues(data), id]
  );
  if (result.affectedRows === 0) return null;
  return findById(id, { includeTranslations: true });
}

async function remove(id) {
  const [result] = await pool.query(`DELETE FROM faqs WHERE id = ?`, [id]);
  if (result.affectedRows === 0) return { notFound: true };
  return { deleted: true };
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove,
};

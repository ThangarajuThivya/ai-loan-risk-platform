"use strict";

/**
 * system_settings (migration 055) — a small key/value table for admin
 * toggles that actually control backend behaviour. Only the one setting
 * Step 8 makes real, ocr_auto_extraction, is exposed here; the rest of
 * AdminSettings.jsx stays intentionally mocked (see that file's header).
 */

const pool = require("../config/db").promise();

const OCR_AUTO_EXTRACTION_KEY = "ocr_auto_extraction";

/**
 * Whether uploading a document should trigger automatic extraction
 * (documentPipeline.service.js) or leave the document extraction-less until
 * a future manual/administrative run. Fails open (true) if the row is
 * missing, matching the migration's seeded default and this feature's prior
 * behaviour of always running extraction.
 *
 * This setting controls ONLY whether extraction runs — it has no bearing on
 * staff verification, which loanDocument.service.js's verification_status
 * values (pending/verified/rejected) continue to govern entirely on their
 * own, whatever this flag is set to.
 *
 * @returns {Promise<boolean>}
 */
async function isOcrAutoExtractionEnabled() {
  const [rows] = await pool.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = ?`,
    [OCR_AUTO_EXTRACTION_KEY]
  );
  if (!rows[0]) return true;
  return rows[0].setting_value === "true";
}

/**
 * @param {boolean} enabled
 * @param {number} updatedBy admin user id
 * @returns {Promise<boolean>} the value that was persisted
 */
async function setOcrAutoExtractionEnabled(enabled, updatedBy) {
  const value = enabled ? "true" : "false";
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [OCR_AUTO_EXTRACTION_KEY, value, updatedBy ?? null]
  );
  return enabled;
}

module.exports = {
  isOcrAutoExtractionEnabled,
  setOcrAutoExtractionEnabled,
};

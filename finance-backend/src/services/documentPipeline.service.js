"use strict";

/**
 * Document extraction pipeline — composes the four pure/adapter pieces of
 * this feature into one run against a single uploaded document:
 *
 *   ocr.service          bytes  -> raw text
 *   documentExtraction   text   -> field bundle
 *   documentValidation   fields -> findings   (across ALL of the
 *                                              application's documents)
 *   loanModel/leaseApplication.model          -> persisted, advisory only
 *
 * This module is the composition layer, the same tier as a controller: it
 * reads the stored file and writes to the database. The recognition,
 * extraction and validation modules underneath it keep their own contracts
 * (ocr.service.js is still the only one that touches the network;
 * documentExtraction and documentValidation are still pure).
 *
 * ADVISORY ONLY. Nothing in here writes verification_status on either
 * document table — not on success, not on a blocker finding. Staff sign-off
 * remains the sole authority over whether a document is accepted, exactly as
 * migration 054's header and the existing KYC design require. A blocker
 * finding is information presented to an officer, never an automatic
 * rejection.
 *
 * NEVER THROWS, NEVER REJECTS. processDocumentInBackground() is called after
 * the HTTP response has already been sent — an unhandled rejection there
 * would be an unhandled process-level error, and an upload the customer has
 * already been told succeeded must not be able to destabilise the server.
 * Every failure mode is recorded on the extraction row as 'failed' or
 * 'skipped' and logged; none propagates.
 */

const fs = require("fs/promises");
const path = require("path");

const { LOAN_DOCUMENT_DIR } = require("../config/multer");
const loanModel = require("../models/loanModel");
const leaseAppModel = require("../models/leaseApplication.model");
const userModel = require("../models/userModel");
const systemSettingsModel = require("../models/systemSettings.model");
const { recognizeDocument } = require("./ocr.service");
const { extractFields } = require("./documentExtraction.service");
const { validateApplication } = require("./documentValidation.service");

/**
 * Per-source wiring. Both document tables are shaped the same way and both
 * persist into the single document_extractions table (migration 054),
 * distinguished by document_source — so the pipeline itself is written once
 * and only the model functions and the isLease flag differ.
 */
const SOURCES = {
  loan: {
    isLease: false,
    upsert: (args) => loanModel.upsertLoanDocumentExtraction(args),
    listForApplication: (id) => loanModel.getLoanApplicationExtractions(id),
  },
  lease: {
    isLease: true,
    upsert: (args) => leaseAppModel.upsertLeaseDocumentExtraction(args),
    listForApplication: (id) => leaseAppModel.getLeaseApplicationExtractions(id),
  },
};

/**
 * Mean confidence across the fields an extractor actually produced, as the
 * document's overall score. Null when nothing was extracted — a document
 * whose type has no extraction rules yet scores nothing rather than zero,
 * which would read as "extracted, and certainly wrong".
 * Rounded to 3dp to fit document_extractions.confidence_score DECIMAL(4,3).
 */
function overallConfidence(fields) {
  const scores = Object.values(fields || {})
    .filter((f) => f && typeof f.confidence === "number")
    .map((f) => f.confidence);
  if (!scores.length) return null;
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return Math.round(mean * 1000) / 1000;
}

/**
 * Reading a stored document is subject to the same path-escape defence the
 * download routes apply: whatever ended up in storage_path, refuse to read
 * anything that resolves outside the document directory.
 */
function isPathInsideDocumentDir(storagePath) {
  const resolved = path.resolve(String(storagePath || ""));
  return resolved.startsWith(path.resolve(LOAN_DOCUMENT_DIR) + path.sep);
}

// A single transient recognition failure (a momentary 429 from Gemini's
// free-tier quota, a slow response) used to permanently strand a document
// with nothing ever read from it — 'failed' was recorded on the first try
// and nothing tried again. Two attempts, a short gap between them, gives a
// genuinely transient failure a real second chance without materially
// delaying a pipeline that already runs in the background. A 'skipped'
// result is NOT retried: it means recognition was never attempted at all
// (no API key configured, an unsupported mime type, an empty buffer), and
// trying again cannot change that outcome.
const RECOGNITION_ATTEMPTS = 2;
const RECOGNITION_RETRY_DELAY_MS = 3000;

async function recognizeWithRetry(recognize, args, sleep) {
  let result;
  for (let attempt = 1; attempt <= RECOGNITION_ATTEMPTS; attempt += 1) {
    result = await recognize(args);
    if (result.status !== "failed") return result;
    if (attempt < RECOGNITION_ATTEMPTS) {
      console.warn(
        `[pipeline] recognition failed (attempt ${attempt}/${RECOGNITION_ATTEMPTS}) — retrying.`
      );
      await sleep(RECOGNITION_RETRY_DELAY_MS);
    }
  }
  return result;
}

/**
 * Assemble the cross-document field bundle documentValidation expects:
 * `{ [document_type]: { field: {value, snippet, confidence} } }`.
 *
 * Built from every succeeded extraction already stored against the
 * application, with the run in progress merged in on top — the row for the
 * document being processed has not been written yet at this point, and
 * re-reading it would give a stale (or absent) answer.
 *
 * Two documents of the same type (a second payslip, a corrected CR copy)
 * merge field-by-field with the later row winning, so a re-upload
 * supersedes rather than duplicating.
 */
function buildExtractedBundle(storedRows, currentType, currentFields) {
  const bundle = {};
  for (const row of storedRows || []) {
    if (row.extraction_status !== "succeeded" || !row.extracted_fields) continue;
    // mysql2 parses JSON columns for us; tolerate a string just in case.
    let fields = row.extracted_fields;
    if (typeof fields === "string") {
      try {
        fields = JSON.parse(fields);
      } catch {
        continue;
      }
    }
    bundle[row.document_type] = { ...(bundle[row.document_type] || {}), ...fields };
  }
  bundle[currentType] = { ...(bundle[currentType] || {}), ...currentFields };
  return bundle;
}

/**
 * The pipeline's outside world, in one place. Production callers take the
 * defaults; the tests substitute fakes, so the orchestration (routing,
 * skip/fail semantics, what gets persisted when) is covered without a
 * database, a file on disk or a network call.
 */
const DEFAULT_DEPS = {
  sources: SOURCES,
  recognize: recognizeDocument,
  readFile: (p) => fs.readFile(p),
  findDeclared: (userId) => userModel.findDeclaredApplicantData(userId),
  isPathAllowed: isPathInsideDocumentDir,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Run the full pipeline for one uploaded document and persist the result.
 * Awaitable (the tests await it); production callers use
 * processDocumentInBackground below instead.
 *
 * @param {object} p
 * @param {'loan'|'lease'} p.source which document table documentId belongs to
 * @param {number} p.documentId    the document row's id
 * @param {number} p.applicationId the application the document hangs off
 * @param {number} p.userId        the applicant (for their declared data)
 * @param {string} p.documentType
 * @param {string} p.storagePath
 * @param {string} p.mimeType
 * @param {object} [deps] test seam — see DEFAULT_DEPS
 * @returns {Promise<object|null>} the persisted extraction row
 */
async function runExtractionPipeline(
  { source, documentId, applicationId, userId, documentType, storagePath, mimeType },
  deps = {}
) {
  const { sources, recognize, readFile, findDeclared, isPathAllowed, sleep } = {
    ...DEFAULT_DEPS,
    ...deps,
  };
  const wiring = sources[source];
  if (!wiring) throw new Error(`Unknown document source: ${source}`);

  const persist = (fields) =>
    wiring.upsert({
      documentId,
      extractionStatus: fields.extractionStatus,
      engine: fields.engine ?? null,
      rawText: fields.rawText ?? null,
      extractedFields: fields.extractedFields ?? null,
      validationFindings: fields.validationFindings ?? null,
      confidenceScore: fields.confidenceScore ?? null,
    });

  // Claim the row up front so a document being processed is distinguishable
  // from one nothing has ever looked at — the extraction endpoint can then
  // honestly answer "in progress" rather than 404.
  await persist({ extractionStatus: "pending" });

  // ---- 1. Read the stored bytes -------------------------------------
  let buffer;
  try {
    if (!isPathAllowed(storagePath)) {
      console.error("[pipeline] refusing to read a path outside the document dir:", storagePath);
      return persist({ extractionStatus: "failed" });
    }
    buffer = await readFile(storagePath);
  } catch (err) {
    console.warn(`[pipeline] could not read document ${documentId} (${err.code || err.message}).`);
    return persist({ extractionStatus: "failed" });
  }

  // ---- 2. Recognition (the only I/O-to-a-model step) -----------------
  const ocr = await recognizeWithRetry(recognize, { buffer, mimeType }, sleep);
  if (ocr.status !== "succeeded" || !ocr.rawText) {
    // 'skipped' and 'failed' both pass straight through — ocr.service has
    // already decided which one this was, and the distinction (never
    // attempted vs. attempted and unusable) matters to whoever reads it.
    return persist({ extractionStatus: ocr.status, engine: ocr.engine });
  }

  // ---- 3. Field extraction (pure) -----------------------------------
  let fields;
  try {
    fields = extractFields(ocr.rawText, documentType);
  } catch (err) {
    // Only reachable for a document_type outside the extractor's supported
    // set. Keep the recognised text — it is still worth showing a reviewer.
    console.warn(`[pipeline] extraction failed for document ${documentId}: ${err.message}`);
    return persist({ extractionStatus: "failed", engine: ocr.engine, rawText: ocr.rawText });
  }

  // ---- 4. Cross-document validation (pure) --------------------------
  let findings = [];
  try {
    const [storedRows, declared] = await Promise.all([
      wiring.listForApplication(applicationId),
      findDeclared(userId),
    ]);
    findings = validateApplication({
      extracted: buildExtractedBundle(storedRows, documentType, fields),
      declared: { ...(declared || {}), isLease: wiring.isLease },
    });
  } catch (err) {
    // Validation is corroboration on top of extraction — losing it must not
    // discard the fields we did extract, so this records an empty finding
    // set rather than downgrading the run to 'failed'.
    console.warn(`[pipeline] validation failed for document ${documentId}: ${err.message}`);
    findings = [];
  }

  return persist({
    extractionStatus: "succeeded",
    engine: ocr.engine,
    rawText: ocr.rawText,
    extractedFields: fields,
    validationFindings: findings,
    confidenceScore: overallConfidence(fields),
  });
}

/**
 * Fire-and-forget entry point for the upload handlers. Returns immediately;
 * the pipeline runs on later ticks, after the 201 has gone out. The upload
 * response therefore never waits on OCR latency (a Gemini Vision call is up
 * to 10s), and an OCR failure can never turn a successful upload into an
 * error the customer sees.
 *
 * Gated on the admin "run document extraction automatically on uploaded
 * documents" setting (AdminSettings.jsx / system_settings.ocr_auto_extraction,
 * see systemSettings.model.js). This is the ONLY thing that setting
 * controls — it decides whether this automatic, upload-triggered run
 * happens at all. It has no say over what runExtractionPipeline does once
 * called (a future manual "re-run extraction" action would go through
 * runExtractionPipeline directly, bypassing this gate on purpose), and it
 * never touches verification_status — staff sign-off is unaffected by this
 * setting in either position.
 *
 * Returns the in-flight promise purely so tests can await it — production
 * callers deliberately ignore it.
 *
 * @param {object} args same as runExtractionPipeline
 * @param {object} [deps] test seam — see DEFAULT_DEPS. deps.isAutoExtractionEnabled
 *   overrides the setting lookup itself.
 * @returns {Promise<void>} always resolves
 */
function processDocumentInBackground(args, deps = {}) {
  const isAutoExtractionEnabled =
    deps.isAutoExtractionEnabled || systemSettingsModel.isOcrAutoExtractionEnabled;

  return Promise.resolve(isAutoExtractionEnabled())
    .then((enabled) => {
      if (!enabled) return undefined;
      return runExtractionPipeline(args, deps);
    })
    .catch((err) => {
      // Last line of defence: runExtractionPipeline already handles every
      // expected failure, so reaching here means the setting lookup or the
      // database itself is unreachable. Log and swallow — an unhandled
      // rejection from a post-response task would take down more than this
      // one extraction.
      console.error("DOCUMENT EXTRACTION PIPELINE ERROR:", err);
    });
}

/**
 * Shape a stored extraction row for the GET .../documents/:docId/extraction
 * endpoint. Pure — both controllers use it so the loan and lease responses
 * cannot drift apart.
 *
 * A document with no extraction row yet is reported as status 'pending'
 * with empty results rather than 404: the document exists, and "we have not
 * looked at it yet" is a truthful answer that a client can poll on. 404
 * would wrongly imply the document itself is missing.
 *
 * raw_text is deliberately NOT returned. It is a full transcript of the
 * document, and a reviewer who wants the contents has the download route —
 * which streams the authentic file rather than a model's reading of it.
 *
 * @param {object} doc the document row
 * @param {object|null} extraction the document_extractions row, if any
 */
function presentExtraction(doc, extraction) {
  if (!extraction) {
    return {
      document_id: doc.id,
      document_type: doc.document_type,
      extraction_status: "pending",
      engine: null,
      confidence_score: null,
      extracted_fields: {},
      validation_findings: [],
      updated_at: null,
    };
  }
  return {
    document_id: doc.id,
    document_type: doc.document_type,
    extraction_status: extraction.extraction_status,
    engine: extraction.engine,
    // DECIMAL comes back from mysql2 as a string; a confidence is a number.
    confidence_score:
      extraction.confidence_score === null ? null : Number(extraction.confidence_score),
    extracted_fields: extraction.extracted_fields || {},
    validation_findings: extraction.validation_findings || [],
    updated_at: extraction.updated_at,
  };
}

module.exports = {
  runExtractionPipeline,
  processDocumentInBackground,
  presentExtraction,
  buildExtractedBundle,
  overallConfidence,
};

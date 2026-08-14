"use strict";

/**
 * Shared scoring engine for both evaluation harnesses:
 *   - runEvaluation.js          — synthetic fixture set
 *   - runRealDocumentEvaluation.js — real-world/sample document set
 * Both run the same real pipeline (ocr.service.js + documentExtraction
 * .service.js) over a set of {file, documentType, expectedFields} records
 * and score per-field precision/recall the same way; only where the
 * documents come from and where the report gets written differs. Pulled
 * out here so neither script duplicates this logic.
 */

const fs = require("fs");
const path = require("path");

const { recognizeDocument } = require("../../../src/services/ocr.service");
const { extractFields } = require("../../../src/services/documentExtraction.service");

/** field to check, per document type, and how to pull it out of extractFields()'s output. */
const FIELD_SPECS = [
  {
    label: "NIC number",
    documentType: "national_id",
    groundTruthKey: "nic",
    getPredicted: (extracted) => extracted?.national_id?.value?.nic ?? null,
    normalize: (v) => String(v || "").replace(/[\s-]/g, "").toUpperCase(),
  },
  {
    label: "Chassis number",
    documentType: "cr_copy",
    groundTruthKey: "chassis_number",
    getPredicted: (extracted) => extracted?.chassis_number?.value ?? null,
    normalize: (v) => String(v || "").replace(/[\s-]/g, "").toUpperCase(),
  },
  {
    label: "Net salary",
    documentType: "payslip",
    groundTruthKey: "net_salary",
    // documentExtraction.service.js has no payslip case yet (returns {} —
    // see its `default:` branch), so this is always null. Included anyway,
    // so the gap is visible in the numbers rather than hidden.
    getPredicted: (extracted) => extracted?.net_salary?.value ?? null,
    normalize: (v) => (v === null || v === undefined ? null : Number(v)),
  },
  {
    label: "Account number",
    documentType: "bank_statement",
    groundTruthKey: "account_number",
    getPredicted: (extracted) => extracted?.account_number?.value ?? null,
    normalize: (v) => String(v || "").replace(/\s/g, ""),
  },
];

// The Gemini free tier caps requests *per model, per day* (observed: as low
// as 20/day on some model names) — nowhere near enough for a 20-50+
// document batch. Requests are round-robined across several verified-
// reachable model names, each carrying its own separate quota bucket, via
// ocr.service.js's per-call `model` override (added specifically to make
// these harnesses runnable — see that file's recognizeDocument() jsdoc).
// Every model here is still a pretrained Gemini Vision model used
// zero-shot, so this doesn't change what's being evaluated — it only works
// around a free-tier quota ceiling that a single model name can't clear.
const EVAL_GEMINI_MODELS = (
  process.env.OCR_EVAL_GEMINI_MODELS ||
  "gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3-flash-preview"
).split(",").map((s) => s.trim()).filter(Boolean);

// Delay between Gemini calls so a batch doesn't trip per-minute rate limits.
const CALL_DELAY_MS = Number(process.env.OCR_EVAL_CALL_DELAY_MS || 1500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini's shared infrastructure returns transient 503s / connection
// timeouts under load, indistinguishable at the HTTP layer from the model
// actually failing to read a document. ocr.service.js correctly reports
// these as status:'failed' (it must never throw — see its file header),
// but scoring a transient infra hiccup as an extraction failure would
// understate the pipeline's real recall. The harness retries a genuine
// 'failed' a few times, on the assumption most are transient; a document
// that still fails after retrying is counted as a real failure.
const MAX_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = 4000;

// A retry that reuses the same model it just failed on doesn't help when
// the failure was that model's daily quota — so each retry attempt also
// advances to the next model in EVAL_GEMINI_MODELS.
async function recognizeWithRetry(buffer, mimeType, docIndex) {
  let result;
  let usedModel;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    usedModel = EVAL_GEMINI_MODELS[(docIndex + attempt - 1) % EVAL_GEMINI_MODELS.length];
    result = await recognizeDocument({ buffer, mimeType, model: usedModel });
    if (result.status !== "failed") return { ...result, modelUsed: usedModel };
    if (attempt < MAX_ATTEMPTS) {
      console.log(`    retrying with ${EVAL_GEMINI_MODELS[(docIndex + attempt) % EVAL_GEMINI_MODELS.length]} (attempt ${attempt} on ${usedModel} failed)...`);
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  return { ...result, modelUsed: usedModel };
}

let globalDocCounter = 0;

/** Sniff a fixture's mime type from its extension — the synthetic set is always .jpg, but real-world fixtures include .png. */
function mimeTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpeg" || ext === ".jpg") return "image/jpeg";
  throw new Error(`Unhandled extension for evaluation fixture: ${file}`);
}

/**
 * @param {string} documentsDir directory containing the image files
 * @param {{file, documentType, expectedFields}} doc
 * @param {object} spec one of FIELD_SPECS
 */
async function evaluateDocument(documentsDir, doc, spec) {
  const buffer = fs.readFileSync(path.join(documentsDir, doc.file));
  const mimeType = mimeTypeFor(doc.file);
  const docIndex = globalDocCounter;
  globalDocCounter += 1;

  const ocrResult = await recognizeWithRetry(buffer, mimeType, docIndex);
  let extracted = {};
  let extractionError = null;
  if (ocrResult.status === "succeeded") {
    try {
      extracted = extractFields(ocrResult.rawText, doc.documentType);
    } catch (err) {
      extractionError = err.message;
    }
  }

  const expected = spec.normalize(doc.expectedFields[spec.groundTruthKey]);
  const predictedRaw = spec.getPredicted(extracted);
  const predicted = predictedRaw === null || predictedRaw === undefined ? null : spec.normalize(predictedRaw);

  let outcome; // "tp" | "fp" | "fn"
  if (predicted !== null && predicted === expected) outcome = "tp";
  else if (predicted !== null) outcome = "fp";
  else outcome = "fn";

  return {
    file: doc.file,
    documentType: doc.documentType,
    ocrStatus: ocrResult.status,
    ocrEngine: ocrResult.engine,
    modelUsed: ocrResult.modelUsed,
    extractionError,
    expected: doc.expectedFields[spec.groundTruthKey],
    predicted: predictedRaw,
    outcome,
  };
}

function formatPercent(n) {
  return n === null ? "N/A" : `${(n * 100).toFixed(1)}%`;
}

function computeMetrics(results) {
  const tp = results.filter((r) => r.outcome === "tp").length;
  const fp = results.filter((r) => r.outcome === "fp").length;
  const fn = results.filter((r) => r.outcome === "fn").length;
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  return { tp, fp, fn, precision, recall };
}

/**
 * Runs every doc in `docs` through the real pipeline and scores it against
 * whichever FIELD_SPECS entries have a matching documentType present in
 * `docs` (so a document set with no payslips, for example, simply never
 * touches the Net salary spec).
 * @param {string} documentsDir
 * @param {Array<{file, documentType, expectedFields}>} docs
 * @param {(processed:number, total:number, doc:object, result:object)=>void} [onProgress]
 */
async function runBatch(documentsDir, docs, onProgress) {
  const documentTypesPresent = new Set(docs.map((d) => d.documentType));
  const specs = FIELD_SPECS.filter((s) => documentTypesPresent.has(s.documentType));

  const fieldResults = {}; // label -> [{...}]
  const ocrStatusCounts = { succeeded: 0, failed: 0, skipped: 0 };
  let processed = 0;
  const total = docs.length;

  for (const spec of specs) {
    fieldResults[spec.label] = [];
    const matchingDocs = docs.filter((d) => d.documentType === spec.documentType);
    for (const doc of matchingDocs) {
      const result = await evaluateDocument(documentsDir, doc, spec);
      fieldResults[spec.label].push(result);
      ocrStatusCounts[result.ocrStatus] = (ocrStatusCounts[result.ocrStatus] || 0) + 1;
      processed += 1;
      if (onProgress) onProgress(processed, total, doc, spec, result);
      await sleep(CALL_DELAY_MS);
    }
  }

  const metrics = specs.map((spec) => ({
    spec,
    results: fieldResults[spec.label],
    metrics: computeMetrics(fieldResults[spec.label]),
  }));

  return { metrics, ocrStatusCounts };
}

module.exports = {
  FIELD_SPECS,
  EVAL_GEMINI_MODELS,
  formatPercent,
  computeMetrics,
  runBatch,
};

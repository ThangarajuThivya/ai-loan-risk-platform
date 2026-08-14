"use strict";

require("dotenv").config();
// The eval harness makes real Gemini Vision calls in a batch, non-
// interactive context, so it can tolerate more latency than a live upload
// waiting on the HTTP response. Production's tighter default (10s, tuned
// for upload-time latency) is untouched — see ocr.service.js's comment on
// OCR_TIMEOUT_MS. Only applied if the caller hasn't already set it.
process.env.OCR_TIMEOUT_MS = process.env.OCR_TIMEOUT_MS || "30000";

/**
 * OCR evaluation harness — synthetic fixture set.
 *   node scripts/ocrEval/runEvaluation.js
 *
 * Runs the REAL, unmodified pipeline — ocr.service.js's recognizeDocument()
 * (a live Gemini Vision call per image) followed by
 * documentExtraction.service.js's extractFields() (pure, deterministic) —
 * over every fixture in fixtures/documents/, and scores the result against
 * fixtures/ground_truth.json (produced by generateSyntheticDocuments.js).
 *
 * Reports per-field precision and recall, not one aggregate score, because
 * a single blended number hides which fields are trustworthy and which
 * aren't — see OCR_FEATURE.md's evaluation methodology section for why
 * that distinction is called out explicitly.
 *
 * There is a second, separate harness — runRealDocumentEvaluation.js — that
 * runs the same scoring engine (lib/evalRunner.js) over a small set of
 * real-world/sample documents instead of these synthetic ones, and writes
 * its own separate report. See OCR_FEATURE.md §5.4.
 *
 * Output:
 *   ../../../OCR_EVALUATION_REPORT.txt   — the report (repo root)
 *   fixtures/evaluation_results.json     — full per-document detail, for
 *                                           anyone who wants to see exactly
 *                                           which documents failed and how
 */

const fs = require("fs");
const path = require("path");

const { EVAL_GEMINI_MODELS, formatPercent, runBatch } = require("./lib/evalRunner");

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const DOCUMENTS_DIR = path.join(FIXTURES_DIR, "documents");
const GROUND_TRUTH_PATH = path.join(FIXTURES_DIR, "ground_truth.json");
const REPORT_PATH = path.join(__dirname, "..", "..", "..", "OCR_EVALUATION_REPORT.txt");
const RESULTS_JSON_PATH = path.join(FIXTURES_DIR, "evaluation_results.json");

async function main() {
  const groundTruth = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, "utf8"));
  console.log(`Evaluating ${groundTruth.documents.length} fixture documents...\n`);

  const { metrics, ocrStatusCounts } = await runBatch(
    DOCUMENTS_DIR,
    groundTruth.documents,
    (processed, total, doc, spec, result) => {
      console.log(`  [${processed}/${total}] ${doc.file} — ocr:${result.ocrStatus} ${spec.label}:${result.outcome}`);
    }
  );

  // -------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------
  const lines = [];
  lines.push("OCR + Rule-Based Field Extraction — Evaluation Report (synthetic fixture set)");
  lines.push("=".repeat(79));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Fixture set: ${groundTruth.documentCount} synthetic documents (seed ${groundTruth.seed})`);
  lines.push(`Recognition engine under test: Gemini Vision, zero-shot`);
  lines.push(
    `  Model calls were round-robined across [${EVAL_GEMINI_MODELS.join(", ")}]`
  );
  lines.push(
    `  (each Gemini model name enforces its own separate free-tier daily quota;`
  );
  lines.push(
    `  rotating across several was necessary to complete a ${groundTruth.documentCount}-document`
  );
  lines.push(`  batch in one run — see OCR_FEATURE.md §5.3).`);
  lines.push(`Extraction: deterministic rule-based field extraction (documentExtraction.service.js)`);
  lines.push("");
  lines.push("Per-field precision and recall (not a single blended score):");
  lines.push("");
  lines.push("Field              Precision       Recall");
  lines.push("-------------------------------------------");
  for (const { spec, metrics: m } of metrics) {
    lines.push(
      `${spec.label.padEnd(18)} ${formatPercent(m.precision).padEnd(15)} ${formatPercent(m.recall)}`
    );
  }
  lines.push("");
  lines.push("Detail (true positives / false positives / false negatives, per field):");
  for (const { spec, metrics: m } of metrics) {
    lines.push(`  ${spec.label}: TP=${m.tp} FP=${m.fp} FN=${m.fn} (n=${m.tp + m.fp + m.fn})`);
  }
  lines.push("");
  lines.push("OCR recognition status across all documents processed:");
  lines.push(
    `  succeeded=${ocrStatusCounts.succeeded || 0} failed=${ocrStatusCounts.failed || 0} skipped=${ocrStatusCounts.skipped || 0}`
  );
  lines.push("");
  lines.push("Known gap — Net salary:");
  lines.push(
    "  documentExtraction.service.js does not yet implement field extraction for"
  );
  lines.push(
    "  the 'payslip' document type (see its `default:` case, which returns {})."
  );
  lines.push(
    "  Net salary is scored here anyway, as required, so the gap is visible in"
  );
  lines.push(
    "  the numbers rather than hidden by omitting the field: recall is 0% and"
  );
  lines.push(
    "  precision is undefined (no predictions were ever made) — this reflects"
  );
  lines.push("  an unimplemented extractor, not an OCR or model failure.");
  lines.push("");
  lines.push("LIMITATIONS — read before citing any number above:");
  lines.push("  - The evaluation set is small (52 documents, 13 per field/type).");
  lines.push("  - The evaluation is entirely synthetic: HTML/CSS-rendered documents with");
  lines.push("    programmatic rotation/blur/glare/JPEG-compression augmentation, not real");
  lines.push("    scans or camera photos of real documents. A separate, smaller evaluation");
  lines.push("    against real-world/sample documents exists — see");
  lines.push("    REAL_DOCUMENT_EVALUATION_REPORT.txt.");
  lines.push("  - These results are NOT a production accuracy claim. They establish a");
  lines.push("    reproducible baseline and a regression check, nothing more.");
  lines.push("  - Full methodology, generator, and PDPA considerations: see OCR_FEATURE.md.");
  lines.push("");

  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  fs.writeFileSync(
    RESULTS_JSON_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), metrics: metrics.map((m) => ({
      field: m.spec.label,
      documentType: m.spec.documentType,
      precision: m.metrics.precision,
      recall: m.metrics.recall,
      tp: m.metrics.tp,
      fp: m.metrics.fp,
      fn: m.metrics.fn,
      documents: m.results,
    })) }, null, 2)
  );

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport written to ${REPORT_PATH}`);
  console.log(`Full detail written to ${RESULTS_JSON_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

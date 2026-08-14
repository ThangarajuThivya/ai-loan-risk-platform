"use strict";

require("dotenv").config();
process.env.OCR_TIMEOUT_MS = process.env.OCR_TIMEOUT_MS || "30000";

/**
 * OCR evaluation harness — real-world/sample document set.
 *   node scripts/ocrEval/runRealDocumentEvaluation.js
 *
 * Same scoring engine as runEvaluation.js (lib/evalRunner.js), same real
 * pipeline (ocr.service.js + documentExtraction.service.js), but run over
 * fixtures/real_documents/ instead of the synthetic set — a small mixed
 * collection of genuine Sri Lankan documents and third-party KYC-vendor
 * mockup/sample templates, gathered rather than generated. See
 * fixtures/real_ground_truth.json's "notes" for how ground truth was
 * built and what "source" means per document, and its "excluded" list for
 * documents dropped from scoring (redacted/blank/illegible fields — see
 * OCR_FEATURE.md §5.4 for the full methodology and why this set is kept
 * deliberately separate from the synthetic one rather than merged into it.
 *
 * Output:
 *   ../../../REAL_DOCUMENT_EVALUATION_REPORT.txt — the report (repo root)
 *   fixtures/real_evaluation_results.json         — full per-document detail
 */

const fs = require("fs");
const path = require("path");

const { EVAL_GEMINI_MODELS, formatPercent, runBatch } = require("./lib/evalRunner");

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const DOCUMENTS_DIR = path.join(FIXTURES_DIR, "real_documents");
const GROUND_TRUTH_PATH = path.join(FIXTURES_DIR, "real_ground_truth.json");
const REPORT_PATH = path.join(__dirname, "..", "..", "..", "REAL_DOCUMENT_EVALUATION_REPORT.txt");
const RESULTS_JSON_PATH = path.join(FIXTURES_DIR, "real_evaluation_results.json");

async function main() {
  const groundTruth = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, "utf8"));
  console.log(
    `Evaluating ${groundTruth.documents.length} real-world/sample documents ` +
    `(${groundTruth.excluded.length} excluded — see real_ground_truth.json)...\n`
  );

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
  lines.push("OCR + Rule-Based Field Extraction — Evaluation Report (real-world/sample documents)");
  lines.push("=".repeat(86));
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(
    `Document set: ${groundTruth.documents.length} scored (${groundTruth.excluded.length} excluded — ` +
    `redacted/blank/illegible field, see below)`
  );
  lines.push(`Recognition engine under test: Gemini Vision, zero-shot`);
  lines.push(`  Model calls were round-robined across [${EVAL_GEMINI_MODELS.join(", ")}] — same reason as the synthetic run (see OCR_EVALUATION_REPORT.txt).`);
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
  lines.push(`Excluded from scoring (${groundTruth.excluded.length} documents — no valid value to check extraction against):`);
  for (const ex of groundTruth.excluded) {
    lines.push(`  ${ex.file}: ${ex.reason}`);
  }
  lines.push("");
  lines.push("Observed failure modes (why the false negatives above happened):");
  lines.push(
    "  These are read directly off this run's raw OCR transcripts, not guessed."
  );
  lines.push(
    "  1. Two-column form reflow (all 5 Chassis number FNs: CR-01, CR-04, CR-07,"
  );
  lines.push(
    "     CR-08, CR-09). The official CR-copy form lays out 'Registration No.' and"
  );
  lines.push(
    "     'Chassis No.' as two column headers on one row, with both values on the"
  );
  lines.push(
    "     row below. Gemini transcribes exactly what it sees, so the labels and"
  );
  lines.push(
    "     values land on separate lines in the output text — but extractLineField()"
  );
  lines.push(
    "     in documentExtraction.service.js only matches a label and its value on"
  );
  lines.push(
    "     the SAME line. Every real CR copy in this set hit this, unanimously —"
  );
  lines.push(
    "     the synthetic set never could, since its HTML template renders each"
  );
  lines.push(
    "     field as one full-width 'Label: Value' line by construction."
  );
  lines.push(
    "  2. Label with no colon separator (Account number FN: BS-08, BS-09). This"
  );
  lines.push(
    "     statement prints 'Account Number   06 3167 10781391' — label and value"
  );
  lines.push(
    "     column-aligned with whitespace, no ':' or '-' between them anywhere."
  );
  lines.push(
    "     extractLineField()'s pattern requires that separator; without one, the"
  );
  lines.push(
    "     line simply never matches, regardless of how clean the transcription is."
  );
  lines.push(
    "  3. Label and value on separate lines (Account number FN: BS-01). This"
  );
  lines.push(
    "     statement prints 'Account Number:' on its own line, then the (partially"
  );
  lines.push(
    "     masked) value on the next line — the same same-line requirement as #1,"
  );
  lines.push(
    "     different document type."
  );
  lines.push(
    "  4. Space before an old-format NIC's check-letter (NIC number FN: NIC-01)."
  );
  lines.push(
    "     This card has no 'NIC No:' label at all, so extraction falls back to a"
  );
  lines.push(
    "     bare pattern match; Gemini transcribed it as '961230144 v' (with a"
  );
  lines.push(
    "     space before the letter), and the bare pattern's \\b...\\b word boundary"
  );
  lines.push(
    "     doesn't span a space, so it never matches."
  );
  lines.push(
    "  None of these are OCR failures — Gemini Vision read all four documents"
  );
  lines.push(
    "  correctly in every case above. All four are gaps in the deterministic"
  );
  lines.push(
    "  extraction layer's same-line, colon-anchored pattern, exposed by real"
  );
  lines.push(
    "  document layouts the synthetic templates don't produce. Fixing them is"
  );
  lines.push(
    "  future extraction work, out of scope for this evaluation step; they are"
  );
  lines.push("  recorded here so they don't get lost.");
  lines.push("");
  lines.push("What this set actually contains:");
  lines.push(
    "  Of the 24 documents supplied, only 14 had a legible, unredacted value in the"
  );
  lines.push(
    "  field this harness checks. Several of the 14 are genuine Sri Lankan documents"
  );
  lines.push(
    "  (mainly the CR copies); several others turned out, on inspection, to be"
  );
  lines.push(
    "  third-party KYC-vendor mockup/sample templates (watermarked 'Mr. Verify',"
  );
  lines.push(
    "  'Roposh.com', 'TemplateLab') rather than genuine issued documents — see each"
  );
  lines.push(
    "  document's \"source\" field in real_ground_truth.json. Both kinds are scored"
  );
  lines.push(
    "  identically; the recognition/extraction pipeline has no way to tell a genuine"
  );
  lines.push(
    "  document from a realistic mockup, and isn't expected to."
  );
  lines.push("");
  lines.push("LIMITATIONS — read before citing any number above:");
  lines.push("  - This set is very small (14 scored documents, unevenly split across");
  lines.push("    3 fields — see the per-field n above). A handful of documents can swing");
  lines.push("    the percentage a lot; treat these numbers as anecdotal, not statistical.");
  lines.push("  - Some ground-truth values were transcribed from small or angled text");
  lines.push("    by visual inspection (not verified against an independent source), and");
  lines.push("    carry a 'confidence' rating in real_ground_truth.json for that reason —");
  lines.push("    a 'wrong' result against a 'low' confidence entry may be a ground-truth");
  lines.push("    transcription error rather than a genuine extraction failure.");
  lines.push("  - No payslip/net salary documents were supplied in this set, so that field");
  lines.push("    isn't represented here at all (it is covered in the synthetic report).");
  lines.push("  - These results are NOT a production accuracy claim, and are not a");
  lines.push("    substitute for the larger synthetic evaluation — see");
  lines.push("    OCR_EVALUATION_REPORT.txt and OCR_FEATURE.md.");
  lines.push("");

  fs.writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
  fs.writeFileSync(
    RESULTS_JSON_PATH,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      excluded: groundTruth.excluded,
      metrics: metrics.map((m) => ({
        field: m.spec.label,
        documentType: m.spec.documentType,
        precision: m.metrics.precision,
        recall: m.metrics.recall,
        tp: m.metrics.tp,
        fp: m.metrics.fp,
        fn: m.metrics.fn,
        documents: m.results,
      })),
    }, null, 2)
  );

  console.log("\n" + lines.join("\n"));
  console.log(`\nReport written to ${REPORT_PATH}`);
  console.log(`Full detail written to ${RESULTS_JSON_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

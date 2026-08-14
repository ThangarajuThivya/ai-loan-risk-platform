"use strict";

/**
 * Runnable test script for the document extraction pipeline.
 *   node src/services/__tests__/documentPipeline.test.js
 * Exits non-zero on the first failed assertion.
 *
 * The pipeline is the feature's composition layer, so its dependencies —
 * the database, the stored file, the OCR call — are injected as fakes via
 * runExtractionPipeline's `deps` seam. No DB, no disk, no network.
 *
 * Requiring the service transitively requires the models, which create a
 * mysql2 pool at module load; nothing here queries it, but the open pool
 * would keep the process alive, hence the explicit process.exit(0) at the
 * end. Whether a database is actually reachable makes no difference to any
 * assertion below.
 */

const assert = require("assert");
const {
  runExtractionPipeline,
  processDocumentInBackground,
  presentExtraction,
  buildExtractedBundle,
  overallConfidence,
} = require("../documentPipeline.service");

let passed = 0;
function check(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok - ${name}`);
  });
}

/** A fake source: records every upsert, so we can assert on what was persisted. */
function fakeSource({ isLease = false, stored = [] } = {}) {
  const writes = [];
  return {
    writes,
    wiring: {
      isLease,
      upsert: async (args) => {
        writes.push(args);
        return { ...args, id: 1 };
      },
      listForApplication: async () => stored,
    },
  };
}

const BASE_ARGS = {
  source: "loan",
  documentId: 7,
  applicationId: 3,
  userId: 42,
  documentType: "national_id",
  storagePath: "/secure-uploads/loan-documents/abc.pdf",
  mimeType: "application/pdf",
};

/** deps that succeed all the way through unless overridden. */
function deps(source, overrides = {}) {
  return {
    sources: { loan: source.wiring, lease: source.wiring },
    isPathAllowed: () => true,
    readFile: async () => Buffer.from("bytes"),
    recognize: async () => ({
      status: "succeeded",
      engine: "pdf-text-layer",
      rawText: "National Identity Card\nNIC No: 851234567V\n",
      pageCount: 1,
    }),
    findDeclared: async () => ({
      fullName: "Nimal Perera",
      dateOfBirth: "1985-05-03",
      gender: "male",
      monthlyIncome: 150000,
      bankAccountHolderName: "Nimal Perera",
    }),
    ...overrides,
  };
}

const last = (writes) => writes[writes.length - 1];

async function run() {
  // -------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------
  console.log("Happy path");

  await check("extracts, validates and persists a recognised document", async () => {
    const src = fakeSource();
    await runExtractionPipeline(BASE_ARGS, deps(src));

    // Claims the row as 'pending' first, then writes the result.
    assert.strictEqual(src.writes.length, 2);
    assert.strictEqual(src.writes[0].extractionStatus, "pending");

    const final = last(src.writes);
    assert.strictEqual(final.extractionStatus, "succeeded");
    assert.strictEqual(final.engine, "pdf-text-layer");
    assert.strictEqual(final.extractedFields.national_id.value.nic, "851234567V");
    assert(typeof final.confidenceScore === "number");
    assert(Array.isArray(final.validationFindings));
  });

  await check("cross-checks the NIC against the applicant's declared facts", async () => {
    const src = fakeSource();
    // Declared DOB deliberately disagrees with the NIC's 1985-05-03.
    await runExtractionPipeline(
      BASE_ARGS,
      deps(src, {
        findDeclared: async () => ({ dateOfBirth: "1990-01-01", gender: "male" }),
      })
    );
    const codes = last(src.writes).validationFindings.map((f) => f.code);
    assert(codes.includes("nic_dob_mismatch"), `expected a DOB mismatch, got ${codes}`);
    const mismatch = last(src.writes).validationFindings.find((f) => f.code === "nic_dob_mismatch");
    assert.strictEqual(mismatch.severity, "blocker");
  });

  await check("validates the new document against ones already extracted", async () => {
    // A bank statement extracted on an earlier upload names someone else.
    // Only a CROSS-document check catches that — the NIC being uploaded now
    // carries no name of its own to compare against.
    const src = fakeSource({
      stored: [
        {
          document_type: "bank_statement",
          extraction_status: "succeeded",
          extracted_fields: {
            account_holder: { value: "Sunil Fernando", snippet: "x", confidence: 0.9 },
          },
        },
      ],
    });
    await runExtractionPipeline(BASE_ARGS, deps(src));
    const findings = last(src.writes).validationFindings;
    const mismatch = findings.find(
      (f) => f.code === "identity_name_bank_statement_registered_account_mismatch"
    );
    assert(
      mismatch,
      `expected a stored-document name mismatch, got ${findings.map((f) => f.code)}`
    );
  });

  // -------------------------------------------------------------------
  // Failure modes never break the upload
  // -------------------------------------------------------------------
  console.log("Failure modes");

  await check("records 'skipped' when OCR was never attempted", async () => {
    const src = fakeSource();
    await runExtractionPipeline(
      BASE_ARGS,
      deps(src, {
        recognize: async () => ({ status: "skipped", engine: null, rawText: null, pageCount: null }),
      })
    );
    const final = last(src.writes);
    assert.strictEqual(final.extractionStatus, "skipped");
    assert.strictEqual(final.extractedFields, null);
  });

  await check("records 'failed' when OCR was attempted and produced nothing", async () => {
    const src = fakeSource();
    await runExtractionPipeline(
      BASE_ARGS,
      deps(src, {
        recognize: async () => ({
          status: "failed",
          engine: "gemini-vision",
          rawText: null,
          pageCount: null,
        }),
      })
    );
    const final = last(src.writes);
    assert.strictEqual(final.extractionStatus, "failed");
    assert.strictEqual(final.engine, "gemini-vision");
  });

  await check("refuses to read a storage path outside the document directory", async () => {
    const src = fakeSource();
    let read = false;
    await runExtractionPipeline(
      { ...BASE_ARGS, storagePath: "/etc/passwd" },
      deps(src, {
        isPathAllowed: () => false,
        readFile: async () => {
          read = true;
          return Buffer.from("x");
        },
      })
    );
    assert.strictEqual(read, false, "the file must never be opened");
    assert.strictEqual(last(src.writes).extractionStatus, "failed");
  });

  await check("records 'failed' when the stored file has gone missing", async () => {
    const src = fakeSource();
    await runExtractionPipeline(
      BASE_ARGS,
      deps(src, {
        readFile: async () => {
          const err = new Error("ENOENT");
          err.code = "ENOENT";
          throw err;
        },
      })
    );
    assert.strictEqual(last(src.writes).extractionStatus, "failed");
  });

  await check("keeps the extracted fields when validation itself fails", async () => {
    const src = fakeSource();
    await runExtractionPipeline(
      BASE_ARGS,
      deps(src, {
        findDeclared: async () => {
          throw new Error("database unavailable");
        },
      })
    );
    const final = last(src.writes);
    assert.strictEqual(final.extractionStatus, "succeeded");
    assert.strictEqual(final.extractedFields.national_id.value.nic, "851234567V");
    assert.deepStrictEqual(final.validationFindings, []);
  });

  // -------------------------------------------------------------------
  // Advisory-only guarantee
  // -------------------------------------------------------------------
  console.log("Advisory-only guarantee");

  await check("never writes verification_status, on any path", async () => {
    for (const override of [
      {},
      { recognize: async () => ({ status: "failed", engine: "gemini-vision", rawText: null, pageCount: null }) },
      { findDeclared: async () => ({ dateOfBirth: "1990-01-01" }) }, // produces a blocker
    ]) {
      const src = fakeSource();
      await runExtractionPipeline(BASE_ARGS, deps(src, override));
      for (const write of src.writes) {
        assert.strictEqual(
          "verificationStatus" in write,
          false,
          "the pipeline must never write verification_status"
        );
      }
    }
  });

  // -------------------------------------------------------------------
  // The admin "run extraction automatically" setting
  // -------------------------------------------------------------------
  console.log("Auto-extraction setting");

  await check("skips the pipeline entirely when auto-extraction is disabled", async () => {
    const src = fakeSource();
    let extractionRan = false;
    await processDocumentInBackground(
      BASE_ARGS,
      deps(src, {
        isAutoExtractionEnabled: async () => false,
        recognize: async () => {
          extractionRan = true;
          return { status: "succeeded", engine: "pdf-text-layer", rawText: "x", pageCount: 1 };
        },
      })
    );
    assert.strictEqual(extractionRan, false, "OCR must never run while the setting is off");
    assert.strictEqual(src.writes.length, 0, "no extraction row should be written while the setting is off");
  });

  await check("runs the pipeline as normal when auto-extraction is enabled", async () => {
    const src = fakeSource();
    await processDocumentInBackground(BASE_ARGS, deps(src, { isAutoExtractionEnabled: async () => true }));
    assert.strictEqual(last(src.writes).extractionStatus, "succeeded");
  });

  await check("swallows a failure in the setting lookup itself rather than rejecting", async () => {
    const src = fakeSource();
    await assert.doesNotReject(
      processDocumentInBackground(
        BASE_ARGS,
        deps(src, {
          isAutoExtractionEnabled: async () => {
            throw new Error("database unavailable");
          },
        })
      )
    );
  });

  // -------------------------------------------------------------------
  // Pure helpers
  // -------------------------------------------------------------------
  console.log("Pure helpers");

  await check("overallConfidence averages the extracted fields' confidences", () => {
    assert.strictEqual(overallConfidence({ a: { confidence: 0.9 }, b: { confidence: 0.7 } }), 0.8);
    assert.strictEqual(overallConfidence({ a: null }), null);
    assert.strictEqual(overallConfidence({}), null);
  });

  await check("buildExtractedBundle merges stored rows under the run in progress", () => {
    const bundle = buildExtractedBundle(
      [
        {
          document_type: "national_id",
          extraction_status: "succeeded",
          extracted_fields: { national_id: { value: { nic: "OLD" } }, name: { value: "Nimal" } },
        },
        {
          document_type: "bank_statement",
          extraction_status: "failed",
          extracted_fields: { bank: { value: "ignored" } },
        },
      ],
      "national_id",
      { national_id: { value: { nic: "NEW" } } }
    );
    assert.strictEqual(bundle.national_id.national_id.value.nic, "NEW");
    // A field the current run did not produce survives from the stored row.
    assert.strictEqual(bundle.national_id.name.value, "Nimal");
    // A failed row contributes nothing.
    assert.strictEqual(bundle.bank_statement, undefined);
  });

  await check("presentExtraction reports a never-extracted document as pending, not missing", () => {
    const res = presentExtraction({ id: 5, document_type: "payslip" }, null);
    assert.strictEqual(res.extraction_status, "pending");
    assert.deepStrictEqual(res.extracted_fields, {});
    assert.deepStrictEqual(res.validation_findings, []);
  });

  await check("presentExtraction never leaks the raw transcript", () => {
    const res = presentExtraction(
      { id: 5, document_type: "payslip" },
      {
        extraction_status: "succeeded",
        engine: "pdf-text-layer",
        raw_text: "SECRET FULL DOCUMENT TEXT",
        extracted_fields: { net_salary: { value: 100 } },
        validation_findings: [],
        confidence_score: "0.900",
        updated_at: "2026-08-14T00:00:00Z",
      }
    );
    assert.strictEqual("raw_text" in res, false);
    assert.strictEqual(res.confidence_score, 0.9);
  });

  console.log(`\n${passed} assertions passed.`);
  // The models' mysql2 pool is open; nothing above used it, but it would
  // otherwise hold the event loop forever.
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

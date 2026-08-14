"use strict";

/**
 * Runnable test script for the OCR engine adapter.
 *   node src/services/__tests__/ocr.test.js
 * Exits non-zero on the first failed assertion.
 *
 * Network calls (Gemini Vision) are stubbed by monkey-patching axios.post —
 * ocr.service.js holds a reference to the same shared `axios` module object
 * this file requires, so reassigning `.post` on it here is visible to the
 * service without a mocking library. PDF fixtures are real, in-memory
 * pdfkit-generated PDFs (no I/O — pdfkit renders to a Buffer), which
 * exercises pdf-parse for real rather than stubbing it.
 */

const assert = require("assert");
const PDFDocument = require("pdfkit");
const axios = require("axios");
const { recognizeDocument } = require("../ocr.service");

let passed = 0;
function check(name, fn) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ok - ${name}`);
  });
}

function stubAxiosPost(fn) {
  const original = axios.post;
  axios.post = fn;
  return () => {
    axios.post = original;
  };
}

/** Render a pdfkit document to a Buffer in memory — no filesystem I/O. */
function renderPdf(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}

async function run() {
  // -------------------------------------------------------------------
  // PDF text-layer routing
  // -------------------------------------------------------------------
  console.log("PDF text-layer routing");

  await check("extracts text directly from a PDF with a text layer, skipping OCR", async () => {
    const unstubbed = stubAxiosPost(async () => {
      throw new Error("axios.post must not be called for a text-layer PDF");
    });
    try {
      const buffer = await renderPdf((doc) => doc.text("Applicant NIC No: 851234567V, Colombo 03"));
      const res = await recognizeDocument({ buffer, mimeType: "application/pdf" });
      assert.strictEqual(res.status, "succeeded");
      assert.strictEqual(res.engine, "pdf-text-layer");
      assert(res.rawText.includes("851234567V"));
      assert.strictEqual(res.pageCount, 1);
    } finally {
      unstubbed();
    }
  });

  // -------------------------------------------------------------------
  // Scanned-document routing
  // -------------------------------------------------------------------
  console.log("Scanned-document routing");

  await check("routes a text-less (scanned) PDF to Gemini Vision", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    let called = false;
    const unstubbed = stubAxiosPost(async (url, body) => {
      called = true;
      assert(url.includes("generateContent"));
      assert(body.contents[0].parts.some((p) => p.inline_data?.mime_type === "application/pdf"));
      return { data: { candidates: [{ content: { parts: [{ text: "recognized text" }] } }] } };
    });
    try {
      // A PDF with only a filled rectangle has no extractable text layer.
      const buffer = await renderPdf((doc) => doc.rect(0, 0, 100, 100).fill("red"));
      const res = await recognizeDocument({ buffer, mimeType: "application/pdf" });
      assert.strictEqual(called, true);
      assert.strictEqual(res.status, "succeeded");
      assert.strictEqual(res.engine, "gemini-vision");
      assert.strictEqual(res.rawText, "recognized text");
      assert.strictEqual(res.pageCount, 1);
    } finally {
      unstubbed();
      delete process.env.GEMINI_API_KEY;
    }
  });

  await check("routes an image straight to Gemini Vision", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const unstubbed = stubAxiosPost(async () => ({
      data: { candidates: [{ content: { parts: [{ text: "bank statement text" }] } }] },
    }));
    try {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]); // JPEG magic bytes, contents irrelevant — axios is stubbed
      const res = await recognizeDocument({ buffer, mimeType: "image/jpeg" });
      assert.strictEqual(res.status, "succeeded");
      assert.strictEqual(res.engine, "gemini-vision");
      assert.strictEqual(res.rawText, "bank statement text");
      assert.strictEqual(res.pageCount, 1);
    } finally {
      unstubbed();
      delete process.env.GEMINI_API_KEY;
    }
  });

  // -------------------------------------------------------------------
  // Missing-key fallback
  // -------------------------------------------------------------------
  console.log("Missing-key fallback");

  await check("skips recognition (never calls axios) when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const unstubbed = stubAxiosPost(async () => {
      throw new Error("axios.post must not be called with no API key");
    });
    try {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
      const res = await recognizeDocument({ buffer, mimeType: "image/jpeg" });
      assert.strictEqual(res.status, "skipped");
      assert.strictEqual(res.engine, null);
      assert.strictEqual(res.rawText, null);
    } finally {
      unstubbed();
    }
  });

  // -------------------------------------------------------------------
  // Timeout fallback
  // -------------------------------------------------------------------
  console.log("Timeout fallback");

  await check("returns failed, not a throw, when the Gemini call times out", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const unstubbed = stubAxiosPost(async () => {
      const err = new Error("timeout of 10000ms exceeded");
      err.code = "ECONNABORTED";
      throw err;
    });
    try {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
      const res = await recognizeDocument({ buffer, mimeType: "image/jpeg" });
      assert.strictEqual(res.status, "failed");
      assert.strictEqual(res.engine, "gemini-vision");
      assert.strictEqual(res.rawText, null);
    } finally {
      unstubbed();
      delete process.env.GEMINI_API_KEY;
    }
  });

  // -------------------------------------------------------------------
  // Empty-response fallback
  // -------------------------------------------------------------------
  console.log("Empty-response fallback");

  await check("returns failed when Gemini responds with no usable text", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const unstubbed = stubAxiosPost(async () => ({
      data: { candidates: [{ content: { parts: [{ text: "" }] } }] },
    }));
    try {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
      const res = await recognizeDocument({ buffer, mimeType: "image/jpeg" });
      assert.strictEqual(res.status, "failed");
      assert.strictEqual(res.engine, "gemini-vision");
      assert.strictEqual(res.rawText, null);
    } finally {
      unstubbed();
      delete process.env.GEMINI_API_KEY;
    }
  });

  // -------------------------------------------------------------------
  // Other resilience edges
  // -------------------------------------------------------------------
  console.log("Other resilience edges");

  await check("skips an empty buffer without touching the network", async () => {
    const unstubbed = stubAxiosPost(async () => {
      throw new Error("axios.post must not be called for an empty buffer");
    });
    try {
      const res = await recognizeDocument({ buffer: Buffer.alloc(0), mimeType: "application/pdf" });
      assert.strictEqual(res.status, "skipped");
    } finally {
      unstubbed();
    }
  });

  await check("skips an unsupported mime type without touching the network", async () => {
    const unstubbed = stubAxiosPost(async () => {
      throw new Error("axios.post must not be called for an unsupported mime type");
    });
    try {
      const res = await recognizeDocument({ buffer: Buffer.from("hello"), mimeType: "text/plain" });
      assert.strictEqual(res.status, "skipped");
    } finally {
      unstubbed();
    }
  });

  await check("never throws even when axios throws something unexpected", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const unstubbed = stubAxiosPost(async () => {
      throw new TypeError("boom");
    });
    try {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
      const res = await recognizeDocument({ buffer, mimeType: "image/jpeg" });
      assert.strictEqual(res.status, "failed");
    } finally {
      unstubbed();
      delete process.env.GEMINI_API_KEY;
    }
  });

  console.log(`\n${passed} assertions passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

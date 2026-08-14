"use strict";

/**
 * OCR engine adapter — the ONLY module in the document-extraction feature
 * that performs I/O (network calls to Gemini Vision; local PDF text-layer
 * parsing). Every other module in this feature (nicValidation, document
 * Extraction, documentValidation) is pure and does no I/O at all — this is
 * where that boundary lives.
 *
 * recognizeDocument() does recognition only: it turns a document's raw
 * bytes into raw text. It does not parse fields out of that text (Step 2 —
 * documentExtraction.service.js) and does not validate anything (Step 3 —
 * documentValidation.service.js).
 *
 * Resilience contract — mirrors gemini.service.js's explainRisk():
 *   - Secrets stay server-side: GEMINI_API_KEY is read from the environment
 *     and never returned to a caller.
 *   - Never throws. Every failure mode (missing key, network error,
 *     timeout, empty response, unreadable/corrupt input) resolves to a
 *     `{ status, engine, rawText, pageCount }` object instead — exactly
 *     like explainRisk() always resolves to a usable string. A caller that
 *     already persisted an uploaded document must be able to call this
 *     immediately afterward without risking that success: OCR failing here
 *     can never fail the upload.
 *   - status is one of 'succeeded' | 'failed' | 'skipped':
 *       'skipped' — recognition was never attempted (empty input, an
 *         unsupported mime type, or no GEMINI_API_KEY configured so a
 *         Vision call was never dispatched).
 *       'failed'  — recognition was attempted but did not produce usable
 *         text (network error, timeout, or an empty model response).
 *       'succeeded' — rawText is populated and usable.
 */

const axios = require("axios");
const { PDFParse } = require("pdf-parse");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
// Same convention as gemini.service.js's GEMINI_TIMEOUT_MS. Overridable via
// env because the OCR evaluation harness (scripts/ocrEval/) runs the same
// call in a non-interactive batch context where a longer timeout is
// appropriate; production's upload-latency-sensitive default is unchanged.
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 10000;

// A PDF's extracted text layer must clear this many non-whitespace
// characters (after stripping pdf-parse's own "-- n of m --" page-break
// markers) to count as "has a text layer" rather than a blank/near-blank
// scanned page that happens to parse without error.
const TEXT_LAYER_MIN_CHARS = 20;

const OCR_PROMPT = [
  "You are an OCR engine. Transcribe every piece of text visible in this",
  "document exactly as it appears, preserving line breaks where they occur.",
  "Do not summarize, translate, explain, or add any commentary of your own —",
  "output only the raw transcribed text.",
].join(" ");

function result(status, engine, rawText, pageCount) {
  return { status, engine, rawText, pageCount };
}

/**
 * Strip pdf-parse's own page-break markers before judging whether a PDF
 * actually has a meaningful text layer.
 */
function meaningfulTextLength(text) {
  return String(text || "")
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, "")
    .trim().length;
}

/**
 * Try to read a PDF's embedded text layer directly, no AI model involved.
 * @param {Buffer} buffer
 * @returns {Promise<{hasText: boolean, text: string|null, pageCount: number|null}>}
 */
async function tryExtractPdfTextLayer(buffer) {
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    const pageCount = Number.isFinite(parsed.total) ? parsed.total : null;
    if (meaningfulTextLength(parsed.text) >= TEXT_LAYER_MIN_CHARS) {
      return { hasText: true, text: parsed.text, pageCount };
    }
    return { hasText: false, text: null, pageCount };
  } catch (err) {
    // Corrupt / encrypted / unparsable PDF — treat exactly like a scanned
    // PDF with no readable text layer, and let the Gemini Vision fallback
    // have a try. Page count is unknowable since we never got to parse it.
    return { hasText: false, text: null, pageCount: null };
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // parser was never fully initialized — nothing to clean up.
      }
    }
  }
}

/**
 * Pull the plain-text response out of a Gemini generateContent payload.
 * Same shape/extraction as gemini.service.js.
 */
function extractGeminiText(response) {
  return (response.data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

/**
 * Send a scanned PDF page or image to Gemini Vision for text recognition.
 * Read fresh from process.env on every call (rather than captured once at
 * module load, as gemini.service.js does) so a deployment's key rotation —
 * and this file's own tests — don't require a process restart.
 * @param {object} p
 * @param {Buffer} p.buffer
 * @param {string} p.mimeType
 * @param {number|null} p.pageCount
 * @returns {Promise<{status, engine, rawText, pageCount}>}
 */
async function recognizeWithGeminiVision({ buffer, mimeType, pageCount, model }) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    return result("skipped", null, null, pageCount);
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model || GEMINI_MODEL)}:generateContent`;

  try {
    const response = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              { text: OCR_PROMPT },
              { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
            ],
          },
        ],
      },
      {
        timeout: OCR_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
      }
    );

    const text = extractGeminiText(response);
    if (!text) {
      console.warn("[ocr] Gemini Vision returned an empty response — marking failed.");
      return result("failed", "gemini-vision", null, pageCount);
    }
    return result("succeeded", "gemini-vision", text, pageCount);
  } catch (err) {
    const detail = err.response ? `HTTP ${err.response.status}` : err.code || err.message;
    console.warn(`[ocr] Gemini Vision recognition failed (${detail}).`);
    return result("failed", "gemini-vision", null, pageCount);
  }
}

/**
 * Recognize text in one uploaded document. Routing order:
 *   1. application/pdf with an extractable text layer → read it directly,
 *      no AI model involved.
 *   2. application/pdf with no text layer (scanned) or an image/* mime
 *      type → Gemini Vision.
 *   3. Anything else (empty buffer, unsupported mime type) → skipped.
 *
 * Never throws — see the file header's resilience contract.
 *
 * @param {object} p
 * @param {Buffer} p.buffer the document's raw bytes
 * @param {string} p.mimeType e.g. "application/pdf", "image/jpeg"
 * @param {string} [p.model] override GEMINI_MODEL for this call only. Not
 *   used by any production caller (all of which want the configured
 *   default); exists so the eval harness (scripts/ocrEval/) can spread a
 *   batch run across several Gemini model names, each with its own
 *   separate free-tier daily quota, without touching the shared
 *   GEMINI_MODEL env var that gemini.service.js also reads.
 * @returns {Promise<{status: 'succeeded'|'failed'|'skipped', engine: string|null, rawText: string|null, pageCount: number|null}>}
 */
async function recognizeDocument({ buffer, mimeType, model } = {}) {
  try {
    if (!buffer || !buffer.length) {
      return result("skipped", null, null, null);
    }

    if (mimeType === "application/pdf") {
      const textLayer = await tryExtractPdfTextLayer(buffer);
      if (textLayer.hasText) {
        return result("succeeded", "pdf-text-layer", textLayer.text, textLayer.pageCount);
      }
      return recognizeWithGeminiVision({ buffer, mimeType, pageCount: textLayer.pageCount, model });
    }

    if (typeof mimeType === "string" && mimeType.startsWith("image/")) {
      return recognizeWithGeminiVision({ buffer, mimeType, pageCount: 1, model });
    }

    return result("skipped", null, null, null);
  } catch (err) {
    // Belt-and-braces: nothing above should throw, but a caller's upload
    // flow must never fail because of this service, no matter what.
    console.warn(`[ocr] unexpected failure — marking failed (${err.message}).`);
    return result("failed", null, null, null);
  }
}

module.exports = {
  recognizeDocument,
};

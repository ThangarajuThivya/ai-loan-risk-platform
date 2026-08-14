"use strict";

/**
 * Rule-based field extraction from raw OCR/PDF text — pure, deterministic,
 * no I/O. Given text that some upstream step already turned a document
 * image/PDF into (this service does no OCR itself), it pulls out the
 * fields underwriting cares about using label anchors and known patterns.
 *
 * Every extracted field is either `null` (nothing found — this service
 * never guesses a missing value) or `{ value, snippet, confidence }`,
 * where `snippet` is the exact source text the value was read from and
 * `confidence` reflects how the match was made: a labelled field
 * ("Registration No: ...") is trusted more than a bare pattern found
 * loose in the text with no label nearby.
 */

const { DOCUMENT_TYPES } = require("./loanDocument.service");
const { LEASE_DOCUMENT_TYPES } = require("./leaseDocument.service");
const { normalizeNic, parseNic } = require("./nicValidation.service");

const SUPPORTED_DOCUMENT_TYPES = Array.from(
  new Set([...DOCUMENT_TYPES, ...LEASE_DOCUMENT_TYPES])
);

/** Confidence bands. A labelled match is trusted more than a bare pattern match found with no label nearby. */
const CONFIDENCE = {
  LABEL_ANCHOR: 0.95,
  KEYWORD_MATCH: 0.85,
  LOOSE_PATTERN: 0.6,
};

function field(value, snippet, confidence) {
  if (value === null || value === undefined || value === "") return null;
  return { value, snippet: String(snippet).trim(), confidence };
}

// ---------------------------------------------------------------------------
// Shared normalizers
// ---------------------------------------------------------------------------

/**
 * Parse a Sri Lankan LKR amount string into a number, or null if it can't
 * be parsed. Handles "Rs.", "රු.", "LKR" prefixes, thousands separators,
 * the trailing "/=" convention, and parenthesized negatives.
 * @param {string} str
 * @returns {number|null}
 */
function parseLkrAmount(str) {
  if (str === null || str === undefined) return null;
  let s = String(str).trim();
  if (!s) return null;

  let negative = false;
  const paren = s.match(/^\(([^)]+)\)$/);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  } else if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1).trim();
  }

  s = s.replace(/Rs\.?|රු\.?|LKR/gi, "").trim();
  s = s.replace(/\/=\s*$/, "").trim();
  s = s.replace(/,/g, "");

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const num = parseFloat(s);
  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * Parse a locally-formatted date string as DD/MM/YYYY (never MM/DD/YYYY —
 * US ordering is never assumed). Accepts "/", "-" or "." separators and a
 * 2- or 4-digit year. Returns an ISO "YYYY-MM-DD" string, or null.
 * @param {string} str
 * @returns {string|null}
 */
function parseLocalDate(str) {
  if (!str) return null;
  const m = String(str)
    .trim()
    .match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (m[3].length === 2) year += year < 50 ? 2000 : 1900;

  if (month < 1 || month > 12) return null;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthLengths[month - 1]) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Line-labelled field helper
// ---------------------------------------------------------------------------

/**
 * Find "Label: value" (or "Label - value") on its own line, trying each
 * label alternative in order. This is how the vast majority of structured
 * fields on a CR copy or bank statement are laid out.
 */
function extractLineField(text, labelAlternatives, confidence = CONFIDENCE.LABEL_ANCHOR) {
  const labelPattern = labelAlternatives.join("|");
  const re = new RegExp(`^[ \\t]*(?:${labelPattern})[ \\t]*[:\\-][ \\t]*(.+?)[ \\t]*$`, "im");
  const m = text.match(re);
  if (!m || !m[1].trim()) return null;
  return field(m[1].trim(), m[0], confidence);
}

// ---------------------------------------------------------------------------
// 2.1 national_id
// ---------------------------------------------------------------------------

const NIC_LABEL_RE =
  /(?:NIC|N\.I\.C\.?|National\s*ID(?:entity)?\s*(?:Card)?)\s*(?:No\.?|Number)?\s*[:\-]?\s*([0-9][0-9\s-]{7,13}[VXvx]?)/;
const NIC_OLD_BARE_RE = /\b\d{2}-?\d{3}-?\d{4}-?[VXvx]\b/;
const NIC_NEW_BARE_RE = /\b\d{12}\b/;

function extractNationalId(text) {
  const labelMatch = text.match(NIC_LABEL_RE);
  if (labelMatch) {
    const candidate = normalizeNic(labelMatch[1]);
    const parsed = parseNic(candidate);
    if (parsed.valid) {
      return field({ nic: candidate, ...parsed }, labelMatch[0], CONFIDENCE.LABEL_ANCHOR);
    }
  }

  const bareCandidates = [
    ...(text.match(new RegExp(NIC_OLD_BARE_RE, "g")) || []),
    ...(text.match(new RegExp(NIC_NEW_BARE_RE, "g")) || []),
  ];
  for (const candidate of bareCandidates) {
    const normalized = normalizeNic(candidate);
    const parsed = parseNic(normalized);
    if (parsed.valid) {
      return field({ nic: normalized, ...parsed }, candidate, CONFIDENCE.LOOSE_PATTERN);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 2.2 cr_copy (DMT Certificate of Registration)
// ---------------------------------------------------------------------------

const REG_NO_LABEL_RE =
  /(?:Registration|Reg\.?|Regn\.?)\s*(?:No\.?|Number)\s*[:\-]?\s*([A-Za-z]{2,3}-?\d{4}|\d{2,3}-\d{4})/i;
const REG_NO_NEW_BARE_RE = /\b[A-Za-z]{2,3}-?\d{4}\b/;
const REG_NO_OLD_BARE_RE = /\b\d{2,3}-\d{4}\b/;

function extractRegistrationNumber(text) {
  const labelMatch = text.match(REG_NO_LABEL_RE);
  if (labelMatch) {
    return field(labelMatch[1].toUpperCase(), labelMatch[0], CONFIDENCE.LABEL_ANCHOR);
  }

  const bare = text.match(REG_NO_NEW_BARE_RE) || text.match(REG_NO_OLD_BARE_RE);
  if (bare) {
    return field(bare[0].toUpperCase(), bare[0], CONFIDENCE.LOOSE_PATTERN);
  }

  return null;
}

function extractYearOfManufacture(text) {
  const line = extractLineField(text, [
    "Year\\s*of\\s*Manufacture",
    "Manufactured\\s*Year",
    "YOM",
  ]);
  if (!line) return null;
  const yearMatch = String(line.value).match(/(?:19|20)\d{2}/);
  if (!yearMatch) return null;
  return field(parseInt(yearMatch[0], 10), line.snippet, line.confidence);
}

function extractAbsoluteOwner(text) {
  const line = extractLineField(text, ["Absolute\\s*Owner", "Owner"]);
  if (!line) return null;
  const likelyFinanceCompany = /Finance|Leasing|Bank/i.test(line.value);
  return field({ name: line.value, likelyFinanceCompany }, line.snippet, line.confidence);
}

function extractCrCopyFields(text) {
  return {
    registration_number: extractRegistrationNumber(text),
    chassis_number: extractLineField(text, ["Chassis\\s*No\\.?", "Chassis\\s*Number"]),
    engine_number: extractLineField(text, ["Engine\\s*No\\.?", "Engine\\s*Number"]),
    make: extractLineField(text, ["Make"]),
    model: extractLineField(text, ["Model"]),
    year_of_manufacture: extractYearOfManufacture(text),
    fuel_type: extractLineField(text, ["Fuel\\s*Type", "Fuel"]),
    class_of_vehicle: extractLineField(text, ["Class\\s*of\\s*Vehicle", "Vehicle\\s*Class"]),
    absolute_owner: extractAbsoluteOwner(text),
  };
}

// ---------------------------------------------------------------------------
// 2.3 bank_statement
// ---------------------------------------------------------------------------

/** Fixed list of banks recognised from statement header text — closed set, not a guess. */
const BANK_KEYWORDS = [
  { id: "BOC", pattern: /Bank\s*of\s*Ceylon|\bBOC\b/i },
  { id: "People's Bank", pattern: /People'?s\s*Bank/i },
  { id: "Commercial Bank", pattern: /Commercial\s*Bank(?:\s*of\s*Ceylon)?/i },
  { id: "HNB", pattern: /Hatton\s*National\s*Bank|\bHNB\b/i },
  { id: "Sampath", pattern: /Sampath\s*Bank|\bSampath\b/i },
  { id: "NDB", pattern: /National\s*Development\s*Bank|\bNDB\b/i },
  { id: "NSB", pattern: /National\s*Savings\s*Bank|\bNSB\b/i },
  { id: "Seylan", pattern: /Seylan\s*Bank|\bSeylan\b/i },
  { id: "DFCC", pattern: /DFCC\s*Bank|\bDFCC\b/i },
  { id: "Nations Trust", pattern: /Nations\s*Trust\s*Bank|\bNTB\b/i },
];

function extractBank(text) {
  // Match against every bank and keep the leftmost hit — not just the
  // first list entry — so e.g. "Commercial Bank of Ceylon" (which also
  // contains the substring "Bank of Ceylon") resolves to Commercial Bank
  // rather than BOC.
  let best = null;
  for (const { id, pattern } of BANK_KEYWORDS) {
    const m = text.match(pattern);
    if (m && (best === null || m.index < best.match.index)) {
      best = { id, match: m };
    }
  }
  if (!best) return null;
  return field(best.id, best.match[0], CONFIDENCE.KEYWORD_MATCH);
}

const STATEMENT_PERIOD_RE =
  /(?:Statement\s*Period|Period)\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\s*(?:to|-|–|until)\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i;

function extractStatementPeriod(text) {
  const m = text.match(STATEMENT_PERIOD_RE);
  if (!m) return null;
  const from = parseLocalDate(m[1]);
  const to = parseLocalDate(m[2]);
  if (!from || !to) return null;
  return field({ from, to }, m[0], CONFIDENCE.LABEL_ANCHOR);
}

function extractBalanceField(text, labelAlternatives) {
  const line = extractLineField(text, labelAlternatives);
  if (!line) return null;
  const amount = parseLkrAmount(line.value);
  if (amount === null) return null;
  return field(amount, line.snippet, line.confidence);
}

function extractBankStatementFields(text) {
  return {
    bank: extractBank(text),
    account_number: extractLineField(text, [
      "Account\\s*No\\.?",
      "A/C\\s*No\\.?",
      "Account\\s*Number",
      "Acc\\.?\\s*No\\.?",
    ]),
    account_holder: extractLineField(text, [
      "Account\\s*Name",
      "Account\\s*Holder",
      "Customer\\s*Name",
    ]),
    branch: extractLineField(text, ["Branch"]),
    statement_period: extractStatementPeriod(text),
    opening_balance: extractBalanceField(text, ["Opening\\s*Balance"]),
    closing_balance: extractBalanceField(text, ["Closing\\s*Balance"]),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Extract fields from raw OCR/PDF text for a given document type. Returns
 * an object of field name -> `{ value, snippet, confidence }` or `null`.
 * Document types with no extraction rules defined yet return `{}`.
 * @param {string} rawText
 * @param {string} documentType one of loanDocument.service's DOCUMENT_TYPES or leaseDocument.service's LEASE_DOCUMENT_TYPES
 * @returns {Object<string, {value: *, snippet: string, confidence: number}|null>}
 */
function extractFields(rawText, documentType) {
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentType)) {
    throw new Error(`Unsupported document_type: ${documentType}`);
  }
  const text = String(rawText || "");

  switch (documentType) {
    case "national_id":
      return { national_id: extractNationalId(text) };
    case "cr_copy":
      return extractCrCopyFields(text);
    case "bank_statement":
      return extractBankStatementFields(text);
    default:
      return {};
  }
}

module.exports = {
  extractFields,
  parseLkrAmount,
  parseLocalDate,
};

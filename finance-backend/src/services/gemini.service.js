"use strict";

/**
 * Gemini explanation service (GUIDANCE.md §6; ARCHITECTURE.md §9.3).
 *
 * explainRisk() turns a structured risk result + the top contributing factors
 * (DTI, CRIB score, guarantor exposure, savings ratio) into a short, plain-
 * language explanation for the customer. Optionally localized to Sinhala/Tamil
 * per the proposal's multilingual goal.
 *
 * Design rules honoured here:
 *   - Secrets stay server-side: the key is read from GEMINI_API_KEY and never
 *     leaves the gateway (ARCHITECTURE.md §10, P3).
 *   - Never fail the assess flow because of Gemini. When the key is absent, the
 *     call errors, or the response is empty, we return a deterministic fallback
 *     string built from the same factors — assess still succeeds.
 *
 * The Gemini REST API is called via axios (already a dependency) so no extra
 * package is required.
 */

const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_TIMEOUT_MS = 10000;

// Supported explanation languages (multilingual goal). Anything else → English.
const LANGUAGES = { english: "English", sinhala: "Sinhala", tamil: "Tamil" };

/**
 * Format a factor value for a prompt / fallback, tolerating missing data.
 * @param {*} value
 * @param {(n:number)=>string} fmt formatter applied to a finite number
 * @returns {string}
 */
function fmt(value, formatter) {
  const n = Number(value);
  return Number.isFinite(n) ? formatter(n) : "not available";
}

/**
 * Render the four risk factors as human-readable lines for the prompt.
 *
 * cribScore/guarantorExposure are never a verified credit-bureau record today
 * (there is no live CRIB integration) — they are either self-declared by the
 * applicant on the form, or a neutral placeholder when left blank. The
 * `cribProvided`/`guarantorProvided` flags make that distinction explicit so
 * the prompt (and therefore Gemini's output) doesn't assert a default as fact.
 *
 * @param {object} factors { dti, cribScore, cribProvided, guarantorExposure, guarantorProvided, savingsRatio }
 * @returns {string}
 */
function describeFactors(factors = {}) {
  const dti = fmt(factors.dti, (n) => `${(n * 100).toFixed(0)}%`);
  const crib = fmt(
    factors.cribScore,
    (n) =>
      `${Math.round(n)} (${factors.cribProvided ? "self-reported by applicant, not verified against CRIB" : "not provided — assumed neutral"})`
  );
  const guarantor = fmt(
    factors.guarantorExposure,
    (n) =>
      `LKR ${Math.round(n).toLocaleString("en-LK")} (${factors.guarantorProvided ? "self-reported by applicant" : "not provided — assumed none"})`
  );
  const savings = fmt(factors.savingsRatio, (n) => `${(n * 100).toFixed(0)}%`);

  return [
    `- Debt-to-income ratio: ${dti}`,
    `- CRIB credit score: ${crib}`,
    `- Guarantor exposure: ${guarantor}`,
    `- Savings ratio: ${savings}`,
  ].join("\n");
}

/**
 * Deterministic explanation used when Gemini is unavailable. Never throws.
 * @param {object} p { riskCategory, factors, languageName }
 * @returns {string}
 */
function fallbackExplanation({ riskCategory, factors = {} }) {
  const category = riskCategory || "assessed";
  const dtiPct = Number(factors.dti);
  const savingsPct = Number(factors.savingsRatio);
  const crib = Number(factors.cribScore);

  // Each driver explains the plain-English meaning of the metric alongside
  // the applicant's actual number, not just a label — a customer shouldn't
  // need to know what "DTI" or "CRIB" stand for to understand the sentence.
  const drivers = [];
  if (Number.isFinite(dtiPct)) {
    const pct = (dtiPct * 100).toFixed(0);
    drivers.push(
      dtiPct > 0.4
        ? `around ${pct}% of your income would go toward debt repayments each month, which is on the higher side`
        : `only about ${pct}% of your income would go toward debt repayments each month, which is manageable`
    );
  }
  if (Number.isFinite(crib) && factors.cribProvided) {
    // Only described as the applicant's own history when they actually
    // self-declared a score — never state the neutral default as fact.
    drivers.push(
      crib >= 700
        ? `your self-reported CRIB score of ${Math.round(crib)} shows a solid repayment history`
        : `your self-reported CRIB score of ${Math.round(crib)} suggests some past repayment issues`
    );
  } else if (Number.isFinite(crib)) {
    drivers.push(
      `we don't yet have your CRIB score on file, so this assessment assumes an average credit history`
    );
  }
  if (Number.isFinite(savingsPct)) {
    const pct = (savingsPct * 100).toFixed(0);
    drivers.push(
      savingsPct >= 0.2
        ? `you save around ${pct}% of your income each month, a healthy buffer`
        : `you currently save only around ${pct}% of your income each month, which is a bit low`
    );
  }

  const reason = drivers.length
    ? ` This is mainly because ${drivers.join("; and ")}.`
    : "";

  return `Based on your application, we've placed you in the ${category} category.${reason} This is an automated summary — a loan officer can walk through the details with you if you have questions.`;
}

/**
 * Build the structured prompt sent to Gemini.
 * @param {object} p { riskCategory, probabilities, factors, languageName }
 * @returns {string}
 */
function buildPrompt({ riskCategory, probabilities, factors, languageName }) {
  const probLines = probabilities
    ? Object.entries(probabilities)
        .map(([k, v]) => `- ${k}: ${(Number(v) * 100).toFixed(0)}%`)
        .join("\n")
    : "- not available";

  return [
    "You are a helpful loan advisor for a Sri Lankan bank.",
    `Explain, in plain language and in ${languageName}, why a loan applicant was assessed as "${riskCategory}".`,
    "",
    "Risk probabilities:",
    probLines,
    "",
    "Key factors:",
    describeFactors(factors),
    "",
    "Guidelines:",
    "- Write for an everyday bank customer, not a banker. Avoid jargon.",
    "- Whenever you mention a technical term (e.g. debt-to-income ratio, CRIB score,",
    "  guarantor exposure, savings ratio), briefly explain what it means in plain",
    "  words in the same sentence — don't just name it and move on.",
    "- Write 3-5 short, warm sentences, addressed directly to the applicant ('you').",
    "- Reference the specific factors and numbers that most influenced the result,",
    "  explained simply (e.g. 'about 46% of your income would go toward loan",
    "  repayments each month' rather than just 'DTI: 46%').",
    "- Be encouraging and constructive; do not promise or deny approval.",
    "- Do not invent numbers beyond those given. Output only the explanation text,",
    "  no headings, labels, or markdown.",
    "- The CRIB score and guarantor exposure above are marked as either",
    "  'self-reported by applicant' or 'not provided — assumed neutral/none'.",
    "  Never describe either one as a verified bureau/bank record — if you",
    "  reference it, reflect that it's self-reported or an assumed default.",
  ].join("\n");
}

/**
 * Produce a natural-language risk explanation.
 *
 * Never throws: on any failure (no key, network/timeout, bad response) it
 * returns a deterministic fallback so the caller can always attach a non-empty
 * explanation to the assess response.
 *
 * @param {object} p
 * @param {string} p.riskCategory   e.g. "Medium Risk"
 * @param {object} [p.probabilities] { "Low Risk": 0.31, ... }
 * @param {object} [p.factors]      { dti, cribScore, cribProvided, guarantorExposure, guarantorProvided, savingsRatio }
 * @param {string} [p.language]     "english" | "sinhala" | "tamil" (default english)
 * @returns {Promise<string>} a non-empty explanation string
 */
async function explainRisk({
  riskCategory,
  probabilities,
  factors = {},
  language = "english",
} = {}) {
  const languageName =
    LANGUAGES[String(language).toLowerCase()] || LANGUAGES.english;

  if (!GEMINI_API_KEY) {
    return fallbackExplanation({ riskCategory, factors });
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const prompt = buildPrompt({
    riskCategory,
    probabilities,
    factors,
    languageName,
  });

  try {
    const response = await axios.post(
      url,
      { contents: [{ parts: [{ text: prompt }] }] },
      {
        timeout: GEMINI_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
      }
    );

    const text = (response.data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!text) {
      console.warn("[gemini] empty response — using fallback explanation.");
      return fallbackExplanation({ riskCategory, factors });
    }
    return text;
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status}`
      : err.code || err.message;
    console.warn(`[gemini] explanation failed (${detail}) — using fallback.`);
    return fallbackExplanation({ riskCategory, factors });
  }
}

module.exports = {
  explainRisk,
  fallbackExplanation,
  buildPrompt,
};

"use strict";

require("dotenv").config();

/**
 * Synthetic Sri Lankan document generator for the OCR evaluation harness.
 *   node scripts/ocrEval/generateSyntheticDocuments.js
 *
 * Renders HTML/CSS document templates (lib/templates.js) with a headless
 * Chromium (Puppeteer) and screenshots them as JPEGs, applying scan-realism
 * augmentation — rotation, blur, glare, JPEG compression — so the fixture
 * set resembles photographed/scanned documents rather than clean renders.
 * No real applicant data is used anywhere; every field is synthesized by
 * lib/syntheticData.js from a seeded PRNG (lib/prng.js), the same
 * reproducible-synthetic-data approach used in
 * loan-risk-model/src/data_generator.py.
 *
 * Output:
 *   fixtures/documents/*.jpg   — the rendered, augmented document images
 *   fixtures/ground_truth.json — the exact field values used to render
 *                                 each document, keyed by filename, for
 *                                 runEvaluation.js to score extraction
 *                                 against.
 *
 * These fixtures are committed to the repo (not gitignored) so they double
 * as a manual-testing corpus for the upload flow, not just eval input.
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const { mulberry32, randInt, pick, chance } = require("./lib/prng");
const {
  BANK_NAMES,
  VEHICLE_MAKES_MODELS,
  randomFullName,
  randomNic,
  randomChassisNumber,
  randomRegistrationNumber,
  randomAccountNumber,
  randomAmount,
  formatLkr,
  randomDate,
} = require("./lib/syntheticData");
const {
  nationalIdTemplate,
  crCopyTemplate,
  bankStatementTemplate,
  payslipTemplate,
  buildPageHtml,
} = require("./lib/templates");

const SEED = Number(process.env.OCR_EVAL_SEED || 20260814);
const DOCS_PER_TYPE = Number(process.env.OCR_EVAL_DOCS_PER_TYPE || 13); // 13*4 = 52 documents

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const DOCUMENTS_DIR = path.join(FIXTURES_DIR, "documents");

const JPEG_QUALITIES = [90, 80, 65, 50]; // higher = less compression artifact

function pickAugmentation(rng) {
  return {
    rotateDeg: chance(rng, 0.7) ? randInt(rng, -8, 8) : 0,
    blurPx: chance(rng, 0.35) ? Number((randInt(rng, 2, 9) / 10).toFixed(1)) : 0,
    glare: chance(rng, 0.3),
    jpegQuality: pick(rng, JPEG_QUALITIES),
  };
}

function buildNationalIdDoc(rng, index) {
  const gender = pick(rng, ["male", "female"]);
  const nic = randomNic(rng, gender);
  const fullName = randomFullName(rng);
  const html = nationalIdTemplate({ nic, fullName, dateOfBirth: randomDate(rng, 1965, 2000) });
  return {
    file: `national_id_${String(index).padStart(3, "0")}.jpg`,
    documentType: "national_id",
    html,
    expectedFields: { nic },
  };
}

function buildCrCopyDoc(rng, index) {
  const [make, model] = pick(rng, VEHICLE_MAKES_MODELS);
  const chassisNumber = randomChassisNumber(rng);
  const html = crCopyTemplate({
    registrationNumber: randomRegistrationNumber(rng),
    chassisNumber,
    engineNumber: randomChassisNumber(rng).slice(0, 11),
    make,
    model,
    year: randInt(rng, 2005, 2023),
  });
  return {
    file: `cr_copy_${String(index).padStart(3, "0")}.jpg`,
    documentType: "cr_copy",
    html,
    expectedFields: { chassis_number: chassisNumber },
  };
}

function buildBankStatementDoc(rng, index) {
  const bankName = pick(rng, BANK_NAMES);
  const accountNumber = randomAccountNumber(rng);
  const opening = randomAmount(rng, 20000, 500000);
  const closing = randomAmount(rng, 20000, 500000);
  const html = bankStatementTemplate({
    bankName,
    accountNumber,
    accountHolder: randomFullName(rng),
    periodFrom: randomDate(rng, 2026, 2026),
    periodTo: randomDate(rng, 2026, 2026),
    opening: formatLkr(opening),
    closing: formatLkr(closing),
  });
  return {
    file: `bank_statement_${String(index).padStart(3, "0")}.jpg`,
    documentType: "bank_statement",
    html,
    expectedFields: { account_number: accountNumber },
  };
}

function buildPayslipDoc(rng, index) {
  const basic = randomAmount(rng, 40000, 150000);
  const gross = basic + randomAmount(rng, 5000, 40000);
  const deductions = randomAmount(rng, 3000, 15000);
  const net = gross - deductions;
  const html = payslipTemplate({
    employerName: "Aura Digital Holdings (Pvt) Ltd",
    employeeName: randomFullName(rng),
    basic: formatLkr(basic),
    gross: formatLkr(gross),
    deductions: formatLkr(deductions),
    net: formatLkr(net),
  });
  return {
    file: `payslip_${String(index).padStart(3, "0")}.jpg`,
    documentType: "payslip",
    html,
    expectedFields: { net_salary: net },
  };
}

async function main() {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  for (const stale of fs.readdirSync(DOCUMENTS_DIR)) {
    fs.unlinkSync(path.join(DOCUMENTS_DIR, stale));
  }

  const rng = mulberry32(SEED);
  const builders = [buildNationalIdDoc, buildCrCopyDoc, buildBankStatementDoc, buildPayslipDoc];

  const specs = [];
  for (const builder of builders) {
    for (let i = 1; i <= DOCS_PER_TYPE; i += 1) {
      specs.push(builder(rng, i));
    }
  }
  // Interleave rather than grouped-by-type, so the fixture set isn't
  // trivially sorted by document type on disk.
  for (let i = specs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [specs[i], specs[j]] = [specs[j], specs[i]];
  }

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1500 });

  const groundTruth = {
    seed: SEED,
    generatedAt: new Date().toISOString(),
    documentCount: specs.length,
    documents: [],
  };

  for (const spec of specs) {
    const augmentation = pickAugmentation(rng);
    const fullHtml = buildPageHtml(spec.html, augmentation);
    await page.setContent(fullHtml, { waitUntil: "load" });
    const buffer = await page.screenshot({ type: "jpeg", quality: augmentation.jpegQuality });
    fs.writeFileSync(path.join(DOCUMENTS_DIR, spec.file), buffer);

    groundTruth.documents.push({
      file: spec.file,
      documentType: spec.documentType,
      augmentation,
      expectedFields: spec.expectedFields,
    });
    console.log(`  wrote ${spec.file} (${spec.documentType})`);
  }

  await browser.close();

  fs.writeFileSync(
    path.join(FIXTURES_DIR, "ground_truth.json"),
    JSON.stringify(groundTruth, null, 2)
  );

  console.log(`\nGenerated ${specs.length} synthetic documents in ${DOCUMENTS_DIR}`);
  console.log(`Ground truth written to ${path.join(FIXTURES_DIR, "ground_truth.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

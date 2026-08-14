"use strict";

/**
 * HTML/CSS document templates for the four document types the OCR pipeline
 * knows about (national_id, cr_copy, bank_statement) plus payslip (see
 * OCR_FEATURE.md's limitations section for why payslip is generated but not
 * yet scored on extraction). Each field is rendered as its own line of
 * text — "Label: Value" — because documentExtraction.service.js's
 * extractLineField() anchors a label+colon+value pattern to a single
 * transcribed line; splitting a field across lines would fail extraction
 * even when Gemini Vision reads the text perfectly, which would not be
 * testing what we intend to test.
 */

const PAGE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #c9c4bb;
    font-family: 'DejaVu Sans', Arial, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1200px;
    height: 1500px;
  }
  .stage {
    width: 1200px;
    height: 1500px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .page {
    width: 860px;
    background: #ffffff;
    padding: 40px 48px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.35);
    color: #1a1a1a;
  }
  .glare {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .doc-title {
    font-size: 22px;
    font-weight: 700;
    text-align: center;
    margin-bottom: 4px;
    letter-spacing: 0.5px;
  }
  .doc-subtitle {
    font-size: 13px;
    text-align: center;
    color: #444;
    margin-bottom: 20px;
  }
  .row {
    font-size: 16px;
    padding: 7px 0;
    border-bottom: 1px solid #e4e4e4;
  }
  .row .label { font-weight: 700; }
  hr { border: none; border-top: 2px solid #1a1a1a; margin: 12px 0 18px; }
`;

function row(label, value) {
  return `<div class="row"><span class="label">${escapeHtml(label)}:</span> ${escapeHtml(String(value))}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function nationalIdTemplate({ nic, fullName, dateOfBirth }) {
  return `
    <div class="doc-title">DEMOCRATIC SOCIALIST REPUBLIC OF SRI LANKA</div>
    <div class="doc-subtitle">NATIONAL IDENTITY CARD</div>
    <hr />
    ${row("Name", fullName)}
    ${row("NIC No", nic)}
    ${row("Date of Birth", dateOfBirth)}
    ${row("Address", "142/3 Galle Road, Colombo 06")}
  `;
}

function crCopyTemplate({ registrationNumber, chassisNumber, engineNumber, make, model, year }) {
  return `
    <div class="doc-title">DEPARTMENT OF MOTOR TRAFFIC</div>
    <div class="doc-subtitle">CERTIFICATE OF REGISTRATION — COPY</div>
    <hr />
    ${row("Registration No", registrationNumber)}
    ${row("Chassis No", chassisNumber)}
    ${row("Engine No", engineNumber)}
    ${row("Make", make)}
    ${row("Model", model)}
    ${row("Year of Manufacture", year)}
    ${row("Fuel Type", "Petrol")}
    ${row("Absolute Owner", "Nations Trust Bank Leasing")}
  `;
}

function bankStatementTemplate({ bankName, accountNumber, accountHolder, periodFrom, periodTo, opening, closing }) {
  return `
    <div class="doc-title">${escapeHtml(bankName.toUpperCase())}</div>
    <div class="doc-subtitle">ACCOUNT STATEMENT</div>
    <hr />
    ${row("Account No", accountNumber)}
    ${row("Account Name", accountHolder)}
    ${row("Branch", "Colombo Head Office")}
    ${row("Statement Period", `${periodFrom} to ${periodTo}`)}
    ${row("Opening Balance", opening)}
    ${row("Closing Balance", closing)}
  `;
}

function payslipTemplate({ employerName, employeeName, basic, gross, deductions, net }) {
  return `
    <div class="doc-title">${escapeHtml(employerName.toUpperCase())}</div>
    <div class="doc-subtitle">SALARY SLIP</div>
    <hr />
    ${row("Employee Name", employeeName)}
    ${row("Basic Salary", basic)}
    ${row("Gross Salary", gross)}
    ${row("Total Deductions", deductions)}
    ${row("Net Salary", net)}
  `;
}

/**
 * Wrap a document body in the full HTML page, applying the requested
 * scan-realism augmentations purely through CSS so a single headless-
 * Chrome screenshot captures all of them at once:
 *   - rotation: transform: rotate() on the page card, simulating a
 *     slightly crooked phone photo of a paper document.
 *   - blur: CSS filter: blur() on the whole stage, simulating camera
 *     focus/motion blur.
 *   - glare: a diagonal semi-transparent white gradient overlaid on the
 *     page, simulating light reflecting off a photographed/scanned surface.
 * JPEG compression is applied separately at screenshot time (variable
 * quality), not here — see generateSyntheticDocuments.js.
 */
function buildPageHtml(bodyHtml, { rotateDeg = 0, blurPx = 0, glare = false } = {}) {
  const glareHtml = glare
    ? `<div class="glare" style="background: linear-gradient(120deg, transparent 35%, rgba(255,255,255,0.5) 48%, rgba(255,255,255,0.15) 58%, transparent 70%);"></div>`
    : "";
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>${PAGE_CSS}</style></head>
<body style="filter: blur(${blurPx}px);">
  <div class="stage">
    <div class="page" style="position: relative; transform: rotate(${rotateDeg}deg);">
      ${bodyHtml}
      ${glareHtml}
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  nationalIdTemplate,
  crCopyTemplate,
  bankStatementTemplate,
  payslipTemplate,
  buildPageHtml,
};

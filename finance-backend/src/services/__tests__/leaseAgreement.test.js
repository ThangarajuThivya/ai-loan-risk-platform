"use strict";

/**
 * leaseAgreement.service — the agreement statement and the letter of
 * release, both PDFKit documents.
 *
 * WHY THIS EXISTS. The document was rewritten from plain black-on-white text
 * to a letterheaded, zebra-striped, footed layout, and that rewrite shipped
 * two real defects that neither `node --check` nor a byte-count could ever
 * catch:
 *
 *   1. A bulleted list built with `.text(bullet, {continued:true, width:14})`
 *      followed by `.text(paragraph)` — PDFKit locks a continued run to the
 *      FIRST segment's width, so every obligation wrapped one or two
 *      characters per line and alone turned a one-page document into
 *      eighteen.
 *   2. A page footer positioned inside the bottom margin — which is where a
 *      footer belongs — but PDFKit's automatic pagination watches
 *      `page.maxY() = height - margins.bottom` and silently inserts a new,
 *      blank page the instant explicit text coordinates fall past that
 *      line, stranding the real footer text on the wrong page and leaving
 *      the intended one blank underneath.
 *
 * Both were invisible to a byte-count check (the broken 18-page PDF was
 * still a syntactically valid PDF) and both were only found by actually
 * rendering the output to an image and looking at it. What CAN be asserted
 * automatically, and is below, is the property that would have caught
 * regressions of the same shape going forward: the page count is exactly
 * what the content requires, and every figure and clause the document is
 * supposed to state is actually extractable from it.
 *
 * PDF TEXT EXTRACTION. PDFKit deflates content streams and encodes strings
 * as literals `(...)Tj`/`[...]TJ` or hex `<...>Tj`. `extractText` inflates
 * every stream and decodes both forms — good enough to assert a label or
 * figure appears somewhere in the document, not a full PDF parser.
 */

const assert = require("assert");
const zlib = require("zlib");
const { generateLeaseAgreementPdf, generateReleaseLetterPdf } = require("../leaseAgreement.service");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok - " + name);
};

/** Every `stream ... endstream` block in the PDF, inflated where possible. */
function inflatedStreams(buf) {
  const text = buf.toString("latin1");
  const out = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = Buffer.from(m[1], "latin1");
    try {
      out.push(zlib.inflateSync(raw).toString("latin1"));
    } catch {
      // Not a Flate stream (an embedded font, say) — irrelevant to page text.
    }
  }
  return out;
}

/** Literal `(...)`, hex `<...>`, and octal-escape decoding good enough for
 * ASCII body text — every figure and label in this document is ASCII. */
function decodeLiteral(s) {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "n") out += "\n";
      else if (/[0-7]/.test(n)) {
        const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
        out += String.fromCharCode(parseInt(oct, 8));
        i += oct.length;
      } else out += n;
      i += 1;
    } else out += s[i];
  }
  return out;
}

/**
 * Concatenated best-effort page text, for substring assertions.
 *
 * PDFKit's own choice of literal `(...)` vs hex `<...>` strings is not
 * fixed — it depends on the font subset, and inside one `[...]TJ` array the
 * two kinds sit side by side with bare kerning numbers between them, e.g.
 * `[<41> 30 <757261...>] TJ` is "A", a −30/1000 em kern, then the hex run
 * for "ura...". The numbers carry no text and are skipped; every string
 * token — literal or hex, wherever it appears — is decoded and concatenated
 * in order, which reconstructs the line regardless of which encoding this
 * PDFKit version or font happened to pick for it.
 */
function extractText(buf) {
  let text = "";
  const tokenRe = /\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f]+)>/g;
  for (const content of inflatedStreams(buf)) {
    for (const opMatch of content.matchAll(/(\((?:[^()\\]|\\.)*\)|\[(?:[^\]]|\\.)*\])\s*(Tj|TJ)/g)) {
      const body = opMatch[1];
      tokenRe.lastIndex = 0;
      let t;
      while ((t = tokenRe.exec(body))) {
        text += t[1] !== undefined ? decodeLiteral(t[1]) : Buffer.from(t[2], "hex").toString("latin1");
      }
      text += " ";
    }
  }
  // A line PDFKit wraps mid-phrase is drawn as two separate Tj/TJ ops, each
  // already ending in its own space — reassembling them can legitimately
  // produce "in  full" for what renders as one single space. Collapsed here
  // so assertions test content, not incidental extraction whitespace.
  return text.replace(/\s+/g, " ");
}

/** Real page count, read from the PDF's own `/Count` entry — independent
 * of how the text was drawn, so it can't share a bug with `extractText`. */
function pageCount(buf) {
  const m = buf.toString("latin1").match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

const application = {
  id: 103,
  make: "Toyota",
  model: "Aqua",
  year_of_manufacture: 2024,
  condition_type: "brand_new",
  registration_no: null,
  supplier_name: "Prestige Auto (Pvt) Ltd",
  chassis_no: "JTDKN3DU0A1234567",
};

const baseQuotation = {
  id: 47,
  quoted_at: "2026-08-01",
  expires_at: "2026-08-15",
  status: "accepted",
  responded_at: "2026-08-02",
  vehicle_price: 7000000,
  down_payment_amount: 6300000,
  down_payment_percent: 90,
  financed_amount: 700000,
  term_months: 24,
  interest_rate: 11,
  rate_type: "flat",
  monthly_rental: 35583.34,
  total_rentals: 853999.99,
  fees: [
    { label: "Documentation Fee", amount: 35000, waived: 0 },
    { label: "Government Stamp Duty", amount: 5250, waived: 0 },
    // A real MySQL TINYINT, not a JS boolean — the exact shape that once
    // rendered a stray "0" on the customer-facing pages (Boolean() bug).
    { label: "Late Registration Fee", amount: 2500, waived: 1 },
  ],
};

const summary = { upfrontTotal: 6340250, totalCost: 7160250, effectiveApr: 14.2 };

(async () => {
  // --- the standard case: exactly the pages the content needs -------------
  {
    const buf = await generateLeaseAgreementPdf({
      application,
      quotation: baseQuotation,
      summary,
      lesseeName: "Thomas Cabriel",
    });
    assert.strictEqual(buf.slice(0, 4).toString(), "%PDF");
    ok("produces a real PDF (starts with the %PDF magic bytes)");

    const pages = pageCount(buf);
    assert.strictEqual(pages, 2, `expected 2 pages for the standard fixture, got ${pages}`);
    ok("LOAD-BEARING: an ordinary agreement is exactly 2 pages, not 18");

    const text = extractText(buf);
    for (const expected of [
      "Aura Digital Bank",
      "Vehicle Finance Lease",
      "#103",
      "#47",
      "Thomas Cabriel",
      "Toyota Aqua",
      "Brand new",
      "Prestige Auto (Pvt) Ltd",
      "7,000,000.00",
      "6,300,000.00",
      "24 months",
      "11.00% flat",
      "35,583.34",
      "Documentation Fee",
      "35,000.00",
      "Government Stamp Duty",
      "Late Registration Fee",
      "Nil",
      "What You Pay",
      "6,340,250.00",
      "7,160,250.00",
      "14.2%",
      "Ownership of the Vehicle",
      "Obligations of the Lessee",
      "Pay each monthly rental in full",
      "Not sell, transfer, sub-lease",
      "Default",
      "repossession",
      "ACCEPTED",
      "Thomas Cabriel on August 2, 2026",
      "Page 1 of 2",
      "Page 2 of 2",
    ]) {
      assert.ok(text.includes(expected), `extracted text is missing "${expected}"`);
    }
    ok("LOAD-BEARING: every figure, clause and page-number label is present in the rendered text");
  }

  // --- a fee genuinely charged must never look waived, and vice versa -----
  {
    const buf = await generateLeaseAgreementPdf({
      application,
      quotation: baseQuotation,
      summary,
      lesseeName: "Thomas Cabriel",
    });
    const text = extractText(buf);
    assert.ok(text.includes("Documentation Fee") && text.includes("35,000.00"));
    assert.ok(!text.includes("Documentation Fee0"), "a TINYINT 0 must not render as a literal digit");
    ok("an unwaived fee (waived: 0) shows its real amount, with no stray '0' from the falsy TINYINT");
  }

  // --- an unaccepted quotation reads as a proposal, never a contract -------
  {
    const pending = { ...baseQuotation, status: "pending", responded_at: null };
    const buf = await generateLeaseAgreementPdf({
      application,
      quotation: pending,
      summary,
      lesseeName: "Thomas Cabriel",
    });
    const text = extractText(buf);
    assert.ok(text.includes("NOT YET ACCEPTED"));
    assert.ok(text.includes("not an executed agreement"));
    assert.ok(!text.includes("ACCEPTED\n") && !/[^T]ACCEPTED\b/.test(text.replace("NOT YET ACCEPTED", "")));
    ok("LOAD-BEARING: a pending quotation is stamped NOT YET ACCEPTED, never mistaken for a signed lease");
  }

  // --- no fees on the facility: the empty-state line, not an empty table --
  {
    const noFees = { ...baseQuotation, fees: [] };
    const buf = await generateLeaseAgreementPdf({
      application,
      quotation: noFees,
      summary: { ...summary, effectiveApr: null },
      lesseeName: "Thomas Cabriel",
    });
    const text = extractText(buf);
    assert.ok(text.includes("No fees apply to this facility."));
    assert.ok(!text.includes("Effective annual rate"), "a null APR must not print an empty rate line");
    const pages = pageCount(buf);
    assert.ok(pages >= 1 && pages <= 2, `unexpected page count for the shortest fixture: ${pages}`);
    ok("no fees and a null effective APR both degrade to their stated empty cases, not blank rows");
  }

  // --- a long fee schedule must paginate cleanly, not runaway -------------
  {
    const manyFees = {
      ...baseQuotation,
      fees: Array.from({ length: 14 }, (_, i) => ({
        label: `Miscellaneous Charge ${i + 1}`,
        amount: 1000 + i,
        waived: i % 3 === 0 ? 1 : 0,
      })),
    };
    const buf = await generateLeaseAgreementPdf({
      application,
      quotation: manyFees,
      summary,
      lesseeName: "Thomas Cabriel",
    });
    const pages = pageCount(buf);
    // The exact count isn't the point — a runaway would produce dozens, not
    // a handful, of pages for one extra table.
    assert.ok(pages >= 2 && pages <= 4, `a long fee schedule produced ${pages} pages — looks like a runaway`);
    const text = extractText(buf);
    assert.ok(text.includes("Miscellaneous Charge 1"));
    assert.ok(text.includes("Miscellaneous Charge 14"));
    assert.ok(text.includes(`Page 1 of ${pages}`) && text.includes(`Page ${pages} of ${pages}`));
    ok(`LOAD-BEARING: 14 fee lines paginate cleanly (${pages} pages), every footer numbered correctly`);
  }

  // --- the letter of release -----------------------------------------------
  {
    const buf = await generateReleaseLetterPdf({
      application,
      agreement: { agreement_no: "LSE-000019" },
      registration: {
        release_letter_no: "REL-000005",
        release_issued_at: "2028-08-08",
        cr_number: "CR-2024-8891",
      },
      lesseeName: "Thomas Cabriel",
    });
    assert.strictEqual(buf.slice(0, 4).toString(), "%PDF");
    const pages = pageCount(buf);
    assert.strictEqual(pages, 1, `expected the release letter to fit on 1 page, got ${pages}`);
    ok("the letter of release is exactly 1 page");

    const text = extractText(buf);
    for (const expected of [
      "Letter of Release",
      "REL-000005",
      "LSE-000019",
      "Aura Digital Bank",
      "Thomas Cabriel",
      "Toyota Aqua",
      "CR-2024-8891",
      "JTDKN3DU0A1234567",
      "paid in full",
      "releases all right, title and interest",
      "No further sum is payable",
      "Page 1 of 1",
    ]) {
      assert.ok(text.includes(expected), `release letter is missing "${expected}"`);
    }
    ok("every clause and reference number the release letter must state is present");
  }

  // --- a lessor override actually reaches the document ----------------------
  {
    const buf = await generateLeaseAgreementPdf({
      application,
      quotation: baseQuotation,
      summary,
      lesseeName: "Thomas Cabriel",
      lessorName: "Northern Star Finance PLC",
    });
    const text = extractText(buf);
    assert.ok(text.includes("Northern Star Finance PLC"));
    assert.ok(!text.includes("Aura Digital Bank"));
    ok("a supplied lessor name replaces the default everywhere, including the letterhead");
  }

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error("\nFAILED:", err.stack || err.message);
  process.exitCode = 1;
});

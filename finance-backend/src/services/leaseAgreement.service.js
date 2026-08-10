"use strict";

/**
 * Lease agreement / quotation document (L4.3), and the letter of release
 * that closes a lease out.
 *
 * Follows decisionLetter.service.js's shape: build a PDF into a Buffer and
 * let the controller decide what to do with it.
 *
 * WHAT THIS DOCUMENT IS, AND IS NOT. It sets out the terms of a finance
 * lease in the form the Finance Leasing Act contemplates, and it is
 * generated from the SNAPSHOTTED quotation — never recomputed — so the
 * paper and the database can never disagree about what was offered.
 *
 * It is not, on its own, an executed agreement. Execution in this system is
 * the lessee accepting the quotation, which is recorded with a timestamp and
 * an audit event. A production deployment would add a signature block and
 * witnessing; that is deliberately out of scope here rather than faked with
 * a decorative signature line implying something that did not happen.
 *
 * The ownership clause is the part that matters most and is stated plainly:
 * the lessor owns the vehicle throughout, the lessee has possession and use,
 * and title passes only after the final rental and a letter of release.
 *
 * LOOK AND FEEL. This used to be plain black Helvetica on white with no
 * hierarchy beyond bold headings — legible but not something a lessee would
 * read as a real financial document. The palette below is the frontend's
 * own brand colours (tailwind.config.js `brand.*`), not an invented one, so
 * a document downloaded from the portal looks like it came from the same
 * institution as the portal itself.
 */

const PDFDocument = require("pdfkit");

// The app's own brand palette (tailwind.config.js) — not invented for this
// document, so a PDF downloaded from the portal reads as the same
// institution rather than a generic template.
const BRAND = {
  primary: "#0F4C81",
  secondary: "#2E8BC0",
  accent: "#00A86B",
  text: "#1E293B",
  muted: "#64748B",
  faint: "#94A3B8",
  hairline: "#E2E8F0",
  panel: "#F8FAFC",
  danger: "#B91C1C",
};

const PAGE_MARGIN = 56;
const LESSOR_NAME_DEFAULT = "Aura Digital Bank";

const money = (v) =>
  `LKR ${Number(v || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "long", year: "numeric" })
    : "—";

const CONDITION_LABELS = {
  brand_new: "Brand new",
  reconditioned: "Reconditioned",
  used: "Used (registered)",
};

/** Full content width inside the page margins — computed fresh per document
 * since a new PDFDocument is created for each call. */
function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/**
 * The coloured band every lease document opens with: institution name,
 * document title, and a right-aligned reference block. Replaces the old
 * plain-text heading — a lender's actual paperwork has a letterhead, and a
 * lessee's first signal that this is a real financial document is seeing
 * one before they read a word of the terms.
 */
function drawLetterhead(doc, { title, referenceLines, lessor }) {
  const width = doc.page.width;
  // Tall enough for the reference block on the right — 3 lines at 26px each
  // starting 30px down, plus room for the two-line label+value pair on the
  // last one, or its date clips against the band's own bottom edge.
  const bandHeight = 66 + referenceLines.length * 26;

  doc.rect(0, 0, width, bandHeight).fill(BRAND.primary);

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(lessor, PAGE_MARGIN, 26, { width: width - PAGE_MARGIN * 2 - 200 });

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#DCEBFB")
    .text("Vehicle Finance Leasing", PAGE_MARGIN, 47);

  doc
    .font("Helvetica-Bold")
    .fontSize(12.5)
    .fillColor("#FFFFFF")
    .text(title, PAGE_MARGIN, 64, { width: width - PAGE_MARGIN * 2 - 200 });

  // Reference block, right-aligned within the band.
  const refX = width - PAGE_MARGIN - 200;
  let refY = 30;
  doc.font("Helvetica").fontSize(8.5).fillColor("#DCEBFB");
  for (const [label, value] of referenceLines) {
    doc.text(`${label}`, refX, refY, { width: 200, align: "right" });
    doc
      .font("Helvetica-Bold")
      .fillColor("#FFFFFF")
      .fontSize(9.5)
      .text(String(value), refX, refY + 10, { width: 200, align: "right" });
    doc.font("Helvetica").fontSize(8.5).fillColor("#DCEBFB");
    refY += 26;
  }

  doc.fillColor(BRAND.text);
  doc.y = bandHeight + 26;
}

/**
 * A section heading with a thin accent rule beneath it, replacing bare bold
 * text. The rule is what gives the document a sense of structure at a
 * glance — a reader flipping through can see where one topic ends and the
 * next begins without reading a line of body text.
 */
function sectionHeading(doc, text) {
  // Keep a heading and at least its first row of content together — a
  // heading stranded alone at the foot of a page is the single most
  // amateurish thing a generated document can do.
  if (doc.y > doc.page.height - doc.page.margins.bottom - 90) {
    doc.addPage();
  }
  doc.moveDown(0.15);
  const y = doc.y;
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor(BRAND.primary).text(text, PAGE_MARGIN, y);
  const afterY = doc.y + 3;
  doc
    .moveTo(PAGE_MARGIN, afterY)
    .lineTo(PAGE_MARGIN + contentWidth(doc), afterY)
    .lineWidth(1.2)
    .strokeColor(BRAND.hairline)
    .stroke();
  doc.y = afterY + 10;
  doc.fillColor(BRAND.text);
}

/**
 * Two-column key/value table with alternating row shading, replacing the
 * old plain-text rows. Zebra striping is what makes a wide table of figures
 * scannable — the eye can follow a row across the page without losing it,
 * which matters here because every section in this document is exactly
 * that: a list of figures someone needs to check.
 */
function renderRows(doc, rows, { boxed = true } = {}) {
  const x = PAGE_MARGIN;
  const width = contentWidth(doc);
  const rowHeight = 22;
  const labelWidth = width * 0.56;

  const startY = doc.y;
  let y = startY;

  for (let i = 0; i < rows.length; i += 1) {
    // A row must not silently split across a page break — repaint the
    // shading on the new page rather than let a row's label land on one
    // page and its value on the next.
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    if (i % 2 === 1) {
      doc.rect(x, y, width, rowHeight).fill(BRAND.panel);
    }

    const [label, value, opts = {}] = rows[i];
    const textY = y + 6;
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(BRAND.muted)
      .text(label, x + 10, textY, { width: labelWidth - 16 });
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(opts.color || BRAND.text)
      .text(String(value), x + labelWidth, textY, { width: width - labelWidth - 10, align: "right" });

    y += rowHeight;
  }

  if (boxed) {
    doc
      .rect(x, startY, width, y - startY)
      .lineWidth(0.75)
      .strokeColor(BRAND.hairline)
      .stroke();
  }

  doc.fillColor(BRAND.text);
  doc.y = y + 14;
}

/**
 * The one figure a lessee actually opens this document to check, in a
 * shaded callout rather than as just another table row. "What You Pay" was
 * already singled out as its own section in the plain-text version; giving
 * it a visually distinct box is what makes that intent actually land on the
 * page instead of reading as one row among a dozen others.
 */
function renderCallout(doc, { heading, rows, big }) {
  const x = PAGE_MARGIN;
  const width = contentWidth(doc);
  const padding = 14;
  const rowHeight = 20;
  const bigHeight = big ? 34 : 0;
  const height = padding * 2 + 16 + rows.length * rowHeight + bigHeight;

  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
  const top = doc.y;

  doc.rect(x, top, width, height).fill(BRAND.panel);
  doc.rect(x, top, 4, height).fill(BRAND.accent);
  doc
    .rect(x, top, width, height)
    .lineWidth(0.75)
    .strokeColor(BRAND.hairline)
    .stroke();

  let y = top + padding;
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(BRAND.primary).text(heading, x + padding + 6, y);
  y += 20;

  for (const [label, value, opts = {}] of rows) {
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(BRAND.muted)
      .text(label, x + padding + 6, y, { width: width - padding * 2 - 12 - 180 });
    doc
      .font(opts.bold === false ? "Helvetica" : "Helvetica-Bold")
      .fontSize(opts.big ? 15 : 9.5)
      .fillColor(opts.big ? BRAND.accent : BRAND.text)
      .text(value, x + width - padding - 190, opts.big ? y - 3 : y, { width: 190, align: "right" });
    y += opts.big ? 26 : rowHeight;
  }

  doc.fillColor(BRAND.text);
  doc.y = top + height + 14;
}

function bodyText(doc, text) {
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(BRAND.text)
    .text(text, PAGE_MARGIN, doc.y, { width: contentWidth(doc), align: "left", lineGap: 2.5 });
  doc.moveDown(0.55);
}

/**
 * A bullet glyph plus a hanging-indented, wrapped paragraph.
 *
 * NOT `continued: true`. Chaining the bullet and the paragraph as one
 * continued run means the paragraph inherits the BULLET's `width: 14` —
 * PDFKit locks continued text to the first segment's line box — so every
 * item wrapped one or two characters per line and alone turned a one-page
 * document into eighteen. Two independent, explicitly positioned `.text()`
 * calls avoid the shared box entirely: the bullet is placed, the paragraph
 * is placed beside it at its own full width, and `doc.y` ends up below
 * whichever one is taller.
 */
function bulletList(doc, items) {
  const width = contentWidth(doc);
  const indent = 14;
  for (const item of items) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
    const y = doc.y;
    doc.font("Helvetica").fontSize(9.5).fillColor(BRAND.text).text("•", PAGE_MARGIN, y, { width: indent });
    const bulletBottom = doc.y;
    doc.text(item, PAGE_MARGIN + indent, y, { width: width - indent, lineGap: 2.5 });
    doc.y = Math.max(doc.y, bulletBottom);
    doc.moveDown(0.28);
  }
  doc.moveDown(0.35);
}

/**
 * Page numbers and a confidentiality line on every page, drawn AFTER all
 * content so the total page count is known — `bufferPages` holds every page
 * in memory until `doc.end()` rather than flushing as it goes, which is
 * exactly what makes "page 2 of 3" possible instead of "page 2 of ?".
 */
function paginate(doc, { lessor, footerNote }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);

    // The footer lives INSIDE the bottom margin by design — that is the
    // whole point of a footer. But PDFKit's automatic page-break watches
    // `page.maxY() = height - margins.bottom`, and any explicitly positioned
    // text landing below that line reads to it as "this page overflowed,"
    // silently inserting a fresh page and drawing there instead — never
    // where it was asked to. `bufferedPageRange().count` is read once
    // before this loop, so those extra pages fall outside the loop's own
    // range and are never given content, leaving them blank while the real
    // footer text lands, mispositioned, on whichever new page it landed on.
    // Zeroing this page's own margin object for the duration of the footer
    // draw removes the trigger; nothing else on an already-finished page
    // reflows because of it.
    const originalBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = doc.page.height - originalBottom + 18;
    doc
      .moveTo(PAGE_MARGIN, y - 8)
      .lineTo(doc.page.width - PAGE_MARGIN, y - 8)
      .lineWidth(0.5)
      .strokeColor(BRAND.hairline)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(BRAND.faint)
      .text(footerNote || `${lessor} — Confidential`, PAGE_MARGIN, y, {
        width: contentWidth(doc) - 80,
        lineBreak: false,
      });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - PAGE_MARGIN - 80, y, {
      width: 80,
      align: "right",
      lineBreak: false,
    });

    doc.page.margins.bottom = originalBottom;
  }
}

/**
 * @param {object} data
 * @param {object} data.application  lease application row (with vehicle joined)
 * @param {object} data.quotation    lease_quotations row with .fees
 * @param {object} data.summary      summarizeLeaseFees output
 * @param {string} data.lesseeName
 * @param {string} [data.lessorName]
 * @returns {Promise<Buffer>}
 */
function generateLeaseAgreementPdf({ application, quotation, summary, lesseeName, lessorName }) {
  const lessor = lessorName || LESSOR_NAME_DEFAULT;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawLetterhead(doc, {
      lessor,
      title: "Vehicle Finance Lease — Statement of Terms",
      referenceLines: [
        ["Application", `#${application.id}`],
        ["Quotation", `#${quotation.id}`],
        ["Issued", day(quotation.quoted_at)],
      ],
    });

    // --- Parties -----------------------------------------------------------
    sectionHeading(doc, "Parties");
    renderRows(doc, [
      ["Lessor (owner of the vehicle)", lessor],
      ["Lessee (user of the vehicle)", lesseeName],
      ["Quotation valid until", day(quotation.expires_at)],
    ]);

    // --- The vehicle ---------------------------------------------------------
    sectionHeading(doc, "The Vehicle");
    renderRows(doc, [
      ["Make and model", `${application.make} ${application.model}`],
      ["Year of manufacture", application.year_of_manufacture],
      ["Condition", CONDITION_LABELS[application.condition_type] || application.condition_type],
      ["Registration number", application.registration_no || "Not yet registered"],
      ["Supplier", application.supplier_name || "Private seller"],
      ["Purchase price", money(quotation.vehicle_price)],
    ]);

    // --- Financial terms -----------------------------------------------------
    sectionHeading(doc, "Financial Terms");
    renderRows(doc, [
      ["Down payment", `${money(quotation.down_payment_amount)}  (${quotation.down_payment_percent}%)`],
      ["Amount financed", money(quotation.financed_amount)],
      ["Term", `${quotation.term_months} months`],
      ["Interest rate", `${Number(quotation.interest_rate).toFixed(2)}% ${quotation.rate_type}`],
      ["Monthly rental", money(quotation.monthly_rental)],
      ["Total rentals payable", money(quotation.total_rentals)],
    ]);

    // --- Fees ------------------------------------------------------------------
    sectionHeading(doc, "Fees and Charges");
    if (!quotation.fees?.length) {
      bodyText(doc, "No fees apply to this facility.");
    } else {
      renderRows(
        doc,
        quotation.fees.map((f) => [
          f.waived ? `${f.label} (waived)` : f.label,
          f.waived ? "Nil" : money(f.amount),
          f.waived ? { color: BRAND.accent } : {},
        ])
      );
    }

    // --- What the lessee actually pays — the headline callout -----------------
    renderCallout(doc, {
      heading: "What You Pay",
      rows: [
        ["Payable at signing (down payment + fees)", money(summary.upfrontTotal), { big: true }],
        ["Then, monthly", `${money(quotation.monthly_rental)} × ${quotation.term_months}`, {}],
        ["Total cost over the lease", money(summary.totalCost), {}],
      ],
    });
    if (summary.effectiveApr !== null && summary.effectiveApr !== undefined) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(8.5)
        .fillColor(BRAND.muted)
        .text(
          `Effective annual rate including fees: ${summary.effectiveApr}%. The headline rate of ` +
            `${Number(quotation.interest_rate).toFixed(2)}% ${quotation.rate_type} does not account for ` +
            `the fees above.`,
          PAGE_MARGIN,
          doc.y,
          { width: contentWidth(doc) }
        );
      doc.moveDown(0.9);
      doc.fillColor(BRAND.text);
    }

    // --- Ownership ---------------------------------------------------------
    sectionHeading(doc, "Ownership of the Vehicle");
    bodyText(
      doc,
      `This is a finance lease, not a loan. ${lessor} will purchase the vehicle described above ` +
        `and will remain its absolute owner for the duration of the lease. The Certificate of ` +
        `Registration will record ${lessor} as absolute owner and ${lesseeName} as the registered user.`
    );
    bodyText(
      doc,
      `${lesseeName} has the right to possess and use the vehicle for the term of the lease, ` +
        `subject to paying each monthly rental when due and to the obligations set out below. ` +
        `Ownership does not pass on signing, on payment of the down payment, or at any point ` +
        `during the term.`
    );
    bodyText(
      doc,
      `On payment of the final rental, ${lessor} will issue a letter of release, which is the ` +
        `lessee's authority to transfer the vehicle into their own name at the Department of ` +
        `Motor Traffic. Title passes at that point and not before.`
    );

    // --- Obligations ---------------------------------------------------------
    sectionHeading(doc, "Obligations of the Lessee");
    bulletList(doc, [
      "Pay each monthly rental in full on or before its due date.",
      "Keep the vehicle comprehensively insured for its full value throughout the term, with the lessor noted as absolute owner on the policy.",
      "Maintain the vehicle in good working order and bear all running, maintenance and repair costs.",
      "Not sell, transfer, sub-lease, pledge or otherwise deal with the vehicle, which is not the lessee's to dispose of.",
      "Not alter the vehicle's registration particulars without the lessor's written consent.",
      "Notify the lessor promptly of any accident, total loss, theft, or change of the lessee's address.",
    ]);

    // --- Default -------------------------------------------------------------
    sectionHeading(doc, "Default");
    bodyText(
      doc,
      `If rentals fall into arrears or the lessee breaches any obligation above, the lessor may ` +
        `exercise its rights as owner of the vehicle, which include repossession, in accordance ` +
        `with the Finance Leasing Act and the notice requirements it imposes.`
    );
    bodyText(
      doc,
      `The lessee may settle the lease early at any time. On early settlement a rebate of ` +
        `unearned finance charges is applied, so the amount payable is less than the sum of the ` +
        `remaining rentals.`
    );

    // --- Status statement ------------------------------------------------------
    // Says plainly what this document currently is, so an unaccepted
    // quotation can never be mistaken for an executed agreement. Boxed
    // rather than a closing italic paragraph — this is the sentence that
    // decides whether the reader is looking at a binding document or a
    // proposal, and it should not be easy to skim past.
    const accepted = quotation.status === "accepted";
    const statusX = PAGE_MARGIN;
    const statusWidth = contentWidth(doc);
    const statusText = accepted
      ? `These terms were accepted by ${lesseeName} on ${day(quotation.responded_at)}. This ` +
        `document records the agreed terms of the lease.`
      : `This is a statement of proposed terms and is not an executed agreement. It becomes ` +
        `binding only when accepted by the lessee, and lapses on ${day(quotation.expires_at)} ` +
        `if not accepted.`;

    if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
    const boxTop = doc.y;
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(accepted ? BRAND.accent : BRAND.danger)
      .text(accepted ? "ACCEPTED" : "NOT YET ACCEPTED", statusX, boxTop, { width: statusWidth });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.text)
      .text(statusText, statusX, doc.y + 3, { width: statusWidth, lineGap: 2 });
    const boxHeight = doc.y - boxTop + 10;
    doc
      .rect(statusX - 8, boxTop - 8, statusWidth + 16, boxHeight)
      .lineWidth(1)
      .strokeColor(accepted ? BRAND.accent : BRAND.danger)
      .stroke();
    doc.moveDown(1.2);

    paginate(doc, {
      lessor,
      footerNote: `${lessor} · Vehicle Finance Lease · Application #${application.id} · Generated ${day(new Date())}`,
    });

    doc.end();
  });
}

/**
 * Letter of release (L7.3).
 *
 * The document the whole module builds towards. Its only job is to say, in
 * terms the Department of Motor Traffic will accept, that the lessor no
 * longer has any interest in the vehicle and the lessee may transfer it into
 * their own name.
 *
 * It is deliberately short. A release is a discharge, not a contract — every
 * additional clause would be an opportunity to imply a condition that does
 * not exist. Shares the agreement's letterhead and section styling so the
 * two documents a lessee ever downloads look like they came from one
 * institution rather than two different tools.
 *
 * @param {object} data
 * @returns {Promise<Buffer>}
 */
function generateReleaseLetterPdf({ application, agreement, registration, lesseeName, lessorName }) {
  const lessor = lessorName || LESSOR_NAME_DEFAULT;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4", bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawLetterhead(doc, {
      lessor,
      title: "Letter of Release",
      referenceLines: [
        ["Release Ref.", registration.release_letter_no],
        ["Agreement", agreement?.agreement_no || `#${application.id}`],
        ["Issued", day(registration.release_issued_at)],
      ],
    });

    doc.font("Helvetica").fontSize(10).fillColor(BRAND.text).text("To whom it may concern,", PAGE_MARGIN, doc.y);
    doc.moveDown(0.7);

    bodyText(
      doc,
      `${lessor} confirms that all rentals due under the vehicle finance lease described below ` +
        `have been paid in full by ${lesseeName}, and that the lease has been discharged.`
    );

    sectionHeading(doc, "The Vehicle");
    renderRows(doc, [
      ["Make and model", `${application.make} ${application.model}`],
      ["Year of manufacture", application.year_of_manufacture],
      ["Registration number", application.registration_no || "—"],
      ["Chassis number", application.chassis_no || "—"],
      ["Certificate of Registration", registration.cr_number || "—"],
    ]);

    bodyText(
      doc,
      `${lessor} accordingly releases all right, title and interest it holds in the vehicle as ` +
        `absolute owner, and raises no objection to the Department of Motor Traffic transferring ` +
        `ownership into the name of ${lesseeName}.`
    );
    bodyText(doc, `No further sum is payable to ${lessor} in respect of this lease.`);

    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(9.5).fillColor(BRAND.muted).text("For and on behalf of", PAGE_MARGIN, doc.y);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(BRAND.text).text(lessor, PAGE_MARGIN, doc.y + 2);
    doc.moveDown(1.4);

    doc
      .font("Helvetica-Oblique")
      .fontSize(8.5)
      .fillColor(BRAND.muted)
      .text(
        `This letter is issued electronically and is valid without signature when presented ` +
          `together with the lease agreement reference above.`,
        PAGE_MARGIN,
        doc.y,
        { width: contentWidth(doc) }
      );

    paginate(doc, {
      lessor,
      footerNote: `${lessor} · Letter of Release · ${registration.release_letter_no} · Generated ${day(new Date())}`,
    });

    doc.end();
  });
}

module.exports = { generateLeaseAgreementPdf, generateReleaseLetterPdf };

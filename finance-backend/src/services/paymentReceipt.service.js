"use strict";

/**
 * Payment receipt PDF rendering (040). Same contract as
 * decisionLetter.service.js: takes a plain, already-assembled data object —
 * never a raw DB row or an Express req/res — so it stays testable
 * independently of loanModel and has no idea those modules exist.
 *
 * pdfkit is a streaming API: draw into a PDFDocument, collect the emitted
 * chunks, resolve once finalized. No file ever touches disk.
 *
 * THE ALLOCATION BREAKDOWN IS THE POINT. A receipt that says only "you paid
 * LKR 11,885" tells a borrower nothing they did not already know. What they
 * cannot work out for themselves — and what every lender is expected to show
 * — is where that money went: which instalments it cleared, and how much of
 * it was interest, fees and actual principal. loan_payment_allocations (027)
 * already records exactly that, permanently and per payment, so the receipt
 * reads it rather than recomputing anything.
 *
 * Deliberately available for staff-keyed payments too, not just card ones: a
 * cash payment at a branch deserves the same receipt as an online one.
 */

const PDFDocument = require("pdfkit");

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

/** Abbreviated form, for the allocation table where column width is tight. */
const formatShortDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/** Table cells carry the currency in the column header, not on every row. */
const formatAmount = (value) =>
  Number(value || 0).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const METHOD_LABELS = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  standing_order: "Standing order",
  card: "Card (online)",
  other: "Other",
};

/**
 * @param {object} data
 * @param {string} data.referenceNo       PMT-000123
 * @param {number} data.applicationId
 * @param {string} data.accountNo         LN-000025
 * @param {string} data.borrowerName
 * @param {number} data.amount
 * @param {string} data.paidOn            value date
 * @param {string} data.method
 * @param {string} data.paymentType       'installment' | 'settlement'
 * @param {string|null} data.recordedByName null for a self-service payment
 * @param {Array<{installmentNo:number, dueDate:string, feeAmount:number,
 *   interestAmount:number, principalAmount:number}>} data.allocations
 * @param {object} data.outstandingAfter  {principal, interest, fees, total}
 * @param {boolean} data.loanClosed
 * @returns {Promise<Buffer>}
 */
function generatePaymentReceiptPdf(data) {
  const {
    referenceNo,
    applicationId,
    accountNo,
    borrowerName,
    amount,
    paidOn,
    method,
    paymentType,
    recordedByName,
    allocations = [],
    outstandingAfter,
    loanClosed,
  } = data;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text("Payment Receipt").moveDown(0.25);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`Receipt Reference: ${referenceNo}`)
      .text(`Loan Account: ${accountNo || "—"}   ·   Application #${applicationId}`)
      .text(`Date Received: ${formatDate(paidOn)}`)
      .fillColor("#000000")
      .moveDown(1);

    doc.fontSize(11).text(`Received with thanks from ${borrowerName}:`).moveDown(0.5);

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .fillColor("#0a7d3b")
      .text(formatCurrency(amount))
      .fillColor("#000000")
      .fontSize(11)
      .font("Helvetica")
      .moveDown(0.75);

    const header = [
      ["Payment method", METHOD_LABELS[method] || method],
      ["Payment type", paymentType === "settlement" ? "Early settlement" : "Instalment"],
      // A card payment has no staff member behind it. Saying "Paid online by
      // the customer" is the honest rendering of recorded_by IS NULL, rather
      // than leaving a blank field that looks like missing data.
      ["Received by", recordedByName || "Paid online by the customer"],
    ];
    for (const [label, value] of header) {
      doc.text(`${label}: `, { continued: true }).font("Helvetica-Bold").text(value).font("Helvetica");
    }
    doc.moveDown(1);

    // ---- Allocation breakdown -------------------------------------------
    doc.font("Helvetica-Bold").fontSize(12).text("How this payment was applied").fontSize(10);
    doc
      .font("Helvetica")
      .fillColor("#555555")
      .text(
        "Payments are applied to the oldest outstanding instalment first, and within each instalment to fees, then interest, then principal."
      )
      .fillColor("#000000")
      .moveDown(0.5);

    const startX = doc.x;
    const cols = [
      { label: "Instalment", width: 74 },
      { label: "Due date", width: 96 },
      { label: "Fees (LKR)", width: 78 },
      { label: "Interest (LKR)", width: 88 },
      { label: "Principal (LKR)", width: 90 },
      { label: "Total (LKR)", width: 86 },
    ];

    const drawRow = (cells, bold) => {
      const y = doc.y;
      let x = startX;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      cells.forEach((cell, i) => {
        doc.text(String(cell), x, y, { width: cols[i].width, align: i === 0 || i === 1 ? "left" : "right" });
        x += cols[i].width;
      });
      doc.y = y + 14;
      doc.x = startX;
    };

    drawRow(cols.map((c) => c.label), true);
    doc
      .moveTo(startX, doc.y - 3)
      .lineTo(startX + cols.reduce((s, c) => s + c.width, 0), doc.y - 3)
      .strokeColor("#cccccc")
      .stroke();

    let totFee = 0;
    let totInt = 0;
    let totPri = 0;
    for (const a of allocations) {
      const rowTotal = Number(a.feeAmount) + Number(a.interestAmount) + Number(a.principalAmount);
      totFee += Number(a.feeAmount);
      totInt += Number(a.interestAmount);
      totPri += Number(a.principalAmount);
      drawRow([
        `#${a.installmentNo}`,
        formatShortDate(a.dueDate),
        formatAmount(a.feeAmount),
        formatAmount(a.interestAmount),
        formatAmount(a.principalAmount),
        formatAmount(rowTotal),
      ]);
    }

    if (!allocations.length) {
      doc.font("Helvetica-Oblique").fontSize(9).text("No allocation detail recorded.").font("Helvetica");
      doc.moveDown(0.5);
    } else {
      doc
        .moveTo(startX, doc.y - 3)
        .lineTo(startX + cols.reduce((s, c) => s + c.width, 0), doc.y - 3)
        .strokeColor("#cccccc")
        .stroke();
      drawRow(
        [
          "Total",
          "",
          formatAmount(totFee),
          formatAmount(totInt),
          formatAmount(totPri),
          formatAmount(totFee + totInt + totPri),
        ],
        true
      );
    }

    doc.moveDown(1).fontSize(11);

    // ---- Position after this payment ------------------------------------
    if (loanClosed) {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0a7d3b")
        .text("This payment cleared the loan in full. Your loan account is now closed.")
        .fillColor("#000000")
        .font("Helvetica");
    } else if (outstandingAfter) {
      doc.font("Helvetica-Bold").text("Balance after this payment").font("Helvetica").moveDown(0.25);
      const after = [
        ["Principal outstanding", formatCurrency(outstandingAfter.principal)],
        ["Interest outstanding", formatCurrency(outstandingAfter.interest)],
        ["Fees outstanding", formatCurrency(outstandingAfter.fees)],
        ["Total outstanding", formatCurrency(outstandingAfter.total)],
      ];
      for (const [label, value] of after) {
        doc.text(`${label}: `, { continued: true }).font("Helvetica-Bold").text(value).font("Helvetica");
      }
    }

    doc.moveDown(1.5);
    doc
      .fontSize(9)
      .fillColor("#777777")
      .text(
        "This is a system-generated receipt and does not require a signature. Please retain it for your records. If any detail above looks wrong, contact support through your account quoting the receipt reference.",
        { width: 480 }
      );

    doc.end();
  });
}

module.exports = { generatePaymentReceiptPdf };

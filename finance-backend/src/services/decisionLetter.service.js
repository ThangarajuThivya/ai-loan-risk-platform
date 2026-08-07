"use strict";

/**
 * Decision letter PDF rendering (F3). Takes a plain, already-assembled data
 * object — never a raw DB row or an Express req/res — so this stays
 * testable independent of loanModel/loan.controller.js and has no idea
 * those modules exist. loan.controller.js's getDecisionLetter assembles
 * `letterData` from the row plus its own serializeOffer/serializeAdverseAction
 * (already in scope there) and hands it here.
 *
 * pdfkit is a streaming API: draw into a PDFDocument, collect the emitted
 * buffer chunks, resolve once the document is finalized. No file ever
 * touches disk.
 */

const PDFDocument = require("pdfkit");

const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "long", year: "numeric" })
    : "—";

/**
 * @param {object} letterData
 * @param {number} letterData.applicationId
 * @param {string} letterData.applicantName
 * @param {string} letterData.productName
 * @param {number} letterData.requestedAmount
 * @param {number} letterData.tenureMonths
 * @param {'approved'|'rejected'} letterData.status
 * @param {object} letterData.decision {decided_at, note, source, decided_by_name}
 * @param {object|null} letterData.offer serializeOffer() output — required when status==='approved'
 * @param {object|null} letterData.adverseAction serializeAdverseAction() output — required when status==='rejected'
 * @returns {Promise<Buffer>}
 */
function generateDecisionLetterPdf(letterData) {
  const { applicationId, applicantName, productName, requestedAmount, tenureMonths, status, decision, offer, adverseAction } =
    letterData;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Loan Application Decision Letter", { align: "left" })
      .moveDown(0.25);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`Application Reference: #${applicationId}`)
      .text(`Date Issued: ${formatDate(decision.decided_at)}`)
      .fillColor("#000000")
      .moveDown(1);

    doc.fontSize(11).font("Helvetica").text(`Dear ${applicantName},`).moveDown(0.75);

    doc.text(
      `Thank you for your application for a ${productName || "loan"} of ${formatCurrency(
        requestedAmount
      )} over ${tenureMonths} months. We are writing to confirm the outcome of our assessment.`,
      { align: "left" }
    );
    doc.moveDown(1);

    if (status === "approved") {
      doc
        .font("Helvetica-Bold")
        .fillColor("#0a7d3b")
        .text("Your application has been APPROVED.")
        .fillColor("#000000")
        .font("Helvetica")
        .moveDown(0.75);

      if (offer) {
        doc.font("Helvetica-Bold").text("Approved Terms").font("Helvetica").moveDown(0.25);
        const rows = [
          ["Approved Amount", formatCurrency(offer.amount)],
          ["Tenure", `${offer.tenure_months} months`],
          ["Interest Rate", `${offer.interest_rate}% (${offer.rate_type})`],
          ["Monthly Instalment (EMI)", formatCurrency(offer.emi)],
          ["Total Repayable", formatCurrency(offer.total_repayable)],
          ["Offer Valid Until", formatDate(offer.expires_at)],
        ];
        for (const [label, value] of rows) {
          doc.text(`${label}: `, { continued: true }).font("Helvetica-Bold").text(value).font("Helvetica");
        }
        doc.moveDown(0.75);

        // Fees & net disbursement (I1). Only rendered when fee lines were
        // actually loaded — an offer that predates fees, or an endpoint that
        // didn't fetch them, must not imply a zero-fee loan by showing an
        // empty breakdown.
        if (Array.isArray(offer.fees) && offer.fees.length > 0) {
          doc.font("Helvetica-Bold").text("Fees & Charges").font("Helvetica").moveDown(0.25);
          doc
            .fontSize(10)
            .fillColor("#555555")
            .text(
              "These are deducted from the amount paid out to you. They do not change your instalment or the total you repay."
            )
            .fillColor("#000000")
            .fontSize(11)
            .moveDown(0.35);

          for (const fee of offer.fees) {
            const basis =
              fee.calc_method === "percentage" ? ` (${fee.rate_or_amount}%)` : "";
            if (fee.waived) {
              doc
                .fillColor("#555555")
                .text(`${fee.label}${basis}: `, { continued: true })
                .font("Helvetica-Bold")
                .text("Waived", { continued: true })
                .font("Helvetica-Oblique")
                .text(fee.waived_reason ? ` — ${fee.waived_reason}` : "")
                .font("Helvetica")
                .fillColor("#000000");
            } else {
              doc
                .text(`${fee.label}${basis}: `, { continued: true })
                .font("Helvetica-Bold")
                .text(formatCurrency(fee.amount))
                .font("Helvetica");
            }
          }

          doc.moveDown(0.4);
          doc
            .text("Total Fees: ", { continued: true })
            .font("Helvetica-Bold")
            .text(formatCurrency(offer.total_fees))
            .font("Helvetica");
          doc
            .text("Amount You Receive: ", { continued: true })
            .font("Helvetica-Bold")
            .fillColor("#0a7d3b")
            .text(formatCurrency(offer.net_disbursed))
            .fillColor("#000000")
            .font("Helvetica");

          // The headline honesty figure: what the loan really costs once the
          // fees above are taken into account. null when it can't be
          // determined — stated as such rather than guessed at.
          if (offer.effective_apr !== null && offer.effective_apr !== undefined) {
            doc
              .text("Effective APR (including fees): ", { continued: true })
              .font("Helvetica-Bold")
              .text(`${offer.effective_apr}%`)
              .font("Helvetica");
          }
          doc.moveDown(0.75);
        }
        if (offer.note) {
          doc.font("Helvetica-Oblique").text(`Note from our credit team: "${offer.note}"`).font("Helvetica");
          doc.moveDown(0.75);
        }
      }

      doc.text(
        "Please log in to your account to review and accept this offer before it expires. Disbursement will follow once the offer is accepted."
      );
    } else {
      doc
        .font("Helvetica-Bold")
        .fillColor("#a1122f")
        .text("Your application has been DECLINED.")
        .fillColor("#000000")
        .font("Helvetica")
        .moveDown(0.75);

      doc.text("This decision was based on the following reason(s):").moveDown(0.4);
      const reasons = adverseAction?.reasons || [];
      if (reasons.length === 0) {
        doc.text("• No specific reason codes were recorded for this decision.");
      } else {
        for (const reason of reasons) {
          doc.font("Helvetica-Bold").text(`• ${reason.label}`, { continued: false }).font("Helvetica");
          if (reason.description) {
            doc.fontSize(10).fillColor("#333333").text(`  ${reason.description}`).fillColor("#000000").fontSize(11);
          }
          doc.moveDown(0.35);
        }
      }
      doc.moveDown(0.5);
      doc.text(
        "You may be able to reapply once the circumstances above have changed. If you believe this decision was made in error, please contact our support team."
      );
    }

    if (decision.note) {
      doc.moveDown(0.75);
      doc.font("Helvetica-Oblique").text(`Additional note: "${decision.note}"`).font("Helvetica");
    }

    doc.moveDown(1.5);
    doc.text("Yours sincerely,");
    doc.font("Helvetica-Bold").text(decision.source === "system" ? "Automated Credit Decision System" : decision.decided_by_name || "Credit Operations");
    doc.font("Helvetica").fontSize(9).fillColor("#777777").moveDown(1);
    doc.text(
      "This is a system-generated letter and does not require a signature. For questions about this decision, please contact support through your account.",
      { width: 480 }
    );

    doc.end();
  });
}

module.exports = { generateDecisionLetterPdf };

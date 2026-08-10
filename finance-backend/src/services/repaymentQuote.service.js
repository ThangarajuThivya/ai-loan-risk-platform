"use strict";

/**
 * What a borrower is allowed to pay, and exactly how much (040) — pure,
 * deterministic. No DB, no I/O, no gateway.
 *
 * THE POINT OF THIS MODULE: the client says which KIND of payment it wants
 * ('installment' | 'settlement' | 'custom'), never how much. The amount is
 * derived here from the schedule and sent to the gateway by the server. A
 * browser that posts {kind:'settlement', amount: 1} gets charged the real
 * settlement figure or nothing at all — the `amount` field is only ever read
 * for 'custom', and even then only as an upper-bounded request.
 *
 * Everything here is composed from repayment.service.js rather than
 * reimplemented: outstandingOn, computeOutstanding and computeSettlement are
 * the same functions loanModel.recordPayment allocates with, so a quote and
 * the payment it produces can never disagree about the arithmetic.
 *
 * The rejections mirror the ones recordPayment already returns (overpayment,
 * settlement mismatch, inactive loan) so a customer is stopped BEFORE their
 * card is charged rather than after — quoting server-side is pointless if the
 * quote can still be refused at the ledger.
 */

const {
  outstandingOn,
  computeOutstanding,
  computeSettlement,
  round2,
} = require("./repayment.service");

/** The kinds a customer may choose. */
const PAYMENT_KINDS = Object.freeze(["installment", "settlement", "custom"]);

/**
 * Smallest payment worth processing. Gateways reject trivial amounts anyway,
 * and a 1-cent payment costs more in fees than it recovers.
 */
const MIN_PAYMENT = 100;

/**
 * The next instalment still owing — oldest unpaid first, matching the
 * allocation order in allocatePayment. This is what "pay my instalment"
 * means: not the nominal EMI, but what is actually left on the oldest row,
 * including any late fee and net of anything already part-paid or waived.
 *
 * A residual below MIN_PAYMENT rolls forward into the following
 * instalment(s) — a gateway will not process it, and nobody would
 * deliberately pay a few rupees anyway. It arises whenever an earlier
 * payment landed a few cents short of a full instalment (an offline receipt
 * keyed in as 35,583.00 instead of 35,583.34, say), and without this the
 * shortfall sits on the ledger forever: "pay my instalment" would forever
 * quote an amount nothing will charge. This changes nothing about how a
 * payment is ALLOCATED once made — allocatePayment applies it oldest-first
 * regardless of what the quote was for, so a combined charge simply clears
 * both rows.
 *
 * @param {object[]} installments repayment_schedule rows
 * @returns {{scheduleId:number, installmentNo:number, throughInstallmentNo?:number,
 *            dueDate:string, amount:number}|null}
 */
function nextInstallmentDue(installments) {
  const sorted = [...installments].sort((a, b) => a.installment_no - b.installment_no);
  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    const owed = outstandingOn(row);
    if (owed.total > 0) {
      let amount = round2(owed.total);
      let through = i;
      while (amount > 0 && amount < MIN_PAYMENT && through + 1 < sorted.length) {
        through += 1;
        amount = round2(amount + outstandingOn(sorted[through]).total);
      }
      return {
        scheduleId: row.id,
        installmentNo: row.installment_no,
        // Present only when rolled forward, so a caller that doesn't care
        // can ignore it — an ordinary full instalment is unaffected.
        throughInstallmentNo: through !== i ? sorted[through].installment_no : undefined,
        dueDate: row.due_date,
        amount,
      };
    }
  }
  return null;
}

/**
 * Every amount a customer could pay right now, for the portal to display.
 * Read-only — nothing here commits to anything.
 *
 * @param {object[]} installments
 * @param {Date} [asOf]
 * @returns {{outstanding:object, settlement:object, nextInstallment:object|null,
 *   minPayment:number, payable:boolean}}
 */
function buildQuoteOptions(installments, asOf = new Date()) {
  const outstanding = computeOutstanding(installments);
  const settlement = computeSettlement(installments, asOf);
  const nextInstallment = nextInstallmentDue(installments);
  return {
    outstanding,
    settlement,
    nextInstallment,
    minPayment: MIN_PAYMENT,
    // A fully-repaid loan whose account has not yet been closed has nothing
    // payable. Surfacing that as a flag stops the UI offering a Pay button
    // that could only ever fail.
    payable: outstanding.total > 0,
  };
}

/**
 * Resolve one payment request into the exact amount to charge.
 *
 * @param {object} p
 * @param {object[]} p.installments
 * @param {'installment'|'settlement'|'custom'} p.kind
 * @param {number} [p.amount] only consulted when kind === 'custom'
 * @param {Date} [p.asOf]
 * @returns {{ok:true, amount:number, paymentType:'installment'|'settlement', description:string}
 *          |{ok:false, reason:string, message:string, outstanding?:number}}
 */
function resolvePayment({ installments, kind, amount, asOf = new Date() }) {
  if (!PAYMENT_KINDS.includes(kind)) {
    return {
      ok: false,
      reason: "INVALID_KIND",
      message: `kind must be one of: ${PAYMENT_KINDS.join(", ")}.`,
    };
  }

  const outstanding = computeOutstanding(installments);
  if (outstanding.total <= 0) {
    return {
      ok: false,
      reason: "NOTHING_OWED",
      message: "This loan has nothing left to pay.",
    };
  }

  if (kind === "settlement") {
    const quote = computeSettlement(installments, asOf);
    // Defence in depth: on the very last instalment of the loan, settling
    // and paying it outright are nearly the same figure, and if that figure
    // ever rounds below what a gateway will process there is no row left to
    // roll it into. Caught here rather than reaching the gateway.
    if (quote.total > 0 && quote.total < MIN_PAYMENT) {
      return {
        ok: false,
        reason: "BELOW_MINIMUM",
        message: `This comes to only ${quote.total}, too small to pay online. Please contact us.`,
      };
    }
    return {
      ok: true,
      amount: quote.total,
      // Carried through to loan_payments.payment_type, which is what makes
      // recordPayment apply the interest waiver instead of a plain
      // oldest-first allocation.
      paymentType: "settlement",
      description: "Early settlement of loan",
    };
  }

  if (kind === "installment") {
    const next = nextInstallmentDue(installments);
    if (!next) {
      return {
        ok: false,
        reason: "NOTHING_OWED",
        message: "This loan has nothing left to pay.",
      };
    }
    // nextInstallmentDue already rolls a tiny residual forward into a
    // following row; this only fires when that row was the LAST one on the
    // schedule and there was nowhere left to roll it into.
    if (next.amount > 0 && next.amount < MIN_PAYMENT) {
      return {
        ok: false,
        reason: "BELOW_MINIMUM",
        message: `This comes to only ${next.amount}, too small to pay online. Please contact us.`,
      };
    }
    return {
      ok: true,
      amount: next.amount,
      paymentType: "installment",
      description: `Loan instalment ${next.installmentNo}`,
    };
  }

  // custom
  const requested = round2(Number(amount));
  if (!Number.isFinite(requested) || requested <= 0) {
    return {
      ok: false,
      reason: "INVALID_AMOUNT",
      message: "Enter a payment amount greater than zero.",
    };
  }
  if (requested < MIN_PAYMENT) {
    return {
      ok: false,
      reason: "BELOW_MINIMUM",
      message: `The smallest payment we can process is ${MIN_PAYMENT}.`,
    };
  }
  // The same rejection recordPayment would produce on `unallocated > 0`,
  // raised here so it happens before the card is charged rather than after.
  if (requested > outstanding.total) {
    return {
      ok: false,
      reason: "OVERPAYMENT",
      message: `That is more than the loan owes. The outstanding balance is ${outstanding.total}.`,
      outstanding: outstanding.total,
    };
  }
  return {
    ok: true,
    amount: requested,
    paymentType: "installment",
    description: "Loan repayment",
  };
}

module.exports = {
  PAYMENT_KINDS,
  MIN_PAYMENT,
  nextInstallmentDue,
  buildQuoteOptions,
  resolvePayment,
};

"use strict";

/**
 * The lease agreement and its rentals (L7).
 *
 * THE ARITHMETIC IS REUSED. `buildAmortizationSchedule` is a pure function of
 * principal, term, rate and rate type — nothing in it is loan-specific, and
 * a flat-rate lease amortises exactly as a flat-rate loan does. Writing a
 * second implementation would be how the two silently diverge.
 *
 * WHAT IS NOT REUSED is the vocabulary. A lease has rentals, not
 * instalments; capital recovery and a finance charge, not principal and
 * interest. The translation happens at the persistence boundary below, so
 * the schema stays honest without duplicating the maths.
 *
 * ACTIVATION IS GATED ON REGISTRATION. Rentals cannot begin until the CR
 * names the lessor as absolute owner — before that the institution is a
 * creditor with no asset behind it, which is precisely what a finance lease
 * is not. See leaseRegistration.service for the full ordering.
 */

const pool = require("../config/db").promise();
const { buildAmortizationSchedule, round2 } = require("../services/amortization.service");
const {
  buildRentalOptions,
  toIsoDate,
  todayIso,
} = require("../services/leaseRentalQuote.service");

/**
 * One month after a date, clamped to month end. Mirrors loanSchedule.
 *
 * `candidate` is LOCAL midnight, so it must be read back with local calendar
 * components. `toISOString()` here converted +05:30 local midnight to 18:30
 * UTC the previous day and shifted every due date in every lease schedule
 * one day early — see toIsoDate's header for the full trap.
 */
function addMonths(date, months) {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  const candidate = new Date(d.getFullYear(), targetMonth, d.getDate());
  if (candidate.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    // The day overflowed (e.g. 31 Jan + 1 month) — clamp to the last day.
    candidate.setDate(0);
  }
  return toIsoDate(candidate);
}

/**
 * One agreement by its own id. The card-rental path starts from a payment
 * intent, which references the AGREEMENT — it has no application id to look
 * up by, and deriving one by scanning applications would be backwards.
 */
async function findAgreementById(agreementId) {
  const [rows] = await pool.query(`SELECT * FROM lease_agreements WHERE id = ? LIMIT 1`, [
    agreementId,
  ]);
  return rows[0] || null;
}

async function findAgreementByApplication(applicationId) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_agreements WHERE application_id = ? LIMIT 1`,
    [applicationId]
  );
  return rows[0] || null;
}

async function findRentalSchedule(agreementId) {
  const [rows] = await pool.query(
    `SELECT * FROM lease_rental_schedule WHERE agreement_id = ? ORDER BY rental_no ASC`,
    [agreementId]
  );
  return rows;
}

async function findRentals(agreementId) {
  const [rows] = await pool.query(
    `SELECT r.*, u.first_name AS recorded_by_first_name, u.last_name AS recorded_by_last_name
       FROM lease_rentals r
       LEFT JOIN users u ON u.user_id = r.recorded_by
      WHERE r.agreement_id = ?
      ORDER BY r.paid_on DESC, r.id DESC`,
    [agreementId]
  );
  return rows;
}

/**
 * Bring a lease to life: create the agreement from the accepted quotation
 * and lay out every rental, in one transaction.
 *
 * The terms are SNAPSHOTTED from the quotation and never recomputed — the
 * rental calendar must not shift because a formula changed later. The
 * schedule is generated once, here, for the same reason.
 *
 * @returns {Promise<{agreementId:number}|{alreadyActive:true}>}
 */
async function activateAgreement({ applicationId, quotation, vehicleId, lesseeId, createdBy, firstRentalDate }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const rows = buildAmortizationSchedule({
      principal: Number(quotation.financed_amount),
      tenureMonths: Number(quotation.term_months),
      annualRatePct: Number(quotation.interest_rate),
      rateType: quotation.rate_type,
      emi: Number(quotation.monthly_rental),
      firstDueDate: firstRentalDate,
    });
    const maturity = rows[rows.length - 1].dueDate;

    let agreementId;
    try {
      const [result] = await conn.query(
        `INSERT INTO lease_agreements
           (application_id, lessee_id, vehicle_id, vehicle_price, down_payment_amount,
            financed_amount, interest_rate, rate_type, term_months, monthly_rental,
            total_rentals, signed_at, activated_at, first_rental_date, maturity_date,
            status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, 'active', ?)`,
        [
          applicationId,
          lesseeId,
          vehicleId,
          quotation.vehicle_price,
          quotation.down_payment_amount,
          quotation.financed_amount,
          quotation.interest_rate,
          quotation.rate_type,
          quotation.term_months,
          quotation.monthly_rental,
          quotation.total_rentals,
          quotation.responded_at,
          firstRentalDate,
          maturity,
          createdBy ?? null,
        ]
      );
      agreementId = result.insertId;
    } catch (err) {
      // UNIQUE(application_id) — a second activation racing the first.
      if (err.code === "ER_DUP_ENTRY") {
        await conn.rollback();
        return { alreadyActive: true };
      }
      throw err;
    }

    // Human-facing reference, set in the same transaction as the insert —
    // same approach as loan_accounts.account_no.
    await conn.query(`UPDATE lease_agreements SET agreement_no = ? WHERE id = ?`, [
      `LSE-${String(agreementId).padStart(6, "0")}`,
      agreementId,
    ]);

    for (const row of rows) {
      await conn.query(
        `INSERT INTO lease_rental_schedule
           (agreement_id, rental_no, due_date, opening_balance, capital_component,
            finance_component, rental_amount, closing_balance, rate_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          agreementId,
          row.installmentNo,
          row.dueDate,
          row.openingBalance,
          // Loan vocabulary in, lease vocabulary out — see the header.
          row.principalComponent,
          row.interestComponent,
          row.emi,
          row.closingBalance,
          quotation.rate_type,
        ]
      );
    }

    await conn.commit();
    return { agreementId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Where the lease stands: what has been paid, what is outstanding, what is
 * next, and whether anything is overdue.
 *
 * Arrears are judged on the DUE DATE against today, not on when a payment
 * was keyed in — a Friday payment recorded on Monday is still a Friday
 * payment.
 */
async function getRentalPosition(agreementId) {
  const schedule = await findRentalSchedule(agreementId);
  if (!schedule.length) return null;

  const today = todayIso();
  const unpaid = schedule.filter((r) => r.status !== "paid");
  const overdue = unpaid.filter((r) => toIsoDate(r.due_date) < today);

  const [[paid]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM lease_rentals WHERE agreement_id = ?`,
    [agreementId]
  );

  const totalRentals = round2(
    schedule.reduce((s, r) => s + Number(r.rental_amount), 0)
  );
  const received = round2(paid.total);

  return {
    totalRentals,
    received,
    outstanding: round2(Math.max(0, totalRentals - received)),
    rentalsPaid: schedule.filter((r) => r.status === "paid").length,
    rentalsTotal: schedule.length,
    nextDue: unpaid[0]
      ? {
          rentalNo: unpaid[0].rental_no,
          dueDate: toIsoDate(unpaid[0].due_date),
          amount: round2(unpaid[0].rental_amount),
        }
      : null,
    arrears: {
      count: overdue.length,
      amount: round2(overdue.reduce((s, r) => s + Number(r.rental_amount), 0)),
    },
    // Every rental settled. This is what unlocks the release letter.
    fullyPaid: unpaid.length === 0,
  };
}

/**
 * Record a rental and allocate it across the schedule, oldest first.
 *
 * A payment is applied to the earliest unpaid rental until it is exhausted,
 * which is the ordinary waterfall: money always clears the oldest debt.
 * Partial coverage marks a rental 'partial' rather than 'paid', so the
 * arrears calculation above does not treat it as settled.
 *
 * SETTLEMENT IS NOT A BIG RENTAL. Settling early costs LESS than the sum of
 * the remaining rentals, because the unearned finance charge is rebated
 * (sum-of-digits — see leasing.service.computeEarlySettlement). Run through
 * the waterfall above, a settlement would therefore always fall short of the
 * schedule's face value, leave the last rows unpaid, and strand the lease
 * open forever — with the release letter, and so the lessee's title to their
 * own vehicle, locked behind an agreement that can never complete.
 *
 * So `rental_type = 'settlement'` closes the schedule outright. The figure
 * is recomputed HERE, under the row lock, and a payment short of it is
 * refused: without that check "settlement" would be a one-word instruction
 * to write off the balance, and LKR 1 would buy a car.
 *
 * Pass `conn` to run inside a caller's transaction. The card path needs
 * this: claiming the payment intent and posting the rental have to be one
 * atomic act, or two concurrent webhook deliveries can both pass the
 * intent's status gate and post the same money twice. When `conn` is
 * supplied this function neither commits nor rolls back — the caller owns
 * the transaction, and a business refusal comes back as a return value for
 * the caller to act on.
 */
async function recordRental({
  agreementId,
  amount,
  method,
  paidOn,
  rentalType,
  externalRef,
  note,
  recordedBy,
  conn: externalConn = null,
}) {
  const conn = externalConn || (await pool.getConnection());
  const ownsTransaction = !externalConn;
  // Inside a caller's transaction, "roll back" means "report the refusal and
  // let the caller decide" — unwinding their work would discard the record
  // of a payment that really did arrive.
  const abort = async () => {
    if (ownsTransaction) await conn.rollback();
  };
  try {
    if (ownsTransaction) await conn.beginTransaction();

    const [[agreement]] = await conn.query(
      `SELECT * FROM lease_agreements WHERE id = ? FOR UPDATE`,
      [agreementId]
    );
    if (!agreement) {
      await abort();
      return { notFound: true };
    }
    if (agreement.status !== "active") {
      await abort();
      return { inactive: true, status: agreement.status };
    }

    const [[paid]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM lease_rentals WHERE agreement_id = ?`,
      [agreementId]
    );
    const totalDue = round2(
      Number(agreement.monthly_rental) * Number(agreement.term_months)
    );

    const isSettlement = rentalType === "settlement";

    // A settlement is checked against its OWN figure, not against the
    // schedule's face value — see this function's header. Everything else is
    // checked against what the schedule still owes.
    if (!isSettlement && round2(Number(paid.total) + Number(amount)) > totalDue + 0.01) {
      await abort();
      return {
        overpayment: true,
        outstanding: round2(Math.max(0, totalDue - Number(paid.total))),
      };
    }

    let settlementQuote = null;
    if (isSettlement) {
      // Locked before the figure is computed, so a rental landing
      // concurrently cannot change the rebate out from under this quote.
      const [scheduleRows] = await conn.query(
        `SELECT rental_no, rental_amount, finance_component
           FROM lease_rental_schedule
          WHERE agreement_id = ? ORDER BY rental_no ASC FOR UPDATE`,
        [agreementId]
      );
      const options = buildRentalOptions({
        schedule: scheduleRows,
        received: Number(paid.total),
        monthlyRental: Number(agreement.monthly_rental),
      });
      settlementQuote = options && options.settlement;
      if (!settlementQuote || settlementQuote.amount <= 0) {
        await abort();
        return { notSettleable: true };
      }
      // THE CHECK THAT STOPS "settlement" MEANING "write off the rest".
      if (Number(amount) + 0.01 < settlementQuote.amount) {
        await abort();
        return { settlementShortfall: true, required: settlementQuote.amount };
      }
    }

    const [result] = await conn.query(
      `INSERT INTO lease_rentals
         (agreement_id, amount, paid_on, method, rental_type, external_ref, note, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        agreementId,
        amount,
        paidOn,
        method,
        rentalType || "rental",
        externalRef ?? null,
        note ?? null,
        recordedBy ?? null,
      ]
    );
    const rentalId = result.insertId;
    await conn.query(`UPDATE lease_rentals SET reference_no = ? WHERE id = ?`, [
      `RNT-${String(rentalId).padStart(6, "0")}`,
      rentalId,
    ]);

    // Re-derive every rental's status from the TOTAL received, rather than
    // applying just this payment to whatever looked unpaid.
    //
    // The schedule carries no per-row paid amount, so incremental allocation
    // would lose how much had landed on a 'partial' row and drift from the
    // ledger on the next payment. Recomputing makes status a pure function
    // of the ledger — it cannot drift, and it self-heals if a payment is
    // ever corrected.
    const [allRows] = await conn.query(
      `SELECT id, rental_amount FROM lease_rental_schedule
        WHERE agreement_id = ? ORDER BY rental_no ASC FOR UPDATE`,
      [agreementId]
    );
    if (isSettlement) {
      // The rebate has been verified above, so every remaining rental is
      // discharged — by contract, not by having been paid at face value.
      await conn.query(
        `UPDATE lease_rental_schedule SET status = 'paid' WHERE agreement_id = ?`,
        [agreementId]
      );
    } else {
      let covered = round2(Number(paid.total) + Number(amount));
      for (const row of allRows) {
        const owed = round2(Number(row.rental_amount));
        // Tolerant of a final cent of rounding dust, deliberately: refusing to
        // call a rental paid over LKR 0.004 would strand the lease forever.
        const status = covered + 0.01 >= owed ? "paid" : covered > 0 ? "partial" : "due";
        await conn.query(`UPDATE lease_rental_schedule SET status = ? WHERE id = ?`, [
          status,
          row.id,
        ]);
        covered = round2(Math.max(0, covered - owed));
      }
    }

    // Every rental settled closes the agreement. The release letter and the
    // title transfer are separate, deliberate acts — see issueRelease.
    const [[stillOwing]] = await conn.query(
      `SELECT COUNT(*) AS n FROM lease_rental_schedule
        WHERE agreement_id = ? AND status <> 'paid'`,
      [agreementId]
    );
    let completed = false;
    if (Number(stillOwing.n) === 0) {
      await conn.query(
        `UPDATE lease_agreements SET status = 'completed', closed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [agreementId]
      );
      completed = true;
    }

    if (ownsTransaction) await conn.commit();
    return { rentalId, completed, settlement: settlementQuote };
  } catch (err) {
    await abort();
    throw err;
  } finally {
    // Only the owner returns the connection to the pool. Releasing a
    // caller's connection mid-transaction would abandon their work.
    if (ownsTransaction) conn.release();
  }
}

module.exports = {
  addMonths,
  findAgreementById,
  findAgreementByApplication,
  findRentalSchedule,
  findRentals,
  activateAgreement,
  getRentalPosition,
  recordRental,
};

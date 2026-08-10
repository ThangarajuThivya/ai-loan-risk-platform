"use strict";

/**
 * Leasing portfolio reporting (L8.1) — pure shaping, no DB.
 *
 * WHY THIS IS SEPARATE FROM THE LOAN REPORTS. A lease book and a loan book
 * are separately regulated and separately accounted for; presenting them in
 * one total would be the same misclassification this module exists to
 * correct, only in the reporting layer instead of the schema.
 *
 * The figures a lessor watches differ from a lender's, too. A lender asks
 * what is owed. A lessor also asks what it OWNS — how much vehicle is
 * sitting on its books, and how much of that it is still exposed on.
 */

const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Roll raw rows into the portfolio summary.
 *
 * @param {object} p
 * @param {object[]} p.applications  lease applications, with status
 * @param {object[]} p.agreements    lease agreements, with status and amounts
 * @param {object[]} p.rentals       [{ agreement_id, total }]
 * @param {object[]} p.registrations [{ status, n }]
 * @returns {object}
 */
function buildPortfolio({ applications = [], agreements = [], rentals = [], registrations = [] }) {
  const receivedByAgreement = new Map(rentals.map((r) => [r.agreement_id, Number(r.total) || 0]));

  const byApplicationStatus = {};
  for (const a of applications) {
    byApplicationStatus[a.status] = (byApplicationStatus[a.status] || 0) + 1;
  }

  const active = agreements.filter((a) => a.status === "active");

  let financedTotal = 0;
  let rentalsDue = 0;
  let rentalsReceived = 0;
  let assetValue = 0;
  for (const a of agreements) {
    financedTotal = round2(financedTotal + Number(a.financed_amount));
    if (a.status === "active") {
      rentalsDue = round2(rentalsDue + Number(a.total_rentals));
      rentalsReceived = round2(rentalsReceived + (receivedByAgreement.get(a.id) || 0));
      // Vehicles the lessor still OWNS. A completed lease's vehicle has been
      // released to the lessee, so it is no longer an asset on this book —
      // see the load-bearing test.
      assetValue = round2(assetValue + Number(a.vehicle_price));
    }
  }

  const byRegistration = {};
  for (const r of registrations) byRegistration[r.status] = Number(r.n) || 0;

  return {
    applications: {
      total: applications.length,
      byStatus: byApplicationStatus,
      // Waiting on the institution, not on the applicant — the queue that
      // actually needs working.
      awaitingReview:
        (byApplicationStatus.pending || 0) + (byApplicationStatus.under_review || 0),
    },
    agreements: {
      total: agreements.length,
      active: active.length,
      completed: agreements.filter((a) => a.status === "completed").length,
      terminated: agreements.filter((a) => a.status === "terminated").length,
      repossessed: agreements.filter((a) => a.status === "repossessed").length,
    },
    book: {
      // Everything ever advanced, live or closed.
      financedTotal,
      rentalsDue,
      rentalsReceived,
      rentalsOutstanding: round2(Math.max(0, rentalsDue - rentalsReceived)),
      // The lessor's own asset position. A lender has no equivalent line.
      vehiclesOwned: active.length,
      assetValue,
      // null, not 0, when nothing is due — see the test.
      collectionRate: rentalsDue > 0 ? round2((rentalsReceived / rentalsDue) * 100) : null,
    },
    title: {
      byStatus: byRegistration,
      // Bought but not yet titled: the backlog that most needs chasing,
      // because the institution has paid out and does not yet hold title.
      awaitingRegistration:
        (byRegistration.not_started || 0) + (byRegistration.submitted || 0),
    },
  };
}

module.exports = { buildPortfolio };

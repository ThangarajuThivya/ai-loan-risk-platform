"use strict";

/**
 * Staff/admin review of lease applications (L3.1) — the valuation workflow
 * and the credit decision it gates.
 *
 * THE CENTRAL IDEA: a valuation is not paperwork, it is the input that makes
 * loan-to-value answerable. So completing one does not just store a number —
 * it RE-EVALUATES the credit policy, because the verdict taken at intake was
 * reached without knowing what the vehicle was worth. Leaving the old
 * verdict in place would mean approving against a judgement that explicitly
 * said it could not judge.
 *
 * Re-evaluation appends rather than overwrites. Both verdicts are true: one
 * is what was known at intake, the other what is known now.
 */

const { validationResult } = require("express-validator");

const leaseAppModel = require("../models/leaseApplication.model");
const leaseModel = require("../models/leaseModel");
const loanModel = require("../models/loanModel");

const { evaluateCreditPolicy } = require("../services/creditPolicy.service");
const { ageFromDob } = require("../services/mlClient.service");
const { assessLtv, resolveDownPayment, buildLeaseQuote } = require("../services/leasing.service");
const { checkTransition, checkValuationGate } = require("../services/leaseStatus.service");
const { resolveLeaseFees, summarizeLeaseFees } = require("../services/leaseFees.service");
const { generateLeaseAgreementPdf, generateReleaseLetterPdf } = require("../services/leaseAgreement.service");
const leaseNotifier = require("../services/leaseNotifier.service");
const leaseRegister = require("../services/leaseRegister.service");
const dpModel = require("../models/leaseDownPayment.model");
const agreementModel = require("../models/leaseAgreement.model");
const { buildPortfolio } = require("../services/leasePortfolio.service");
const {
  checkPayoutAllowed,
  checkSubmissionAllowed,
  checkRegistrationTransition,
  describeNextStep,
} = require("../services/leaseRegistration.service");

/** The lessor's registered name, as it appears on a Certificate of Registration. */
const LESSOR_NAME = process.env.LESSOR_NAME || "Aura Digital Bank";

/** How long a lease quotation stays open for acceptance. */
const QUOTATION_VALID_DAYS = 14;

function rejectInvalid(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  return true;
}

/**
 * Re-run the credit policy for an application using whatever is known NOW,
 * including any completed valuation, and append the verdict.
 *
 * Shared by the valuation-completion path and the decision path so the two
 * can never disagree about how a lease is judged.
 *
 * @returns {Promise<{policy:object, ltv:object}>}
 */
async function reevaluatePolicy(application) {
  const profile = await loanModel.findProfileByUserId(application.lessee_id);
  const valuation = await leaseAppModel.findLatestCompletedValuation(application.vehicle_id);

  const down = resolveDownPayment({
    vehiclePrice: Number(application.invoice_price),
    condition: application.condition_type,
    downPaymentAmount: Number(
      (Number(application.invoice_price) - Number(application.financed_amount)).toFixed(2)
    ),
  });

  const ltv = assessLtv({
    condition: application.condition_type,
    invoicePrice: Number(application.invoice_price),
    valuationAmount: valuation ? Number(valuation.valuation_amount) : undefined,
    financedAmount: Number(application.financed_amount),
  });

  const quote = buildLeaseQuote({
    vehiclePrice: Number(application.invoice_price),
    condition: application.condition_type,
    annualRatePct: Number(application.priced_interest_rate || application.interest_rate),
    tenureMonths: Number(application.term_months),
    rateType: application.rate_type,
    downPaymentAmount: down ? down.amount : undefined,
  });

  const policy = evaluateCreditPolicy({
    applicant: {
      age: ageFromDob(profile?.date_of_birth),
      monthlyIncome: Number(profile?.monthly_income) || 0,
      monthlyExpense: Number(profile?.monthly_expense) || 0,
      employmentType: profile?.employment_type,
      // Re-read from the application's own snapshot, not from the profile as
      // it stands today: the decision must be reproducible against what was
      // declared at the time.
      yearsEmployed: application.years_employed ?? undefined,
      existingLoans: application.existing_loans ?? undefined,
      previousDefaults: application.previous_defaults ?? undefined,
      cribScore: application.crib_score ?? undefined,
      guarantorDefaults: application.guarantor_defaults ?? undefined,
      additionalIncome: application.additional_income ?? undefined,
    },
    loan: {
      amount: Number(application.financed_amount),
      tenureMonths: Number(application.term_months),
      emi: quote ? quote.rental : null,
    },
    lease: {
      ltv,
      downPaymentPercent: down?.percent ?? null,
      minimumDownPaymentPercent: down?.minimumPercent ?? null,
    },
  });

  await leaseAppModel.insertPolicyEvaluation(application.id, {
    policy,
    ltv,
    downPaymentPercent: down?.percent ?? null,
  });

  return { policy, ltv };
}

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */

/** GET /api/leases/review/queue */
exports.getQueue = async (req, res) => {
  try {
    const applications = await leaseAppModel.findAllLeaseApplications({
      status: req.query.status || undefined,
    });
    return res.status(200).json({ applications });
  } catch (err) {
    console.error("LEASE QUEUE ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the lease queue." });
  }
};

/* ------------------------------------------------------------------ *
 * Valuations
 * ------------------------------------------------------------------ */

/** GET /api/leases/:id/valuations */
exports.listValuations = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    // Readable by the lessee too — being told a valuation is outstanding is
    // the answer to "why is my application still pending?".
    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const valuations = await leaseAppModel.findValuationsByVehicle(application.vehicle_id);
    return res.status(200).json({ valuations });
  } catch (err) {
    console.error("LIST VALUATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch valuations." });
  }
};

/** POST /api/leases/:id/valuations — request one from an approved valuer. */
exports.requestValuation = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    if (!application.vehicle_id) {
      return res.status(409).json({ message: "This application has no vehicle to value." });
    }

    if (req.body.valuer_id) {
      const valuer = await leaseModel.findValuerById(req.body.valuer_id);
      if (!valuer) return res.status(400).json({ message: "Unknown valuer." });
      if (valuer.status !== "active") {
        return res.status(400).json({ message: `${valuer.name} is suspended and cannot be assigned.` });
      }
    }

    const valuation = await leaseAppModel.requestValuation({
      vehicleId: application.vehicle_id,
      valuerId: req.body.valuer_id || null,
      requestedBy: req.user.user_id,
    });
    // "Why is my application still pending?" — answered before it is asked.
    leaseNotifier.valuationRequested(application);
    return res.status(201).json({ valuation });
  } catch (err) {
    console.error("REQUEST VALUATION ERROR:", err);
    return res.status(500).json({ message: "Failed to request a valuation." });
  }
};

/**
 * PATCH /api/leases/:id/valuations/:valuationId — record the valuer's report.
 *
 * On completion the credit policy is re-run, because LTV has just become
 * answerable. The response returns the NEW verdict so the reviewer sees the
 * consequence of the number they just entered, rather than having to reload
 * and work out what changed.
 */
exports.recordValuation = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const existing = await leaseAppModel.findValuationById(Number(req.params.valuationId));
    if (!existing || existing.vehicle_id !== application.vehicle_id) {
      return res.status(404).json({ message: "Valuation not found." });
    }

    const status = req.body.status;
    if (status === "completed" && !(Number(req.body.valuation_amount) > 0)) {
      return res.status(400).json({
        message: "A completed valuation must carry a positive valuation_amount.",
      });
    }

    const valuation = await leaseAppModel.completeValuation(existing.id, {
      status,
      valuationAmount: req.body.valuation_amount,
      valuationDate: req.body.valuation_date,
      reportReference: req.body.report_reference,
      conditionNotes: req.body.condition_notes,
    });
    if (!valuation) {
      // Guarded in SQL, so this is a genuine race or a repeat submission,
      // not a validation slip.
      return res.status(409).json({
        message:
          "This valuation has already been recorded. Request a fresh valuation instead of amending a completed one.",
      });
    }

    // The number just changed what LTV can say, so the verdict has to be
    // taken again — see this module's header.
    const { policy, ltv } = await reevaluatePolicy(application);

    if (req.body.status === "completed") {
      leaseNotifier.valuationCompleted(application, req.body.valuation_amount);
    }
    return res.status(200).json({ valuation, policy, ltv });
  } catch (err) {
    console.error("RECORD VALUATION ERROR:", err);
    return res.status(500).json({ message: "Failed to record the valuation." });
  }
};

/* ------------------------------------------------------------------ *
 * The credit decision
 * ------------------------------------------------------------------ */

/**
 * PATCH /api/leases/:id/status — move an application through the machine.
 *
 * Two gates, in order:
 *   1. The status machine: is this move legal for this role at all?
 *   2. The valuation gate: may THIS vehicle be approved yet?
 *
 * Both live in leaseStatus.service so any future endpoint that moves a lease
 * inherits them rather than reimplementing them.
 */
exports.updateStatus = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const to = req.body.status;
    const move = checkTransition(application.status, to, req.user.role);
    if (!move.ok) return res.status(409).json({ message: move.reason });

    // Rejecting requires a reason, the same rule the loan side applies: an
    // applicant refused with no explanation has nothing to act on.
    const note = (req.body.note || "").trim();
    if (to === "rejected" && !note) {
      return res.status(400).json({ message: "A reason is required when rejecting a lease application." });
    }

    if (to === "approved") {
      const completed = await leaseAppModel.findLatestCompletedValuation(application.vehicle_id);
      const gate = checkValuationGate({
        targetStatus: to,
        conditionType: application.condition_type,
        hasCompletedValuation: Boolean(completed),
      });
      if (!gate.ok) return res.status(409).json({ message: gate.reason });

      // Approving against a stale verdict would mean approving against a
      // judgement taken before the valuation existed. Re-run first, and
      // refuse if the policy now declines.
      const { policy } = await reevaluatePolicy(application);
      if (policy.outcome === "decline" && !req.body.override_reason) {
        return res.status(409).json({
          message:
            "Credit policy declines this lease on the current figures. Supply an override_reason to approve it anyway.",
          reason_codes: policy.reason_codes,
        });
      }
    }

    const moved = await leaseAppModel.transitionApplication(application.id, {
      from: application.status,
      to,
      actorUserId: req.user.user_id,
      actorRole: req.user.role,
      note: note || req.body.override_reason || null,
    });
    if (!moved) {
      return res.status(409).json({
        message: "This application was updated by someone else. Reload and try again.",
      });
    }

    const updated = await leaseAppModel.findLeaseApplicationById(application.id);
    // The decision itself. 'approved' is the one that matters most: it tells
    // the lessee outright that approval is NOT the last step, which is the
    // confusion this whole stage kept producing.
    leaseNotifier.statusChanged(updated, to, note || req.body.override_reason || null);
    return res.status(200).json({ application: updated });
  } catch (err) {
    console.error("UPDATE LEASE STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to update the lease application." });
  }
};

/* ------------------------------------------------------------------ *
 * Quotations (L4.1)
 * ------------------------------------------------------------------ */

/**
 * Build the full set of quotation figures for an application.
 *
 * Everything a quotation says comes from here, and the same function feeds
 * both the preview and the issue path — so what staff see before clicking
 * and what the lessee is sent afterwards cannot differ.
 *
 * `overrides` lets staff re-quote on different terms (a larger down payment,
 * a shorter term) without editing the application.
 */
async function buildQuotationFigures(application, overrides = {}) {
  const vehiclePrice = Number(overrides.vehicle_price ?? application.invoice_price);
  const financedAmount = Number(overrides.financed_amount ?? application.financed_amount);
  const termMonths = Number(overrides.term_months ?? application.term_months);
  const interestRate = Number(
    overrides.interest_rate ?? application.priced_interest_rate ?? application.interest_rate
  );

  const down = resolveDownPayment({
    vehiclePrice,
    condition: application.condition_type,
    downPaymentAmount: Number((vehiclePrice - financedAmount).toFixed(2)),
  });
  if (!down) return { error: "The down payment implied by these figures could not be resolved." };
  if (!down.meetsMinimum) {
    return {
      error:
        `These terms leave a ${down.percent}% down payment; a ` +
        `${String(application.condition_type).replace("_", "-")} vehicle requires at least ` +
        `${down.minimumPercent}%.`,
    };
  }

  const quote = buildLeaseQuote({
    vehiclePrice,
    condition: application.condition_type,
    annualRatePct: interestRate,
    tenureMonths: termMonths,
    rateType: application.rate_type,
    downPaymentAmount: down.amount,
  });
  if (!quote) return { error: "A rental could not be computed from these figures." };

  const configs = await leaseAppModel.findLeaseProductFees(application.product_id);
  const fees = resolveLeaseFees({
    configs,
    financedAmount: quote.financedAmount,
    condition: application.condition_type,
    waivers: Array.isArray(overrides.fee_waivers) ? overrides.fee_waivers : [],
  });
  const summary = summarizeLeaseFees({
    fees,
    downPaymentAmount: down.amount,
    financedAmount: quote.financedAmount,
    rental: quote.rental,
    termMonths,
  });

  return {
    terms: {
      vehiclePrice: quote.vehiclePrice,
      downPaymentAmount: down.amount,
      downPaymentPercent: down.percent,
      financedAmount: quote.financedAmount,
      termMonths,
      interestRate,
      rateType: application.rate_type,
      monthlyRental: quote.rental,
      totalRentals: quote.totalRentals,
      note: overrides.note,
    },
    fees,
    summary,
  };
}

/** GET /api/leases/:id/quotations — every quotation ever issued. */
exports.listQuotations = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }
    const quotations = await leaseAppModel.findQuotationsByApplication(application.id);
    return res.status(200).json({ quotations });
  } catch (err) {
    console.error("LIST QUOTATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch quotations." });
  }
};

/** POST /api/leases/:id/quotations/preview — the figures, without issuing. */
exports.previewQuotation = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const built = await buildQuotationFigures(application, req.body);
    if (built.error) return res.status(400).json({ message: built.error });
    return res.status(200).json(built);
  } catch (err) {
    console.error("PREVIEW QUOTATION ERROR:", err);
    return res.status(500).json({ message: "Failed to build the quotation." });
  }
};

/**
 * POST /api/leases/:id/quotations — issue (or reissue) a quotation.
 *
 * Only an approved application may be quoted, and issuing moves it to
 * `quoted` through the same status machine everything else uses. A reissue
 * supersedes the live quotation inside the model's transaction, so there is
 * never a moment with two acceptable sets of terms.
 */
exports.issueQuotation = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    // approved → quoted for a first quotation; quoted → quoted for a
    // reissue. Both are real edges in the machine, so both are checked
    // there rather than special-cased here.
    const target = "quoted";
    const move = checkTransition(application.status, target, req.user.role);
    if (!move.ok) return res.status(409).json({ message: move.reason });

    const built = await buildQuotationFigures(application, req.body);
    if (built.error) return res.status(400).json({ message: built.error });

    // Waiving a fee needs a stated reason, the same rule that governs
    // rejections and policy overrides — a discount nobody has to justify is
    // a discount nobody can audit.
    for (const fee of built.fees) {
      if (fee.waived && !fee.waived_reason) {
        return res.status(400).json({
          message: `Waiving the ${fee.label} requires a reason.`,
        });
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + QUOTATION_VALID_DAYS);

    const quotationId = await leaseAppModel.issueQuotationWithin({
      applicationId: application.id,
      terms: built.terms,
      fees: built.fees,
      quotedBy: req.user.user_id,
      expiresAt,
    });

    // Only move the application on a FIRST quotation; a reissue leaves it
    // where it already is.
    if (application.status !== "quoted") {
      await leaseAppModel.transitionApplication(application.id, {
        from: application.status,
        to: target,
        actorUserId: req.user.user_id,
        actorRole: req.user.role,
        note: built.terms.note || null,
      });
    }

    const quotation = await leaseAppModel.findQuotationById(quotationId);
    // Keyed per QUOTATION, so a reissue notifies again — new terms are news.
    leaseNotifier.quotationIssued(application, quotation);
    return res.status(201).json({ quotation, summary: built.summary });
  } catch (err) {
    console.error("ISSUE QUOTATION ERROR:", err);
    return res.status(500).json({ message: "Failed to issue the quotation." });
  }
};

/**
 * PATCH /api/leases/:id/quotations/:quotationId — the lessee's answer.
 *
 * Accepting is the act that makes the terms binding in this system, so it is
 * the lessee's alone: the status machine grants `quoted → accepted` to
 * 'customer' only, and the ownership check below makes sure it is THEIR
 * application.
 */
exports.answerQuotation = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    if (application.lessee_id !== req.user.user_id) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const decision = req.body.decision;
    const target = decision === "accept" ? "accepted" : "declined";
    const move = checkTransition(application.status, target, "customer");
    if (!move.ok) return res.status(409).json({ message: move.reason });

    const quotation = await leaseAppModel.findQuotationById(Number(req.params.quotationId));
    if (!quotation || quotation.application_id !== application.id) {
      return res.status(404).json({ message: "Quotation not found." });
    }
    if (quotation.status !== "pending") {
      return res.status(409).json({
        message: `This quotation is ${quotation.status} and can no longer be answered.`,
      });
    }
    if (new Date(quotation.expires_at) < new Date()) {
      return res.status(409).json({
        message: "This quotation has expired. Contact us for a fresh one.",
      });
    }

    const answered = await leaseAppModel.answerQuotation({
      quotationId: quotation.id,
      applicationId: application.id,
      decision,
      lesseeId: req.user.user_id,
      note: req.body.note,
    });
    if (!answered) {
      return res.status(409).json({
        message: "This quotation was updated elsewhere. Reload and try again.",
      });
    }

    const updated = await leaseAppModel.findQuotationById(quotation.id);
    // Tells the DESK, not the lessee — they just did this themselves.
    leaseNotifier.quotationAnswered(application, updated, decision);
    return res.status(200).json({ quotation: updated });
  } catch (err) {
    console.error("ANSWER QUOTATION ERROR:", err);
    return res.status(500).json({ message: "Failed to record your response." });
  }
};

/**
 * GET /api/leases/:id/agreement.pdf — the statement of lease terms.
 *
 * Generated from the SNAPSHOTTED quotation, never recomputed, so the
 * document and the record cannot drift. Available to the lessee and to
 * staff; there is nothing here the lessee should not see, since it is their
 * own agreement.
 */
exports.getAgreementPdf = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    // The accepted quotation if there is one, else whatever is currently
    // live — a lessee reading terms before deciding needs the live one.
    const quotations = await leaseAppModel.findQuotationsByApplication(application.id);
    const quotation =
      quotations.find((q) => q.status === "accepted") ||
      quotations.find((q) => q.status === "pending");
    if (!quotation) {
      return res.status(409).json({ message: "No quotation has been issued for this application." });
    }

    const summary = summarizeLeaseFees({
      fees: quotation.fees,
      downPaymentAmount: Number(quotation.down_payment_amount),
      financedAmount: Number(quotation.financed_amount),
      rental: Number(quotation.monthly_rental),
      termMonths: Number(quotation.term_months),
    });

    const profile = await loanModel.findProfileByUserId(application.lessee_id);
    const lesseeName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "The Lessee";

    const pdf = await generateLeaseAgreementPdf({ application, quotation, summary, lesseeName });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="lease-agreement-${application.id}.pdf"`
    );
    return res.send(pdf);
  } catch (err) {
    console.error("LEASE AGREEMENT PDF ERROR:", err);
    return res.status(500).json({ message: "Failed to generate the agreement." });
  }
};

/* ------------------------------------------------------------------ *
 * Purchase and title (L6)
 * ------------------------------------------------------------------ */

/**
 * Everything about where this lease has got to on the purchase/title track,
 * plus the single sentence saying what happens next.
 *
 * One endpoint rather than three because the three facts are only meaningful
 * together: whether the dealer can be paid depends on the down payment, and
 * whether the CR can be lodged depends on the payout.
 */
async function loadPurchaseState(application) {
  const [payout, registration, position, supplier] = await Promise.all([
    leaseAppModel.findPayout(application.id),
    leaseAppModel.findRegistration(application.vehicle_id),
    dpModel.getSigningPosition(application.id),
    application.supplier_id ? leaseModel.findSupplierById(application.supplier_id) : null,
  ]);
  const registrationStatus = registration?.status || "not_started";
  // Who we are buying from, and whether they can actually be paid. Both
  // reported before the payout step rather than discovered at it: a dealer
  // with no account on file used to surface only as a 409 at the moment
  // someone tried to pay, which is the worst possible time to find out.
  const supplierReadiness = application.supplier_id
    ? leaseRegister.describeSupplierReadiness(supplier)
    : null;
  return {
    payout,
    registration,
    registrationStatus,
    supplier: supplier
      ? {
          id: supplier.id,
          name: supplier.name,
          contact_person: supplier.contact_person,
          phone: supplier.phone,
          status: supplier.status,
          payable: supplierReadiness.payable,
          readiness: supplierReadiness,
        }
      : null,
    downPaymentSettled: Boolean(position?.settled),
    downPayment: position,
    nextStep: describeNextStep({
      applicationStatus: application.status,
      downPaymentSettled: Boolean(position?.settled),
      vehiclePaidFor: Boolean(payout),
      registrationStatus,
    }),
  };
}

/** GET /api/leases/:id/purchase */
exports.getPurchaseState = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }
    const state = await loadPurchaseState(application);
    if (isOwner && !["admin", "staff"].includes(req.user.role) && state.supplier) {
      // The lessee may see WHO we are buying from — that is their car. They
      // may not see that the dealer's bank details are incomplete on our
      // side; that is our operational problem, not a status update.
      const { payable, readiness, ...visible } = state.supplier;
      void payable;
      void readiness;
      state.supplier = visible;
    }
    return res.status(200).json(state);
  } catch (err) {
    console.error("GET PURCHASE STATE ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the purchase state." });
  }
};

/**
 * POST /api/leases/:id/purchase/payout — record paying the dealer.
 *
 * Gated on the down payment being settled. That gate is the institution's
 * protection, not paperwork: buying the vehicle first would advance its own
 * money against a commitment the lessee has not yet made.
 */
exports.recordPayout = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const state = await loadPurchaseState(application);
    // null for a private seller, which is legitimate — that purchase is
    // arranged out of band and only RECORDED here.
    const supplier = application.supplier_id
      ? await leaseModel.findSupplierById(application.supplier_id)
      : null;

    const gate = checkPayoutAllowed({
      applicationStatus: application.status,
      downPaymentSettled: state.downPaymentSettled,
      alreadyPaid: Boolean(state.payout),
      supplier,
      supplierPayable: supplier ? leaseModel.supplierIsPayable(supplier) : true,
    });
    if (!gate.ok) return res.status(409).json({ message: gate.reason });

    // The amount is the VEHICLE PRICE from the accepted quotation, not the
    // financed amount: the institution buys the whole vehicle, of which the
    // lessee has funded the down payment portion.
    const quotation = await leaseAppModel.findQuotationsByApplication(application.id);
    const acceptedQuotation = quotation.find((q) => q.status === "accepted");
    if (!acceptedQuotation) {
      return res.status(409).json({ message: "No accepted quotation to buy against." });
    }

    const result = await leaseAppModel.recordPayout({
      applicationId: application.id,
      supplierId: supplier?.id ?? null,
      amount: Number(acceptedQuotation.vehicle_price),
      method: req.body.method || "bank_transfer",
      referenceNo: req.body.reference_no,
      paidOn: req.body.paid_on || new Date().toISOString().slice(0, 10),
      paidBy: req.user.user_id,
      notes: req.body.notes,
      supplier,
    });
    if (result.alreadyPaid) {
      // UNIQUE(application_id) caught a race the gate above did not.
      return res.status(409).json({ message: "The vehicle for this lease has already been paid for." });
    }

    const updated = await loadPurchaseState(application);
    leaseNotifier.dealerPaid(application);
    return res.status(201).json({ payout_id: result.payoutId, ...updated });
  } catch (err) {
    console.error("RECORD PAYOUT ERROR:", err);
    return res.status(500).json({ message: "Failed to record the payout." });
  }
};

/**
 * PATCH /api/leases/:id/purchase/supplier — attach or detach the dealer.
 *
 * Gated on the payout, not on the application status. Before the money
 * leaves, who we are buying from is still a working decision staff are
 * entitled to correct; after it leaves, the supplier on the vehicle is the
 * counterparty a real payment was made to and changing it would make the
 * payout record describe a transaction that did not happen.
 */
exports.assignSupplier = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    if (!application.vehicle_id) {
      return res.status(409).json({ message: "This application has no vehicle recorded." });
    }

    const state = await loadPurchaseState(application);
    if (state.payout) {
      return res.status(409).json({
        message: "The vehicle has already been paid for — the dealer on record cannot be changed.",
      });
    }

    const raw = req.body.supplier_id;
    const supplierId = raw === null || raw === undefined || raw === "" ? null : Number(raw);

    let supplier = null;
    if (supplierId !== null) {
      supplier = await leaseModel.findSupplierById(supplierId);
      if (!supplier) return res.status(404).json({ message: "Dealer not found." });
      if (supplier.status !== "active") {
        return res
          .status(409)
          .json({ message: `${supplier.name} is suspended and cannot be assigned.` });
      }
    }

    await leaseAppModel.setVehicleSupplier(application.vehicle_id, supplierId);

    // Report payout readiness with the answer rather than leaving staff to
    // discover at the payout step that the dealer they just chose has no
    // account on file.
    const readiness = leaseRegister.describeSupplierReadiness(supplier);
    return res.status(200).json({
      supplier: supplier
        ? { id: supplier.id, name: supplier.name, payable: readiness.payable, readiness }
        : null,
      notice: supplier && !readiness.payable ? readiness.summary : null,
    });
  } catch (err) {
    console.error("ASSIGN LEASE SUPPLIER ERROR:", err);
    return res.status(500).json({ message: "Failed to set the dealer." });
  }
};

/**
 * PATCH /api/leases/:id/purchase/registration — advance the CR workflow.
 *
 * `submitted` records lodging the papers with the DMT; `registered` records
 * the CR coming back with the institution as absolute owner. Each carries
 * its own reference and date because each is a real interaction someone will
 * eventually have to evidence.
 */
exports.updateRegistration = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    if (!application.vehicle_id) {
      return res.status(409).json({ message: "This application has no vehicle to register." });
    }

    const state = await loadPurchaseState(application);
    const to = req.body.status;
    const from = state.registrationStatus;

    if (to === "submitted") {
      const gate = checkSubmissionAllowed({
        vehiclePaidFor: Boolean(state.payout),
        registrationStatus: from,
      });
      if (!gate.ok) return res.status(409).json({ message: gate.reason });
    } else {
      const gate = checkRegistrationTransition(from, to);
      if (!gate.ok) return res.status(409).json({ message: gate.reason });
    }

    const fields = {};
    if (to === "submitted") {
      fields.submitted_at = req.body.submitted_at || new Date().toISOString().slice(0, 10);
      fields.submitted_reference = req.body.reference || null;
    }
    if (to === "registered") {
      if (!req.body.cr_number) {
        return res.status(400).json({ message: "A CR number is required to record registration." });
      }
      fields.cr_number = req.body.cr_number;
      fields.registered_at = req.body.registered_at || new Date().toISOString().slice(0, 10);
      // Snapshotted as printed on the CR — the lessor's registered name can
      // change over a five-year lease, and what was printed must not.
      fields.absolute_owner = req.body.absolute_owner || LESSOR_NAME;
      fields.registered_user = req.body.registered_user || null;
      // A brand-new vehicle gets its registration number here for the first
      // time, so carry it back onto the vehicle record too.
      if (req.body.registration_no) {
        await leaseAppModel.setVehicleRegistrationNo(application.vehicle_id, req.body.registration_no);
      }
    }
    if (req.body.notes) fields.notes = req.body.notes;

    const moved = await leaseAppModel.advanceRegistration(application.vehicle_id, {
      from,
      to,
      fields,
      updatedBy: req.user.user_id,
    });
    if (!moved) {
      return res.status(409).json({
        message: "The registration was updated by someone else. Reload and try again.",
      });
    }

    const updated = await loadPurchaseState(application);
    // Only the CR coming back is news to a lessee — "lodged with the DMT"
    // is our internal step, and telling them about it would be noise.
    if (to === "registered") {
      leaseNotifier.vehicleRegistered(application, req.body.cr_number || updated.registration?.cr_number);
    }
    return res.status(200).json(updated);
  } catch (err) {
    console.error("UPDATE REGISTRATION ERROR:", err);
    return res.status(500).json({ message: "Failed to update the registration." });
  }
};

/* ------------------------------------------------------------------ *
 * The agreement, rentals and release of title (L7)
 * ------------------------------------------------------------------ */

/** GET /api/leases/:id/agreement — the live agreement, schedule and position. */
exports.getAgreement = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const agreement = await agreementModel.findAgreementByApplication(application.id);
    if (!agreement) return res.status(200).json({ agreement: null });

    const [schedule, rentals, position, registration] = await Promise.all([
      agreementModel.findRentalSchedule(agreement.id),
      agreementModel.findRentals(agreement.id),
      agreementModel.getRentalPosition(agreement.id),
      leaseAppModel.findRegistration(application.vehicle_id),
    ]);

    return res.status(200).json({ agreement, schedule, rentals, position, registration });
  } catch (err) {
    console.error("GET LEASE AGREEMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the agreement." });
  }
};

/**
 * POST /api/leases/:id/agreement/activate — start the lease.
 *
 * Gated on the CR being registered. Until title names the lessor, there is
 * no asset behind the rentals, so collecting them would make this a loan in
 * all but name.
 */
exports.activateAgreement = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    if (application.status !== "accepted") {
      return res.status(409).json({
        message: `The lessee has not accepted a quotation (application is ${application.status}).`,
      });
    }

    const registration = await leaseAppModel.findRegistration(application.vehicle_id);
    if (registration?.status !== "registered") {
      return res.status(409).json({
        message:
          "The vehicle is not registered to us yet. Rentals cannot begin before the Certificate " +
          "of Registration names the lessor as absolute owner.",
      });
    }

    const quotations = await leaseAppModel.findQuotationsByApplication(application.id);
    const accepted = quotations.find((q) => q.status === "accepted");
    if (!accepted) return res.status(409).json({ message: "No accepted quotation to activate." });

    // First rental falls a month after activation, which is the convention
    // for a lease drawn down today.
    const firstRentalDate =
      req.body?.first_rental_date || agreementModel.addMonths(new Date(), 1);

    const result = await agreementModel.activateAgreement({
      applicationId: application.id,
      quotation: accepted,
      vehicleId: application.vehicle_id,
      lesseeId: application.lessee_id,
      createdBy: req.user.user_id,
      firstRentalDate,
    });
    if (result.alreadyActive) {
      return res.status(409).json({ message: "This lease has already been activated." });
    }

    const agreement = await agreementModel.findAgreementByApplication(application.id);
    const schedule = await agreementModel.findRentalSchedule(agreement.id);
    leaseNotifier.leaseActivated(application, agreement);
    return res.status(201).json({ agreement, schedule });
  } catch (err) {
    console.error("ACTIVATE AGREEMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to activate the lease." });
  }
};

/** POST /api/leases/:id/agreement/rentals — staff record a rental received. */
exports.recordRental = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const agreement = await agreementModel.findAgreementByApplication(application.id);
    if (!agreement) return res.status(409).json({ message: "This lease is not active yet." });

    const result = await agreementModel.recordRental({
      agreementId: agreement.id,
      amount: Number(req.body.amount),
      method: req.body.method,
      paidOn: req.body.paid_on || new Date().toISOString().slice(0, 10),
      rentalType: req.body.rental_type,
      externalRef: req.body.reference_no,
      note: req.body.note,
      recordedBy: req.user.user_id,
    });

    if (result.notFound) return res.status(404).json({ message: "Agreement not found." });
    if (result.inactive) {
      return res.status(409).json({
        message: `This lease is ${result.status}; no further rentals can be recorded.`,
      });
    }
    if (result.overpayment) {
      return res.status(409).json({
        message: `That is more than the lease owes. LKR ${result.outstanding.toLocaleString("en-LK")} is outstanding.`,
        outstanding: result.outstanding,
      });
    }

    const position = await agreementModel.getRentalPosition(agreement.id);
    leaseNotifier.rentalReceived(application, Number(req.body.amount), position, {
      settlement: req.body.rental_type === "settlement",
    });
    return res.status(201).json({ rental_id: result.rentalId, completed: result.completed, position });
  } catch (err) {
    console.error("RECORD RENTAL ERROR:", err);
    return res.status(500).json({ message: "Failed to record the rental." });
  }
};

/**
 * POST /api/leases/:id/agreement/release — issue the letter of release.
 *
 * THE POINT OF THE WHOLE MODULE. Every rental paid means the lessee has
 * earned the vehicle, and this is the document that lets them put it in
 * their own name at the DMT. Gated on the agreement being completed —
 * releasing an asset still being paid for would hand away security.
 */
exports.issueRelease = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const agreement = await agreementModel.findAgreementByApplication(application.id);
    if (!agreement) return res.status(409).json({ message: "This lease is not active." });

    const position = await agreementModel.getRentalPosition(agreement.id);
    if (!position?.fullyPaid) {
      return res.status(409).json({
        message:
          `A release letter cannot be issued while rentals are outstanding — ` +
          `${position?.rentalsTotal - position?.rentalsPaid} of ${position?.rentalsTotal} remain unpaid.`,
      });
    }

    const registration = await leaseAppModel.findRegistration(application.vehicle_id);
    const gate = checkRegistrationTransition(registration?.status || "not_started", "release_issued");
    if (!gate.ok) return res.status(409).json({ message: gate.reason });

    const letterNo = `REL-${String(agreement.id).padStart(6, "0")}`;
    const moved = await leaseAppModel.advanceRegistration(application.vehicle_id, {
      from: registration.status,
      to: "release_issued",
      fields: {
        release_letter_no: letterNo,
        release_issued_at: new Date().toISOString().slice(0, 10),
      },
      updatedBy: req.user.user_id,
    });
    if (!moved) {
      return res.status(409).json({ message: "The registration was updated elsewhere. Reload and try again." });
    }

    const updated = await leaseAppModel.findRegistration(application.vehicle_id);
    leaseNotifier.releaseIssued(application, letterNo);
    return res.status(201).json({ registration: updated, release_letter_no: letterNo });
  } catch (err) {
    console.error("ISSUE RELEASE ERROR:", err);
    return res.status(500).json({ message: "Failed to issue the release letter." });
  }
};

/**
 * PATCH /api/leases/:id/agreement/transfer — record the DMT transfer.
 *
 * The last act: the lessee is now the legal owner and the lease is over.
 */
exports.recordTransfer = async (req, res) => {
  if (rejectInvalid(req, res)) return;
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    const registration = await leaseAppModel.findRegistration(application.vehicle_id);
    const gate = checkRegistrationTransition(registration?.status || "not_started", "transferred");
    if (!gate.ok) return res.status(409).json({ message: gate.reason });

    const moved = await leaseAppModel.advanceRegistration(application.vehicle_id, {
      from: registration.status,
      to: "transferred",
      fields: {
        transferred_at: req.body.transferred_at || new Date().toISOString().slice(0, 10),
        transfer_reference: req.body.reference || null,
      },
      updatedBy: req.user.user_id,
    });
    if (!moved) {
      return res.status(409).json({ message: "The registration was updated elsewhere. Reload and try again." });
    }

    const updated = await leaseAppModel.findRegistration(application.vehicle_id);
    leaseNotifier.titleTransferred(application);
    return res.status(200).json({ registration: updated });
  } catch (err) {
    console.error("RECORD TRANSFER ERROR:", err);
    return res.status(500).json({ message: "Failed to record the transfer." });
  }
};

/** GET /api/leases/:id/release-letter.pdf */
exports.getReleaseLetterPdf = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    const isOwner = application.lessee_id === req.user.user_id;
    if (!isOwner && !["admin", "staff"].includes(req.user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const registration = await leaseAppModel.findRegistration(application.vehicle_id);
    if (!registration?.release_letter_no) {
      return res.status(409).json({ message: "No release letter has been issued for this lease." });
    }

    const agreement = await agreementModel.findAgreementByApplication(application.id);
    const profile = await loanModel.findProfileByUserId(application.lessee_id);
    const lesseeName =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "The Lessee";

    const pdf = await generateReleaseLetterPdf({
      application,
      agreement,
      registration,
      lesseeName,
      lessorName: LESSOR_NAME,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="release-letter-${application.id}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error("RELEASE LETTER PDF ERROR:", err);
    return res.status(500).json({ message: "Failed to generate the release letter." });
  }
};

/**
 * GET /api/leases/review/portfolio (L8.1) — the leasing book.
 *
 * Four cheap aggregate reads rather than one join: the four questions are
 * independent, and a single query would need outer joins that inflate the
 * counts it is trying to report.
 */
exports.getPortfolio = async (_req, res) => {
  try {
    const [applications, agreements, rentals, registrations] =
      await leaseAppModel.getPortfolioRows();
    return res.status(200).json(
      buildPortfolio({ applications, agreements, rentals, registrations })
    );
  } catch (err) {
    console.error("LEASE PORTFOLIO ERROR:", err);
    return res.status(500).json({ message: "Failed to build the leasing portfolio." });
  }
};

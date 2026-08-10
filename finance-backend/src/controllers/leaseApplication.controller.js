"use strict";

/**
 * Lease application intake (L2.1) — POST /api/leases/apply and the reads
 * around it.
 *
 * THE POINT OF THIS FILE is that almost nothing in it is lease-specific.
 * The risk model, the credit-policy engine, the consent gate and the
 * behavioural-feature derivation are the SAME services the loan path calls,
 * invoked with the same arguments. A lease is underwritten exactly like any
 * other credit exposure; what differs is the asset behind it, and that shows
 * up in precisely three places:
 *
 *   1. The vehicle is required, and its price is what the financed amount is
 *      derived against.
 *   2. LTV is measured against the LOWER of invoice and valuation, and fed
 *      to the policy engine as the LEASE_LTV rule.
 *   3. The rental is flat-rate by convention (leasing.service), not the
 *      reducing-balance EMI a loan quotes.
 *
 * Everything else is deliberately shared, because duplicating a credit
 * decisioning pipeline is how the two drift apart.
 */

const fs = require("fs");
const path = require("path");
const { validationResult } = require("express-validator");

const leaseAppModel = require("../models/leaseApplication.model");
const leaseModel = require("../models/leaseModel");
const loanModel = require("../models/loanModel");
const consentModel = require("../models/consentModel");
const leaseNotifier = require("../services/leaseNotifier.service");

const {
  mapProfileToModelFields,
  predictRisk,
  ageFromDob,
  isProvided,
  DECLARABLE_FIELDS,
  PROFILE_BACKED_FIELDS,
} = require("../services/mlClient.service");
const { evaluateCreditPolicy } = require("../services/creditPolicy.service");
const { deriveBehaviouralFeatures } = require("../services/behaviouralFeatures.service");
const { priceInterestRate } = require("../services/interestPricing.service");
const { findMissingConsents } = require("../services/consent.service");
const {
  assessLtv,
  resolveDownPayment,
  requiresValuation,
  buildLeaseQuote,
} = require("../services/leasing.service");
const {
  normalizeVehicleInput,
  validateLeaseVehicle,
} = require("../services/leaseVehicle.service");
const { sanitizeDownloadFilename } = require("../services/loanDocument.service");
const { LOAN_DOCUMENT_DIR } = require("../config/multer");

/** Most undecided lease applications one lessee may have at once. */
const MAX_PENDING_LEASE_APPLICATIONS = 3;

/**
 * POST /api/leases/apply
 */
exports.apply = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const lesseeId = req.user.user_id;
  const { product_id, financed_amount, term_months } = req.body;

  try {
    // Consent gate — identical to the loan path, and for the same reason:
    // this is where personal data is processed and a bureau-aware risk
    // assessment happens. A frontend gate alone is only ever a UX nicety.
    const latestConsents = await consentModel.getLatestConsentsByUser(lesseeId);
    const missingConsents = findMissingConsents(latestConsents);
    if (missingConsents.length) {
      return res.status(403).json({
        message:
          "Required consent has not been provided. Please review and accept the consent notices before applying.",
        missing_consents: missingConsents,
      });
    }

    const profile = await loanModel.findProfileByUserId(lesseeId);
    if (!profile) {
      return res.status(400).json({
        message: "No customer profile found. Complete your profile before applying.",
      });
    }

    const product = await leaseAppModel.findLeaseProductById(product_id);
    if (!product || !product.active) {
      return res.status(400).json({ message: `Unknown lease product (product_id=${product_id}).` });
    }

    const minAmount = Number(product.min_financed_amount);
    const maxAmount = Number(product.max_financed_amount);
    if (financed_amount < minAmount || financed_amount > maxAmount) {
      return res.status(400).json({
        message: `financed_amount must be between ${minAmount} and ${maxAmount} for ${product.name}.`,
      });
    }
    if (term_months < product.min_term_months || term_months > product.max_term_months) {
      return res.status(400).json({
        message: `term_months must be between ${product.min_term_months} and ${product.max_term_months} for ${product.name}.`,
      });
    }

    // The vehicle. Required for every lease — there is no lease without one.
    const vehicle = normalizeVehicleInput(req.body.vehicle);
    const vehicleErrors = validateLeaseVehicle(vehicle, { financedAmount: financed_amount });
    if (vehicleErrors.length) {
      return res.status(400).json({ message: vehicleErrors[0], errors: vehicleErrors });
    }

    // The down payment is DERIVED: price − financed amount. It is not a
    // field, so the three numbers cannot disagree.
    const down = resolveDownPayment({
      vehiclePrice: vehicle.invoicePrice,
      condition: vehicle.conditionType,
      downPaymentAmount: Number((vehicle.invoicePrice - financed_amount).toFixed(2)),
    });
    if (!down) {
      return res.status(400).json({
        message: "The down payment implied by the vehicle price could not be resolved.",
      });
    }
    if (!down.meetsMinimum) {
      return res.status(400).json({
        message:
          `A ${vehicle.conditionType.replace("_", "-")} vehicle needs a down payment of at least ` +
          `${down.minimumPercent}%. You are putting down ${down.percent}% — reduce the amount to ` +
          `finance, or choose a less expensive vehicle.`,
      });
    }

    // Stop a lessee stacking undecided applications before spending an ML
    // call and a persisted row.
    const undecided = await leaseAppModel.countUndecidedLeaseApplications(lesseeId);
    if (undecided >= MAX_PENDING_LEASE_APPLICATIONS) {
      return res.status(409).json({
        message: `You already have ${undecided} lease applications awaiting a decision. Wait for those to be reviewed before applying again.`,
      });
    }

    // Declared model inputs, falling back to the profile — same resolution
    // order the loan path uses, so the same customer is described the same
    // way to the model whichever product they apply for.
    const declared = {};
    for (const field of DECLARABLE_FIELDS) {
      if (isProvided(req.body[field])) declared[field] = req.body[field];
    }
    for (const field of PROFILE_BACKED_FIELDS) {
      if (!isProvided(declared[field]) && isProvided(profile[field])) {
        declared[field] = profile[field];
      }
    }

    // Behavioural features from this customer's own record with us, read
    // BEFORE the intake transaction so the application being scored cannot
    // contaminate its own history.
    const creditHistory = await loanModel.findBorrowerCreditHistory(lesseeId);
    const { fields: behaviouralFields, meta: behaviouralMeta } =
      deriveBehaviouralFeatures(creditHistory);

    // --- SHARED SERVICE: the risk model ------------------------------------
    // Fed the product's BASE rate, exactly as the loan path does: a
    // risk-based price is an OUTPUT of the assessment, never an input to it.
    const baseRate = Number(product.interest_rate);
    const modelFields = mapProfileToModelFields(
      profile,
      {
        requested_amount: financed_amount,
        tenure_months: term_months,
        interest_rate: baseRate,
      },
      declared,
      behaviouralFields
    );
    const risk = await predictRisk(modelFields);

    const pricing = priceInterestRate({
      baseRate,
      minRate: product.min_interest_rate,
      maxRate: product.max_interest_rate,
      riskLabel: risk.risk_label,
    });

    // The rental the lessee would actually pay, quoted at the priced rate.
    const quote = buildLeaseQuote({
      vehiclePrice: vehicle.invoicePrice,
      condition: vehicle.conditionType,
      annualRatePct: pricing.rate,
      tenureMonths: term_months,
      rateType: product.rate_type,
      downPaymentAmount: down.amount,
    });

    // --- Lease-specific: loan to value -------------------------------------
    // No valuation exists at intake — one is requested afterwards for a used
    // or reconditioned vehicle. assessLtv therefore returns undecidable for
    // those, which the LEASE_LTV rule turns into a referral rather than
    // guessing. A brand-new vehicle is decidable immediately, because its
    // invoice IS its value.
    const ltv = assessLtv({
      condition: vehicle.conditionType,
      invoicePrice: vehicle.invoicePrice,
      valuationAmount: undefined,
      financedAmount: financed_amount,
    });

    const monthlyIncome = Number(profile.monthly_income) || 0;
    const monthlyExpense = Number(profile.monthly_expense) || 0;

    // --- SHARED SERVICE: the credit policy engine --------------------------
    const policy = evaluateCreditPolicy({
      applicant: {
        age: ageFromDob(profile.date_of_birth),
        monthlyIncome,
        monthlyExpense,
        employmentType: profile.employment_type,
        additionalIncome: declared.additional_income,
        yearsEmployed: declared.years_employed,
        existingLoans: declared.existing_loans,
        previousDefaults: declared.previous_defaults,
        cribScore: declared.crib_score,
        guarantorDefaults: declared.guarantor_defaults,
      },
      loan: {
        amount: Number(financed_amount),
        tenureMonths: Number(term_months),
        emi: quote ? quote.rental : null,
      },
      lease: {
        ltv,
        downPaymentPercent: down.percent,
        minimumDownPaymentPercent: down.minimumPercent,
      },
    });

    const result = await leaseAppModel.runLeaseApplicationTransaction({
      lesseeId,
      productId: product.id,
      financedAmount: financed_amount,
      termMonths: term_months,
      vehicle,
      declared,
      pricedInterestRate: pricing.rate,
      risk: {
        risk_label: risk.risk_label,
        risk_category: risk.risk_category,
        probLow: risk.probabilities?.["Low Risk"],
        probMedium: risk.probabilities?.["Medium Risk"],
        probHigh: risk.probabilities?.["High Risk"],
        model_version: risk.model_version,
        behaviouralSnapshot: behaviouralMeta,
      },
      policy,
      ltv,
      downPaymentPercent: down.percent,
    });

    // Confirm to the lessee, and put the application in front of the desk.
    // Loaded back rather than reusing the request body so the notice quotes
    // what was actually stored — including the status the policy engine
    // decided on, which is not always the one that was asked for.
    leaseAppModel
      .findLeaseApplicationById(result.applicationId)
      .then((created) => (created ? leaseNotifier.applicationSubmitted(created) : null))
      .catch(() => {});

    return res.status(201).json({
      application_id: result.applicationId,
      status: result.status,
      risk: {
        label: risk.risk_label,
        category: risk.risk_category,
        probabilities: risk.probabilities,
      },
      policy: {
        outcome: policy.outcome,
        reason_codes: policy.reason_codes,
        rules: policy.rules,
      },
      quote,
      down_payment: {
        amount: down.amount,
        percent: down.percent,
        minimum_percent: down.minimumPercent,
      },
      valuation_required: requiresValuation(vehicle.conditionType),
      interest_rate: pricing.rate,
    });
  } catch (err) {
    console.error("LEASE APPLY ERROR:", err);
    // A model-service failure is an upstream problem, not the applicant's.
    // Reported the same way the loan path reports it (loan.controller.js
    // assess) — a lessee and a borrower hitting the same dead dependency
    // must not be told two different stories, and "Failed to submit your
    // application" invites someone to blame their own form.
    const isModelError = /risk model/i.test(err.message || "");
    return res.status(isModelError ? 502 : 500).json({
      message: isModelError
        ? "The risk assessment service is unavailable. Please try again shortly."
        : "Failed to submit the lease application.",
      error: err.message,
    });
  }
};

/** GET /api/leases/products */
exports.getProducts = async (req, res) => {
  try {
    const products = await leaseAppModel.findAllLeaseProducts({ lang: req.query.lang });
    return res.status(200).json({ products });
  } catch (err) {
    console.error("GET LEASE PRODUCTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch lease products." });
  }
};

/** GET /api/leases/dealers — the approved-dealer picker for the wizard. */
exports.getDealers = async (_req, res) => {
  try {
    const suppliers = await leaseModel.listSuppliers({ activeOnly: true });
    // Narrow projection: a lessee has no business seeing a dealer's bank
    // details or how many vehicles they have supplied.
    return res.status(200).json({
      dealers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        contact_person: s.contact_person,
        phone: s.phone,
        address: s.address,
      })),
    });
  } catch (err) {
    console.error("GET LEASE DEALERS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch approved dealers." });
  }
};

/** GET /api/leases/my-applications */
exports.getMyApplications = async (req, res) => {
  try {
    const applications = await leaseAppModel.findLeaseApplicationsByLessee(req.user.user_id);
    return res.status(200).json({ applications });
  } catch (err) {
    console.error("GET MY LEASE APPLICATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch your lease applications." });
  }
};

/** GET /api/leases/:id */
exports.getApplicationById = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) {
      return res.status(404).json({ message: "Lease application not found." });
    }
    // Owner, staff or admin. Staff are included deliberately: they process
    // these, and a queue they cannot open is not a queue.
    const isOwner = application.lessee_id === req.user.user_id;
    const isStaffOrAdmin = ["admin", "staff"].includes(req.user.role);
    if (!isOwner && !isStaffOrAdmin) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const [assessment, events] = await Promise.all([
      leaseAppModel.findLeaseAssessment(application.id),
      leaseAppModel.findLeaseApplicationEvents(application.id),
    ]);

    return res.status(200).json({
      ...application,
      risk: assessment.risk,
      policy: assessment.policy,
      events,
    });
  } catch (err) {
    console.error("GET LEASE APPLICATION ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the lease application." });
  }
};

/* ------------------------------------------------------------------ *
 * Documents (L2.4)
 *
 * Storage reuses the loan documents' multer config and directory — a PDF is
 * a PDF, and the write path, size cap and MIME filtering are not
 * lease-specific. Only the METADATA table is parallel, because that is what
 * is keyed to an application.
 * ------------------------------------------------------------------ */

/**
 * Multer has already written the file to disk by the time a handler runs, so
 * every rejection path has to delete it again rather than leave an orphan.
 */
function discardUploadedFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, (err) => {
    if (err) console.error("LEASE DOCUMENT CLEANUP ERROR:", err.message);
  });
}

/** Owner, staff or admin may READ an application's documents. */
async function loadForDocumentAccess(applicationId, user) {
  const application = await leaseAppModel.findLeaseApplicationById(applicationId);
  if (!application) return { error: { status: 404, message: "Lease application not found." } };
  const isOwner = application.lessee_id === user.user_id;
  const isStaffOrAdmin = ["admin", "staff"].includes(user.role);
  if (!isOwner && !isStaffOrAdmin) {
    return { error: { status: 403, message: "Permission denied" } };
  }
  return { application };
}

/** POST /api/leases/:id/documents */
exports.uploadDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    discardUploadedFile(req.file);
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  if (!req.file) return res.status(400).json({ message: "A file is required." });

  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) {
      discardUploadedFile(req.file);
      return res.status(404).json({ message: "Lease application not found." });
    }
    // Upload is owner-only even though reading is open to staff: staff
    // REVIEW evidence, they do not supply it.
    if (application.lessee_id !== req.user.user_id) {
      discardUploadedFile(req.file);
      return res.status(403).json({ message: "Permission denied" });
    }

    const doc = await leaseAppModel.createLeaseDocument({
      applicationId: application.id,
      documentType: req.body.document_type,
      uploadedBy: req.user.user_id,
      originalName: req.file.originalname,
      storagePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    return res.status(201).json(doc);
  } catch (err) {
    discardUploadedFile(req.file);
    console.error("UPLOAD LEASE DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to upload the document." });
  }
};

/** GET /api/leases/:id/documents */
exports.listDocuments = async (req, res) => {
  try {
    const { application, error } = await loadForDocumentAccess(req.params.id, req.user);
    if (error) return res.status(error.status).json({ message: error.message });
    const documents = await leaseAppModel.findLeaseDocuments(application.id);
    return res.status(200).json({ documents });
  } catch (err) {
    console.error("LIST LEASE DOCUMENTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch documents." });
  }
};

/** GET /api/leases/:id/documents/:docId */
exports.downloadDocument = async (req, res) => {
  try {
    const { application, error } = await loadForDocumentAccess(req.params.id, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const doc = await leaseAppModel.findLeaseDocumentById(Number(req.params.docId));
    // The document id must belong to the application named in the path,
    // otherwise any authenticated lessee could read someone else's document
    // by pairing their own application id with a foreign document id.
    if (!doc || doc.application_id !== application.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    // Defence in depth: refuse to serve anything that resolves outside the
    // document directory, whatever ended up in the column.
    const resolved = path.resolve(doc.storage_path);
    if (!resolved.startsWith(path.resolve(LOAN_DOCUMENT_DIR) + path.sep)) {
      console.error("DOWNLOAD LEASE DOCUMENT ERROR: path escapes document dir:", resolved);
      return res.status(404).json({ message: "Document not found." });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ message: "The stored file is no longer available." });
    }

    res.setHeader("Content-Type", doc.mime_type);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${sanitizeDownloadFilename(doc.original_name)}"`
    );
    return fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error("DOWNLOAD LEASE DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the document." });
  }
};

/** DELETE /api/leases/:id/documents/:docId — owner, and only while pending. */
exports.deleteDocument = async (req, res) => {
  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });
    if (application.lessee_id !== req.user.user_id) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const doc = await leaseAppModel.findLeaseDocumentById(Number(req.params.docId));
    if (!doc || doc.application_id !== application.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    const deleted = await leaseAppModel.deleteLeaseDocumentIfPending(doc.id);
    if (!deleted) {
      return res.status(409).json({
        message:
          "This document has already been reviewed and can no longer be removed. Upload a replacement instead.",
      });
    }
    // Only unlink once the row is gone: a file deleted while its record
    // survives is a broken download, which is worse than an orphan file.
    discardUploadedFile({ path: doc.storage_path });
    return res.status(200).json({ message: "Document removed." });
  } catch (err) {
    console.error("DELETE LEASE DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to remove the document." });
  }
};

/**
 * PATCH /api/leases/:id/documents/:docId/verify — staff sign off, or reject.
 *
 * Advisory only, exactly as the loan equivalent is: verifying a payslip does
 * not move the application's status, and rejecting one does not decline it.
 * A credit verdict is a point-in-time snapshot taken by the status machine;
 * letting a document review silently re-open it would make the audit trail
 * lie about who decided what.
 */
exports.verifyDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  try {
    const application = await leaseAppModel.findLeaseApplicationById(req.params.id);
    if (!application) return res.status(404).json({ message: "Lease application not found." });

    // The document must belong to the application named in the path.
    // Without this an officer could decide ANY document row by guessing its
    // id — the same hole downloadDocument closes.
    const doc = await leaseAppModel.findLeaseDocumentById(Number(req.params.docId));
    if (!doc || doc.application_id !== application.id) {
      return res.status(404).json({ message: "Document not found on this lease application." });
    }

    const updated = await leaseAppModel.verifyLeaseDocument(doc.id, {
      verificationStatus: req.body.verification_status,
      verifiedBy: req.user.user_id,
      verificationNotes: req.body.verification_notes,
    });
    if (!updated) {
      return res.status(409).json({
        message: "This document has already been verified or rejected and cannot be changed again.",
      });
    }

    return res.status(200).json({
      id: updated.id,
      verification_status: updated.verification_status,
      verification_notes: updated.verification_notes,
      verified_at: updated.verified_at,
    });
  } catch (err) {
    console.error("VERIFY LEASE DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to update the document." });
  }
};

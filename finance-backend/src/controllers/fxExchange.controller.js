"use strict";

/**
 * FX exchange-request controller (Phase 10, CURRENCY_FEATURE.md §12) —
 * routes -> controller -> model, the same shape as loan.controller.js,
 * which this feature deliberately mirrors end to end (submit -> review ->
 * decision -> notify).
 *
 * Domain model: a retail bank does not let customers execute instant FX
 * trades. A customer requests a quote (POST /quote), redeems it into a
 * submitted request (POST /requests), staff review it (approve / reject /
 * counter-quote), and settlement happens physically at a branch (POST
 * .../settle). No payment gateway, no balance ledger, no money moves inside
 * this system — see CURRENCY_FEATURE.md §12 for the full writeup and the
 * state-machine diagram this controller implements.
 *
 * Forecast/trend/volatility/anomaly output (currencyClient.service.js) is
 * NEVER consulted here — quoting only reads the live rate board
 * (currency_rates + fx_rate_board_config via fxQuote.service.js). Per the
 * brief: model output is staff decision support elsewhere in the app, never
 * something that gates or auto-decides an exchange request.
 */

const fs = require("fs");
const path = require("path");

const { validationResult } = require("express-validator");

const { FX_DOCUMENT_DIR } = require("../config/multer");
const fxExchangeModel = require("../models/fxExchangeModel");
const currencyModel = require("../models/currencyModel");
const notificationModel = require("../models/notificationModel");
const fxQuote = require("../services/fxQuote.service");
const fxExpirySweep = require("../services/fxExpirySweep.service");
const fxVar = require("../services/fxVar.service");

// A staff/admin decision can arrive alongside 2 decimal places of currency
// math; round consistently rather than let floating point noise leak into
// stored LKR amounts.
function round2(n) {
  return Math.round(n * 100) / 100;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Whether an exchange of `lkrAmount` must be evidenced with supporting
 * documents, given an effective fx_limits row. A NULL threshold means the
 * currency carries no documentation requirement at all — which is why this
 * is not written as a bare `>=` against a possibly-null column, where
 * `x >= null` would quietly be false and silently disable the control.
 * The comparison is inclusive: a threshold of 1,000,000 means an exchange
 * OF exactly 1,000,000 needs documents.
 * @param {number} lkrAmount
 * @param {object} limits an fx_limits row (see getEffectiveLimits)
 * @returns {boolean}
 */
function requiresDocumentsFor(lkrAmount, limits) {
  if (limits?.document_threshold_lkr == null) return false;
  return Number(lkrAmount) >= Number(limits.document_threshold_lkr);
}

/** Coerce mysql2's string-typed DECIMAL columns to numbers for the API response. */
function serializeRequest(row) {
  if (!row) return null;
  return {
    reference_no: row.reference_no,
    user_id: row.user_id,
    direction: row.direction,
    currency_code: row.currency_code,
    foreign_amount: Number(row.foreign_amount),
    quoted_rate: Number(row.quoted_rate),
    quoted_lkr_amount: Number(row.quoted_lkr_amount),
    spread_bps_applied: row.spread_bps_applied,
    rate_source: row.rate_source,
    quote_locked_at: row.quote_locked_at,
    quote_expires_at: row.quote_expires_at,
    purpose_code: row.purpose_code,
    // Snapshot taken at submission, not re-derived from today's threshold —
    // see migration 014's header for why.
    requires_documents: Boolean(row.requires_documents),
    document_count: Number(row.document_count ?? 0),
    branch: row.branch,
    settlement_date: row.settlement_date,
    status: row.status,
    reviewed_by: row.reviewed_by,
    review_note: row.review_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.first_name !== undefined
      ? {
          applicant: {
            user_id: row.user_id,
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
          },
        }
      : {}),
  };
}

/** Throttled lazy-expiry trigger — every list/detail read opportunistically
 * sweeps stale pending_review requests, but never more than once a minute,
 * so a burst of reads doesn't turn into a burst of sweep queries. The real
 * enforcement is the scheduled background sweep (fxExpirySweep.service.js);
 * this just makes sure a read right after the SLA passes doesn't show a
 * request as still "pending_review" for up to the full sweep interval.
 */
const LAZY_SWEEP_MIN_GAP_MS = 60 * 1000;
let lastLazySweepAt = 0;
async function lazySweep() {
  if (Date.now() - lastLazySweepAt < LAZY_SWEEP_MIN_GAP_MS) return;
  lastLazySweepAt = Date.now();
  try {
    await fxExpirySweep.sweepExpiredRequests();
  } catch (err) {
    console.error("FX LAZY EXPIRY SWEEP ERROR:", err.message);
  }
}

function notifyStatusChange(userId, title, message) {
  return notificationModel.create({ userId, title, message }).catch((err) => {
    console.error("FX NOTIFICATION ERROR:", err.message);
  });
}

// POST /api/currency/exchange/quote (customer) — indicative quote, locked
// for a short TTL. Nothing is persisted; the response's quote_id is a
// signed token redeemed by POST /requests.
exports.getQuote = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const direction = req.body.direction;
  const currencyCode = req.body.currency_code.toUpperCase();
  const foreignAmount = req.body.foreign_amount;
  const lkrAmount = req.body.lkr_amount;

  try {
    const quote = await fxQuote.buildQuote({
      userId: req.user.user_id,
      direction,
      currencyCode,
      foreignAmount,
      lkrAmount,
    });

    // Surface the same limits POST /requests enforces server-side, so the
    // customer sees their headroom before locking a quote, choosing a
    // branch, and picking a settlement date — not after. This is a display
    // convenience only; submitRequest re-checks both limits itself and
    // remains the sole enforcement point (a second request submitted in
    // between could still push the daily total over, and must still be
    // rejected there).
    const [limits, todaysTotal] = await Promise.all([
      fxExchangeModel.getEffectiveLimits(currencyCode),
      fxExchangeModel.sumTodaysCommittedLkr(req.user.user_id),
    ]);
    const maxPerTransactionLkr = Number(limits.max_per_transaction_lkr);
    const maxPerCustomerPerDayLkr = Number(limits.max_per_customer_per_day_lkr);
    const remainingTodayLkr = round2(Math.max(0, maxPerCustomerPerDayLkr - todaysTotal));
    const documentThresholdLkr =
      limits.document_threshold_lkr == null ? null : Number(limits.document_threshold_lkr);

    return res.status(200).json({
      ...quote,
      max_per_transaction_lkr: maxPerTransactionLkr,
      max_per_customer_per_day_lkr: maxPerCustomerPerDayLkr,
      used_today_lkr: round2(todaysTotal),
      remaining_today_lkr: remainingTodayLkr,
      // Advance warning only. The binding decision is made (and snapshotted)
      // at submission by requiresDocumentsFor, against the threshold in
      // force at that moment — this quote could sit unredeemed while an
      // admin changes it.
      document_threshold_lkr: documentThresholdLkr,
      will_require_documents: requiresDocumentsFor(quote.quoted_lkr_amount, limits),
    });
  } catch (err) {
    if (err instanceof fxQuote.QuoteError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("FX GET QUOTE ERROR:", err);
    return res.status(500).json({ message: "Failed to build a quote." });
  }
};

// POST /api/currency/exchange/requests (customer) — redeem a still-valid
// quote into a submitted request. Idempotent: resubmitting the same
// quote_id (a double-click) returns the already-created request instead of
// erroring or creating a duplicate.
exports.submitRequest = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const userId = req.user.user_id;
  const { quote_id, purpose_code, branch, settlement_date } = req.body;

  let decoded;
  try {
    decoded = fxQuote.verifyQuote(quote_id, userId);
  } catch (err) {
    if (err instanceof fxQuote.QuoteError) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("FX SUBMIT REQUEST VERIFY ERROR:", err);
    return res.status(500).json({ message: "Failed to validate the quote." });
  }

  if (settlement_date < todayDateString()) {
    return res.status(400).json({ message: "settlement_date cannot be in the past." });
  }

  try {
    // Re-check tradability at submission time — an admin could have
    // disabled the currency in the window between quote and submit.
    const configRows = await currencyModel.listBoardConfig();
    const config = configRows.find((c) => c.currency_code === decoded.currency_code);
    if (!config || !config.is_tradable) {
      return res
        .status(400)
        .json({ message: `${decoded.currency_code} is not currently tradable against LKR.` });
    }

    const limits = await fxExchangeModel.getEffectiveLimits(decoded.currency_code);
    if (decoded.lkr_amount > Number(limits.max_per_transaction_lkr)) {
      return res.status(400).json({
        message: `This exchange (LKR ${decoded.lkr_amount}) exceeds the maximum per-transaction limit of LKR ${limits.max_per_transaction_lkr}.`,
      });
    }
    const todaysTotal = await fxExchangeModel.sumTodaysCommittedLkr(userId);
    if (todaysTotal + decoded.lkr_amount > Number(limits.max_per_customer_per_day_lkr)) {
      return res.status(400).json({
        message: `This exchange would put you over today's aggregate limit of LKR ${limits.max_per_customer_per_day_lkr} (already at LKR ${todaysTotal}).`,
      });
    }

    let row;
    let alreadySubmitted = false;
    try {
      row = await fxExchangeModel.createRequest({
        userId,
        direction: decoded.direction,
        currencyCode: decoded.currency_code,
        foreignAmount: decoded.foreign_amount,
        quotedRate: decoded.rate,
        quotedLkrAmount: decoded.lkr_amount,
        spreadBpsApplied: decoded.spread_bps_applied,
        rateSource: decoded.rate_source,
        // Both must be JS Date objects, not raw ISO strings — mysql2
        // formats a Date into a TIMESTAMP-safe value automatically, but
        // passes a string straight through, which MySQL strict mode
        // rejects for the 'T'/'Z' ISO shape (found via a real 500 while
        // manually verifying this endpoint).
        quoteLockedAt: new Date(decoded.locked_at),
        quoteExpiresAt: new Date(decoded.exp * 1000),
        quoteJti: decoded.jti,
        purposeCode: purpose_code,
        // Evaluated against the threshold in force NOW, not at quote time,
        // and stored on the row — see migration 014's header.
        requiresDocuments: requiresDocumentsFor(decoded.lkr_amount, limits),
        branch,
        settlementDate: settlement_date,
      });
    } catch (err) {
      const isDupQuote =
        err.code === "ER_DUP_ENTRY" && String(err.sqlMessage || "").includes("quote_jti");
      if (!isDupQuote) throw err;
      row = await fxExchangeModel.findByQuoteJti(decoded.jti);
      alreadySubmitted = true;
    }

    if (!alreadySubmitted) {
      notifyStatusChange(
        userId,
        "FX Exchange Request Submitted",
        `Your request ${row.reference_no} to ${decoded.direction} ${decoded.foreign_amount} ${decoded.currency_code} has been submitted for review.` +
          (row.requires_documents
            ? ` Because this exchange is LKR ${Number(limits.document_threshold_lkr).toLocaleString("en-LK")} or more, supporting documents are required before staff can approve it — please upload them from the request's detail page.`
            : "")
      );
    }

    return res
      .status(alreadySubmitted ? 200 : 201)
      .json({ ...serializeRequest(row), already_submitted: alreadySubmitted });
  } catch (err) {
    console.error("FX SUBMIT REQUEST ERROR:", err);
    return res.status(500).json({ message: "Failed to submit the exchange request." });
  }
};

// GET /api/currency/exchange/requests (customer) — own requests, filterable.
exports.listMyRequests = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  await lazySweep();

  const { status, currency, limit, offset } = req.query;
  try {
    const rows = await fxExchangeModel.findMineByUser(req.user.user_id, {
      status,
      currency: currency ? currency.toUpperCase() : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return res.status(200).json({ requests: rows.map(serializeRequest) });
  } catch (err) {
    console.error("FX LIST MY REQUESTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch exchange requests." });
  }
};

// GET /api/currency/exchange/requests/:ref — customer (own only), staff/admin (any).
exports.getRequestByRef = async (req, res) => {
  await lazySweep();
  const ref = req.params.ref;
  try {
    const row = await fxExchangeModel.findByReferenceNo(ref);
    if (!row) {
      return res.status(404).json({ message: "Exchange request not found." });
    }
    const isOwner = row.user_id === req.user.user_id;
    const isStaffOrAdmin = req.user.role === "admin" || req.user.role === "staff";
    if (!isOwner && !isStaffOrAdmin) {
      return res.status(403).json({ message: "Permission denied" });
    }
    const events = await fxExchangeModel.findEventsForRequest(row.id);
    return res.status(200).json({ ...serializeRequest(row), events });
  } catch (err) {
    console.error("FX GET REQUEST BY REF ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the exchange request." });
  }
};

// POST /api/currency/exchange/requests/:ref/cancel (customer, own, pending_review only).
exports.cancelRequest = async (req, res) => {
  const ref = req.params.ref;
  try {
    const row = await fxExchangeModel.findByReferenceNo(ref);
    if (!row) {
      return res.status(404).json({ message: "Exchange request not found." });
    }
    if (row.user_id !== req.user.user_id) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const result = await fxExchangeModel.transitionStatus({
      id: row.id,
      fromStatuses: ["pending_review"],
      toStatus: "cancelled",
      actorUserId: req.user.user_id,
      note: "Cancelled by customer.",
    });
    if (result.conflict) {
      return res.status(409).json({
        message: `Cannot cancel; this request is already ${result.status}.`,
      });
    }

    notifyStatusChange(
      row.user_id,
      "FX Exchange Request Cancelled",
      `Your request ${row.reference_no} has been cancelled.`
    );

    const updated = await fxExchangeModel.findById(row.id);
    return res.status(200).json(serializeRequest(updated));
  } catch (err) {
    console.error("FX CANCEL REQUEST ERROR:", err);
    return res.status(500).json({ message: "Failed to cancel the exchange request." });
  }
};

// GET /api/currency/exchange/admin/queue (staff, admin).
exports.listQueue = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  await lazySweep();

  const { status, currency, limit, offset } = req.query;
  try {
    const rows = await fxExchangeModel.findQueue({
      status,
      currency: currency ? currency.toUpperCase() : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return res.status(200).json({ requests: rows.map(serializeRequest) });
  } catch (err) {
    console.error("FX LIST QUEUE ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the review queue." });
  }
};

// POST /api/currency/exchange/requests/:ref/review (staff, admin) —
// approve / reject / counter-quote. See CURRENCY_FEATURE.md §12 for why
// 'approved' is a reserved-but-unused status here: this single-step review
// endpoint moves an approval straight to 'ready_for_settlement', and a
// counter-quote revises terms while deliberately staying in
// 'pending_review' rather than requiring a separate customer-acceptance
// endpoint this session doesn't build.
exports.reviewRequest = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const ref = req.params.ref;
  const { action, note, countered_rate } = req.body;

  if (action === "reject" && !note) {
    return res.status(400).json({ message: "A reason (note) is required to reject a request." });
  }
  if (action === "counter" && !(countered_rate > 0)) {
    return res
      .status(400)
      .json({ message: "countered_rate must be a positive number for a counter-quote." });
  }

  try {
    const row = await fxExchangeModel.findByReferenceNo(ref);
    if (!row) {
      return res.status(404).json({ message: "Exchange request not found." });
    }

    let toStatus;
    let extraFields = { reviewed_by: req.user.user_id, review_note: note || null };
    if (action === "approve") {
      // A request that was flagged as needing evidence cannot be approved
      // until at least one document exists. Rejecting and counter-quoting
      // stay available — staff must still be able to turn away a request
      // whose customer never uploaded anything. 409 (not 400) for
      // consistency with the state machine's other "legal endpoint, wrong
      // state" refusals.
      if (row.requires_documents && Number(row.document_count ?? 0) === 0) {
        return res.status(409).json({
          message:
            "This request requires supporting documents before it can be approved. The customer has not uploaded any yet.",
        });
      }
      toStatus = "ready_for_settlement";
    } else if (action === "reject") {
      toStatus = "rejected";
    } else if (action === "counter") {
      toStatus = "pending_review";
      extraFields.quoted_rate = countered_rate;
      extraFields.quoted_lkr_amount = round2(Number(row.foreign_amount) * countered_rate);
    } else {
      return res
        .status(400)
        .json({ message: "action must be one of: approve, reject, counter." });
    }

    const result = await fxExchangeModel.transitionStatus({
      id: row.id,
      fromStatuses: ["pending_review"],
      toStatus,
      actorUserId: req.user.user_id,
      note: note || (action === "approve" ? "Approved by staff." : undefined),
      extraFields,
    });
    if (result.conflict) {
      return res.status(409).json({
        message: `Cannot review; this request is already ${result.status}, not pending_review.`,
      });
    }

    const updated = await fxExchangeModel.findById(row.id);

    if (action === "approve") {
      notifyStatusChange(
        row.user_id,
        "FX Exchange Request Approved",
        `Your request ${row.reference_no} has been approved. Please visit ${updated.branch} on or after ${updated.settlement_date} to complete the exchange.`
      );
    } else if (action === "reject") {
      notifyStatusChange(
        row.user_id,
        "FX Exchange Request Rejected",
        `Your request ${row.reference_no} has been rejected. Reason: ${note}`
      );
    } else {
      notifyStatusChange(
        row.user_id,
        "FX Exchange Counter-Offer",
        `Our staff has proposed a revised rate for request ${row.reference_no}: ${countered_rate} (was ${Number(row.quoted_rate)}).${note ? ` Note: ${note}` : ""} You can cancel and re-submit if you'd prefer a different rate.`
      );
    }

    return res.status(200).json(serializeRequest(updated));
  } catch (err) {
    console.error("FX REVIEW REQUEST ERROR:", err);
    return res.status(500).json({ message: "Failed to review the exchange request." });
  }
};

// POST /api/currency/exchange/requests/:ref/settle (staff, admin) — the
// terminal step: staff at the branch mark the physical exchange as done.
exports.settleRequest = async (req, res) => {
  const ref = req.params.ref;
  const { note } = req.body;
  try {
    const row = await fxExchangeModel.findByReferenceNo(ref);
    if (!row) {
      return res.status(404).json({ message: "Exchange request not found." });
    }

    const result = await fxExchangeModel.transitionStatus({
      id: row.id,
      fromStatuses: ["ready_for_settlement"],
      toStatus: "settled",
      actorUserId: req.user.user_id,
      note: note || "Settled at branch.",
    });
    if (result.conflict) {
      return res.status(409).json({
        message: `Cannot settle; this request is ${result.status}, must be ready_for_settlement.`,
      });
    }

    notifyStatusChange(
      row.user_id,
      "FX Exchange Settled",
      `Your request ${row.reference_no} has been settled. Thank you for banking with us.`
    );

    const updated = await fxExchangeModel.findById(row.id);
    return res.status(200).json(serializeRequest(updated));
  } catch (err) {
    console.error("FX SETTLE REQUEST ERROR:", err);
    return res.status(500).json({ message: "Failed to settle the exchange request." });
  }
};

// --- compliance documents ----------------------------------------------

/**
 * Shared access check for every document route: load the request by
 * reference and confirm the caller may see it. Mirrors getRequestByRef's
 * rule — the owning customer, or any staff/admin.
 * @returns {Promise<{row:object}|{error:{status:number,message:string}}>}
 */
async function loadRequestForDocumentAccess(ref, user) {
  const row = await fxExchangeModel.findByReferenceNo(ref);
  if (!row) {
    return { error: { status: 404, message: "Exchange request not found." } };
  }
  const isOwner = row.user_id === user.user_id;
  const isStaffOrAdmin = user.role === "admin" || user.role === "staff";
  if (!isOwner && !isStaffOrAdmin) {
    return { error: { status: 403, message: "Permission denied" } };
  }
  return { row };
}

/** Remove an uploaded file that we've decided not to keep, best-effort. */
function discardUploadedFile(file) {
  if (!file?.path) return;
  fs.unlink(file.path, (err) => {
    if (err) console.error("FX DOCUMENT CLEANUP ERROR:", err.message);
  });
}

// POST /api/currency/exchange/requests/:ref/documents (customer, own) —
// upload one supporting document. Multer has already written the file to
// secure-uploads/ by the time this runs, so every rejection path below has
// to delete it again rather than leave an orphan on disk.
exports.uploadDocument = async (req, res) => {
  const ref = req.params.ref;

  if (!req.file) {
    return res.status(400).json({ message: "A file is required." });
  }

  try {
    const row = await fxExchangeModel.findByReferenceNo(ref);
    if (!row) {
      discardUploadedFile(req.file);
      return res.status(404).json({ message: "Exchange request not found." });
    }
    // Upload is owner-only even though *reading* documents is open to
    // staff/admin: staff review evidence, they don't supply it.
    if (row.user_id !== req.user.user_id) {
      discardUploadedFile(req.file);
      return res.status(403).json({ message: "Permission denied" });
    }
    // Evidence is part of the review packet, so it can only be added while
    // the request is still awaiting review. 409 for consistency with the
    // state machine's other wrong-state refusals.
    if (row.status !== "pending_review") {
      discardUploadedFile(req.file);
      return res.status(409).json({
        message: `Documents can only be added while a request is pending review; this one is ${row.status}.`,
      });
    }

    const doc = await fxExchangeModel.createDocument({
      requestId: row.id,
      uploadedBy: req.user.user_id,
      originalName: req.file.originalname,
      storagePath: req.file.path,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });

    return res.status(201).json(doc);
  } catch (err) {
    discardUploadedFile(req.file);
    console.error("FX UPLOAD DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to upload the document." });
  }
};

// GET /api/currency/exchange/requests/:ref/documents — metadata only
// (customer: own; staff/admin: any).
exports.listDocuments = async (req, res) => {
  try {
    const { row, error } = await loadRequestForDocumentAccess(req.params.ref, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const documents = await fxExchangeModel.findDocumentsForRequest(row.id);
    return res.status(200).json({ documents });
  } catch (err) {
    console.error("FX LIST DOCUMENTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the documents." });
  }
};

// GET /api/currency/exchange/requests/:ref/documents/:id/download — stream
// the file back. This route exists because secure-uploads/ is deliberately
// NOT served statically (see migration 014's header): it is the only way to
// read a compliance document, and it checks ownership/role on every hit.
exports.downloadDocument = async (req, res) => {
  try {
    const { row, error } = await loadRequestForDocumentAccess(req.params.ref, req.user);
    if (error) return res.status(error.status).json({ message: error.message });

    const doc = await fxExchangeModel.findDocumentById(Number(req.params.id));
    // The id must belong to the request named in the path — otherwise any
    // authenticated customer could read another customer's document by
    // pairing their own reference with someone else's document id.
    if (!doc || doc.request_id !== row.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    // Defence in depth: refuse to serve anything that resolved outside the
    // document directory, whatever ended up in the column.
    const resolved = path.resolve(doc.storage_path);
    if (!resolved.startsWith(path.resolve(FX_DOCUMENT_DIR) + path.sep)) {
      console.error("FX DOWNLOAD DOCUMENT ERROR: path escapes document dir:", resolved);
      return res.status(404).json({ message: "Document not found." });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ message: "The stored file is no longer available." });
    }

    res.setHeader("Content-Type", doc.mime_type);
    // `inline` so staff can preview a PDF/image in the browser rather than
    // being forced to download it; the filename is quoted and stripped of
    // quotes/newlines so it can't break out of the header.
    const safeName = String(doc.original_name).replace(/["\r\n]/g, "_");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    return fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error("FX DOWNLOAD DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch the document." });
  }
};

// DELETE /api/currency/exchange/requests/:ref/documents/:id (customer, own,
// pending_review) — so a customer who uploaded the wrong file can replace
// it. Once staff have actioned the request its evidence is frozen.
exports.deleteDocument = async (req, res) => {
  try {
    const row = await fxExchangeModel.findByReferenceNo(req.params.ref);
    if (!row) {
      return res.status(404).json({ message: "Exchange request not found." });
    }
    if (row.user_id !== req.user.user_id) {
      return res.status(403).json({ message: "Permission denied" });
    }
    if (row.status !== "pending_review") {
      return res.status(409).json({
        message: `Documents can only be removed while a request is pending review; this one is ${row.status}.`,
      });
    }

    const doc = await fxExchangeModel.findDocumentById(Number(req.params.id));
    if (!doc || doc.request_id !== row.id) {
      return res.status(404).json({ message: "Document not found." });
    }

    await fxExchangeModel.deleteDocument(doc.id);
    // The row is the source of truth; a leftover file on disk is untidy but
    // harmless (nothing can reach it without a row), so this is best-effort
    // and must not turn a successful delete into a 500.
    fs.unlink(doc.storage_path, (err) => {
      if (err) console.error("FX DOCUMENT CLEANUP ERROR:", err.message);
    });

    return res.status(200).json({ message: "Document removed.", id: doc.id });
  } catch (err) {
    console.error("FX DELETE DOCUMENT ERROR:", err);
    return res.status(500).json({ message: "Failed to remove the document." });
  }
};

// GET /api/currency/exchange/admin/limits (admin).
exports.listLimits = async (req, res) => {
  try {
    const rows = await fxExchangeModel.listLimits();
    return res.status(200).json({ limits: rows });
  } catch (err) {
    console.error("FX LIST LIMITS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch FX limits." });
  }
};

// PATCH /api/currency/exchange/admin/limits (admin).
exports.updateLimits = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const currencyCode = (req.body.currency_code || "ALL").toUpperCase();
  try {
    const row = await fxExchangeModel.upsertLimit({
      currencyCode,
      maxPerTransactionLkr: req.body.max_per_transaction_lkr,
      maxPerCustomerPerDayLkr: req.body.max_per_customer_per_day_lkr,
      // Passed through untouched so `undefined` (absent — leave alone) stays
      // distinguishable from an explicit `null` (clear the requirement).
      documentThresholdLkr: req.body.document_threshold_lkr,
    });
    return res.status(200).json({ limit: row });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.error("FX UPDATE LIMITS ERROR:", err);
    return res.status(500).json({ message: "Failed to update FX limits." });
  }
};

// GET /api/currency/exchange/admin/spreads (admin) — same fx_rate_board_config
// GET /api/currency/board already reads; exposed here too since the exchange
// feature's admin console shouldn't have to know that table's history.
exports.listSpreads = async (req, res) => {
  try {
    const rows = await currencyModel.listBoardConfig();
    return res.status(200).json({ spreads: rows });
  } catch (err) {
    console.error("FX LIST SPREADS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch spread configuration." });
  }
};

// PATCH /api/currency/exchange/admin/spreads/:code (admin).
exports.updateSpread = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const code = req.params.code.toUpperCase();
  try {
    const row = await currencyModel.updateBoardConfig(code, {
      buySpreadBps: req.body.buy_spread_bps,
      sellSpreadBps: req.body.sell_spread_bps,
      isTradable: req.body.is_tradable,
    });
    if (!row) {
      return res.status(404).json({ message: `No spread configuration exists for ${code}.` });
    }
    return res.status(200).json({ spread: row });
  } catch (err) {
    console.error("FX UPDATE SPREAD ERROR:", err);
    return res.status(500).json({ message: "Failed to update spread configuration." });
  }
};

// GET /api/currency/exchange/admin/position (admin) — net FX exposure by
// currency and status. "Committed" statuses (ready_for_settlement, settled)
// are the bank's real obligation/position; pending_review/approved-in-flight
// aren't counted in net exposure since they aren't guaranteed to complete.
const COMMITTED_STATUSES = new Set(["ready_for_settlement", "settled"]);
exports.getPosition = async (req, res) => {
  try {
    const rows = await fxExchangeModel.getPositionBreakdown();
    const byCurrency = new Map();
    for (const r of rows) {
      if (!byCurrency.has(r.currency_code)) {
        byCurrency.set(r.currency_code, {
          currency_code: r.currency_code,
          breakdown: [],
          net_foreign_amount: 0,
          net_lkr_amount: 0,
        });
      }
      const entry = byCurrency.get(r.currency_code);
      entry.breakdown.push({
        direction: r.direction,
        status: r.status,
        count: r.count,
        total_foreign_amount: Number(r.total_foreign_amount),
        total_lkr_amount: Number(r.total_lkr_amount),
      });
      if (COMMITTED_STATUSES.has(r.status)) {
        // 'sell' (customer sells FX to the bank) increases the bank's FX
        // holdings; 'buy' (customer buys FX from the bank) decreases it.
        const sign = r.direction === "sell" ? 1 : -1;
        entry.net_foreign_amount += sign * Number(r.total_foreign_amount);
        entry.net_lkr_amount += sign * Number(r.total_lkr_amount);
      }
    }
    const positions = Array.from(byCurrency.values()).map((e) => ({
      ...e,
      net_foreign_amount: round2(e.net_foreign_amount),
      net_lkr_amount: round2(e.net_lkr_amount),
    }));

    return res.status(200).json({
      note: "net_* figures only count ready_for_settlement/settled requests (real commitments), not pending_review.",
      positions,
      // Historical-simulation VaR on exactly the net_lkr_amount figures above
      // (Phase 32, CURRENCY_FEATURE.md §33). Additive: `positions` is
      // unchanged, and `risk` is null when the scenario artifact is absent,
      // so this endpoint degrades to its previous behaviour rather than
      // failing. Computed from the same committed-only exposure, so the risk
      // figure can never describe a different book than the chart above it.
      risk: fxVar.computeVar(positions),
    });
  } catch (err) {
    console.error("FX GET POSITION ERROR:", err);
    return res.status(500).json({ message: "Failed to compute the FX position." });
  }
};

// --- admin reports (Phase 31) --------------------------------------------
//
// One row-fetch (fxExchangeModel.getReportRows), two views of the same data:
// exports.getReports (aggregated JSON for the dashboard) and
// exports.exportReportsCsv (the underlying rows as a download). Deliberately
// sharing computeSpreadRevenueLkr and the same query so the on-screen totals
// and the exported file can never drift apart.

const ALL_STATUSES = [
  "pending_review",
  "ready_for_settlement",
  "settled",
  "rejected",
  "cancelled",
  "expired",
];

function defaultReportRange(query) {
  const to = query.to || todayDateString();
  const from = query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * The bank's spread margin on one settled request, in LKR — derived from
 * the rate actually charged and the spread snapshot on the row, without
 * needing the live mid-rate the quote was built from (which isn't stored).
 * quoted_rate = mid * (1 ± bps/10000) depending on direction (see
 * crossRate.service.js's applySpread), so mid_lkr_amount is recovered by
 * inverting that, and the margin is the difference.
 * @param {object} row a getReportRows row
 * @returns {number}
 */
function computeSpreadRevenueLkr(row) {
  const bps = Number(row.spread_bps_applied);
  const lkr = Number(row.quoted_lkr_amount);
  if (!(bps > 0) || !(lkr > 0)) return 0;
  // direction 'buy': quoted at sell_rate = mid*(1+bps/10000) -> revenue = lkr*bps/(10000+bps)
  // direction 'sell': quoted at buy_rate = mid*(1-bps/10000)  -> revenue = lkr*bps/(10000-bps)
  return row.direction === "buy"
    ? round2((lkr * bps) / (10000 + bps))
    : round2((lkr * bps) / (10000 - bps));
}

function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/currency/exchange/admin/reports (admin) — status-rate,
// volume-by-currency, and spread-revenue aggregates over a submission-date
// range. Defaults to the trailing 30 days when from/to are omitted.
exports.getReports = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const { from, to } = defaultReportRange(req.query);
  const currencyCode = req.query.currency ? req.query.currency.toUpperCase() : undefined;

  try {
    const rows = await fxExchangeModel.getReportRows({ from, to, currencyCode });

    const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

    const totalRequests = rows.length;
    // 'cancelled' is a customer action, not a bank outcome, so it's excluded
    // from the denominator these rates are judged against — the same reason
    // `note` on getPosition excludes pending_review from net exposure.
    const decidable = totalRequests - byStatus.cancelled;
    const approvedCount = byStatus.ready_for_settlement + byStatus.settled;
    const rate = (n) => (decidable > 0 ? round2((n / decidable) * 100) : null);

    const volumeMap = new Map();
    const revenueMap = new Map();
    let totalRevenueLkr = 0;
    for (const r of rows) {
      if (r.status !== "settled") continue;

      const vKey = `${r.currency_code}|${r.direction}`;
      if (!volumeMap.has(vKey)) {
        volumeMap.set(vKey, {
          currency_code: r.currency_code,
          direction: r.direction,
          count: 0,
          total_foreign_amount: 0,
          total_lkr_amount: 0,
        });
      }
      const v = volumeMap.get(vKey);
      v.count += 1;
      v.total_foreign_amount += Number(r.foreign_amount);
      v.total_lkr_amount += Number(r.quoted_lkr_amount);

      const revenue = computeSpreadRevenueLkr(r);
      totalRevenueLkr += revenue;
      if (!revenueMap.has(r.currency_code)) {
        revenueMap.set(r.currency_code, { currency_code: r.currency_code, settled_count: 0, revenue_lkr: 0 });
      }
      const rev = revenueMap.get(r.currency_code);
      rev.settled_count += 1;
      rev.revenue_lkr += revenue;
    }

    return res.status(200).json({
      period: { from, to },
      currency_filter: currencyCode || null,
      status_summary: {
        total_requests: totalRequests,
        by_status: byStatus,
        // null (not 0) when there's nothing decidable in the range, so the
        // UI can distinguish "0% approval" from "no data for this period".
        approval_rate_pct: rate(approvedCount),
        rejection_rate_pct: rate(byStatus.rejected),
        expiry_rate_pct: rate(byStatus.expired),
        pending_rate_pct: rate(byStatus.pending_review),
      },
      volume_by_currency: Array.from(volumeMap.values()).map((v) => ({
        ...v,
        total_foreign_amount: round2(v.total_foreign_amount),
        total_lkr_amount: round2(v.total_lkr_amount),
      })),
      spread_revenue: {
        total_lkr: round2(totalRevenueLkr),
        by_currency: Array.from(revenueMap.values()).map((r) => ({ ...r, revenue_lkr: round2(r.revenue_lkr) })),
      },
    });
  } catch (err) {
    console.error("FX GET REPORTS ERROR:", err);
    return res.status(500).json({ message: "Failed to compute the FX report." });
  }
};

// GET /api/currency/exchange/admin/reports/export (admin) — the same
// date/currency-filtered rows exports.getReports aggregates, as a CSV
// download, optionally narrowed further by status. One row per exchange
// request; spread_revenue_lkr is populated only for settled rows, matching
// how the aggregate report only counts realized (settled) revenue.
exports.exportReportsCsv = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const { from, to } = defaultReportRange(req.query);
  const currencyCode = req.query.currency ? req.query.currency.toUpperCase() : undefined;
  const status = req.query.status;

  try {
    let rows = await fxExchangeModel.getReportRows({ from, to, currencyCode });
    if (status && status !== "all") {
      rows = rows.filter((r) => r.status === status);
    }

    const header = [
      "reference_no",
      "status",
      "direction",
      "currency_code",
      "foreign_amount",
      "quoted_rate",
      "quoted_lkr_amount",
      "spread_bps_applied",
      "spread_revenue_lkr",
      "purpose_code",
      "requires_documents",
      "branch",
      "settlement_date",
      "created_at",
      "updated_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.reference_no,
          r.status,
          r.direction,
          r.currency_code,
          Number(r.foreign_amount),
          Number(r.quoted_rate),
          Number(r.quoted_lkr_amount),
          r.spread_bps_applied,
          r.status === "settled" ? computeSpreadRevenueLkr(r) : "",
          r.purpose_code,
          r.requires_documents ? 1 : 0,
          r.branch,
          r.settlement_date,
          r.created_at?.toISOString?.() ?? r.created_at,
          r.updated_at?.toISOString?.() ?? r.updated_at,
        ]
          .map(csvField)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fx-exchange-report_${from}_to_${to}.csv"`
    );
    return res.status(200).send(lines.join("\r\n"));
  } catch (err) {
    console.error("FX EXPORT REPORTS CSV ERROR:", err);
    return res.status(500).json({ message: "Failed to export the FX report." });
  }
};

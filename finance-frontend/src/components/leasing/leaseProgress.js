/**
 * Where a lease has got to, as a sequence of steps.
 *
 * Pure — no React, no network, no clock, and (deliberately) no i18n either.
 * Takes the six objects every lease surface already loads and returns the
 * same answer for all three portals. That sameness is the point: a lessee
 * ringing up to ask "what's happening?" and the officer who answers must be
 * looking at one description of the workflow, not two that drift.
 *
 * TEXT IS RETURNED AS KEYS, NOT STRINGS. This module is shared by the
 * customer-facing lease pages (translated into Sinhala/Tamil) and the
 * staff review queue (English only, always — see LeaseNextAction.jsx and
 * LeaseProgressTracker.jsx, which resolve staff copy through a fixed-English
 * `t` regardless of the ambient UI language). Returning a translation key
 * plus its interpolation params, instead of a rendered sentence, lets both
 * audiences resolve the same derivation into their own language without this
 * file importing react-i18next — which would break its use from plain node
 * (see leaseTiles.js's docstring on the same constraint).
 *
 * Every *Key below is a fully-qualified path into the `leaseProgress`
 * namespace in src/i18n/locales/{en,si,ta}.json.
 *
 * WHY A DERIVATION RATHER THAN A COLUMN. `lease_applications.status` stops
 * at 'accepted' — everything after that lives in other tables (the down
 * payment ledger, the payout, the registration, the agreement). A status
 * column could be made to track all of it, but then it would be a second
 * source of truth that has to be kept in step with the records it
 * summarises. Deriving it means the bar cannot disagree with the data.
 *
 * The `hintKey` on each step is the reason this exists at all: the Sri
 * Lankan leasing sequence is not obvious, and people do not know what
 * happens next or who is holding the ball.
 */

/** Terminal states — the lease stopped here and goes no further. */
const HALTED_STATUSES = ["rejected", "withdrawn", "declined"];

const fmtLkr = (v) => `LKR ${Number(v).toLocaleString("en-LK")}`;

/**
 * The eight steps of a finance lease, in order.
 *
 * Fewer, broader steps than the underlying state machine has, deliberately:
 * a bar with fifteen ticks is a diagram, not a progress indicator. Where two
 * real stages are folded into one step, the detail key says which half is
 * outstanding.
 */
export const LEASE_STEPS = [
  { key: "applied", who: "us" },
  { key: "review", who: "us" },
  { key: "approved", who: "us" },
  { key: "quotation", who: "you" },
  { key: "down_payment", who: "you" },
  { key: "purchase", who: "us" },
  { key: "rentals", who: "you" },
  { key: "released", who: "you" },
].map((s) => ({
  ...s,
  labelKey: `leaseProgress.steps.${s.key}.label`,
  hintKey: `leaseProgress.steps.${s.key}.hint`,
}));

/**
 * How far along a lease is.
 *
 * @param {object} input
 * @param {object} input.application  the lease application row
 * @param {Array}  [input.quotations] every quotation, newest first or last
 * @param {object} [input.downPayment] the signing position
 * @param {object} [input.purchase]   payout + registration state
 * @param {object} [input.agreement]  { agreement, position } once live
 * @returns {{steps:Array, currentIndex:number, halted:boolean,
 *            haltedStatus:string|null, complete:boolean}}
 */
export function deriveLeaseProgress({
  application,
  quotations = [],
  downPayment = null,
  purchase = null,
  agreement = null,
} = {}) {
  const status = application?.status || "pending";
  const halted = HALTED_STATUSES.includes(status);

  const hasAcceptedQuotation = quotations.some((q) => q.status === "accepted");
  const hasLiveQuotation = quotations.some((q) => q.status === "pending");
  const downPaymentSettled = Boolean(downPayment?.settled) || Boolean(purchase?.downPaymentSettled);
  const dealerPaid = Boolean(purchase?.payout);
  const registered = purchase?.registrationStatus === "registered";
  const live = Boolean(agreement?.agreement);
  const fullyPaid = Boolean(agreement?.position?.fullyPaid);
  const released = Boolean(purchase?.registration?.release_letter_no);

  // Read from the FAR END backwards. Progress is evidenced by the furthest
  // thing that has actually happened, not by walking forward and stopping at
  // the first gap — a lease whose CR came back before the payout was keyed
  // in is further along than the payout row suggests, and the bar should say
  // so rather than under-report it.
  let reached;
  if (released || (live && agreement.agreement.status === "completed")) reached = 7;
  else if (live) reached = 6;
  else if (registered || dealerPaid) reached = 5;
  else if (downPaymentSettled) reached = 4;
  else if (hasAcceptedQuotation) reached = 4;
  else if (hasLiveQuotation || status === "quoted") reached = 3;
  else if (status === "approved") reached = 2;
  else if (status === "under_review" || status === "info_requested") reached = 1;
  else reached = 0;

  // An accepted quotation means step 4 (down payment) is the one IN HAND,
  // not one already finished — the bar marks the current step as active
  // rather than done, so `currentIndex` is where the work sits now.
  const complete = released && fullyPaid;

  const facts = {
    status,
    hasLiveQuotation,
    hasAcceptedQuotation,
    downPayment,
    downPaymentSettled,
    dealerPaid,
    registered,
    live,
    fullyPaid,
    released,
    agreement,
  };

  const steps = LEASE_STEPS.map((step, i) => {
    let state;
    if (i < reached) state = "done";
    else if (i === reached) state = complete ? "done" : halted ? "halted" : "current";
    else state = halted ? "halted" : "upcoming";
    return { ...step, state, detail: detailFor(step.key, facts) };
  });

  return {
    steps,
    currentIndex: reached,
    halted,
    haltedStatus: halted ? status : null,
    complete,
  };
}

/**
 * The one line under a step that says what is actually outstanding.
 *
 * Only worth showing where a single step folds in two real stages, or where
 * the honest answer is a number rather than a state.
 *
 * @returns {{key:string, params?:object}|null} `key` is relative to
 *          `leaseProgress.detail.*`; the render layer prefixes it.
 */
function detailFor(key, s) {
  switch (key) {
    case "review":
      return s.status === "info_requested" ? { key: "infoRequested" } : null;
    case "quotation":
      if (s.hasAcceptedQuotation) return { key: "quotationAccepted" };
      if (s.hasLiveQuotation) return { key: "quotationWaiting" };
      return null;
    case "down_payment":
      if (s.downPaymentSettled) return { key: "downPaymentSettled" };
      if (s.downPayment?.outstanding > 0) {
        return { key: "downPaymentOutstanding", params: { amount: fmtLkr(s.downPayment.outstanding) } };
      }
      return null;
    case "purchase":
      if (s.registered) return { key: "purchaseRegistered" };
      if (s.dealerPaid) return { key: "purchaseDealerPaid" };
      return null;
    case "rentals":
      if (s.live && s.agreement?.position) {
        const p = s.agreement.position;
        return { key: "rentalsPaid", params: { paid: p.rentalsPaid ?? 0, total: p.rentalsTotal ?? 0 } };
      }
      return null;
    case "released":
      return s.released ? { key: "released" } : null;
    default:
      return null;
  }
}

/** `{labelKey, hintKey, params}` — one shared shape for both audiences,
 * since most next-action copy differs only in wording, not in what's
 * interpolated into it. `params` applies to both label and hint; none of
 * the copy below needs them to differ. */
const copy = (labelKey, hintKey, params) => ({ labelKey, hintKey, params });

/**
 * THE one thing that needs doing next, and whose job it is.
 *
 * The progress tracker answers "where is this?". This answers "so what do I
 * do?" — and they are not the same question. A drawer with nine panels and a
 * page with eight sections both made the reader find the answer by scrolling
 * and inferring; this derives it once, so each surface can lead with it.
 *
 * ONE DERIVATION, TWO AUDIENCES. The underlying step is identical for staff
 * and for the lessee — what differs is the wording and whether it's their
 * move. Deriving it twice is how the officer's screen and the customer's
 * screen end up describing the same lease differently.
 *
 * `tab` names the section that holds the controls, so a surface can route
 * straight there instead of asking the reader to hunt for it.
 *
 * @param {object} input same shape as deriveLeaseProgress
 * @returns {{key:string, actor:'staff'|'customer'|'none', tab:string,
 *            staff:{labelKey:string, hintKey:string, params?:object},
 *            customer:{labelKey:string, hintKey:string, params?:object}}}
 */
export function deriveNextAction(input = {}) {
  const {
    application,
    quotations = [],
    downPayment = null,
    purchase = null,
    agreement = null,
  } = input;

  const status = application?.status || "pending";
  const { halted, complete } = deriveLeaseProgress(input);

  const act = (key, actor, tab, staff, customer) => ({ key, actor, tab, staff, customer });
  const na = (suffix) => `leaseProgress.nextAction.${suffix}`;

  if (halted) {
    const shared = copy(na("halted.label"), `leaseProgress.halted.${haltedMessageKey(status)}`);
    return act("halted", "none", "overview", shared, shared);
  }

  if (complete) {
    return act(
      "complete",
      "none",
      "rentals",
      copy(na("complete.staff.label"), na("complete.staff.hint")),
      copy(na("complete.customer.label"), na("complete.customer.hint"))
    );
  }

  const hasAccepted = quotations.some((q) => q.status === "accepted");
  const hasLive = quotations.some((q) => q.status === "pending");
  const dpSettled = Boolean(downPayment?.settled) || Boolean(purchase?.downPaymentSettled);
  const dealerPaid = Boolean(purchase?.payout);
  const regStatus = purchase?.registrationStatus || "not_started";
  const live = Boolean(agreement?.agreement);
  const position = agreement?.position;
  const released = Boolean(purchase?.registration?.release_letter_no);

  // --- the live lease, and the end of it -----------------------------------
  if (live) {
    if (position?.fullyPaid && !released) {
      return act(
        "issue_release",
        "staff",
        "rentals",
        copy(na("issue_release.staff.label"), na("issue_release.staff.hint")),
        copy(na("issue_release.customer.label"), na("issue_release.customer.hint"))
      );
    }
    if (released) {
      return act(
        "record_transfer",
        "staff",
        "rentals",
        copy(na("record_transfer.staff.label"), na("record_transfer.staff.hint")),
        copy(na("record_transfer.customer.label"), na("record_transfer.customer.hint"))
      );
    }
    if (position?.arrears?.count > 0) {
      return act(
        "clear_arrears",
        "customer",
        "rentals",
        copy(na("clear_arrears.staff.label"), na("clear_arrears.staff.hint"), {
          count: position.arrears.count,
        }),
        copy(na("clear_arrears.customer.label"), na("clear_arrears.customer.hint"))
      );
    }
    return act(
      "pay_rental",
      "customer",
      "rentals",
      copy(na("pay_rental.staff.label"), na("pay_rental.staff.hint"), {
        paid: position?.rentalsPaid ?? 0,
        total: position?.rentalsTotal ?? 0,
      }),
      copy(na("pay_rental.customer.label"), na("pay_rental.customer.hint"))
    );
  }

  // --- buying the vehicle and getting title --------------------------------
  if (dpSettled) {
    if (!dealerPaid) {
      return act(
        "pay_dealer",
        "staff",
        "title",
        copy(na("pay_dealer.staff.label"), na("pay_dealer.staff.hint")),
        copy(na("pay_dealer.customer.label"), na("pay_dealer.customer.hint"))
      );
    }
    if (regStatus === "not_started") {
      return act(
        "lodge_cr",
        "staff",
        "title",
        copy(na("lodge_cr.staff.label"), na("lodge_cr.staff.hint")),
        copy(na("lodge_cr.customer.label"), na("lodge_cr.customer.hint"))
      );
    }
    if (regStatus === "submitted") {
      return act(
        "confirm_cr",
        "staff",
        "title",
        copy(na("confirm_cr.staff.label"), na("confirm_cr.staff.hint")),
        copy(na("confirm_cr.customer.label"), na("confirm_cr.customer.hint"))
      );
    }
    return act(
      "activate",
      "staff",
      "rentals",
      copy(na("activate.staff.label"), na("activate.staff.hint")),
      copy(na("activate.customer.label"), na("activate.customer.hint"))
    );
  }

  // --- terms and the money at signing --------------------------------------
  if (hasAccepted) {
    const outstanding = downPayment?.outstanding;
    const hasOutstanding = outstanding > 0;
    return act(
      "collect_down_payment",
      "customer",
      "money",
      copy(
        na("collect_down_payment.staff.label"),
        hasOutstanding
          ? na("collect_down_payment.staff.hintAmount")
          : na("collect_down_payment.staff.hintGeneric"),
        hasOutstanding ? { amount: fmtLkr(outstanding) } : undefined
      ),
      copy(na("collect_down_payment.customer.label"), na("collect_down_payment.customer.hint"))
    );
  }

  if (hasLive) {
    return act(
      "accept_quotation",
      "customer",
      "quotation",
      copy(na("accept_quotation.staff.label"), na("accept_quotation.staff.hint")),
      copy(na("accept_quotation.customer.label"), na("accept_quotation.customer.hint"))
    );
  }

  if (status === "approved") {
    return act(
      "issue_quotation",
      "staff",
      "quotation",
      copy(na("issue_quotation.staff.label"), na("issue_quotation.staff.hint")),
      copy(na("issue_quotation.customer.label"), na("issue_quotation.customer.hint"))
    );
  }

  // --- before a decision ----------------------------------------------------
  if (status === "info_requested") {
    return act(
      "provide_info",
      "customer",
      "documents",
      copy(na("provide_info.staff.label"), na("provide_info.staff.hint")),
      copy(na("provide_info.customer.label"), na("provide_info.customer.hint"))
    );
  }

  // Every condition needs an independent valuation before approval, brand
  // new included — a franchise invoice is a price the dealer set, not a
  // value anyone has verified.
  const needsValuation = Boolean(application?.condition_type);
  const valuationDone = Boolean(input.valuationCompleted);
  if (needsValuation && !valuationDone) {
    return act(
      "valuation",
      "staff",
      "valuation",
      copy(na("valuation.staff.label"), na("valuation.staff.hint")),
      copy(na("valuation.customer.label"), na("valuation.customer.hint"))
    );
  }

  return act(
    "decide",
    "staff",
    "decision",
    copy(na("decide.staff.label"), na("decide.staff.hint")),
    copy(na("decide.customer.label"), na("decide.customer.hint"))
  );
}

/**
 * Adapt a LIST row to what deriveLeaseProgress expects.
 *
 * A list query cannot afford to load quotations, the down-payment position,
 * the payout and the agreement per row, so the two list endpoints return a
 * handful of flat milestone columns instead (see PROGRESS_COLUMNS in
 * leaseApplication.model.js). This reshapes them so the SAME derivation runs
 * — a list and the detail page it links to must never disagree about how far
 * a lease has got.
 *
 * The one thing a list row cannot know is whether the down payment has
 * settled, which is why the derivation does not depend on it.
 */
export function progressFromRow(row = {}) {
  const quotations = [];
  if (row.has_accepted_quotation) quotations.push({ status: "accepted" });
  if (row.has_live_quotation) quotations.push({ status: "pending" });

  return deriveLeaseProgress({
    application: row,
    quotations,
    purchase: {
      payout: row.has_payout ? { id: true } : null,
      registrationStatus: row.registration_status || "not_started",
      registration: row.release_letter_no ? { release_letter_no: row.release_letter_no } : null,
    },
    agreement: row.agreement_status
      ? {
          agreement: { status: row.agreement_status },
          // A list row does not carry the rental ledger. 'completed' is the
          // agreement's own status and is enough to mark the lease done.
          position: { fullyPaid: row.agreement_status === "completed" },
        }
      : null,
  });
}

/**
 * Which `leaseProgress.halted.*` key describes a lease that stopped.
 * @returns {"rejected"|"withdrawn"|"declined"|"default"}
 */
export function haltedMessageKey(status) {
  switch (status) {
    case "rejected":
      return "rejected";
    case "withdrawn":
      return "withdrawn";
    case "declined":
      return "declined";
    default:
      return "default";
  }
}

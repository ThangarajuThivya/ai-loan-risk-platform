// Explicit .js extension, unlike most imports in this tree: it costs
// nothing under Vite and it keeps this module runnable by plain node, which
// is how its arithmetic is tested without standing up a bundler.
import { deriveNextAction } from "./leaseProgress.js";

/**
 * The four figures worth putting at the top of a lessee's lease page.
 *
 * WHICH four depends on where the lease is, which is the whole point. A
 * fixed set would have to be a lowest common denominator — "financed
 * amount, term, status" — none of which is what someone actually opens the
 * page to check. What they want to know is stage-specific: before signing
 * it's what this will cost; while paying it's what's left; once live it's
 * when the next rental is due.
 *
 * Pure, so the tiles can be asserted without rendering anything. Like
 * leaseProgress.js, this returns i18n keys rather than rendered text — this
 * module has no React and no i18n dependency, only the `LeaseTiles`
 * component (LeaseDashboardParts.jsx) resolves them, since it is the only
 * consumer (unlike leaseProgress.js, nothing here is shared with a
 * staff-audience surface, so a plain ambient `t` is enough there).
 *
 * Each tile's `label` is always a key (`leaseProgress.tiles.*`). `value` and
 * `hint` are EITHER already-formatted, language-neutral text (a currency
 * figure, a date) passed straight through, OR a `{key, params}` pair when
 * the fact genuinely contains English words ("of", "overdue", "months") —
 * distinguished by the sibling `valueKey`/`hintKey` field being present.
 *
 * `tone` drives colour and carries meaning, never decoration:
 *   amber   — a number that is owed
 *   emerald — a number that is settled or earned
 *   slate   — neutral fact
 */

const lkr = (v) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : `LKR ${Number(v).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const asDate = (v) =>
  v
    ? new Date(v).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const tk = (suffix) => `leaseProgress.tiles.${suffix}`;

/**
 * @returns {Array<{labelKey:string, value?:string, valueKey?:string,
 *            valueParams?:object, hint?:string, hintKey?:string,
 *            hintParams?:object, tone?:string}>}
 *          always exactly four, so the grid never reflows between stages
 */
export function buildLeaseTiles({
  application,
  quotations = [],
  downPayment = null,
  purchase = null,
  agreement = null,
} = {}) {
  const action = deriveNextAction({ application, quotations, downPayment, purchase, agreement });
  const accepted = quotations.find((q) => q.status === "accepted");
  const live = quotations.find((q) => q.status === "pending");
  const terms = accepted || live;
  const position = agreement?.position;

  // --- the lease is running -------------------------------------------------
  if (agreement?.agreement) {
    const a = agreement.agreement;
    return [
      { labelKey: tk("monthlyRental"), value: lkr(a.monthly_rental), tone: "slate" },
      {
        labelKey: tk("rentalsPaid"),
        valueKey: tk("rentalsPaidOf"),
        valueParams: { paid: position?.rentalsPaid ?? 0, total: position?.rentalsTotal ?? a.term_months ?? 0 },
        hint: lkr(position?.received),
        tone: position?.fullyPaid ? "emerald" : "slate",
      },
      {
        labelKey: tk("outstanding"),
        value: lkr(position?.outstanding),
        tone: position?.outstanding > 0 ? "amber" : "emerald",
      },
      position?.fullyPaid
        ? { labelKey: tk("status"), valueKey: tk("fullyPaid"), tone: "emerald" }
        : {
            labelKey: tk("nextDue"),
            value: position?.nextDue ? asDate(position.nextDue.dueDate) : "—",
            ...(position?.arrears?.count > 0
              ? { hintKey: tk("overdueCount"), hintParams: { count: position.arrears.count } }
              : { hint: position?.nextDue ? lkr(position.nextDue.amount) : undefined }),
            tone: position?.arrears?.count > 0 ? "amber" : "slate",
          },
    ];
  }

  // --- terms agreed, money owed at signing ---------------------------------
  if (downPayment && downPayment.dueTotal !== undefined) {
    return [
      { labelKey: tk("dueAtSigning"), value: lkr(downPayment.dueTotal), tone: "slate" },
      { labelKey: tk("received"), value: lkr(downPayment.received), tone: "emerald" },
      {
        labelKey: tk("outstanding"),
        value: lkr(downPayment.outstanding),
        tone: downPayment.outstanding > 0 ? "amber" : "emerald",
      },
      {
        labelKey: tk("monthlyRental"),
        value: lkr(terms?.monthly_rental),
        ...(terms ? { hintKey: tk("termMonths"), hintParams: { count: terms.term_months } } : {}),
        tone: "slate",
      },
    ];
  }

  // --- terms on the table, nothing payable yet ------------------------------
  if (terms) {
    const feeTotal = (terms.fees || []).reduce(
      (sum, f) => sum + (f.waived ? 0 : Number(f.amount) || 0),
      0
    );
    return [
      { labelKey: tk("monthlyRental"), value: lkr(terms.monthly_rental), tone: "slate" },
      {
        labelKey: tk("payableAtSigning"),
        value: lkr(Number(terms.down_payment_amount) + feeTotal),
        hintKey: feeTotal > 0 ? tk("percentDownPlusFees") : tk("percentDown"),
        hintParams: { percent: terms.down_payment_percent },
        tone: "amber",
      },
      { labelKey: tk("term"), valueKey: tk("termMonths"), valueParams: { count: terms.term_months }, tone: "slate" },
      {
        labelKey: tk("rate"),
        value: `${Number(terms.interest_rate).toFixed(2)}%`,
        // rate_type ("reducing"/"flat") is a curated, closed-set label —
        // reuses the SAME keys the public catalogue (Services.jsx) already
        // translates it with, rather than a second copy of the same word.
        hintKey:
          (terms.rate_type || "").toLowerCase() === "reducing"
            ? "loans.rateTypeReducing"
            : (terms.rate_type || "").toLowerCase() === "flat"
              ? "loans.rateTypeFlat"
              : undefined,
        hint: terms.rate_type,
        tone: "slate",
      },
    ];
  }

  // --- before any terms exist -----------------------------------------------
  return [
    { labelKey: tk("vehiclePrice"), value: lkr(application?.invoice_price), tone: "slate" },
    { labelKey: tk("toFinance"), value: lkr(application?.financed_amount), tone: "slate" },
    {
      labelKey: tk("term"),
      valueKey: tk("termMonths"),
      valueParams: { count: application?.term_months ?? "—" },
      tone: "slate",
    },
    {
      labelKey: tk("stage"),
      valueKey: action.customer.labelKey,
      valueParams: action.customer.params,
      tone: action.actor === "customer" ? "amber" : "slate",
    },
  ];
}

/**
 * One-line summaries of the stages already behind the lessee.
 *
 * A quotation card mattered enormously for one day and is a receipt for the
 * next five years; it should shrink accordingly. Each entry collapses to a
 * line and expands to the full card the page already had.
 *
 * @returns {string[]} keys of stages that are DONE, in workflow order
 */
export function finishedStages({
  quotations = [],
  downPayment = null,
  purchase = null,
  agreement = null,
} = {}) {
  const done = [];
  const acceptedQuote = quotations.some((q) => q.status === "accepted");
  const dpSettled = Boolean(downPayment?.settled) || Boolean(purchase?.downPaymentSettled);
  const live = Boolean(agreement?.agreement);

  // A stage counts as finished only once the NEXT one can begin — otherwise
  // the thing the lessee is currently waiting on would fold itself away.
  if (acceptedQuote && (dpSettled || live)) done.push("quotation");
  if (dpSettled && (purchase?.payout || live)) done.push("downPayment");
  if (live) done.push("purchase");

  return done;
}

export { lkr as formatLkr, asDate as formatTileDate };

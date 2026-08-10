"use strict";

/**
 * Stripe gateway wrapper (040) — the ONLY module in this codebase that knows
 * Stripe exists. Everything above it deals in "a checkout session was
 * created" / "the gateway says this session is paid", so swapping or adding a
 * provider later means writing a sibling of this file, not touching the
 * payment logic.
 *
 * LAZY CLIENT, ON PURPOSE. The client is constructed on first use rather than
 * at require() time, and isConfigured() lets callers degrade gracefully. This
 * backend also serves loans, FX and currency; a missing STRIPE_SECRET_KEY must
 * mean "card payment unavailable", never "the whole server fails to boot".
 * That also keeps `npm test` and a fresh clone working with no Stripe account
 * at all.
 *
 * Stripe Checkout (hosted redirect) is deliberate over an embedded card form:
 * no card data ever reaches this server, and 3-D Secure, wallets, card-error
 * messaging and localisation are Stripe's problem rather than hand-wired here.
 */

const Stripe = require("stripe");

/**
 * Currency actually charged. Not hardcoded to LKR: Stripe accounts are
 * country-bound and a test account may reject LKR as a presentment currency,
 * in which case a demo can fall back to usd without touching code. The
 * amounts held in this system's own tables are always LKR regardless — only
 * what the gateway charges changes.
 */
const CURRENCY = (process.env.STRIPE_CURRENCY || "lkr").toLowerCase();

/** Where Stripe sends the customer back to. */
const PUBLIC_URL = process.env.APP_PUBLIC_URL || "http://localhost:5173";

let client = null;

/**
 * Whether card payment is available at all. Callers use this to return a
 * clean "unavailable" instead of throwing a Stripe constructor error.
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** @returns {object} the memoised Stripe client */
function getClient() {
  if (!isConfigured()) throw new Error("STRIPE_NOT_CONFIGURED");
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/**
 * Convert an LKR amount to the gateway's minor units.
 *
 * ROUND, never truncate. 11885.00 arrives from mysql2 as a string that
 * becomes 11884.999999 often enough to matter, and `Math.trunc` would silently
 * charge a cent less on those. Both LKR and USD are 2-decimal currencies, so
 * this holds for the fallback too.
 *
 * @param {number|string} amount
 * @returns {number} integer minor units
 */
function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100);
}

/** Inverse of toMinorUnits, for checking what the gateway actually charged. */
function fromMinorUnits(minor) {
  return Number(minor) / 100;
}

/**
 * Create a hosted Checkout session for one repayment attempt.
 *
 * The amount comes from the caller, which got it from
 * repaymentQuote.service.js — never from the browser. `metadata` carries our
 * own intent id so the webhook can find the attempt without trusting anything
 * in the URL.
 *
 * @param {object} p
 * @param {number} p.amount            LKR
 * @param {string} p.description       shown on the Stripe page and the card statement
 * @param {number} p.applicationId
 * @param {number} p.intentId          loan_payment_intents.id
 * @param {string} [p.customerEmail]   prefills the Stripe page
 * @returns {Promise<{id:string, url:string}>}
 */
async function createCheckoutSession({
  amount,
  description,
  applicationId,
  intentId,
  customerEmail,
  // Which ledger this session settles into. The webhook dispatches on it,
  // because a lease down payment and a loan repayment are different rows in
  // different tables and confusing the two would post money to the wrong
  // place. Defaults to the loan path so existing callers are unchanged.
  kind = "loan_repayment",
  // Where the gateway sends the customer back to. Defaults to the customer
  // dashboard, which is where a loan repayment belongs.
  returnPath = "/dashboard",
}) {
  const stripe = getClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // session_id is echoed back so the return page can poll (and, if the
    // webhook is slow or absent, reconcile) this exact attempt. The
    // application id rides along only so the return page knows which endpoint
    // to poll — it is never trusted as authorisation, because the poll
    // endpoint re-checks that the intent really belongs to the caller.
    success_url: `${PUBLIC_URL}${returnPath}?payment=success&application=${applicationId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_URL}${returnPath}?payment=cancelled&application=${applicationId}&session_id={CHECKOUT_SESSION_ID}`,
    customer_email: customerEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: toMinorUnits(amount),
          product_data: { name: description },
        },
      },
    ],
    // Read back by the webhook. Stripe returns metadata verbatim, and it is
    // part of the signed payload, so it is safe to trust — unlike a query
    // parameter on the redirect, which the customer can edit.
    metadata: {
      intent_id: String(intentId),
      application_id: String(applicationId),
      kind,
    },
  });
  return { id: session.id, url: session.url };
}

/**
 * Fetch a session's current state straight from Stripe. Used by the return
 * page to settle a payment whose webhook has not landed (or was never
 * configured — the common case on localhost without the Stripe CLI).
 * THE RETURN SHAPE IS camelCase AND DELIBERATELY NOT STRIPE'S. Callers must
 * read `paymentStatus` / `paymentIntentId`, never Stripe's own
 * `payment_status` / `payment_intent` — those are undefined here, which
 * makes a "did this get paid?" check silently answer no and a genuinely
 * charged card never settle. The webhook path is the opposite: it receives
 * the RAW Stripe object and correctly uses snake_case.
 *
 * @param {string} sessionId
 * @returns {Promise<{id:string, status:string|null, paymentStatus:string,
 *                    paymentIntentId:string|null, amountTotal:number|null,
 *                    currency:string|null}>}
 */
async function retrieveSession(sessionId) {
  const stripe = getClient();
  const s = await stripe.checkout.sessions.retrieve(sessionId);
  return {
    id: s.id,
    // 'open' | 'complete' | 'expired'. Distinct from paymentStatus: a
    // session can be complete with an unpaid async method still pending.
    status: s.status || null,
    paymentStatus: s.payment_status,
    paymentIntentId:
      typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id || null,
    amountTotal: s.amount_total ?? null,
    currency: s.currency || null,
  };
}

/**
 * Verify and parse a webhook delivery. Throws if the signature does not match,
 * which is the entire security boundary of the webhook endpoint: without this
 * anyone who knows the URL could post a fake "payment succeeded" and clear
 * someone's loan.
 *
 * `rawBody` must be the untouched Buffer — a JSON-parsed-and-restringified
 * body will not verify, which is why the route mounts express.raw ahead of
 * express.json in app.js.
 *
 * @param {Buffer} rawBody
 * @param {string} signature the Stripe-Signature header
 * @returns {object} the verified Stripe event
 */
function constructWebhookEvent(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET_MISSING");
  return getClient().webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  CURRENCY,
  PUBLIC_URL,
  isConfigured,
  toMinorUnits,
  fromMinorUnits,
  createCheckoutSession,
  retrieveSession,
  constructWebhookEvent,
};

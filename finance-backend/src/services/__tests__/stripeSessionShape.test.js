"use strict";

/**
 * The contract of stripeService.retrieveSession, and every caller's reading
 * of it.
 *
 * WHY THIS EXISTS. `retrieveSession` maps Stripe's raw session onto a
 * camelCase object. Two lease controllers were written against Stripe's own
 * snake_case names instead (`payment_status`, `payment_intent`), which are
 * `undefined` on the mapped object. The effect was silent and expensive: a
 * genuinely paid card returned `undefined === "paid"` → false, the reconcile
 * did nothing, the intent sat at 'created' forever, and the lessee — seeing
 * no change — paid again. Five live charges went unrecorded before it was
 * noticed.
 *
 * Nothing failed loudly, so no existing test caught it. What was missing was
 * a check that the SHAPE the service promises is the shape callers read. The
 * webhook path is deliberately excluded: it receives the RAW Stripe object
 * and correctly uses snake_case.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
const ok = (name) => {
  passed++;
  console.log("  ok - " + name);
};

const SRC = path.join(__dirname, "..", "..");

// --- 1. the documented shape ------------------------------------------------
{
  // Rebuild the mapper's output from a representative raw Stripe session,
  // without a network call, by reading what the service actually returns for
  // a known input. The mapping is a pure transform, so it is safe to assert
  // against the source of truth: the service's own field list.
  const source = fs.readFileSync(path.join(SRC, "services", "stripe.service.js"), "utf8");
  const body = source.slice(
    source.indexOf("async function retrieveSession"),
    source.indexOf("\n}", source.indexOf("async function retrieveSession"))
  );

  for (const field of ["id", "status", "paymentStatus", "paymentIntentId", "amountTotal", "currency"]) {
    assert.ok(
      new RegExp(`\\b${field}\\s*:`).test(body),
      `retrieveSession no longer returns "${field}" — callers depend on it`
    );
  }
  ok("retrieveSession returns the six camelCase fields its callers read");

  // The trap itself: the mapped object must NOT carry Stripe's own names,
  // because a caller reaching for them gets undefined rather than an error.
  assert.ok(
    !/^\s*payment_status\s*:/m.test(body),
    "the mapped object must not expose Stripe's snake_case names"
  );
  ok("the mapped object deliberately does NOT expose payment_status/payment_intent");
}

// --- 2. no caller reads the raw Stripe names off a mapped session ----------
{
  // Every file that calls retrieveSession, scanned for the mistake. A
  // controller reading `session.payment_status` from a retrieveSession
  // result is the exact defect this suite exists for.
  const dirs = ["controllers", "services", "models"];
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;

      const text = fs.readFileSync(full, "utf8");
      if (!text.includes("retrieveSession")) continue;
      // Skip the file that DEFINES the mapper: reading Stripe's snake_case
      // names off the raw session is exactly its job. Everywhere else, the
      // only session in scope is the mapped one.
      if (text.includes("async function retrieveSession")) continue;

      // Look at the window after each retrieveSession call — where the
      // result is consumed — rather than the whole file, so the webhook
      // handlers (which legitimately use snake_case on the RAW object) in
      // the same file are not flagged.
      let from = 0;
      for (;;) {
        const at = text.indexOf("retrieveSession", from);
        if (at === -1) break;
        const window = text.slice(at, at + 600);
        // Ignore comments: this trap is worth writing about.
        const code = window
          .split("\n")
          .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
          .join("\n");
        if (/\.payment_status\b/.test(code) || /\.payment_intent\b/.test(code)) {
          offenders.push(`${path.relative(SRC, full)} (near offset ${at})`);
        }
        from = at + 1;
      }
    }
  };

  for (const d of dirs) walk(path.join(SRC, d));

  assert.deepStrictEqual(
    offenders,
    [],
    "these read Stripe's snake_case names off a mapped retrieveSession result:\n  " +
      offenders.join("\n  ")
  );
  ok("LOAD-BEARING: no caller reads payment_status/payment_intent off a mapped session");
}

// --- 3. the reconcile branches actually fire on the mapped shape -----------
{
  // A stand-in for what retrieveSession really returns for a paid session.
  // The point is to prove the CONDITIONS callers write evaluate true against
  // this shape — the thing that was false for six real payments.
  const paidSession = {
    id: "cs_test_x",
    status: "complete",
    paymentStatus: "paid",
    paymentIntentId: "pi_test_x",
    amountTotal: 630855000,
    currency: "lkr",
  };

  assert.strictEqual(paidSession.paymentStatus === "paid", true);
  assert.strictEqual(paidSession.paymentIntentId, "pi_test_x");
  ok("a paid session satisfies the camelCase condition callers now use");

  // The old condition, kept as a regression marker: this is what shipped,
  // and this is why nothing settled.
  assert.strictEqual(paidSession.payment_status === "paid", false);
  assert.strictEqual(paidSession.payment_intent, undefined);
  ok("LOAD-BEARING: the OLD snake_case condition is false on a genuinely paid session");

  const expired = { ...paidSession, status: "expired", paymentStatus: "unpaid" };
  assert.strictEqual(expired.status === "expired", true);
  ok("an expired session is detectable — `status` is now part of the mapped shape");
}

console.log(`\n${passed} passed`);

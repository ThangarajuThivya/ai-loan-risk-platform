"use strict";

/**
 * Runnable test script for the FX quote helper's pure/stateless logic (no
 * test runner needed, no DB — buildQuote() itself needs the DB and is
 * exercised manually instead, see CURRENCY_FEATURE.md §12).
 *   node src/services/__tests__/fxQuote.test.js
 * Exits non-zero on the first failed assertion.
 */

// Must be set before requiring the module under test — fxQuote.service.js
// reads its signing secret from the environment at load time.
process.env.FX_QUOTE_SECRET = process.env.FX_QUOTE_SECRET || "test-fx-quote-secret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const { rateForDirection, verifyQuote, QuoteError } = require("../fxQuote.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

function assertQuoteError(fn, expectedStatus) {
  assert.throws(fn, (err) => {
    assert(err instanceof QuoteError, `expected a QuoteError, got ${err}`);
    assert.strictEqual(err.status, expectedStatus, `expected status ${expectedStatus}, got ${err.status}`);
    return true;
  });
}

console.log("rateForDirection");

check("customer 'buy' prices at the board's sell_rate (bank sells FX)", () => {
  assert.strictEqual(rateForDirection("buy", { buy_rate: 300, sell_rate: 310 }), 310);
});

check("customer 'sell' prices at the board's buy_rate (bank buys FX)", () => {
  assert.strictEqual(rateForDirection("sell", { buy_rate: 300, sell_rate: 310 }), 300);
});

console.log("verifyQuote");

const SECRET = process.env.FX_QUOTE_SECRET;
function signQuote(claims, opts) {
  return jwt.sign(claims, SECRET, opts);
}

check("a valid, unexpired quote for the right user decodes", () => {
  const token = signQuote({ jti: "abc", sub: 42, currency_code: "USD" }, { expiresIn: "15m" });
  const decoded = verifyQuote(token, 42);
  assert.strictEqual(decoded.sub, 42);
  assert.strictEqual(decoded.currency_code, "USD");
});

check("an expired quote throws a 410 (Gone) QuoteError", () => {
  const token = signQuote({ jti: "abc", sub: 42 }, { expiresIn: -1 });
  assertQuoteError(() => verifyQuote(token, 42), 410);
});

check("a quote redeemed by a different user throws a 403 QuoteError", () => {
  const token = signQuote({ jti: "abc", sub: 42 }, { expiresIn: "15m" });
  assertQuoteError(() => verifyQuote(token, 99), 403);
});

check("a malformed quote id throws a 400 QuoteError", () => {
  assertQuoteError(() => verifyQuote("not-a-real-jwt", 42), 400);
});

check("a quote signed with a different secret throws a 400 QuoteError", () => {
  const token = jwt.sign({ jti: "abc", sub: 42 }, "wrong-secret", { expiresIn: "15m" });
  assertQuoteError(() => verifyQuote(token, 42), 400);
});

console.log(`\n${passed} checks passed.`);

// fxQuote.service.js transitively requires currencyModel.js -> config/db.js,
// which opens a real MySQL connection pool as a side effect of require().
// crossRate.test.js/recommendation.test.js never touch the DB and exit on
// their own; this one needs an explicit exit or the open pool keeps the
// process (and `npm test`) hanging after the last assertion.
process.exit(0);

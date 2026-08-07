"use strict";

/**
 * Runnable test script for loan-wizard draft sanitization (H3).
 *   node src/services/__tests__/loanDraft.test.js
 * Exits non-zero on the first failed assertion.
 *
 * The point of these tests is the security boundary: `payload` is free-form
 * client JSON, and sanitizeDraftPayload is the only thing standing between it
 * and a JSON column. Anything that lets an unknown key, an unbounded string,
 * or a non-scalar through is a real finding, not a style nit.
 */

const assert = require("assert");
const {
  DRAFT_FIELDS,
  COLLATERAL_ITEM_FIELDS,
  MAX_STEP,
  MAX_PAYLOAD_BYTES,
  MAX_COLLATERAL_ITEMS,
  MAX_STRING_LENGTH,
  DraftPayloadError,
  sanitizeDraftPayload,
  sanitizeStep,
} = require("../loanDraft.service");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("sanitizeDraftPayload — whitelisting");

check("keeps known wizard fields verbatim", () => {
  const clean = sanitizeDraftPayload({
    productId: "3",
    requestedAmount: "500000",
    tenureMonths: "24",
    purpose: "Home renovation",
    maritalStatus: "Married",
  });
  assert.strictEqual(clean.productId, "3");
  assert.strictEqual(clean.requestedAmount, "500000");
  assert.strictEqual(clean.tenureMonths, "24");
  assert.strictEqual(clean.purpose, "Home renovation");
  assert.strictEqual(clean.maritalStatus, "Married");
});

check("SECURITY: silently drops keys outside the whitelist", () => {
  const clean = sanitizeDraftPayload({
    purpose: "legit",
    status: "approved",
    user_id: 999,
    is_admin: true,
    __proto__: { polluted: true },
    "'; DROP TABLE loan_applications; --": "x",
  });
  assert.deepStrictEqual(Object.keys(clean), ["purpose"]);
  assert.strictEqual(clean.status, undefined);
  assert.strictEqual(clean.user_id, undefined);
  assert.strictEqual(clean.is_admin, undefined);
});

check("SECURITY: a payload of ONLY unknown keys sanitizes to an empty object", () => {
  const clean = sanitizeDraftPayload({ evil: 1, alsoEvil: "yes" });
  assert.deepStrictEqual(clean, {});
});

check("omitted known keys stay absent rather than being invented", () => {
  const clean = sanitizeDraftPayload({ purpose: "x" });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(clean, "cribScore"), false);
});

check("FORWARD COMPAT: a draft predating a field still round-trips the rest", () => {
  // Simulates an old draft saved before `cribReaffirm` existed.
  const old = { purpose: "x", maritalStatus: "Single" };
  const clean = sanitizeDraftPayload(old);
  assert.strictEqual(clean.purpose, "x");
  assert.strictEqual(clean.maritalStatus, "Single");
  assert.strictEqual(clean.cribReaffirm, undefined);
});

console.log("sanitizeDraftPayload — value coercion");

check("null/undefined collapse to the wizard's empty-answer value", () => {
  const clean = sanitizeDraftPayload({ purpose: null, maritalStatus: undefined });
  assert.strictEqual(clean.purpose, "");
  // `undefined` is not an own enumerable value worth persisting, but the key
  // IS present on the input object, so it normalises rather than vanishing.
  assert.strictEqual(clean.maritalStatus, "");
});

check("numbers and booleans survive as-is", () => {
  const clean = sanitizeDraftPayload({ cribScore: 720, knowsCribScore: true });
  assert.strictEqual(clean.cribScore, 720);
  assert.strictEqual(clean.knowsCribScore, true);
});

check("rejects a non-finite number", () => {
  assert.throws(() => sanitizeDraftPayload({ cribScore: Infinity }), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload({ cribScore: NaN }), DraftPayloadError);
});

check("rejects a nested object where a scalar belongs", () => {
  assert.throws(() => sanitizeDraftPayload({ purpose: { nested: true } }), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload({ purpose: ["a"] }), DraftPayloadError);
});

check("rejects an over-long string", () => {
  const tooLong = "x".repeat(MAX_STRING_LENGTH + 1);
  assert.throws(() => sanitizeDraftPayload({ purpose: tooLong }), DraftPayloadError);
});

check("accepts a string exactly at the length limit", () => {
  const atLimit = "x".repeat(MAX_STRING_LENGTH);
  assert.strictEqual(sanitizeDraftPayload({ purpose: atLimit }).purpose, atLimit);
});

console.log("sanitizeDraftPayload — payload shape");

check("rejects a non-object payload", () => {
  assert.throws(() => sanitizeDraftPayload(null), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload("a string"), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload(42), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload([1, 2]), DraftPayloadError);
});

check("an empty object is a legitimate (if useless) draft", () => {
  assert.deepStrictEqual(sanitizeDraftPayload({}), {});
});

check("rejects an oversized payload", () => {
  // Spread across many fields so no single one trips MAX_STRING_LENGTH first.
  const big = {};
  for (const field of DRAFT_FIELDS) {
    if (field === "collateralItems") continue;
    big[field] = "x".repeat(MAX_STRING_LENGTH);
  }
  big.collateralItems = Array.from({ length: MAX_COLLATERAL_ITEMS }, () => ({
    type: "property",
    description: "y".repeat(MAX_STRING_LENGTH),
    estimatedValue: "1000000",
    ownershipReference: "z".repeat(MAX_STRING_LENGTH),
  }));
  const bytes = Buffer.byteLength(JSON.stringify(big), "utf8");
  assert(bytes > MAX_PAYLOAD_BYTES, `fixture should exceed the cap, got ${bytes}`);
  assert.throws(() => sanitizeDraftPayload(big), DraftPayloadError);
});

console.log("sanitizeDraftPayload — collateralItems");

check("keeps only the four known item keys", () => {
  const clean = sanitizeDraftPayload({
    collateralItems: [
      {
        type: "vehicle",
        description: "Car",
        estimatedValue: "2500000",
        ownershipReference: "ABC-1234",
        verification_status: "verified",
        injected: "nope",
      },
    ],
  });
  assert.deepStrictEqual(Object.keys(clean.collateralItems[0]).sort(), [...COLLATERAL_ITEM_FIELDS].sort());
  assert.strictEqual(clean.collateralItems[0].verification_status, undefined);
  assert.strictEqual(clean.collateralItems[0].type, "vehicle");
});

check("missing item keys normalise to empty rather than undefined", () => {
  const clean = sanitizeDraftPayload({ collateralItems: [{ type: "property" }] });
  assert.strictEqual(clean.collateralItems[0].type, "property");
  assert.strictEqual(clean.collateralItems[0].description, "");
  assert.strictEqual(clean.collateralItems[0].estimatedValue, "");
});

check("null/absent collateralItems becomes an empty array", () => {
  assert.deepStrictEqual(sanitizeDraftPayload({ collateralItems: null }).collateralItems, []);
});

check("rejects a non-array collateralItems", () => {
  assert.throws(() => sanitizeDraftPayload({ collateralItems: "nope" }), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload({ collateralItems: { a: 1 } }), DraftPayloadError);
});

check("rejects a non-object entry inside collateralItems", () => {
  assert.throws(() => sanitizeDraftPayload({ collateralItems: ["a string"] }), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload({ collateralItems: [null] }), DraftPayloadError);
  assert.throws(() => sanitizeDraftPayload({ collateralItems: [["nested"]] }), DraftPayloadError);
});

check("rejects more collateral items than the cap", () => {
  const items = Array.from({ length: MAX_COLLATERAL_ITEMS + 1 }, () => ({ type: "other" }));
  assert.throws(() => sanitizeDraftPayload({ collateralItems: items }), DraftPayloadError);
});

check("accepts exactly the cap", () => {
  const items = Array.from({ length: MAX_COLLATERAL_ITEMS }, () => ({ type: "other" }));
  assert.strictEqual(sanitizeDraftPayload({ collateralItems: items }).collateralItems.length, MAX_COLLATERAL_ITEMS);
});

console.log("sanitizeStep");

check("accepts every real wizard step", () => {
  for (let s = 0; s <= MAX_STEP; s += 1) {
    assert.strictEqual(sanitizeStep(s), s);
  }
});

check("accepts a numeric string, as sent over JSON by some clients", () => {
  assert.strictEqual(sanitizeStep("3"), 3);
});

check("defaults a missing step to 0 rather than throwing", () => {
  assert.strictEqual(sanitizeStep(undefined), 0);
  assert.strictEqual(sanitizeStep(null), 0);
});

check("rejects out-of-range, fractional and non-numeric steps", () => {
  assert.throws(() => sanitizeStep(-1), DraftPayloadError);
  assert.throws(() => sanitizeStep(MAX_STEP + 1), DraftPayloadError);
  assert.throws(() => sanitizeStep(1.5), DraftPayloadError);
  assert.throws(() => sanitizeStep("abc"), DraftPayloadError);
  assert.throws(() => sanitizeStep({}), DraftPayloadError);
});

console.log("catalog");

check("DRAFT_FIELDS covers every wizard step and the H1 reaffirmations", () => {
  assert(Array.isArray(DRAFT_FIELDS) && DRAFT_FIELDS.length > 0);
  for (const expected of [
    "productId", // step 0
    "maritalStatus", // step 1
    "hasExistingLoans", // step 2
    "isGuarantor", // step 3
    "cribScore", // step 4
    "collateralItems", // step 5
    "aboutYouReaffirm", // H1
    "cribReaffirm", // H1
  ]) {
    assert(DRAFT_FIELDS.includes(expected), `DRAFT_FIELDS missing ${expected}`);
  }
});

check("DRAFT_FIELDS has no duplicates", () => {
  assert.strictEqual(new Set(DRAFT_FIELDS).size, DRAFT_FIELDS.length);
});

console.log(`\n${passed} assertions passed.`);

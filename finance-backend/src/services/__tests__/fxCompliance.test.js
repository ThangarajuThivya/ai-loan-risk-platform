"use strict";

/**
 * The documentation-threshold rule (migration 014).
 *
 * `requiresDocumentsFor` is the single decision point behind three
 * behaviours — the advance warning on a quote, the snapshot written at
 * submission, and (via that snapshot) the approval gate. Its edge cases are
 * exactly the ones that fail silently in the wrong direction: a NULL
 * threshold must mean "no requirement", not "requirement at 0", and the
 * comparison at the boundary must be inclusive.
 *
 * The function is defined inside fxExchange.controller.js, which cannot be
 * required here without opening a DB pool, so the rule is restated below and
 * kept in sync by hand — the same approach liveAnomaly.test.js takes to
 * MIN_POINTS_REQUIRED. If you change one, change the other.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function requiresDocumentsFor(lkrAmount, limits) {
  if (limits?.document_threshold_lkr == null) return false;
  return Number(lkrAmount) >= Number(limits.document_threshold_lkr);
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name}\n      ${err.message}`]);
  }
}

console.log("requiresDocumentsFor");

check("a NULL threshold means no documentation requirement at all", () => {
  assert.strictEqual(requiresDocumentsFor(999999999, { document_threshold_lkr: null }), false);
});

check("an undefined/missing threshold column is also treated as no requirement", () => {
  assert.strictEqual(requiresDocumentsFor(999999999, {}), false);
  assert.strictEqual(requiresDocumentsFor(999999999, undefined), false);
});

check("an amount below the threshold does not require documents", () => {
  assert.strictEqual(requiresDocumentsFor(999999.99, { document_threshold_lkr: 1000000 }), false);
});

check("BOUNDARY: an amount exactly at the threshold DOES require documents", () => {
  assert.strictEqual(requiresDocumentsFor(1000000, { document_threshold_lkr: 1000000 }), true);
});

check("an amount above the threshold requires documents", () => {
  assert.strictEqual(requiresDocumentsFor(1000000.01, { document_threshold_lkr: 1000000 }), true);
});

check("mysql2's string-typed DECIMAL threshold is compared numerically, not lexically", () => {
  // "900000" > "1000000" as strings — a lexical comparison would wrongly
  // flag a 900k exchange against a 1M threshold.
  assert.strictEqual(requiresDocumentsFor(900000, { document_threshold_lkr: "1000000.00" }), false);
  assert.strictEqual(requiresDocumentsFor("2000000.00", { document_threshold_lkr: "1000000.00" }), true);
});

check("a zero threshold means every request needs documents, unlike NULL", () => {
  assert.strictEqual(requiresDocumentsFor(0, { document_threshold_lkr: 0 }), true);
  assert.strictEqual(requiresDocumentsFor(1, { document_threshold_lkr: 0 }), true);
});

console.log("controller/migration consistency");

check("the rule under test still matches the controller's implementation", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "controllers", "fxExchange.controller.js"),
    "utf8"
  );
  const match = src.match(/function requiresDocumentsFor\(lkrAmount, limits\) \{([\s\S]*?)\n\}/);
  assert.ok(match, "requiresDocumentsFor not found in fxExchange.controller.js");
  const body = match[1].replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const expected =
    "if (limits?.document_threshold_lkr == null) return false; return Number(lkrAmount) >= Number(limits.document_threshold_lkr);";
  assert.strictEqual(body, expected, "controller rule drifted from this test's copy");
});

check("approval is gated on requires_documents AND a zero document count", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "controllers", "fxExchange.controller.js"),
    "utf8"
  );
  assert.ok(
    /if \(row\.requires_documents && Number\(row\.document_count \?\? 0\) === 0\)/.test(src),
    "the approve-path document gate is missing or has changed shape"
  );
  assert.ok(
    /requires supporting documents before it can be approved/.test(src),
    "the gate's 409 message is missing"
  );
});

check("compliance documents are never written under the statically-served uploads/ dir", () => {
  const multer = fs.readFileSync(path.join(__dirname, "..", "..", "config", "multer.js"), "utf8");
  const dirLine = multer.match(/const FX_DOCUMENT_DIR = .*/);
  assert.ok(dirLine, "FX_DOCUMENT_DIR not found in config/multer.js");
  assert.ok(
    /secure-uploads/.test(dirLine[0]) && !/"uploads"/.test(dirLine[0]),
    "FX documents must live under secure-uploads/, not the public uploads/ tree"
  );
});

const failed = results.filter(([ok]) => !ok);
for (const [ok, name] of results) console.log(`  ${ok ? "ok" : "NOT OK"} - ${name}`);
console.log(`\n${results.length - failed.length} passed${failed.length ? `, ${failed.length} FAILED` : ""}`);
if (failed.length) process.exit(1);

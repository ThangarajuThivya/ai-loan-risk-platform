"use strict";
// Runs every service-level test suite independently (rather than chained,
// as `npm run test:run` does) and writes a per-suite pass/assertion-count
// table to test-summary.txt, alongside printing it to the terminal.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TESTS_DIR = path.join(__dirname, "..", "src", "services", "__tests__");
const OUT_FILE = path.join(__dirname, "..", "test-summary.txt");

const files = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

const rows = [];
let totalAssertions = 0;
let totalFailures = 0;

for (const file of files) {
  const fullPath = path.join(TESTS_DIR, file);
  let output = "";
  let exitCode = 0;
  try {
    output = execFileSync("node", [fullPath], { encoding: "utf8" });
  } catch (err) {
    output = (err.stdout || "") + (err.stderr || "");
    exitCode = err.status ?? 1;
  }
  const okCount = (output.match(/^\s*ok -/gm) || []).length;
  const notOkCount = (output.match(/^\s*not ok/gm) || []).length;
  const status = exitCode === 0 && notOkCount === 0 ? "ok" : "FAIL";
  if (status !== "ok") totalFailures += 1;
  totalAssertions += okCount;
  rows.push({ file, okCount, status });
}

const lines = [];
lines.push(`$ for f in src/services/__tests__/*.test.js; do node "$f"; done`);
lines.push("");
for (const { file, okCount, status } of rows) {
  lines.push(
    `${status.padEnd(4, " ")}${file.padEnd(34, " ")}${String(okCount).padStart(4, " ")} assertions   node ${file}`
  );
}
lines.push("");
lines.push(
  `${rows.length} suites, ${totalAssertions} assertions, ${totalFailures} failures — exit code 0 for every suite`
    .replace("exit code 0 for every suite", totalFailures === 0 ? "exit code 0 for every suite" : "see failures above")
);

const text = lines.join("\n") + "\n";
fs.writeFileSync(OUT_FILE, text);
process.stdout.write(text);

if (totalFailures > 0) process.exit(1);

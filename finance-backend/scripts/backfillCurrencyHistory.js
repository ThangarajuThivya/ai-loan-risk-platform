"use strict";

/**
 * One-off backfill: loads the Phase 1 cleaned Fed H.10 series
 * (currency-forecast-model/data/processed/exchange_rates_long.csv) into
 * currency_rate_history, tagged source='h10-historical'. This is what makes
 * GET /api/currency/rates/:code return real pre-2017 history for charts —
 * see CURRENCY_FEATURE.md §7.3 (the endpoint previously returned [] because
 * currency_rates, the old target table, had no writer).
 *
 * Only backfills the 5 currencies the app actually trains/serves models for
 * (src/config.py's TRAINED_CURRENCIES in currency-forecast-model/), not all
 * 23 currencies in the raw file — the other 18 have no analyze/board/chart
 * consumer in this app.
 *
 * Idempotent: currency_rate_history has a UNIQUE KEY on
 * (base, target, rate_date, source), and this script uses INSERT IGNORE, so
 * re-running it never creates duplicate rows.
 *
 * Usage:
 *   node scripts/backfillCurrencyHistory.js
 *
 * Requires currency-forecast-model/data/processed/exchange_rates_long.csv
 * to exist (run currency-forecast-model/data/prepare_data.py first if not —
 * see currency-forecast-model/README.md).
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const TRAINED_CURRENCIES = new Set(["LKR", "INR", "EUR", "GBP", "JPY"]);
const SOURCE_TAG = "h10-historical";
const BATCH_SIZE = 2000;

const LONG_CSV_PATH = path.join(
  __dirname,
  "..",
  "..",
  "currency-forecast-model",
  "data",
  "processed",
  "exchange_rates_long.csv"
);

async function insertBatch(connection, rows) {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => ["USD", r.target, r.rateDate, r.midRate, SOURCE_TAG]);
  const [result] = await connection.query(
    `INSERT IGNORE INTO currency_rate_history (base, target, rate_date, mid_rate, source)
     VALUES ?`,
    [values]
  );
  return result.affectedRows;
}

async function run() {
  if (!fs.existsSync(LONG_CSV_PATH)) {
    throw new Error(
      `Expected the Phase 1 processed data at ${LONG_CSV_PATH} — it doesn't exist. ` +
        `Run currency-forecast-model/data/prepare_data.py first (see currency-forecast-model/README.md).`
    );
  }

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"]) {
    if (!process.env[key]) throw new Error(`${key} is not set in .env`);
  }

  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  const rl = readline.createInterface({
    input: fs.createReadStream(LONG_CSV_PATH),
    crlfDelay: Infinity,
  });

  let header = null;
  let dateIdx, currencyIdx, rateIdx;
  let batch = [];
  let totalRead = 0;
  let totalInserted = 0;
  const perCurrencyCount = {};

  try {
    for await (const line of rl) {
      if (!line) continue;

      if (!header) {
        header = line.split(",");
        dateIdx = header.indexOf("date");
        currencyIdx = header.indexOf("currency_code");
        rateIdx = header.indexOf("rate");
        if (dateIdx === -1 || currencyIdx === -1 || rateIdx === -1) {
          throw new Error(
            `Unexpected CSV header (expected date/currency_code/rate columns): ${line}`
          );
        }
        continue;
      }

      const cols = line.split(",");
      const currency = cols[currencyIdx];
      if (!TRAINED_CURRENCIES.has(currency)) continue;

      const rateDate = cols[dateIdx];
      const midRate = Number(cols[rateIdx]);
      if (!rateDate || !(midRate > 0)) continue;

      totalRead += 1;
      perCurrencyCount[currency] = (perCurrencyCount[currency] || 0) + 1;
      batch.push({ target: currency, rateDate, midRate });

      if (batch.length >= BATCH_SIZE) {
        totalInserted += await insertBatch(connection, batch);
        batch = [];
      }
    }
    totalInserted += await insertBatch(connection, batch);
  } finally {
    await connection.end();
  }

  console.log(`Read ${totalRead} rows for ${Object.keys(perCurrencyCount).length} trained currencies:`);
  for (const [code, count] of Object.entries(perCurrencyCount).sort()) {
    console.log(`  ${code}: ${count} rows`);
  }
  console.log(
    `Inserted ${totalInserted} new rows into currency_rate_history (source='${SOURCE_TAG}'). ` +
      `${totalRead - totalInserted} were already present (safe to re-run).`
  );
}

run().catch((err) => {
  console.error("❌ Backfill failed:", err.message);
  process.exit(1);
});

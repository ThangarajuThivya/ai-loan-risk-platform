"use strict";

/**
 * DEMO-ONLY seed data — Phase 13 (see ARCHITECTURE.md §8). NOT part of the
 * numbered migrations in db/migrations/ (those define schema; this defines
 * sample rows) and NOT something a production deploy should ever run.
 *
 * Populates a believable dataset so the currency + FX exchange features can
 * be demonstrated (viva/demo) without waiting on real customer activity or a
 * live rate feed to accumulate hourly ticks over days:
 *
 *   1. (RETIRED — no longer seeds rates.) It used to add ~90 days of
 *      synthetic currency_rate_history bridging the gap after the real 1973-2017
 *      H.10 backfill (scripts/backfillCurrencyHistory.js) and whatever the
 *      live feed (rateFeed.service.js) has collected so far — so a rate
 *      chart looks continuous in a demo even on a box with no internet
 *      access or one started minutes ago.
 *   2. One FX exchange request per *reachable* status in the state machine
 *      (ARCHITECTURE.md §9.6) — pending_review,
 *      ready_for_settlement, settled, rejected, cancelled, expired — each
 *      with a plausible fx_request_events audit trail and notifications.
 *      Deliberately does NOT seed an 'approved'-status row: that enum value
 *      is reserved but never set by any real code path (§12.2), and
 *      fabricating one here would misrepresent the app's actual behavior —
 *      exactly the kind of dishonesty this phase exists to avoid.
 *   3. A handful of currency_anomaly_log entries so the staff/admin anomaly
 *      log isn't empty.
 *   4. Two demo accounts (customer + staff) to own/review the above, only
 *      created if they don't already exist.
 *
 * Idempotent — safe to re-run. Every insert either uses INSERT IGNORE
 * against a real unique key, or checks for an existing row first.
 *
 * Usage:
 *   node scripts/seedDemoData.js
 *
 * Requires the schema to already exist (`npm run migrate` first).
 */

const path = require("path");
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const TRAINED_CURRENCIES = ["LKR", "INR", "EUR", "GBP", "JPY"];

// Approximate recent USD-per-unit anchors (H.10/model convention — see
// crossRate.service.js), loosely back-derived from the live board pull
// recorded in ARCHITECTURE.md §8.1 (USD 336.05 / EUR 382.41 / GBP 447.67
// / JPY 2.05 / INR 3.48 LKR-per-unit). Illustrative for a demo chart, not a
// claim of real-time accuracy.
const RATE_ANCHORS_USD_PER_UNIT = {
  LKR: 336.05,
  INR: 96.6,
  EUR: 0.879,
  GBP: 0.751,
  JPY: 163.6,
};

// Board spreads mirror fx_rate_board_config's seeded defaults
// (007_currency_rate_feed.sql) — kept here only so demo quotes look
// consistent with what the admin Spreads tab actually shows, not re-read
// from the DB (a demo seed shouldn't depend on an admin not having edited
// the real config since migration time).
const BOARD_SPREADS_BPS = { USD: 100, EUR: 150, GBP: 150, JPY: 175, INR: 200 };
// LKR-per-unit mid rates for the tradable board currencies, consistent with
// RATE_ANCHORS_USD_PER_UNIT above (mid = LKR-per-USD / currency-per-USD).
const BOARD_MID_LKR_PER_UNIT = {
  USD: RATE_ANCHORS_USD_PER_UNIT.LKR,
  EUR: RATE_ANCHORS_USD_PER_UNIT.LKR / RATE_ANCHORS_USD_PER_UNIT.EUR,
  GBP: RATE_ANCHORS_USD_PER_UNIT.LKR / RATE_ANCHORS_USD_PER_UNIT.GBP,
  JPY: RATE_ANCHORS_USD_PER_UNIT.LKR / RATE_ANCHORS_USD_PER_UNIT.JPY,
  INR: RATE_ANCHORS_USD_PER_UNIT.LKR / RATE_ANCHORS_USD_PER_UNIT.INR,
};

function applySpread(midRate, bps) {
  return {
    buy_rate: midRate * (1 - bps / 10000),
    sell_rate: midRate * (1 + bps / 10000),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// Small deterministic pseudo-random walk (mulberry32) so re-runs generate
// the same values — cosmetic only, since idempotency itself comes from the
// unique key, not from value-stability.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ensureDemoUser(conn, { email, firstName, lastName, role }) {
  const [existing] = await conn.query("SELECT user_id FROM users WHERE email = ?", [email]);
  if (existing.length > 0) return existing[0].user_id;

  const hashedPassword = await bcrypt.hash("Demo@1234", 10);
  const [result] = await conn.query(
    `INSERT INTO users (first_name, last_name, email, password, role, status, email_verified)
     VALUES (?, ?, ?, ?, ?, 'active', 1)`,
    [firstName, lastName, email, hashedPassword, role]
  );
  const userId = result.insertId;

  if (role === "customer") {
    await conn.query(
      `INSERT INTO customer_profiles
         (user_id, date_of_birth, gender, address, employment_type, company_name, monthly_income, monthly_expense)
       VALUES (?, '1990-05-14', 'Female', 'Colombo 05, Sri Lanka', 'Permanent', 'Demo Exports (Pvt) Ltd', 185000, 95000)`,
      [userId]
    );
  }
  return userId;
}

// RETIRED by the v3 data refresh — deliberately kept as a no-op rather than
// deleted, so that anyone re-running `npm run seed:demo` gets the explanation
// instead of silently repopulating fake rates.
//
// This used to synthesise ~90 days of random-walk rates tagged
// source='demo-seed', to bridge the gap between the real H.10 history (which
// stopped at 2017-08-25) and today. `src/data_fetcher.py` now extends H.10 to
// 2026-07-24 and `scripts/backfillCurrencyHistory.js` loads that whole span,
// so currency_rate_history holds one continuous REAL series and the existing
// demo-seed rows have been deleted. Re-introducing them would put invented
// numbers back on a chart that finally shows only real ones — including the
// actual 2022 currency crisis (200.79 → 225.20 on 2022-03-08).
//
// If a fresh database ever needs this span filled, run the real backfill:
//   node scripts/backfillCurrencyHistory.js
async function seedRateHistory() {
  return 0;
}

async function seedAnomalyLog(conn, adminUserId) {
  const candidates = [
    { currency_code: "LKR", as_of_date: isoDate(daysAgo(3)), anomaly_score: 2.14, model_version: "v1" },
    { currency_code: "JPY", as_of_date: isoDate(daysAgo(7)), anomaly_score: 1.87, model_version: "v1" },
    { currency_code: "GBP", as_of_date: isoDate(daysAgo(15)), anomaly_score: 1.62, model_version: "v1" },
  ];
  let inserted = 0;
  for (const c of candidates) {
    const [existing] = await conn.query(
      `SELECT id FROM currency_anomaly_log
        WHERE currency_code = ? AND as_of_date = ? AND ABS(anomaly_score - ?) < 0.0001`,
      [c.currency_code, c.as_of_date, c.anomaly_score]
    );
    if (existing.length > 0) continue;
    await conn.query(
      `INSERT INTO currency_anomaly_log (currency_code, as_of_date, anomaly_score, model_version, detected_by)
       VALUES (?, ?, ?, ?, ?)`,
      [c.currency_code, c.as_of_date, c.anomaly_score, c.model_version, adminUserId]
    );
    inserted += 1;
  }
  return inserted;
}

/**
 * Insert one demo FX exchange request already sitting in `status`, plus a
 * plausible fx_request_events trail and notifications, all backdated via
 * explicit created_at/updated_at so it doesn't look like it just happened.
 * Skipped entirely (both the request and its events) if a row with this
 * quote_jti already exists — INSERT IGNORE against the real unique key.
 */
async function seedExchangeRequest(conn, opts) {
  const {
    quoteJti,
    status,
    direction,
    currencyCode,
    foreignAmount,
    purposeCode,
    branch,
    submittedDaysAgo,
    customerId,
    reviewerId,
    reviewNote = null,
    events, // [{ toStatus, note, daysAgo, actorUserId }] in chronological order after submission
  } = opts;

  const bps = BOARD_SPREADS_BPS[currencyCode];
  const mid = BOARD_MID_LKR_PER_UNIT[currencyCode];
  const { buy_rate, sell_rate } = applySpread(mid, bps);
  const quotedRate = direction === "buy" ? sell_rate : buy_rate;
  const quotedLkrAmount = round2(quotedRate * foreignAmount);

  const submittedAt = daysAgo(submittedDaysAgo);
  const quoteLockedAt = new Date(submittedAt.getTime() - 5 * 60 * 1000);
  const quoteExpiresAt = new Date(submittedAt.getTime() + 10 * 60 * 1000);
  const settlementDate = isoDate(daysAgo(Math.max(submittedDaysAgo - 7, 0)));
  const lastEvent = events[events.length - 1];
  const updatedAt = lastEvent ? daysAgo(lastEvent.daysAgo) : submittedAt;

  const [result] = await conn.query(
    `INSERT IGNORE INTO fx_exchange_requests
       (user_id, direction, currency_code, foreign_amount, quoted_rate, quoted_lkr_amount,
        spread_bps_applied, rate_source, quote_locked_at, quote_expires_at, quote_jti,
        purpose_code, branch, settlement_date, status, reviewed_by, review_note,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'demo-seed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customerId,
      direction,
      currencyCode,
      foreignAmount,
      quotedRate.toFixed(6),
      quotedLkrAmount,
      bps,
      quoteLockedAt,
      quoteExpiresAt,
      quoteJti,
      purposeCode,
      branch,
      settlementDate,
      status,
      status === "pending_review" ? null : reviewerId,
      reviewNote,
      submittedAt,
      updatedAt,
    ]
  );

  if (result.affectedRows === 0) {
    return { inserted: false };
  }

  const id = result.insertId;
  const referenceNo = `FX-${String(id).padStart(6, "0")}`;
  // Also re-sets updated_at explicitly: fx_exchange_requests.updated_at has
  // ON UPDATE CURRENT_TIMESTAMP, so this UPDATE would otherwise silently
  // bump it to "now" even though only reference_no changed, undoing the
  // backdated updatedAt passed in on INSERT above.
  await conn.query(`UPDATE fx_exchange_requests SET reference_no = ?, updated_at = ? WHERE id = ?`, [
    referenceNo,
    updatedAt,
    id,
  ]);

  await conn.query(
    `INSERT INTO fx_request_events (request_id, from_status, to_status, actor_user_id, note, created_at)
     VALUES (?, NULL, 'pending_review', ?, 'Submitted by customer.', ?)`,
    [id, customerId, submittedAt]
  );

  let fromStatus = "pending_review";
  for (const ev of events) {
    await conn.query(
      `INSERT INTO fx_request_events (request_id, from_status, to_status, actor_user_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, fromStatus, ev.toStatus, ev.actorUserId ?? null, ev.note ?? null, daysAgo(ev.daysAgo)]
    );
    fromStatus = ev.toStatus;
  }

  await conn.query(
    `INSERT INTO notifications (user_id, title, message, created_at)
     VALUES (?, ?, ?, ?)`,
    [
      customerId,
      "Currency exchange request update",
      `Your exchange request ${referenceNo} (${currencyCode} ${foreignAmount}) is now ${status.replace(/_/g, " ")}.`,
      updatedAt,
    ]
  );

  return { inserted: true, referenceNo };
}

async function seedExchangeRequests(conn, { customerId, staffId }) {
  const plans = [
    {
      quoteJti: "demo-seed-pending_review-0001",
      status: "pending_review",
      direction: "buy",
      currencyCode: "USD",
      foreignAmount: 500,
      purposeCode: "travel",
      branch: "Colombo Fort",
      submittedDaysAgo: 1,
      events: [],
    },
    {
      quoteJti: "demo-seed-ready_for_settlement-0001",
      status: "ready_for_settlement",
      direction: "sell",
      currencyCode: "EUR",
      foreignAmount: 300,
      purposeCode: "family_maintenance",
      branch: "Kandy",
      submittedDaysAgo: 4,
      reviewNote: null,
      events: [{ toStatus: "ready_for_settlement", note: "Approved.", daysAgo: 3, actorUserId: staffId }],
    },
    {
      quoteJti: "demo-seed-settled-0001",
      status: "settled",
      direction: "buy",
      currencyCode: "GBP",
      foreignAmount: 200,
      purposeCode: "education",
      branch: "Colombo Fort",
      submittedDaysAgo: 10,
      events: [
        { toStatus: "ready_for_settlement", note: "Approved.", daysAgo: 9, actorUserId: staffId },
        { toStatus: "settled", note: "Customer completed the exchange at the branch.", daysAgo: 7, actorUserId: staffId },
      ],
    },
    {
      quoteJti: "demo-seed-rejected-0001",
      status: "rejected",
      direction: "sell",
      currencyCode: "JPY",
      foreignAmount: 50000,
      purposeCode: "import_payment",
      branch: "Negombo",
      submittedDaysAgo: 6,
      reviewNote: "Purpose declaration does not match supporting documentation on file.",
      events: [
        {
          toStatus: "rejected",
          note: "Purpose declaration does not match supporting documentation on file.",
          daysAgo: 5,
          actorUserId: staffId,
        },
      ],
    },
    {
      quoteJti: "demo-seed-cancelled-0001",
      status: "cancelled",
      direction: "buy",
      currencyCode: "INR",
      foreignAmount: 10000,
      purposeCode: "medical",
      branch: "Jaffna",
      submittedDaysAgo: 5,
      events: [{ toStatus: "cancelled", note: "Cancelled by customer.", daysAgo: 5, actorUserId: customerId }],
    },
    {
      quoteJti: "demo-seed-expired-0001",
      status: "expired",
      direction: "sell",
      currencyCode: "USD",
      foreignAmount: 1000,
      purposeCode: "other",
      branch: "Colombo Fort",
      submittedDaysAgo: 12,
      events: [
        {
          toStatus: "expired",
          note: "Auto-expired: no staff action within the review SLA.",
          daysAgo: 9,
          actorUserId: null,
        },
      ],
    },
  ];

  const results = [];
  for (const plan of plans) {
    const { quoteJti, ...rest } = plan;
    // eslint-disable-next-line no-await-in-loop
    const r = await seedExchangeRequest(conn, { ...rest, quoteJti, customerId, reviewerId: staffId });
    results.push({ status: plan.status, ...r });
  }
  return results;
}

async function run() {
  for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"]) {
    if (!process.env[key]) throw new Error(`${key} is not set in .env`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const customerId = await ensureDemoUser(connection, {
      email: "demo.customer@aura.com",
      firstName: "Demo",
      lastName: "Customer",
      role: "customer",
    });
    const staffId = await ensureDemoUser(connection, {
      email: "demo.staff@aura.com",
      firstName: "Demo",
      lastName: "Staff",
      role: "staff",
    });

    const rateRowsInserted = await seedRateHistory(connection);
    const anomalyRowsInserted = await seedAnomalyLog(connection, staffId);
    const requestResults = await seedExchangeRequests(connection, { customerId, staffId });

    console.log("Demo seed complete.");
    console.log(`  Demo accounts: demo.customer@aura.com / demo.staff@aura.com (password: Demo@1234)`);
    console.log(`  currency_rate_history: skipped — real H.10 data covers 1973→today (see backfillCurrencyHistory.js)`);
    console.log(`  currency_anomaly_log: ${anomalyRowsInserted} new rows`);
    console.log(`  fx_exchange_requests:`);
    for (const r of requestResults) {
      console.log(
        `    ${r.status.padEnd(22)} ${r.inserted ? `inserted as ${r.referenceNo}` : "already present, skipped"}`
      );
    }
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error("Demo seed failed:", err.message);
  process.exit(1);
});

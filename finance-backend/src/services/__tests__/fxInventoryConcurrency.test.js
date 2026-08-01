"use strict";

/**
 * Concurrency proof for the reserve-on-approve gate
 * (fxInventoryModel.applyMovement's `requireAvailable` path, wired into
 * fxExchange.controller.js's reviewRequest). The property under test —
 * "two concurrent approvals racing for stock that can only satisfy one of
 * them never both succeed, and never both fail" — is a property of MySQL's
 * row locking under real concurrent transactions. It cannot be demonstrated
 * against a mock; that's why this is the one file in __tests__ that opens a
 * DB pool and needs ai_loan's schema plus at least one staff and one
 * customer user to run, unlike every pure-logic test alongside it.
 *
 * The race is run MANY times, not once: a single race passing proves
 * nothing rules out a check-then-act window that only shows up under real
 * scheduler timing some fraction of the time. See RACE_ITERATIONS.
 *
 * Each iteration resets to a TRUE zero baseline (no balances, no ledger
 * rows) with direct SQL, then seeds the opening balance through
 * fxInventoryModel.applyMovement like production would. Seeding via a raw
 * UPDATE instead would be quicker, but it would leave stock on hand that no
 * movement row accounts for — and the ledger-reconstruction check below,
 * the whole point of which is that SUM(deltas) equals the live balances,
 * would then be asserting against a ledger that was incomplete by
 * construction. The restock row is not noise; it is what makes that sum
 * mean anything.
 */

const assert = require("assert");
const fxExchangeController = require("../../controllers/fxExchange.controller");
const fxInventoryModel = require("../../models/fxInventoryModel");
const pool = require("../../config/db").promise();

const TEST_CURRENCY = "GBP";
const RACE_ITERATIONS = Number(process.env.FX_CONCURRENCY_ITERATIONS) || 30;
// Exactly enough stock for ONE of the two competing requests — the
// smallest seed that makes the race meaningful. Anything less would let
// both legitimately fail (not a bug); anything covering both would let
// both legitimately succeed (also not a bug, and not what's under test).
const SEED_AMOUNT = 1000;

function mkRes() {
  const res = {};
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

// quote_jti is VARCHAR(36) (it normally holds a UUID) — short and still
// unique per process+run so cleanup can find every row this file seeded.
const RUN_TAG = `cxt${process.pid.toString(36)}${Date.now().toString(36)}`;
let jtiSeq = 0;
/** Directly inserts one pending_review 'buy' request for TEST_CURRENCY — a
 * fixture, not a real submission flow (no quote token involved). */
async function seedRequest(customerId) {
  jtiSeq += 1;
  const jti = `${RUN_TAG}-${jtiSeq}`;
  const [result] = await pool.query(
    `INSERT INTO fx_exchange_requests
       (user_id, direction, currency_code, foreign_amount, quoted_rate, quoted_lkr_amount,
        spread_bps_applied, rate_source, quote_locked_at, quote_expires_at, quote_jti,
        purpose_code, requires_documents, branch, settlement_date, status)
     VALUES (?, 'buy', ?, ?, 300.0, ?, 100, 'test', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), ?,
             'travel', 0, 'Colombo', DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'pending_review')`,
    [customerId, TEST_CURRENCY, SEED_AMOUNT, SEED_AMOUNT * 300, jti]
  );
  const id = result.insertId;
  const referenceNo = `FX-${String(id).padStart(6, "0")}`;
  await pool.query(`UPDATE fx_exchange_requests SET reference_no = ? WHERE id = ?`, [referenceNo, id]);
  return { id, referenceNo };
}

/** One race: seed exactly enough stock for one winner, create two competing
 * requests, approve both concurrently, and record what actually happened. */
async function runOneRace(customerId, staffId) {
  // Reset to a true zero baseline: no balances AND no ledger rows, so the
  // two are consistent with each other before anything is seeded.
  await pool.query(`UPDATE fx_inventory SET on_hand_units = 0, reserved_units = 0 WHERE currency_code = ?`, [
    TEST_CURRENCY,
  ]);
  await pool.query(`DELETE FROM fx_inventory_movements WHERE currency_code = ?`, [TEST_CURRENCY]);

  // Seed the opening balance the way production does — through the single
  // writer, leaving a ledger row that accounts for every seeded unit.
  await fxInventoryModel.applyMovement({
    currencyCode: TEST_CURRENCY,
    reason: "restock",
    deltaOnHand: SEED_AMOUNT,
    note: "concurrency test seed",
  });

  const a = await seedRequest(customerId);
  const b = await seedRequest(customerId);

  const [resA, resB] = await Promise.all(
    [a, b].map((r) => {
      const res = mkRes();
      return fxExchangeController
        .reviewRequest(
          { params: { ref: r.referenceNo }, body: { action: "approve" }, user: { user_id: staffId, role: "staff" } },
          res
        )
        .then(() => res);
    })
  );

  const [invRows] = await pool.query(
    `SELECT on_hand_units, reserved_units FROM fx_inventory WHERE currency_code = ?`,
    [TEST_CURRENCY]
  );
  const [movementRows] = await pool.query(
    `SELECT movement_type, delta_units, delta_reserved_units FROM fx_inventory_movements WHERE currency_code = ?`,
    [TEST_CURRENCY]
  );
  const [statusRows] = await pool.query(
    `SELECT reference_no, status FROM fx_exchange_requests WHERE id IN (?, ?)`,
    [a.id, b.id]
  );

  const ledgerOnHandSum = movementRows.reduce((sum, m) => sum + Number(m.delta_units), 0);
  const ledgerReservedSum = movementRows.reduce((sum, m) => sum + Number(m.delta_reserved_units), 0);

  const outcome = {
    statusCodes: [resA.statusCode, resB.statusCode],
    onHand: Number(invRows[0].on_hand_units),
    reserved: Number(invRows[0].reserved_units),
    movementCount: movementRows.length,
    reserveRowCount: movementRows.filter((m) => m.movement_type === "reserve").length,
    ledgerOnHandSum,
    ledgerReservedSum,
    requestStatuses: statusRows.map((r) => r.status),
    conflictMessages: [resA, resB]
      .filter((r) => r.statusCode === 409)
      .map((r) => r.body?.message || ""),
  };

  // Clean up this iteration's fixture rows immediately — fx_request_events
  // cascades with the request (ON DELETE CASCADE, migration 008).
  await pool.query(`DELETE FROM fx_exchange_requests WHERE id IN (?, ?)`, [a.id, b.id]);

  return outcome;
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

(async () => {
  const [[customer], [staff]] = await Promise.all([
    pool.query(`SELECT user_id FROM users WHERE role = 'customer' LIMIT 1`).then(([r]) => r),
    pool.query(`SELECT user_id FROM users WHERE role = 'staff' LIMIT 1`).then(([r]) => r),
  ]);
  if (!customer || !staff) {
    console.error(
      "fxInventoryConcurrency.test: needs at least one 'customer' and one 'staff' user in the DB to run — skipping."
    );
    process.exit(0);
  }

  // Snapshot TEST_CURRENCY's real state so it can be restored exactly, not
  // just zeroed — this test must not assume it is the only thing that has
  // ever touched this currency's vault.
  const [[originalInventory]] = await pool.query(
    `SELECT on_hand_units, reserved_units FROM fx_inventory WHERE currency_code = ?`,
    [TEST_CURRENCY]
  );

  console.log(`fxInventoryModel reserve-on-approve — ${RACE_ITERATIONS} concurrent-approval races`);

  const iterationResults = [];
  let raceError = null;
  try {
    for (let i = 0; i < RACE_ITERATIONS; i++) {
      iterationResults.push(await runOneRace(customer.user_id, staff.user_id));
    }
  } catch (err) {
    raceError = err;
  }

  // Restore, regardless of pass/fail above — a broken assertion must not
  // leave the vault in a test-seeded state for whatever runs next.
  await pool.query(`UPDATE fx_inventory SET on_hand_units = ?, reserved_units = ? WHERE currency_code = ?`, [
    originalInventory.on_hand_units,
    originalInventory.reserved_units,
    TEST_CURRENCY,
  ]);
  await pool.query(`DELETE FROM fx_inventory_movements WHERE currency_code = ?`, [TEST_CURRENCY]);
  await pool.query(`DELETE FROM fx_exchange_requests WHERE quote_jti LIKE ?`, [`${RUN_TAG}-%`]);

  // Re-read after cleanup, so the "nothing left behind" check below is a
  // real query result, not an assumption that the DELETEs above succeeded.
  const [[restoredInventory]] = await pool.query(
    `SELECT on_hand_units, reserved_units FROM fx_inventory WHERE currency_code = ?`,
    [TEST_CURRENCY]
  );
  const [[leftoverMovements]] = await pool.query(
    `SELECT COUNT(*) AS n FROM fx_inventory_movements WHERE currency_code = ?`,
    [TEST_CURRENCY]
  );
  const [[leftoverRequests]] = await pool.query(`SELECT COUNT(*) AS n FROM fx_exchange_requests WHERE quote_jti LIKE ?`, [
    `${RUN_TAG}-%`,
  ]);

  if (raceError) {
    console.error("fxInventoryConcurrency.test: the race itself threw:", raceError);
    process.exit(1);
  }

  check(`every one of ${RACE_ITERATIONS} races produced exactly one 200 and one 409`, () => {
    iterationResults.forEach((r, i) => {
      const codes = [...r.statusCodes].sort();
      assert.deepStrictEqual(codes, [200, 409], `race ${i}: got statusCodes ${JSON.stringify(r.statusCodes)}`);
    });
  });

  check("NEVER two successes and NEVER two failures, in any race", () => {
    iterationResults.forEach((r, i) => {
      const successCount = r.statusCodes.filter((c) => c === 200).length;
      assert.strictEqual(successCount, 1, `race ${i}: ${successCount} successes among ${JSON.stringify(r.statusCodes)}`);
    });
  });

  check("reserved never exceeded on_hand — no oversell — in any race", () => {
    iterationResults.forEach((r, i) => {
      assert.ok(r.reserved <= r.onHand, `race ${i}: reserved ${r.reserved} > on_hand ${r.onHand}`);
    });
  });

  check(`reserved settled at exactly ${SEED_AMOUNT} (the one winner), on_hand unchanged, in every race`, () => {
    iterationResults.forEach((r, i) => {
      assert.strictEqual(r.reserved, SEED_AMOUNT, `race ${i}: reserved=${r.reserved}, expected ${SEED_AMOUNT}`);
      // A reservation moves reserved_units only — the notes haven't left
      // the vault yet, so on_hand must still read the seeded amount.
      assert.strictEqual(r.onHand, SEED_AMOUNT, `race ${i}: on_hand=${r.onHand}, expected unchanged at ${SEED_AMOUNT}`);
    });
  });

  check("exactly one 'reserve' ledger row was written per race — never zero, never two", () => {
    iterationResults.forEach((r, i) => {
      assert.strictEqual(r.reserveRowCount, 1, `race ${i}: ${r.reserveRowCount} 'reserve' rows written`);
      // One seeding restock + one winning reserve, and nothing else — a
      // rolled-back loser must leave no trace in the ledger at all.
      assert.strictEqual(r.movementCount, 2, `race ${i}: ${r.movementCount} total movement rows`);
    });
  });

  check("the ledger reconstructs on_hand/reserved EXACTLY, in every race", () => {
    iterationResults.forEach((r, i) => {
      assert.strictEqual(r.ledgerOnHandSum, r.onHand, `race ${i}: SUM(delta_units)=${r.ledgerOnHandSum} != on_hand_units=${r.onHand}`);
      assert.strictEqual(
        r.ledgerReservedSum,
        r.reserved,
        `race ${i}: SUM(delta_reserved_units)=${r.ledgerReservedSum} != reserved_units=${r.reserved}`
      );
    });
  });

  check("the winner reached ready_for_settlement and the loser stayed pending_review, in every race", () => {
    iterationResults.forEach((r, i) => {
      const statuses = [...r.requestStatuses].sort();
      assert.deepStrictEqual(
        statuses,
        ["pending_review", "ready_for_settlement"],
        `race ${i}: got ${JSON.stringify(r.requestStatuses)}`
      );
    });
  });

  check("the losing approval's 409 names the shortage, in every race", () => {
    iterationResults.forEach((r, i) => {
      assert.strictEqual(r.conflictMessages.length, 1, `race ${i}: expected exactly one 409 message`);
      assert.ok(
        /insufficient/i.test(r.conflictMessages[0]) && /short by/i.test(r.conflictMessages[0]),
        `race ${i}: 409 message did not describe the shortage: ${r.conflictMessages[0]}`
      );
    });
  });

  check(`all ${RACE_ITERATIONS} seeded requests were cleaned up — nothing left behind`, () => {
    assert.strictEqual(Number(leftoverRequests.n), 0, `${leftoverRequests.n} test requests still in the DB`);
  });

  check(`${TEST_CURRENCY}'s ledger and vault were fully cleaned up and restored`, () => {
    assert.strictEqual(Number(leftoverMovements.n), 0, `${leftoverMovements.n} movement rows still in the DB`);
    assert.strictEqual(
      Number(restoredInventory.on_hand_units),
      Number(originalInventory.on_hand_units),
      "on_hand_units was not restored to its pre-test value"
    );
    assert.strictEqual(
      Number(restoredInventory.reserved_units),
      Number(originalInventory.reserved_units),
      "reserved_units was not restored to its pre-test value"
    );
  });

  const failed = results.filter(([ok]) => !ok);
  for (const [ok, name] of results) console.log(`  ${ok ? "ok" : "NOT OK"} - ${name}`);
  console.log(`\n${results.length - failed.length} passed${failed.length ? `, ${failed.length} FAILED` : ""}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("fxInventoryConcurrency.test: unexpected error:", err);
  process.exit(1);
});

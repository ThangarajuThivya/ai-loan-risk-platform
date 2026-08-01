"use strict";

/**
 * Bank-wide FX currency inventory data-access layer (Task 2 of the FX
 * inventory feature). SQL for fx_inventory / fx_inventory_movements
 * (db/migrations/015_fx_inventory.sql, 016_fx_inventory_reserved.sql),
 * mirroring fxExchangeModel.js's shape (transaction-per-write-with-row-lock,
 * same as transitionStatus).
 *
 * There is exactly one vault per currency_code — no branch dimension (see
 * 015's header note). applyMovement is the ONLY function in this file that
 * writes on_hand_units/reserved_units; every other export is read-only. Do
 * not UPDATE fx_inventory anywhere else — the ledger in
 * fx_inventory_movements is only a true audit trail if every balance change
 * is guaranteed to have produced exactly one matching row, and that
 * guarantee only holds if there is a single writer.
 *
 * Reserve/settle business logic (when to call applyMovement, with what
 * deltas) is intentionally NOT here — later tasks own that. This file only
 * provides the transactional primitive.
 */

const db = require("../config/db");
const pool = db.promise();

const MOVEMENT_TYPES = [
  "restock",
  "settlement", // legacy, superseded by settle_out/settle_in — see migration 018
  "adjustment",
  "reserve",
  "settle_out",
  "settle_in",
  "release",
];

/**
 * Thrown by applyMovement when a guarded movement (see `requireAvailable`)
 * loses the race for stock. Carries status 409 so the controller can map it
 * straight to a Conflict response without knowing this module's internals —
 * the same `err.status` convention fxExchangeModel.upsertLimit already uses.
 */
class InsufficientInventoryError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "InsufficientInventoryError";
    this.status = 409;
    this.code = "FX_INVENTORY_INSUFFICIENT";
    this.details = details;
  }
}

/** Converts a raw fx_inventory row's DECIMAL strings to numbers. */
function toInventoryRow(row) {
  if (!row) return row;
  return {
    ...row,
    on_hand_units: Number(row.on_hand_units),
    reserved_units: Number(row.reserved_units),
    reorder_level_units:
      row.reorder_level_units == null ? null : Number(row.reorder_level_units),
  };
}

/** Converts a raw fx_inventory_movements row's DECIMAL strings to numbers. */
function toMovementRow(row) {
  if (!row) return row;
  return {
    ...row,
    delta_units: Number(row.delta_units),
    delta_reserved_units: Number(row.delta_reserved_units),
    balance_after: Number(row.balance_after),
    reserved_after: Number(row.reserved_after),
  };
}

/**
 * Every currency's current holdings, alphabetical.
 * @returns {Promise<object[]>}
 */
async function listInventory() {
  const [rows] = await pool.query(`SELECT * FROM fx_inventory ORDER BY currency_code`);
  return rows.map(toInventoryRow);
}

/**
 * One currency's current holdings.
 * @param {string} code
 * @returns {Promise<object|undefined>}
 */
async function findByCurrency(code) {
  const [rows] = await pool.query(`SELECT * FROM fx_inventory WHERE currency_code = ?`, [code]);
  return toInventoryRow(rows[0]);
}

/**
 * Paginated movement ledger, newest first.
 * @param {object} [opts]
 * @param {string} [opts.currency] filter to one currency
 * @param {number} [opts.limit] default 50
 * @param {number} [opts.offset] default 0
 * @returns {Promise<object[]>}
 */
async function listMovements({ currency, limit = 50, offset = 0 } = {}) {
  const params = [];
  let where = "1 = 1";
  if (currency) {
    where += " AND currency_code = ?";
    params.push(currency);
  }
  params.push(limit, offset);
  const [rows] = await pool.query(
    `SELECT * FROM fx_inventory_movements
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    params
  );
  return rows.map(toMovementRow);
}

/**
 * Apply one signed movement to a currency's balances and record it in the
 * ledger, as a single transaction. This is the ONLY function permitted to
 * write fx_inventory's balances — see this file's header.
 *
 * Two write strategies, chosen by whether `requireAvailable` is supplied:
 *
 *   UNGUARDED (admin restock / adjustment). Row-locks with SELECT ... FOR
 *   UPDATE, computes the new balances in application code, writes them. The
 *   lock — not the read — is what makes this safe; an admin setting an
 *   absolute opening balance needs to know the value it is replacing.
 *
 *   GUARDED (reserve-on-approve). Does NOT read first. The availability
 *   test and the write are ONE atomic statement whose WHERE clause carries
 *   the condition, so two concurrent approvals of the same currency cannot
 *   both observe the same free stock and both reserve it: the second blocks
 *   on the first's row lock and then re-evaluates the condition against the
 *   committed result (InnoDB locking reads are current reads, not snapshot
 *   reads). affectedRows === 0 therefore means "lost the race, or never had
 *   the stock", and raises InsufficientInventoryError. A read-then-write
 *   here would be a check-then-act race no lock ordering could fix.
 *
 * Either way the ledger's balance_after/reserved_after are read back inside
 * the same transaction, after our own exclusive lock is held, so they can
 * never describe a state some other writer moved out from under us.
 *
 * @param {object} p
 * @param {string} p.currencyCode
 * @param {number} [p.requestId] the request this movement belongs to ('settlement'/'reserve'); null for restock/adjustment
 * @param {string} p.reason movement_type: 'restock' | 'settlement' | 'adjustment' | 'reserve'
 * @param {number} [p.deltaOnHand] signed change to on_hand_units; default 0
 * @param {number} [p.deltaReserved] signed change to reserved_units; default 0
 * @param {number} [p.actorUserId] staff member who posted it; null if system-posted
 * @param {string} [p.note]
 * @param {number} [p.requireAvailable] when set, the movement only applies if
 *   (on_hand_units - reserved_units) >= this value, tested atomically as part
 *   of the write. Throws InsufficientInventoryError otherwise.
 * @param {import('mysql2/promise').PoolConnection} [p.conn] an existing
 *   transaction to participate in (e.g. fxExchangeModel.transitionStatus's
 *   connection). If omitted, this function opens, commits/rolls back, and
 *   releases its own connection. If provided, the CALLER owns commit /
 *   rollback / release — this function only queries on it.
 * @returns {Promise<object>} the resulting inventory row
 * @throws {InsufficientInventoryError} guarded path only, status 409
 */
async function applyMovement({
  currencyCode,
  requestId = null,
  reason,
  deltaOnHand = 0,
  deltaReserved = 0,
  actorUserId = null,
  note = null,
  requireAvailable = null,
  conn,
}) {
  if (!MOVEMENT_TYPES.includes(reason)) {
    throw new Error(
      `Invalid inventory movement reason '${reason}'. Expected one of: ${MOVEMENT_TYPES.join(", ")}`
    );
  }

  const ownsConnection = !conn;
  const connection = conn || (await pool.getConnection());
  try {
    if (ownsConnection) {
      await connection.beginTransaction();
    }

    let current;
    if (requireAvailable != null) {
      // One statement: test availability and apply the deltas together.
      const [result] = await connection.query(
        `UPDATE fx_inventory
            SET on_hand_units  = on_hand_units + ?,
                reserved_units = reserved_units + ?
          WHERE currency_code = ?
            AND (on_hand_units - reserved_units) >= ?`,
        [deltaOnHand, deltaReserved, currencyCode, requireAvailable]
      );
      if (result.affectedRows === 0) {
        // Only now — on the failure path, where there is nothing left to
        // race against — read the row, purely to describe the shortfall.
        const [rows] = await connection.query(
          `SELECT on_hand_units, reserved_units FROM fx_inventory WHERE currency_code = ?`,
          [currencyCode]
        );
        const row = rows[0];
        if (!row) {
          throw new InsufficientInventoryError(
            `No FX inventory vault is configured for ${currencyCode}.`,
            { currency_code: currencyCode, requested: Number(requireAvailable), available: null, shortfall: null }
          );
        }
        const available = Number(row.on_hand_units) - Number(row.reserved_units);
        const requested = Number(requireAvailable);
        throw new InsufficientInventoryError(
          `Insufficient ${currencyCode} inventory: ${requested.toLocaleString("en-LK")} ${currencyCode} required but only ` +
            `${available.toLocaleString("en-LK")} ${currencyCode} available — short by ` +
            `${(requested - available).toLocaleString("en-LK")} ${currencyCode}.`,
          {
            currency_code: currencyCode,
            requested,
            available,
            shortfall: Number((requested - available).toFixed(2)),
            on_hand: Number(row.on_hand_units),
            reserved: Number(row.reserved_units),
          }
        );
      }
      const [rows] = await connection.query(
        `SELECT * FROM fx_inventory WHERE currency_code = ?`,
        [currencyCode]
      );
      current = rows[0];
    } else {
      const [rows] = await connection.query(
        `SELECT * FROM fx_inventory WHERE currency_code = ? FOR UPDATE`,
        [currencyCode]
      );
      current = rows[0];
      if (!current) {
        throw new Error(`No fx_inventory row for currency '${currencyCode}'.`);
      }
      await connection.query(
        `UPDATE fx_inventory
            SET on_hand_units  = on_hand_units + ?,
                reserved_units = reserved_units + ?
          WHERE currency_code = ?`,
        [deltaOnHand, deltaReserved, currencyCode]
      );
    }

    // Post-write balances, read back under our own exclusive row lock.
    const newOnHand =
      requireAvailable != null
        ? Number(current.on_hand_units)
        : Number(current.on_hand_units) + Number(deltaOnHand);
    const newReserved =
      requireAvailable != null
        ? Number(current.reserved_units)
        : Number(current.reserved_units) + Number(deltaReserved);

    await connection.query(
      `INSERT INTO fx_inventory_movements
         (currency_code, movement_type, delta_units, delta_reserved_units,
          balance_after, reserved_after, request_id, created_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        currencyCode,
        reason,
        deltaOnHand,
        deltaReserved,
        newOnHand,
        newReserved,
        requestId,
        actorUserId,
        note,
      ]
    );

    if (ownsConnection) {
      await connection.commit();
    }

    return toInventoryRow({
      ...current,
      on_hand_units: newOnHand,
      reserved_units: newReserved,
    });
  } catch (err) {
    if (ownsConnection) {
      await connection.rollback();
    }
    throw err;
  } finally {
    if (ownsConnection) {
      connection.release();
    }
  }
}

/**
 * Release whatever stock is still reserved against one request, returning it
 * to available without moving on_hand_units — nothing physically left the
 * vault. The counterpart to the reserve-on-approve gate: every reservation
 * must exit either through a settlement (settle_out consumes it) or through
 * here, or the stock is leaked permanently. A leak has no error to trace,
 * it just makes `available` drift downward until approvals start failing
 * bank-wide, so this is written to be safe to call from ANY terminal
 * transition, including ones that never reserved anything.
 *
 * The amount is DERIVED from the ledger — the net delta_reserved_units still
 * outstanding for this request — rather than passed in by the caller. That
 * is what makes it idempotent and self-correcting:
 *
 *   * a request that never reserved (any 'sell', or a 'buy' rejected before
 *     approval) nets to 0, so this is a no-op and writes no ledger row;
 *   * a request already settled has had its reservation consumed by
 *     settle_out, so this nets to 0 too and cannot double-release;
 *   * calling it twice releases nothing the second time.
 *
 * Concurrency: takes the fx_inventory row lock BEFORE measuring what is
 * outstanding, and measures it with a locking read, so a second release for
 * the same currency blocks and then observes the first one's committed row
 * rather than a stale snapshot. Callers going through
 * fxExchangeModel.transitionStatus additionally hold the request's own row
 * lock, which serializes lifecycle operations per request.
 *
 * @param {object} p
 * @param {number} p.requestId the request whose reservation is being unwound
 * @param {string} p.currencyCode
 * @param {number} [p.actorUserId] staff member who caused it; null if system-posted
 * @param {string} [p.note]
 * @param {import('mysql2/promise').PoolConnection} [p.conn] an existing
 *   transaction to participate in. If omitted, this opens, commits/rolls
 *   back and releases its own; if provided, the CALLER owns those.
 * @returns {Promise<{released:number, inventory:object|null}>} `released` is
 *   0 when there was nothing outstanding, and `inventory` is null in that case
 */
async function releaseReservation({ requestId, currencyCode, actorUserId = null, note = null, conn }) {
  const ownsConnection = !conn;
  const connection = conn || (await pool.getConnection());
  try {
    if (ownsConnection) {
      await connection.beginTransaction();
    }

    // Lock first, measure second — the reverse order would let two releases
    // both read the same outstanding amount and drive reserved_units negative.
    await connection.query(`SELECT currency_code FROM fx_inventory WHERE currency_code = ? FOR UPDATE`, [
      currencyCode,
    ]);

    // FOR UPDATE makes this a current read rather than a snapshot read, so a
    // release committed by another transaction while we waited is visible.
    // Summed in JS over the (handful of) rows for one request instead of via
    // SQL SUM so the locking semantics are unambiguous.
    const [rows] = await connection.query(
      `SELECT delta_reserved_units FROM fx_inventory_movements WHERE request_id = ? FOR UPDATE`,
      [requestId]
    );
    const outstanding = rows.reduce((sum, r) => sum + Number(r.delta_reserved_units), 0);

    if (!(outstanding > 0)) {
      if (ownsConnection) {
        await connection.commit();
      }
      return { released: 0, inventory: null };
    }

    const inventory = await applyMovement({
      currencyCode,
      requestId,
      reason: "release",
      // Reserved falls; on_hand does not move — the notes are still here.
      deltaOnHand: 0,
      deltaReserved: -outstanding,
      actorUserId,
      note: note || "Reservation released — request closed without settling.",
      conn: connection,
    });

    if (ownsConnection) {
      await connection.commit();
    }
    return { released: outstanding, inventory };
  } catch (err) {
    if (ownsConnection) {
      await connection.rollback();
    }
    throw err;
  } finally {
    if (ownsConnection) {
      connection.release();
    }
  }
}

module.exports = {
  listInventory,
  findByCurrency,
  listMovements,
  applyMovement,
  releaseReservation,
  InsufficientInventoryError,
};

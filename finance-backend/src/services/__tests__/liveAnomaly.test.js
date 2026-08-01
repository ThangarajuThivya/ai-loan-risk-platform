"use strict";

/**
 * Runnable test script for the live-rate anomaly check (no test runner
 * needed, matching the other scripts in this folder):
 *   node src/services/__tests__/liveAnomaly.test.js
 * Exits non-zero on the first failed assertion.
 *
 * Unlike liveForecast.test.js, the logic here isn't pure arithmetic — the
 * risk is in the BRANCHING and in what gets written to the anomaly log, so
 * currencyModel and currencyClient are stubbed via the require cache before
 * the service is loaded. That keeps the test DB-free and network-free while
 * still exercising the real code path, including the two-plane tagging that
 * CURRENCY_FEATURE.md §10.2/§30 depends on.
 */

const assert = require("assert");

// --- stubs, installed before the service is required ----------------------
const modelPath = require.resolve("../../models/currencyModel");
const clientPath = require.resolve("../currencyClient.service");

const stubModel = {
  DATA_PLANE_MODEL_SERIES: "model-series",
  DATA_PLANE_LIVE_FEED: "live-feed",
  rows: [],
  logged: [],
  async findLiveRateHistory() {
    return stubModel.rows;
  },
  async logAnomaly(entry) {
    stubModel.logged.push(entry);
  },
};

const stubClient = {
  calls: [],
  result: null,
  async getAnomaly(currency, recentWindow) {
    stubClient.calls.push({ currency, recentWindow });
    return stubClient.result;
  },
};

const asModule = (filename, exports) => ({ id: filename, filename, loaded: true, exports });
require.cache[modelPath] = asModule(modelPath, stubModel);
require.cache[clientPath] = asModule(clientPath, stubClient);

const { MIN_POINTS_REQUIRED, getLiveAnomaly } = require("../liveAnomaly.service");

// --- helpers --------------------------------------------------------------
let passed = 0;
async function check(name, fn) {
  stubModel.rows = [];
  stubModel.logged = [];
  stubClient.calls = [];
  stubClient.result = null;
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** `n` consecutive daily rows from 2026-01-01, ascending. */
function makeRows(n, rate = 300) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    rows.push({ rate_date: d, mid_rate: rate + i * 0.1, source: "live-er-api" });
  }
  return rows;
}

(async () => {
  console.log("liveAnomaly.service");

  await check("MIN_POINTS_REQUIRED matches the model's ISOFOREST_MIN_WINDOW (21)", () => {
    assert.strictEqual(MIN_POINTS_REQUIRED, 21);
  });

  await check("below the minimum returns insufficient_data without calling the model", async () => {
    stubModel.rows = makeRows(2); // the real dev DB's current state
    const res = await getLiveAnomaly("LKR");
    assert.strictEqual(res.insufficient_data, true);
    assert.strictEqual(res.n_points_available, 2);
    assert.strictEqual(res.min_points_required, 21);
    assert.strictEqual(res.data_plane, "live-feed");
    assert.strictEqual(stubClient.calls.length, 0, "must not call the Python service");
    assert.strictEqual(stubModel.logged.length, 0, "must not log anything");
  });

  await check("exactly the minimum is enough", async () => {
    stubModel.rows = makeRows(21);
    stubClient.result = { is_anomalous: false, anomaly_score: -0.2, data_vintage: {} };
    const res = await getLiveAnomaly("LKR");
    assert.strictEqual(res.insufficient_data, false);
    assert.strictEqual(stubClient.calls.length, 1);
  });

  await check("sends the live mid rates, in order, as the scored window", async () => {
    stubModel.rows = makeRows(25, 300);
    stubClient.result = { is_anomalous: false, anomaly_score: 0, data_vintage: {} };
    await getLiveAnomaly("LKR");
    const { currency, recentWindow } = stubClient.calls[0];
    assert.strictEqual(currency, "LKR");
    assert.strictEqual(recentWindow.length, 25);
    assert.ok(recentWindow.every((v) => typeof v === "number"));
    assert.strictEqual(recentWindow[0], 300);
    assert.ok(recentWindow[24] > recentWindow[0], "window must stay ascending by date");
  });

  // Regression: Number(null) === 0, so a NULL mid_rate used to survive a
  // plain Number.isFinite() filter and enter the window as a zero rate,
  // handing the detector a ~-100% log return. Zero/negative rates are never
  // real observations for a currency pair.
  await check("null, undefined, zero and negative rates are dropped before scoring", async () => {
    stubModel.rows = makeRows(22).concat([
      { rate_date: "2026-02-01", mid_rate: null },
      { rate_date: "2026-02-02", mid_rate: undefined },
      { rate_date: "2026-02-03", mid_rate: 0 },
      { rate_date: "2026-02-04", mid_rate: -12.5 },
      { rate_date: "2026-02-05", mid_rate: "not-a-number" },
    ]);
    stubClient.result = { is_anomalous: false, anomaly_score: 0, data_vintage: {} };
    await getLiveAnomaly("LKR");
    const win = stubClient.calls[0].recentWindow;
    assert.strictEqual(win.length, 22);
    assert.ok(win.every((v) => Number.isFinite(v) && v > 0));
  });

  // MySQL returns DECIMAL columns as strings via mysql2 — the window must
  // still be numeric, not a list of strings the Python side would reject.
  await check("string DECIMAL values are coerced to numbers", async () => {
    stubModel.rows = makeRows(21).map((r) => ({ ...r, mid_rate: String(r.mid_rate) }));
    stubClient.result = { is_anomalous: false, anomaly_score: 0, data_vintage: {} };
    await getLiveAnomaly("LKR");
    assert.ok(stubClient.calls[0].recentWindow.every((v) => typeof v === "number"));
  });

  await check("a detection is logged onto the LIVE plane, never the model plane", async () => {
    stubModel.rows = makeRows(30);
    stubClient.result = {
      is_anomalous: true,
      anomaly_score: 0.87,
      data_vintage: { model_version: "v1" },
    };
    const res = await getLiveAnomaly("LKR", { detectedBy: 42 });

    assert.strictEqual(res.is_anomalous, true);
    assert.strictEqual(res.anomaly_score, 0.87);
    assert.strictEqual(stubModel.logged.length, 1);

    const entry = stubModel.logged[0];
    assert.strictEqual(entry.dataPlane, "live-feed", "§10.2: live detections must be tagged live");
    assert.notStrictEqual(entry.dataPlane, "model-series");
    assert.strictEqual(entry.code, "LKR");
    assert.strictEqual(entry.isAnomalous, true);
    assert.strictEqual(entry.detectedBy, 42);
    assert.strictEqual(entry.modelVersion, "v1");
    // as_of_date is the window's LAST live date, not today and not the
    // model's 2017 anchor.
    assert.strictEqual(entry.asOfDate, stubModel.rows[29].rate_date);
  });

  await check("basis reports the real live window, separate from model vintage", async () => {
    stubModel.rows = makeRows(30);
    stubClient.result = {
      is_anomalous: false,
      anomaly_score: -0.1,
      data_vintage: { training_data_end: "2017-08-25", model_version: "v1" },
    };
    const res = await getLiveAnomaly("LKR");

    assert.strictEqual(res.basis.n_points_used, 30);
    assert.strictEqual(res.basis.from_date, "2026-01-01");
    assert.strictEqual(res.basis.to_date, res.as_of_date);
    assert.strictEqual(res.basis.source_filter, "live-%");
    // The detector's own 2017 provenance travels in its OWN field — never
    // merged into the live basis above (§10.2).
    assert.strictEqual(res.model_data_vintage.training_data_end, "2017-08-25");
    assert.ok(/not a prediction/i.test(res.disclaimer));
  });

  await check("a non-detection still calls logAnomaly, which no-ops on isAnomalous=false", async () => {
    stubModel.rows = makeRows(30);
    stubClient.result = { is_anomalous: false, anomaly_score: -0.3, data_vintage: {} };
    await getLiveAnomaly("LKR");
    assert.strictEqual(stubModel.logged.length, 1);
    assert.strictEqual(stubModel.logged[0].isAnomalous, false);
    assert.strictEqual(stubModel.logged[0].dataPlane, "live-feed");
  });

  console.log(`\n${passed} passed`);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});

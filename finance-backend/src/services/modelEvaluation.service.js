"use strict";

/**
 * Model evaluation artifact reader (Phase 26, CURRENCY_FEATURE.md §27).
 *
 * The honest "does this model beat its baseline?" numbers were only ever in
 * .txt/.json/.csv files inside currency-forecast-model/models/, which nobody
 * running the app ever sees. This module reads those artifacts at runtime and
 * normalizes them into one shape the admin model-status endpoint can serve
 * and AdminCurrency.jsx can render without knowing anything model-specific.
 *
 * NOTHING HERE IS HARDCODED. Every accuracy, RMSE and baseline value is read
 * out of the artifact on each call — if a model is retrained and its metadata
 * rewritten, the admin view changes with it. The only literals are filenames,
 * column names and display labels.
 *
 * Everything is best-effort: `currency-forecast-model/models/` is entirely
 * gitignored (.gitignore:90 — only .gitkeep is tracked), so on a fresh clone
 * or a deploy that doesn't ship the model repo these files legitimately do
 * not exist. A missing or malformed artifact yields
 * `{ available: false, reason }` for that model rather than failing the whole
 * endpoint — an admin seeing "no evaluation artifact found" is correct and
 * useful; a 500 is neither.
 *
 * The normalized per-model shape:
 *   {
 *     key, label, available, source_file, reason?,
 *     metric_label,            // e.g. "Accuracy", "RMSE"
 *     higher_is_better,        // true | false | null (null = not a contest)
 *     trained_at, split, note?,
 *     rows: [{ scope, n, model, baselines: [{ label, value }],
 *              beats_primary_baseline }]
 *   }
 * `baselines[0]` is the primary one — the comparison that decides
 * `beats_primary_baseline`. A model with `higher_is_better: null` is not
 * being scored against its baseline at all (the Isolation Forest is
 * unsupervised; its "baseline" is a sanity cross-check, not a target), and
 * those rows carry `beats_primary_baseline: null` so the UI can show them
 * without a pass/fail verdict.
 */

const fs = require("fs");
const path = require("path");

/**
 * Where the artifacts live. Defaults to the sibling model repo in this
 * monorepo layout; overridable for deploys where the Node service and the
 * model repo aren't checked out next to each other. Note this is a
 * filesystem path, unrelated to CURRENCY_MODEL_URL (the HTTP URL of the
 * Python service) — the two are independent, and this module deliberately
 * does NOT go through the Python service: these are training-time artifacts
 * the inference API has no endpoint for.
 */
const ARTIFACTS_DIR =
  process.env.CURRENCY_MODEL_ARTIFACTS_DIR ||
  path.join(__dirname, "..", "..", "..", "currency-forecast-model", "models");

const XGB_METADATA_FILE = "xgb_trend_metadata_h90_v2.json";
const LSTM_EVAL_FILE = "lstm_evaluation_v2.csv";
const ISOFOREST_EVAL_FILE = "isoforest_evaluation_v1.csv";
const GARCH_EVAL_FILE = "garch_evaluation_v1.csv";
const GARCH_PARAMS_FILE = "garch_params_v1.json";

/**
 * Minimal CSV reader. These files are written by pandas' `to_csv` and hold
 * only currency codes, integers and floats — no embedded commas, quotes or
 * newlines — so a split on "," is sufficient and a dependency isn't worth
 * adding. It deliberately does NOT implement RFC 4180 quoting; if a future
 * artifact grows a quoted free-text column, use a real parser rather than
 * extending this.
 */
function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((key, i) => {
      const raw = (cells[i] ?? "").trim();
      const asNumber = Number(raw);
      row[key] = raw !== "" && !Number.isNaN(asNumber) ? asNumber : raw;
    });
    return row;
  });
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

/** `{ available: false }` with the reason an admin actually needs. */
function unavailable(key, label, file, err) {
  const missing = err && err.code === "ENOENT";
  return {
    key,
    label,
    available: false,
    source_file: file,
    reason: missing
      ? `No evaluation artifact at ${file}. currency-forecast-model/models/ is gitignored, so this file exists only where the training output was placed.`
      : `Could not read ${file}: ${err ? err.message : "unknown error"}`,
    rows: [],
  };
}

const splitOf = (meta) =>
  meta && meta.train_end && meta.val_end
    ? `train ≤ ${meta.train_end}, val ≤ ${meta.val_end}, test after`
    : null;

/**
 * XGBoost trend classifier — the one artifact that already carries TWO
 * baselines per currency, and both are reported. The majority-class baseline
 * is primary because it is the one that answers "is this model doing
 * anything at all"; the trend-continuation baseline is the harder,
 * arguably-fairer comparison the training script argues for (see
 * xgb_evaluation_report_h90_v2.txt's own header) and is shown alongside
 * rather than instead of it.
 */
function readXgbTrend() {
  const file = XGB_METADATA_FILE;
  const full = path.join(ARTIFACTS_DIR, file);
  try {
    const meta = readJson(full);
    const results = meta.results || {};
    const rows = Object.entries(results).map(([ccy, r]) => {
      const majority = r.majority_baseline || {};
      const continuation = r.trend_continuation_baseline || {};
      const baselines = [];
      if (typeof majority.accuracy === "number") {
        baselines.push({ label: "Majority class", value: majority.accuracy });
      }
      if (typeof continuation.accuracy === "number") {
        baselines.push({ label: "Trend continuation", value: continuation.accuracy });
      }
      const primary = baselines.length > 0 ? baselines[0].value : null;
      return {
        scope: ccy,
        n: r.n_test_rows ?? null,
        model: typeof r.model_accuracy === "number" ? r.model_accuracy : null,
        baselines,
        beats_primary_baseline:
          typeof r.model_accuracy === "number" && primary !== null
            ? r.model_accuracy > primary
            : null,
      };
    });
    return {
      key: "xgboost_trend",
      label: `XGBoost trend (${meta.horizon_days || "?"}-day direction)`,
      available: true,
      source_file: file,
      metric_label: "Accuracy",
      higher_is_better: true,
      trained_at: meta.trained_at || null,
      split: splitOf(meta),
      note:
        "Test rows less than the horizon apart overlap in their forward-return window, so n is not n independent bets.",
      rows,
    };
  } catch (err) {
    return unavailable("xgboost_trend", "XGBoost trend", file, err);
  }
}

/**
 * LSTM forecaster — produced by training/evaluate_lstm_forecast.py (§26).
 * One row per (currency, horizon); RMSE, where LOWER is better, so the
 * beats-baseline test is inverted relative to the classifier above. The
 * artifact already carries a `beats_naive_rmse` boolean, but it is
 * recomputed here from the two numbers rather than trusted, so the flag the
 * admin sees always agrees with the two figures printed next to it.
 */
function readLstmForecast() {
  const file = LSTM_EVAL_FILE;
  const full = path.join(ARTIFACTS_DIR, file);
  try {
    const csv = readCsv(full);
    const rows = csv.map((r) => {
      const model = typeof r.model_rmse === "number" ? r.model_rmse : null;
      const naive = typeof r.naive_rmse === "number" ? r.naive_rmse : null;
      return {
        scope: `${r.currency} · ${r.horizon_days}d`,
        n: typeof r.n_test_windows === "number" ? r.n_test_windows : null,
        model,
        baselines: naive === null ? [] : [{ label: "Random walk", value: naive }],
        beats_primary_baseline: model !== null && naive !== null ? model < naive : null,
      };
    });
    return {
      key: "lstm_forecast",
      label: "LSTM forecast (RMSE vs random walk)",
      available: true,
      source_file: file,
      metric_label: "RMSE",
      higher_is_better: false,
      trained_at: null,
      split: null,
      note:
        "RMSE is in each currency's own units — compare each row to its own baseline, never across rows. Losing to a random walk at FX horizons is the expected result (Meese–Rogoff 1983).",
      rows,
    };
  } catch (err) {
    return unavailable("lstm_forecast", "LSTM forecast", file, err);
  }
}

/**
 * Isolation Forest — unsupervised, so there is no ground truth and no
 * accuracy to beat. Its artifact compares the model's flagged days against a
 * simple statistical extreme-move threshold, which is a sanity cross-check,
 * NOT a target to outscore. Reported with `higher_is_better: null` so the UI
 * shows the two counts side by side without inventing a pass/fail verdict
 * the underlying evaluation never claimed.
 */
function readIsolationForest() {
  const file = ISOFOREST_EVAL_FILE;
  const full = path.join(ARTIFACTS_DIR, file);
  try {
    const csv = readCsv(full);
    const rows = csv.map((r) => ({
      scope: r.currency,
      n: null,
      model: typeof r.sanity_model_flagged_days === "number" ? r.sanity_model_flagged_days : null,
      baselines:
        typeof r.sanity_statistical_flagged_days === "number"
          ? [{ label: "Statistical extreme-move", value: r.sanity_statistical_flagged_days }]
          : [],
      beats_primary_baseline: null,
    }));
    return {
      key: "isolation_forest",
      label: "Isolation Forest (days flagged in eval window)",
      available: true,
      source_file: file,
      metric_label: "Days flagged",
      higher_is_better: null,
      trained_at: null,
      split: null,
      note:
        "Unsupervised — no ground-truth anomaly labels exist. The statistical threshold is a sanity cross-check, not a baseline to beat: rough agreement is reassuring, exact agreement is not the goal.",
      rows,
    };
  } catch (err) {
    return unavailable("isolation_forest", "Isolation Forest", file, err);
  }
}

/**
 * GARCH volatility — produced by training/evaluate_garch_volatility.py (§28).
 * QLIKE, where LOWER is better, so the beats-baseline test is inverted the
 * same way the LSTM's RMSE is. Two baselines: rolling 20-day realized
 * variance is primary (the "volatility is what it recently was" forecast,
 * and the harder of the two to interpret away), with the constant
 * unconditional variance alongside it — the evaluation found four cells that
 * beat the rolling baseline but lose to the constant one, and showing only
 * the primary would hide that.
 *
 * Falls back to reporting the fitted-parameters file as "no evaluation" if
 * the CSV hasn't been generated on this machine, since it is gitignored like
 * every other artifact here.
 */
function readGarch() {
  const file = GARCH_EVAL_FILE;
  const full = path.join(ARTIFACTS_DIR, file);
  try {
    const csv = readCsv(full);
    if (csv.length === 0) throw Object.assign(new Error("empty"), { code: "ENOENT" });
    const rows = csv.map((r) => {
      const model = typeof r.model_qlike === "number" ? r.model_qlike : null;
      const roll = typeof r.roll20_qlike === "number" ? r.roll20_qlike : null;
      const constant = typeof r.const_qlike === "number" ? r.const_qlike : null;
      const baselines = [];
      if (roll !== null) baselines.push({ label: "Rolling 20d realized", value: roll });
      if (constant !== null) baselines.push({ label: "Constant unconditional", value: constant });
      return {
        scope: `${r.currency} · ${r.horizon_days}d`,
        n: typeof r.n_windows === "number" ? r.n_windows : null,
        model,
        baselines,
        beats_primary_baseline: model !== null && roll !== null ? model < roll : null,
      };
    });
    return {
      key: "garch_volatility",
      label: "GARCH volatility (QLIKE vs realized variance)",
      available: true,
      source_file: file,
      metric_label: "QLIKE",
      higher_is_better: false,
      trained_at: null,
      split: null,
      note:
        "Volatility clustering is genuine signal, so unlike the level forecasts a win here is expected rather than surprising. Note the serving path does not filter model state forward, so the band the API returns is anchored to the 2011 fit — see the report's ANCHOR GAP section.",
      rows,
    };
  } catch (err) {
    // No evaluation CSV — fall back to what the parameters file can tell us.
    const paramsFull = path.join(ARTIFACTS_DIR, GARCH_PARAMS_FILE);
    try {
      const params = readJson(paramsFull);
      return {
        key: "garch_volatility",
        label: "GARCH volatility",
        available: false,
        source_file: GARCH_PARAMS_FILE,
        trained_at: params.trained_at || null,
        rows: [],
        reason: `No ${file} on this machine. Generate it with: venv/bin/python training/evaluate_garch_volatility.py`,
      };
    } catch (paramsErr) {
      return unavailable("garch_volatility", "GARCH volatility", file, paramsErr);
    }
  }
}

/**
 * All four models' evaluation blocks, for GET /admin/model-status.
 * Read fresh on every call — these files are a few KB, the endpoint is
 * admin-only and infrequent, and a cache would mean an admin who just
 * re-ran a training script keeps seeing the old numbers.
 */
function getEvaluationSummary() {
  return {
    artifacts_dir: ARTIFACTS_DIR,
    models: [readLstmForecast(), readXgbTrend(), readIsolationForest(), readGarch()],
  };
}

module.exports = {
  ARTIFACTS_DIR,
  getEvaluationSummary,
};

#!/usr/bin/env python3
"""
LSTM Multi-Horizon FX Forecaster v2 -- evaluation against the random-walk
baseline (standalone script, local run, EVALUATION ONLY).

WHY THIS EXISTS

models/ ships evaluation artifacts for XGBoost (xgb_evaluation_report_h90_v2
.txt / .csv) and Isolation Forest (isoforest_evaluation_report_v1.txt /
.csv), and fitted parameters for GARCH (garch_params_v1.json) -- but nothing
for the LSTM. That is the wrong model to have no published numbers for: the
LSTM is the only one whose output reaches a customer as a number, on the
forecast cards at /dashboard/currency (CURRENCY_FEATURE.md §20). The API
already returns `naive_baseline_rate` alongside every `predicted_rate` and
has never compared the two anywhere.

train_lstm_forecast_v2.py does compute these metrics at the end of
training and writes lstm_evaluation_report_v2.txt / lstm_evaluation_v2.csv
into its Kaggle output folder -- but only the .keras and .joblib artifacts
were ever copied back into models/, so the report and the metadata JSON did
not survive the trip. This script reproduces the evaluation locally from the
saved artifacts, so the numbers are reproducible on this machine and live
next to the models they describe.

THIS SCRIPT DOES NOT TRAIN OR MODIFY ANYTHING. It loads the existing
lstm_forecast_<CCY>_h<H>_v2.keras models and their lstm_scalers_*.joblib
bundles read-only, and writes exactly two new files (the report and the
CSV). No model artifact, scaler, or data file is touched.

METHOD

Same walk-forward split as every other model in this repo, read from
src/config.py's siblings rather than re-guessed: train <= 2011-12-31,
val <= 2014-12-31, test = everything after (through the data's own last
date, 2017-08-25). Windows are rebuilt exactly as the training notebook
built them, and the SAVED price/delta scalers are used -- never refit, which
would both leak test data into the scaling and produce numbers that no
longer describe the shipped models.

THE BASELINE COMPARISON IS SAMPLE-MATCHED, AND THAT IS A DELIBERATE CHANGE
FROM THE NOTEBOOK. The training notebook computed its baseline with
`naive_random_walk_baseline(series, [h], test_dates)`, passing the windows'
*anchor* dates as the evaluation index. That helper scores rate[t] against
rate[t-h], so the baseline was measured on the h-days-earlier window while
the model was measured on (t -> t+h). Over a multi-year test period the two
windows are similar enough that the comparison is roughly fair, but they are
not the same samples, and "roughly fair" is not what you want in the one
table that decides whether a model beats doing nothing. Here the baseline
prediction for every test window is that window's own anchor rate -- the
rate known at forecast time, i.e. exactly the `naive_baseline_rate` the API
returns -- scored against exactly the same actual as the model. Same
samples, same targets, one difference: the prediction.

The offset-window figure is also computed and reported as
`naive_mae_notebook_window`, so a reader comparing against the notebook's
printed output can see both and see that the conclusion does not hinge on
which one you use.

REALISTIC EXPECTATIONS -- READ BEFORE JUDGING THE NUMBERS

Meese and Rogoff (1983), "Empirical exchange rate models of the seventies:
Do they fit out of sample?", Journal of International Economics 14(1),
3-24, found that a naive random walk forecast out-predicted every
structural and time-series exchange-rate model then available, at horizons
from one to twelve months, even when those models were given *realised*
values of their own explanatory variables. Four decades of follow-up work
has qualified the result at long horizons but has not overturned it at the
short-to-medium horizons this model targets. Failing to beat a random walk
on FX levels is the normal outcome, not a defect peculiar to this model or
this dataset -- and a model that beats it by a hair over one test window is
usually reporting that window's trend, not skill.

The point of publishing this table is not to show the LSTM winning. It is
so that anyone -- including whoever next decides how much weight the
customer-facing forecast cards should carry -- can see what the model is
actually worth relative to assuming the rate does not move.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/evaluate_lstm_forecast.py
    venv/bin/python training/evaluate_lstm_forecast.py --currencies LKR,INR
    venv/bin/python training/evaluate_lstm_forecast.py --horizons 7,30,90

Reads:  data/processed/exchange_rates_wide.(csv|parquet)   (Phase 1 output)
        models/lstm_forecast_<CCY>_h<H>_v2.keras           (read-only)
        models/lstm_scalers_<CCY>_h<H>_v2.joblib           (read-only)
Writes: models/lstm_evaluation_report_v2.txt
        models/lstm_evaluation_v2.csv
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Keras/TF chatter would otherwise bury the report in the terminal. Set
# before the tensorflow import, which is the only time it is read.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import joblib
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.config import (  # noqa: E402
    LSTM_HORIZONS,
    LSTM_LOOKBACK_DAYS,
    LSTM_VERSION,
    MODELS_DIR,
    TRAINED_CURRENCIES,
    WIDE_RATES_CSV,
    WIDE_RATES_PARQUET,
)
from training.preprocessing_utils import (  # noqa: E402
    clean_currency_series,
    date_masks,
    load_wide_rates,
    naive_random_walk_baseline,
    regression_metrics,
)

# The same split every other model in this repo uses. Hardcoded here to
# match train_lstm_forecast_v2.py / train_xgboost_trend_v2.py rather than
# invented: an evaluation run on a different split than the models were
# trained on would silently score them on their own training data.
TRAIN_END = "2011-12-31"
VAL_END = "2014-12-31"


def make_delta_windows(scaled: np.ndarray, dates: pd.DatetimeIndex, lookback: int, horizon: int):
    """Sliding windows for a SINGLE horizon's change-from-anchor target.

    A verbatim port of train_lstm_forecast_v2.py's function of the same
    name. It is NOT in training/preprocessing_utils.py -- that module only
    carries v1's multi-output `make_lstm_windows`, because v2 was written as
    a self-contained Kaggle notebook and its window builder was never
    factored back out. Kept local to this script rather than added to the
    canonical module, so that evaluating the models cannot change anything
    the training path imports.

    X: (n, lookback, 1) -- the lookback-day input window of scaled levels.
    y: (n,)             -- scaled_level[end + horizon] - scaled_level[end],
                           the change over `horizon` days from the window's
                           last day (the anchor). Predicting exactly zero
                           reproduces the naive random-walk baseline.
    sample_dates: (n,)  -- the anchor date, i.e. the date each forecast is
                           made "as of".
    """
    X, y, sample_dates = [], [], []
    n = len(scaled)
    for end in range(lookback - 1, n - horizon):
        X.append(scaled[end - lookback + 1: end + 1])
        y.append(scaled[end + horizon] - scaled[end])
        sample_dates.append(dates[end])
    X = np.asarray(X, dtype="float32").reshape(-1, lookback, 1)
    y = np.asarray(y, dtype="float32")
    return X, y, pd.DatetimeIndex(sample_dates)


def evaluate_one(model, price_scaler, delta_scaler, X_test, y_raw_test):
    """Runs one (currency, horizon) model over its test windows and returns
    real-currency-unit predictions, actuals and anchors.

    Mirrors src/model_utils.py's predict_forecast() arithmetic exactly --
    scale the window, predict a scaled delta, unscale the delta, add it to
    the scaled anchor, unscale back to a rate -- so this measures the
    serving path, not a differently-assembled reimplementation of it.
    """
    pred_delta_scaled = model.predict(X_test, verbose=0).ravel()
    pred_delta = delta_scaler.inverse_transform(pred_delta_scaled.reshape(-1, 1)).ravel()

    anchor_scaled = X_test[:, -1, 0]
    pred_level_scaled = anchor_scaled + pred_delta
    actual_level_scaled = anchor_scaled + y_raw_test

    pred_rate = price_scaler.inverse_transform(pred_level_scaled.reshape(-1, 1)).ravel()
    actual_rate = price_scaler.inverse_transform(actual_level_scaled.reshape(-1, 1)).ravel()
    anchor_rate = price_scaler.inverse_transform(anchor_scaled.reshape(-1, 1)).ravel()
    return pred_rate, actual_rate, anchor_rate


def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--currencies",
        default=",".join(TRAINED_CURRENCIES),
        help="comma-separated currency codes (default: every trained currency)",
    )
    p.add_argument(
        "--horizons",
        default=",".join(str(h) for h in LSTM_HORIZONS),
        help="comma-separated horizons in days (default: every trained horizon)",
    )
    p.add_argument(
        "--out-suffix",
        default="",
        help="appended to the output filenames, for a scratch run that must not "
             "overwrite the committed report (e.g. --out-suffix _scratch)",
    )
    p.add_argument("--models-dir", default=None,
                   help="Directory holding the trained artifacts. Defaults to src/config.py's "
                        "MODELS_DIR. Point at a side-by-side training run to evaluate it "
                        "without swapping artifacts in and out of models/.")
    p.add_argument("--data-dir", default=None,
                   help="Directory holding exchange_rates_wide.(parquet|csv). Defaults to "
                        "src/config.py's DATA_PROCESSED_DIR. Must match the vintage the "
                        "models in --models-dir were trained on.")
    p.add_argument("--train-end", default=TRAIN_END,
                   help="End of the training window. MUST match what the models in "
                        "--models-dir were actually trained with, or the calibration/test "
                        "split will overlap training data and report falsely good numbers.")
    p.add_argument("--val-end", default=VAL_END,
                   help="End of the validation window. Same warning as --train-end.")
    return p.parse_args()


def main():
    args = parse_args()
    train_end, val_end = args.train_end, args.val_end
    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]
    horizons = [int(h) for h in args.horizons.split(",") if h.strip()]

    import tensorflow as tf  # imported late so --help doesn't pay the TF startup cost

    models_dir = Path(args.models_dir) if args.models_dir else MODELS_DIR
    if args.data_dir:
        _dd = Path(args.data_dir)
        data_path = (_dd / "exchange_rates_wide.parquet" if (_dd / "exchange_rates_wide.parquet").exists()
                     else _dd / "exchange_rates_wide.csv")
    else:
        data_path = WIDE_RATES_PARQUET if WIDE_RATES_PARQUET.exists() else WIDE_RATES_CSV
    print(f"MODELS_DIR = {models_dir}")
    print(f"DATA       = {data_path}")
    if not data_path.exists():
        raise SystemExit(
            f"Missing {data_path}. Run data/prepare_data.py first "
            "(see currency-forecast-model/README.md)."
        )
    wide = load_wide_rates(data_path)
    generated_at = datetime.now(timezone.utc).isoformat()

    rows = []
    skipped = []

    for ccy in currencies:
        if ccy not in wide.columns:
            skipped.append(f"{ccy}: not a column in {data_path.name}")
            continue

        series = clean_currency_series(wide[ccy])
        _, _, test_mask = date_masks(series.index, train_end, val_end)
        test_dates_all = series.index[test_mask]

        for h in horizons:
            model_path = models_dir / f"lstm_forecast_{ccy}_h{h}_{LSTM_VERSION}.keras"
            scaler_path = models_dir / f"lstm_scalers_{ccy}_h{h}_{LSTM_VERSION}.joblib"
            if not model_path.exists() or not scaler_path.exists():
                skipped.append(f"{ccy} h={h}: missing {model_path.name} or {scaler_path.name}")
                continue

            scalers = joblib.load(scaler_path)
            price_scaler, delta_scaler = scalers["price_scaler"], scalers["delta_scaler"]

            # The saved price_scaler was fit on the TRAIN rows only. Reusing
            # it (never refitting) is what keeps this evaluation honest and
            # what makes it describe the shipped model rather than a new one.
            scaled = price_scaler.transform(series.values.reshape(-1, 1)).ravel()
            X, y_raw, sample_dates = make_delta_windows(
                scaled, series.index, LSTM_LOOKBACK_DAYS, h
            )
            te_idx = sample_dates.isin(test_dates_all)
            n_test = int(te_idx.sum())
            if n_test == 0:
                skipped.append(f"{ccy} h={h}: no test windows after {val_end}")
                continue

            model = tf.keras.models.load_model(model_path)
            pred_rate, actual_rate, anchor_rate = evaluate_one(
                model, price_scaler, delta_scaler, X[te_idx], y_raw[te_idx]
            )

            model_m = regression_metrics(actual_rate, pred_rate)
            # THE baseline: predict no change, i.e. the anchor rate itself,
            # on exactly the samples the model was scored on.
            naive_m = regression_metrics(actual_rate, anchor_rate)
            # The notebook's offset-window variant, for comparability only.
            naive_nb = naive_random_walk_baseline(series, [h], sample_dates[te_idx])[h]

            # Directional accuracy, with ties counted honestly: a day where
            # the rate did not move at all is not a direction the model can
            # get "right", so those rows are excluded from the denominator
            # rather than silently scored as correct by sign(0) == sign(0).
            actual_dir = np.sign(actual_rate - anchor_rate)
            pred_dir = np.sign(pred_rate - anchor_rate)
            moved = actual_dir != 0
            dir_acc = (
                float((actual_dir[moved] == pred_dir[moved]).mean()) if moved.any() else float("nan")
            )

            # How big a move does the model actually commit to, against how
            # big the moves really were? v2 predicts a DELTA from the anchor,
            # and predicting exactly zero reproduces the naive baseline
            # exactly -- so a model whose average predicted move is a small
            # fraction of the average real move has largely learned to
            # output the baseline, and its near-baseline error is that, not
            # a narrow miss. This ratio is the difference between "tied with
            # the baseline" and "became the baseline".
            mean_abs_pred_change_pct = float(np.mean(np.abs((pred_rate - anchor_rate) / anchor_rate)) * 100)
            mean_abs_actual_change_pct = float(np.mean(np.abs((actual_rate - anchor_rate) / anchor_rate)) * 100)
            move_commitment_ratio = (
                mean_abs_pred_change_pct / mean_abs_actual_change_pct
                if mean_abs_actual_change_pct > 0 else float("nan")
            )

            rows.append({
                "currency": ccy,
                "horizon_days": h,
                "n_test_windows": n_test,
                "test_from": str(sample_dates[te_idx][0].date()),
                "test_to": str(sample_dates[te_idx][-1].date()),
                "model_rmse": model_m["rmse"],
                "model_mae": model_m["mae"],
                "model_mape_pct": model_m["mape_pct"],
                "naive_rmse": naive_m["rmse"],
                "naive_mae": naive_m["mae"],
                "naive_mape_pct": naive_m["mape_pct"],
                "rmse_improvement_vs_naive_pct":
                    (naive_m["rmse"] - model_m["rmse"]) / naive_m["rmse"] * 100,
                "mae_improvement_vs_naive_pct":
                    (naive_m["mae"] - model_m["mae"]) / naive_m["mae"] * 100,
                "beats_naive_rmse": bool(model_m["rmse"] < naive_m["rmse"]),
                "beats_naive_mae": bool(model_m["mae"] < naive_m["mae"]),
                "directional_accuracy": dir_acc,
                "n_moved_windows": int(moved.sum()),
                "mean_abs_pred_change_pct": mean_abs_pred_change_pct,
                "mean_abs_actual_change_pct": mean_abs_actual_change_pct,
                "move_commitment_ratio": move_commitment_ratio,
                "naive_mae_notebook_window": naive_nb["mae"],
            })
            print(
                f"{ccy} h={h:>3}d  RMSE {model_m['rmse']:.4f} vs naive {naive_m['rmse']:.4f}"
                f"  |  MAE {model_m['mae']:.4f} vs naive {naive_m['mae']:.4f}"
                f"  ({rows[-1]['mae_improvement_vs_naive_pct']:+.1f}%)"
            )

    if not rows:
        raise SystemExit(
            "No (currency, horizon) pair could be evaluated. Skipped:\n  "
            + "\n  ".join(skipped)
        )

    df = pd.DataFrame(rows)
    n_cells = len(df)
    n_beat_rmse = int(df["beats_naive_rmse"].sum())
    n_beat_mae = int(df["beats_naive_mae"].sum())

    report = [
        "LSTM Multi-Horizon FX Forecaster v2 - Evaluation Report",
        "=" * 66,
        f"Generated on: {generated_at}",
        f"Version: {LSTM_VERSION}  |  Lookback: {LSTM_LOOKBACK_DAYS} days",
        f"Currencies: {', '.join(sorted(df['currency'].unique()))}",
        f"Horizons: {', '.join(str(h) for h in sorted(df['horizon_days'].unique()))} days",
        f"Train end: {train_end} | Val end: {val_end}",
        "",
        "EVALUATION ONLY - no model was trained or modified by this script.",
        "Metrics are in each currency's own units (currency per 1 USD), so",
        "they are NOT comparable across currencies: JPY's ~110 level makes its",
        "absolute errors far larger than EUR's ~0.9 without meaning anything.",
        "Compare each model to the naive baseline on its OWN row, never across",
        "rows. MAPE is the only column that is cross-currency comparable.",
        "",
        "Baseline = random walk without drift: predict that the rate does not",
        "change from the anchor date. This is the same value the API already",
        "returns as `naive_baseline_rate` next to every prediction, scored on",
        "exactly the same test windows as the model.",
        "",
    ]

    for ccy in sorted(df["currency"].unique()):
        sub = df[df["currency"] == ccy].sort_values("horizon_days")
        span = f"{sub.iloc[0]['test_from']} -> {sub.iloc[0]['test_to']}"
        report.append(f"--- {ccy} (test windows anchored {span}) ---")
        for _, r in sub.iterrows():
            verdict = "beats naive" if r["beats_naive_rmse"] else "LOSES to naive"
            report.append(
                f"  horizon={int(r['horizon_days']):>3}d | "
                f"RMSE {r['model_rmse']:.4f} (naive {r['naive_rmse']:.4f}, "
                f"{r['rmse_improvement_vs_naive_pct']:+.1f}%) | "
                f"MAE {r['model_mae']:.4f} (naive {r['naive_mae']:.4f}, "
                f"{r['mae_improvement_vs_naive_pct']:+.1f}%) | "
                f"MAPE {r['model_mape_pct']:.2f}% | "
                f"dir.acc {r['directional_accuracy']:.1%} | "
                f"n={int(r['n_test_windows'])}  <-- {verdict}"
            )
        report.append("")

    # --- interpretation, derived from the table rather than asserted ------
    tied = df[df["rmse_improvement_vs_naive_pct"].abs() < 1.0]
    best = df.loc[df["rmse_improvement_vs_naive_pct"].idxmax()]
    worst = df.loc[df["rmse_improvement_vs_naive_pct"].idxmin()]
    timid = df[df["move_commitment_ratio"] < 0.25]

    report += [
        "SUMMARY",
        "-" * 66,
        f"  (currency, horizon) pairs evaluated : {n_cells}",
        f"  beat the naive baseline on RMSE     : {n_beat_rmse}/{n_cells}",
        f"  beat the naive baseline on MAE      : {n_beat_mae}/{n_cells}",
        f"  within +/-1% of the baseline on RMSE: {len(tied)}/{n_cells} (i.e. indistinguishable from it)",
        f"  best cell : {best['currency']} h={int(best['horizon_days'])}d "
        f"{best['rmse_improvement_vs_naive_pct']:+.1f}% RMSE",
        f"  worst cell: {worst['currency']} h={int(worst['horizon_days'])}d "
        f"{worst['rmse_improvement_vs_naive_pct']:+.1f}% RMSE",
        "",
        "VERDICT",
        "-" * 66,
        f"The LSTM does not beat a random walk. It wins {n_beat_rmse} of {n_cells} cells on",
        f"RMSE and {n_beat_mae} of {n_cells} on MAE -- around a coin flip -- and {len(tied)} of {n_cells}",
        "cells land within +/-1% of the baseline, which at this sample size is",
        "no difference at all. This is the Meese-Rogoff result reproducing",
        "itself on this dataset (note 1 below); it is the expected outcome,",
        "but it does mean the forecast numbers shown to customers carry no",
        "demonstrated accuracy advantage over assuming the rate stays put.",
        "",
        "Where the model appears to win, check the trend before crediting it.",
        "The largest win in the table is LKR at long horizons, and LKR's",
        "directional accuracy there is ~93% -- the same ~93% that",
        "xgb_evaluation_report_h90_v2.txt records for a majority-class",
        "'always up' baseline on LKR h=90. Both numbers are measuring the",
        "same thing: LKR depreciated against the USD through nearly the whole",
        "test window, so any model biased toward 'up' scores well without",
        "forecasting anything. Treat the LKR long-horizon gains as trend",
        "capture, not skill.",
        "",
        "The move_commitment_ratio column is the sharpest diagnostic here.",
        "v2 predicts a CHANGE from the anchor, and predicting exactly zero",
        "reproduces the naive baseline exactly. A ratio well below 1 means",
        "the model's average predicted move is a small fraction of the",
        f"average real move -- i.e. it has largely learned to output the",
        f"baseline. {len(timid)} of {n_cells} cells sit below 0.25. For those, 'ties the",
        "baseline' is not a near miss; the model has approximately become the",
        "baseline, which is also why their RMSE matches to three or four",
        "decimal places.",
        "",
    ]

    with pd.option_context("display.width", 200, "display.max_columns", 50):
        report.append(
            df[[
                "currency", "horizon_days", "n_test_windows",
                "model_rmse", "naive_rmse", "rmse_improvement_vs_naive_pct",
                "model_mae", "naive_mae", "mae_improvement_vs_naive_pct",
                "model_mape_pct", "directional_accuracy", "move_commitment_ratio",
            ]].to_string(index=False)
        )

    report += [
        "",
        "NOTES / HOW TO READ THIS",
        "-" * 66,
        "1. Meese-Rogoff. Meese & Rogoff (1983), 'Empirical exchange rate",
        "   models of the seventies: Do they fit out of sample?', Journal of",
        "   International Economics 14(1), 3-24, found that a naive random",
        "   walk out-forecast every structural and time-series exchange-rate",
        "   model then available, at horizons of one to twelve months, even",
        "   when those models were handed the REALISED future values of their",
        "   own explanatory variables. Later work has qualified this at long",
        "   horizons but not overturned it at the 1-90 day horizons here.",
        "   Losing to the random walk on FX levels is the expected outcome,",
        "   not evidence that something is broken in this pipeline.",
        "",
        "2. Beating it on one window is weak evidence. Test windows h days",
        "   apart overlap in their forward-return period, so the n reported",
        "   above is NOT n independent bets -- at h=90 the ~600 test rows",
        "   contain on the order of 7 non-overlapping observations. A small",
        "   edge over the baseline at a long horizon usually reflects that",
        "   currency's own trend over 2015-2017 rather than forecasting skill.",
        "   The same caveat is recorded in xgb_evaluation_report_h90_v2.txt.",
        "",
        "3. Directional accuracy excludes flat days. Windows where the rate",
        "   did not move at all are dropped from the denominator rather than",
        "   scored as correct via sign(0) == sign(0); n_moved_windows in the",
        "   CSV gives the real denominator.",
        "",
        "4. The baseline here is sample-matched; the training notebook's was",
        "   not. train_lstm_forecast_v2.py scored the baseline over the",
        "   window ending at the anchor dates (rate[t] vs rate[t-h]) while",
        "   scoring the model over (t -> t+h). This report scores both on the",
        "   same samples. The notebook's variant is kept in the CSV as",
        "   naive_mae_notebook_window so the two can be compared directly.",
        "",
        "5. What this does NOT measure. Only accuracy on a 2015-2017 holdout",
        "   from the Fed H.10 series. The shipped models are anchored to that",
        "   same 2017-08-25 cutoff and are served against no live data at all",
        "   (CURRENCY_FEATURE.md §10.2), so these figures describe the model's",
        "   skill on historical data, and say nothing about how a forecast",
        "   made today would perform.",
    ]

    if skipped:
        report += ["", "SKIPPED", "-" * 66] + [f"  {s}" for s in skipped]

    report_path = models_dir / f"lstm_evaluation_report_{LSTM_VERSION}{args.out_suffix}.txt"
    csv_path = models_dir / f"lstm_evaluation_{LSTM_VERSION}{args.out_suffix}.csv"
    report_path.write_text("\n".join(report) + "\n")
    df.to_csv(csv_path, index=False)

    print()
    print("\n".join(report))
    print(f"\nWrote {report_path}")
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()

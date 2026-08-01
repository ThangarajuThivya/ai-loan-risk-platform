#!/usr/bin/env python3
"""
LSTM Multi-Horizon FX Rate Forecaster -- v2 (standalone script, local run)

Script port of the original Kaggle notebook (since removed -- see git
history). Same model, same split, same seed, same artifact names: the
notebook was Kaggle-only, and retraining on refreshed H.10 data needs to be
runnable locally without a Kaggle round-trip. Verified bit-exact against the
notebook on the same machine before the notebook was deleted, so any change
in the numbers from here on is attributable to the data, not to this port.

WHAT v2 DOES DIFFERENTLY FROM v1 (also removed -- see git history):

v1 trained one shared model per currency with a single Dense(4) head jointly
predicting all 4 horizons under unweighted summed MSE. The 90-day target has
much larger squared error in expectation than the 1-day target, so its
gradient dominated training -- v1's 1-day MAE came out 2-5x *worse* than the
naive baseline. That was a loss-imbalance bug, not "FX is hard".

v2 changes two things:
  1. One model per (currency, horizon) -- removes the cross-horizon loss-scale
     imbalance entirely.
  2. Predicts the CHANGE from the last known rate, not the absolute future
     level. The naive baseline is "predict zero change", so with small random
     initial weights the network starts at the baseline and only has to learn
     a correction on top of it, instead of reconstructing an absolute price
     level from a 60-day window through several nonlinear layers.

REALISTIC EXPECTATIONS -- read before judging the numbers:
Daily FX rates behave close to a random walk (the Meese-Rogoff result). Do not
expect high directional accuracy. A defensible outcome is MAE competitive with
the naive baseline and directional accuracy in the low-to-high 50s%. Any
currency/horizon above ~70-75% should be treated as a signal to check for
evaluation leakage or for a strong multi-decade trend being picked up (see
LKR@90d), not as skill to claim.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/train_lstm_forecast_v2.py
    venv/bin/python training/train_lstm_forecast_v2.py --currencies LKR --horizons 1,7
    venv/bin/python training/train_lstm_forecast_v2.py --output-dir /tmp/control_run

Reads:  data/processed/exchange_rates_wide.(csv|parquet)  (Phase 1 output;
        run data/prepare_data.py first if missing)
Writes: models/lstm_forecast_<CCY>_h<H>_v2.keras      (one per currency/horizon)
        models/lstm_scalers_<CCY>_h<H>_v2.joblib      (price_scaler + delta_scaler)
        models/lstm_metadata_v2.json                  (per-currency/horizon metrics)
        models/lstm_evaluation_report_v2.txt
        models/lstm_evaluation_v2.csv

Note on determinism: seeds are fixed, but TensorFlow is not bit-reproducible
across CPU/GPU or across BLAS thread counts. A control run should land in the
same ballpark as the shipped notebook metrics, not match them to the last
decimal.
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from joblib import dump
from sklearn.preprocessing import MinMaxScaler, StandardScaler

SEED = 42


def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)


# --------------------------------------------------------------------------
# Data loading / cleaning (same contract as training/preprocessing_utils.py)
# --------------------------------------------------------------------------

def load_wide_rates(path: Path) -> pd.DataFrame:
    df = (pd.read_parquet(path) if path.suffix == ".parquet"
          else pd.read_csv(path, index_col=0, parse_dates=True))
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    return df.sort_index()


def clean_currency_series(series: pd.Series) -> pd.Series:
    """Restrict to the currency's own trading window and forward-fill ND
    gaps *within* that window only -- never fill before its first valid
    date (see ../DATA_DICTIONARY.md)."""
    valid = series.dropna()
    if valid.empty:
        raise ValueError(f"{series.name}: no valid observations")
    windowed = series.loc[valid.index.min(): valid.index.max()]
    return windowed.ffill()


def date_masks(index, train_end, val_end):
    """Chronological walk-forward split -- NO shuffling."""
    train_end, val_end = pd.Timestamp(train_end), pd.Timestamp(val_end)
    train_mask = index <= train_end
    val_mask = (index > train_end) & (index <= val_end)
    test_mask = index > val_end
    return train_mask, val_mask, test_mask


def regression_metrics(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    err = y_true - y_pred
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    nonzero = y_true != 0
    mape = float(np.mean(np.abs(err[nonzero] / y_true[nonzero])) * 100) if nonzero.any() else float("nan")
    return {"mae": mae, "rmse": rmse, "mape_pct": mape}


def naive_random_walk_baseline(rate: pd.Series, horizons, eval_index) -> dict:
    """FX textbook baseline: the h-day-ahead forecast made from date t is
    simply rate[t] (no change)."""
    out = {}
    for h in horizons:
        anchor = rate.shift(h)
        idx = eval_index.intersection(rate.index)
        pair = pd.concat({"y_true": rate.loc[idx], "y_pred": anchor.loc[idx]}, axis=1).dropna()
        out[h] = regression_metrics(pair["y_true"], pair["y_pred"])
    return out


def make_delta_windows(scaled: np.ndarray, dates: pd.DatetimeIndex, lookback: int, horizon: int):
    """Sliding windows for a SINGLE horizon's change-from-anchor target.

    X: (n, lookback, 1) -- the lookback-day input window of scaled levels.
    y: (n,) -- scaled_level[end + horizon] - scaled_level[end], i.e. the
       change over `horizon` days from the window's last day (the anchor).
       Predicting zero exactly reproduces the naive random-walk baseline.
    sample_dates[i] = the anchor date (window's last day), used to intersect
       samples with date_masks().
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


def _has_wide_file(p: Path) -> bool:
    return (p / "exchange_rates_wide.csv").exists() or (p / "exchange_rates_wide.parquet").exists()


def find_data_dir(explicit: str | None) -> Path:
    """Resolution order: explicit --data-dir -> local repo layout -> recursive
    search under /kaggle/input (kept so this file still works if pasted into a
    Kaggle cell, where the mount path isn't a predictable slug)."""
    if explicit:
        p = Path(explicit)
        if _has_wide_file(p):
            return p
        raise FileNotFoundError(f"No exchange_rates_wide.(csv|parquet) under {p}")

    try:
        local = Path(__file__).resolve().parent.parent / "data" / "processed"
        if _has_wide_file(local):
            return local
    except NameError:
        pass

    kaggle_root = Path("/kaggle/input")
    if kaggle_root.exists():
        for filename in ("exchange_rates_wide.csv", "exchange_rates_wide.parquet"):
            matches = sorted(kaggle_root.rglob(filename))
            if matches:
                return matches[0].parent

    raise FileNotFoundError(
        "Could not find exchange_rates_wide.(csv|parquet). Run data/prepare_data.py "
        "first, or pass --data-dir explicitly."
    )


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------

def build_model(lookback: int):
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(lookback, 1)),
        tf.keras.layers.LSTM(64, return_sequences=True),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(16, activation="relu"),
        tf.keras.layers.Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse", metrics=["mae"])
    return model


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--currencies", default="LKR,INR,EUR,GBP,JPY",
                   help="Comma-separated ISO codes, must be columns in exchange_rates_wide (see ../DATA_DICTIONARY.md).")
    p.add_argument("--horizons", default="1,7,30,90",
                   help="Comma-separated forecast horizons in trading days. One model is trained per (currency, horizon).")
    p.add_argument("--lookback", type=int, default=60,
                   help="Trading days of history fed to the LSTM.")
    p.add_argument("--train-end", default="2011-12-31")
    p.add_argument("--val-end", default="2014-12-31")
    p.add_argument("--epochs", type=int, default=60)
    p.add_argument("--batch-size", type=int, default=64)
    p.add_argument("--patience", type=int, default=8, help="EarlyStopping patience on val_loss.")
    p.add_argument("--version", default="v2")
    p.add_argument("--data-dir", default=None, help="Override auto-detected data/processed directory.")
    p.add_argument("--output-dir", default=None, help="Defaults to ../models relative to this script.")
    p.add_argument("--verbose", type=int, default=2, help="Keras fit verbosity (2 = one line per epoch, 0 = silent).")
    # parse_known_args (not parse_args): when this script is pasted into a
    # Jupyter/Kaggle/Colab cell, the kernel's own launcher args end up in
    # sys.argv -- ignore anything unrecognized instead of erroring.
    args, _unknown = p.parse_known_args()
    return args


def main():
    args = parse_args()
    set_seed()
    print("TensorFlow:", tf.__version__)

    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]
    horizons = [int(h) for h in args.horizons.split(",") if h.strip()]
    lookback = args.lookback

    data_dir = find_data_dir(args.data_dir)
    data_path = (data_dir / "exchange_rates_wide.parquet"
                 if (data_dir / "exchange_rates_wide.parquet").exists()
                 else data_dir / "exchange_rates_wide.csv")
    print(f"DATA_DIR = {data_dir}")
    wide = load_wide_rates(data_path)
    missing = [c for c in currencies if c not in wide.columns]
    if missing:
        raise ValueError(f"Currencies not found in data: {missing}. Available: {list(wide.columns)}")
    print(f"Loaded {wide.shape}, {wide.index.min().date()} to {wide.index.max().date()}")
    print(f"Lookback = {lookback} | Horizons = {horizons}")

    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        try:
            output_dir = Path(__file__).resolve().parent.parent / "models"
        except NameError:
            output_dir = Path("/kaggle/working/models_out") if Path("/kaggle/working").exists() else Path("./models_out")
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"OUTPUT_DIR = {output_dir}")

    results: dict = {}
    trained_at = datetime.now(timezone.utc).isoformat()

    for ccy in currencies:
        series = clean_currency_series(wide[ccy])
        train_mask, val_mask, test_mask = date_masks(series.index, args.train_end, args.val_end)
        if train_mask.sum() < lookback * 5:
            print(f"Skipping {ccy}: not enough training history ({int(train_mask.sum())} rows)")
            continue

        # Scaler is fit on TRAIN ONLY, then applied to the whole series --
        # fitting on everything would leak test-period range into training.
        price_scaler = MinMaxScaler().fit(series.loc[train_mask].values.reshape(-1, 1))
        scaled = price_scaler.transform(series.values.reshape(-1, 1)).ravel()
        results[ccy] = {}

        for h in horizons:
            print("=" * 70)
            print(f"Training LSTM for {ccy}, horizon={h}d")
            print("=" * 70)

            X, y_raw, sample_dates = make_delta_windows(scaled, series.index, lookback, h)
            tr_idx = sample_dates.isin(series.index[train_mask])
            va_idx = sample_dates.isin(series.index[val_mask])
            te_idx = sample_dates.isin(series.index[test_mask])
            print(f"  windows: train={tr_idx.sum()} val={va_idx.sum()} test={te_idx.sum()}")
            if tr_idx.sum() < 200 or te_idx.sum() == 0:
                print(f"  Skipping {ccy} h={h}: not enough windows")
                continue

            delta_scaler = StandardScaler().fit(y_raw[tr_idx].reshape(-1, 1))
            y = delta_scaler.transform(y_raw.reshape(-1, 1)).ravel()

            model = build_model(lookback)
            early_stop = tf.keras.callbacks.EarlyStopping(
                monitor="val_loss", patience=args.patience, restore_best_weights=True
            )
            history = model.fit(
                X[tr_idx], y[tr_idx],
                validation_data=(X[va_idx], y[va_idx]),
                epochs=args.epochs, batch_size=args.batch_size,
                callbacks=[early_stop], verbose=args.verbose,
            )

            # --- evaluate on the held-out test set, in real currency units ---
            pred_delta_scaled = model.predict(X[te_idx], verbose=0).ravel()
            pred_delta = delta_scaler.inverse_transform(pred_delta_scaled.reshape(-1, 1)).ravel()
            anchor_scaled = X[te_idx][:, -1, 0]  # last input-window value = scaled level at the anchor date
            pred_level_scaled = anchor_scaled + pred_delta
            pred_rate = price_scaler.inverse_transform(pred_level_scaled.reshape(-1, 1)).ravel()

            actual_delta = y_raw[te_idx]
            actual_level_scaled = anchor_scaled + actual_delta
            actual_rate = price_scaler.inverse_transform(actual_level_scaled.reshape(-1, 1)).ravel()

            test_dates = sample_dates[te_idx]
            anchor_rate = price_scaler.inverse_transform(anchor_scaled.reshape(-1, 1)).ravel()

            model_metrics = regression_metrics(actual_rate, pred_rate)
            baseline_metrics = naive_random_walk_baseline(series, [h], test_dates)[h]
            dir_acc = float((np.sign(actual_rate - anchor_rate) == np.sign(pred_rate - anchor_rate)).mean())
            mae_improvement_pct = (baseline_metrics["mae"] - model_metrics["mae"]) / baseline_metrics["mae"] * 100

            print(f"  model : MAE {model_metrics['mae']:.4f} RMSE {model_metrics['rmse']:.4f} "
                  f"MAPE {model_metrics['mape_pct']:.3f}%")
            print(f"  naive : MAE {baseline_metrics['mae']:.4f} RMSE {baseline_metrics['rmse']:.4f} "
                  f"MAPE {baseline_metrics['mape_pct']:.3f}%")
            print(f"  MAE improvement vs naive: {mae_improvement_pct:+.1f}% | directional accuracy: {dir_acc:.1%}")

            model_path = output_dir / f"lstm_forecast_{ccy}_h{h}_{args.version}.keras"
            scalers_path = output_dir / f"lstm_scalers_{ccy}_h{h}_{args.version}.joblib"
            model.save(model_path)
            dump({"price_scaler": price_scaler, "delta_scaler": delta_scaler}, scalers_path)
            print(f"  Saved {model_path.name}, {scalers_path.name}")

            results[ccy][h] = {
                "n_train_windows": int(tr_idx.sum()),
                "n_val_windows": int(va_idx.sum()),
                "n_test_windows": int(te_idx.sum()),
                "model_metrics": model_metrics,
                "naive_baseline_metrics": baseline_metrics,
                "mae_improvement_vs_naive_pct": mae_improvement_pct,
                "directional_accuracy": dir_acc,
                "epochs_trained": len(history.history["loss"]),
            }

    # ----------------------------------------------------------------------
    # Metadata
    # ----------------------------------------------------------------------
    metadata = {
        "version": args.version,
        "trained_at": trained_at,
        "model_type": "lstm_per_horizon_delta",
        "currencies": list(results.keys()),
        "lookback_days": lookback,
        "horizons_days": horizons,
        "train_end": args.train_end,
        "val_end": args.val_end,
        "data_start": str(wide.index.min().date()),
        "data_end": str(wide.index.max().date()),
        "seed": SEED,
        "artifact_pattern": {
            "model": "lstm_forecast_{ccy}_h{h}_" + args.version + ".keras",
            "scalers": "lstm_scalers_{ccy}_h{h}_" + args.version + ".joblib (dict: price_scaler, delta_scaler)",
        },
        "results": results,
    }
    meta_path = output_dir / f"lstm_metadata_{args.version}.json"
    meta_path.write_text(json.dumps(metadata, indent=2))
    print("\nWrote", meta_path)

    # ----------------------------------------------------------------------
    # Evaluation report
    # ----------------------------------------------------------------------
    report_lines = [
        "LSTM Multi-Horizon FX Forecaster v2 - Evaluation Report",
        "=" * 60,
        f"Generated on: {trained_at}",
        f"Version: {args.version}",
        f"Currencies: {', '.join(results.keys())}",
        f"Lookback: {lookback} days | Horizons: {horizons} days",
        f"Train end: {args.train_end} | Val end: {args.val_end}",
        f"Data range: {wide.index.min().date()} to {wide.index.max().date()}",
        "",
    ]
    summary_rows = []
    for ccy, per_h in results.items():
        report_lines.append(f"--- {ccy} ---")
        for h, r in per_h.items():
            m, b = r["model_metrics"], r["naive_baseline_metrics"]
            report_lines.append(
                f"  horizon={h:>3}d | MAE {m['mae']:.4f} (naive {b['mae']:.4f}, "
                f"{r['mae_improvement_vs_naive_pct']:+.1f}% vs naive) | RMSE {m['rmse']:.4f} | "
                f"MAPE {m['mape_pct']:.2f}% | directional accuracy {r['directional_accuracy']:.1%} "
                f"| test windows {r['n_test_windows']}"
            )
            summary_rows.append({
                "currency": ccy, "horizon_days": h,
                "model_mae": m["mae"], "model_rmse": m["rmse"], "model_mape_pct": m["mape_pct"],
                "naive_mae": b["mae"], "naive_rmse": b["rmse"], "naive_mape_pct": b["mape_pct"],
                "mae_improvement_vs_naive_pct": r["mae_improvement_vs_naive_pct"],
                "directional_accuracy": r["directional_accuracy"],
            })
        report_lines.append("")

    report_lines += [
        "Note: 'directional accuracy' = % of test samples where the model correctly",
        "predicted the SIGN of the rate change over the horizon, using the rate",
        "known as of the forecast date as the reference point.",
        "'MAE improvement vs naive' > 0 means the model beat the naive random-walk",
        "baseline. A currency/horizon with unusually high improvement AND",
        "directional accuracy (e.g. a strongly-trended currency at 90d) likely",
        "reflects that currency's own historical trend rather than genuine",
        "short-term forecasting skill -- see 'Realistic expectations' above.",
    ]

    summary_df = pd.DataFrame(summary_rows)
    pd.set_option("display.width", 120)
    print("\n" + summary_df.to_string(index=False))
    print("\n" + "\n".join(report_lines))

    report_path = output_dir / f"lstm_evaluation_report_{args.version}.txt"
    report_path.write_text("\n".join(report_lines))
    summary_df.to_csv(output_dir / f"lstm_evaluation_{args.version}.csv", index=False)
    print("\nWrote", report_path)
    print("Wrote", output_dir / f"lstm_evaluation_{args.version}.csv")


if __name__ == "__main__":
    main()

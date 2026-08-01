#!/usr/bin/env python3
"""
XGBoost Long-Horizon Trend Classifier -- v2 (standalone script, local run)

WHY THIS EXISTS / HOW IT DIFFERS FROM v1 (removed; see git history):

v1 predicts NEXT-DAY direction. That's close to a random walk in efficient
markets -- v1's own results came in around 44-51% accuracy on a 3-class
problem, and for GBP/JPY the model didn't even beat the majority-class
baseline. That's not a bug, it's the expected ceiling for that task (see
training/README.md's "Realistic expectations" section) -- next-day FX
direction from price history alone genuinely tops out in the
low-to-mid-50s% in the published literature. No amount of tuning gets that
task past ~55-60% without label leakage.

v2 instead predicts LONG-HORIZON trend direction (default: 90 trading days
ahead, roughly a quarter). This is a fundamentally different and easier
task, not a trick: FX trends -- especially for a managed-float / crawling-
peg currency like LKR -- persist over months, so the sign of the trailing
N-day return is genuinely informative about the sign of the next N-day
return (momentum / trend-following is a well-documented FX effect). That's
real, non-leaky signal.

Two honesty notes this script bakes in so results don't overstate skill:
  1. It reports a TREND-CONTINUATION baseline (predict "the current trend
     keeps going") next to the majority-class baseline. A model that only
     matches the continuation baseline hasn't learned anything beyond naive
     extrapolation -- the interesting number is model accuracy vs. THAT
     baseline, not vs. 50%.
  2. Test rows less than `horizon` days apart share most of their forward-
     return window, so they are NOT independent bets -- treat the reported
     accuracy as "accuracy over overlapping windows", not "N independent
     coin flips beaten". This is disclosed in the evaluation report output
     too.

Artifact filenames are horizon-aware (xgb_trend_<CCY>_h<H>_v2.json) because
this is a different prediction target than the single-day contract
documented in ../README.md / ../../CURRENCY_FEATURE.md for Phase 4 serving.
If you wire this into the FastAPI service, update that contract to match.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/train_xgboost_trend_v2.py
    venv/bin/python training/train_xgboost_trend_v2.py --horizon 90 --currencies LKR,INR,EUR,GBP,JPY

Reads:  data/processed/exchange_rates_wide.(csv|parquet)  (Phase 1 output;
        run data/prepare_data.py first if missing)
Writes: models/xgb_trend_<CCY>_h<H>_v2.json               (one per currency)
        models/xgb_trend_features_h<H>_v2.json            (shared feature list)
        models/xgb_trend_metadata_h<H>_v2.json            (per-currency metrics)
        models/xgb_evaluation_report_h<H>_v2.txt
        models/xgb_evaluation_h<H>_v2.csv
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report, f1_score

SEED = 42


def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)


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


def _has_wide_file(p: Path) -> bool:
    return (p / "exchange_rates_wide.csv").exists() or (p / "exchange_rates_wide.parquet").exists()


def find_data_dir(explicit: str | None) -> Path:
    """Resolution order: explicit --data-dir -> local repo layout (running
    as `python training/train_xgboost_trend_v2.py`) -> recursive search
    under /kaggle/input (running as a pasted cell on Kaggle, where the
    mount path under an attached dataset isn't a fixed, predictable slug --
    e.g. it can be /kaggle/input/<slug>/... or a deeper nested path
    depending on how the dataset was attached)."""
    if explicit:
        p = Path(explicit)
        if _has_wide_file(p):
            return p
        raise FileNotFoundError(f"No exchange_rates_wide.(csv|parquet) under {p}")

    # __file__ isn't reliably defined when this script is pasted into a
    # Jupyter/Kaggle notebook cell rather than run as a .py file.
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
        "Could not find exchange_rates_wide.(csv|parquet). Checked the local "
        "data/processed/ layout and recursively under /kaggle/input. On "
        "Kaggle, run `!find /kaggle/input -iname 'exchange_rates_wide*'` in "
        "a cell to check what's attached, then pass --data-dir explicitly "
        "(e.g. args string '--data-dir /kaggle/input/.../processed' via "
        "sys.argv, or just hardcode DATA_DIR and call main() logic directly)."
    )


# --------------------------------------------------------------------------
# Features: long-horizon trend / momentum, not next-day microstructure.
# Every feature at row t uses only data up to and including date t.
# --------------------------------------------------------------------------

def log_returns(rate: pd.Series) -> pd.Series:
    return np.log(rate / rate.shift(1))


def trailing_return(rate: pd.Series, window: int) -> pd.Series:
    """Cumulative log return over the trailing `window` days, known as of day t."""
    return np.log(rate / rate.shift(window))


def rolling_slope(series: pd.Series, window: int) -> pd.Series:
    """OLS slope of `series` over the trailing `window` days -- is the trend
    accelerating, flat, or reversing."""
    x = np.arange(window, dtype=float)
    x_mean = x.mean()
    denom = ((x - x_mean) ** 2).sum()

    def _slope(y: np.ndarray) -> float:
        if np.isnan(y).any():
            return np.nan
        return float(((x - x_mean) * (y - y.mean())).sum() / denom)

    return series.rolling(window).apply(_slope, raw=True)


def trend_features_v2(rate: pd.Series, horizon: int) -> pd.DataFrame:
    """Long-horizon trend features, built to capture persistence rather than
    daily noise:
      - trailing cumulative returns at several windows (incl. one matching
        the horizon -- the strongest single feature for a persistence task,
        the same quantity as the label, just looking backward)
      - price position relative to several moving averages
      - short-vs-long moving-average crossovers (classic trend-following
        signal)
      - the slope of the medium-term moving average
      - rolling volatility (regime feature)
    """
    feats = pd.DataFrame(index=rate.index)
    ret = log_returns(rate)

    windows = sorted({w for w in (10, 20, horizon // 3, horizon // 2, horizon) if w >= 2})
    for window in windows:
        feats[f"trail_ret_{window}"] = trailing_return(rate, window)

    for window in (10, 20, 50, 100, 200):
        ma = rate.rolling(window).mean()
        feats[f"price_vs_ma_{window}"] = rate / ma - 1
    feats["ma_cross_20_50"] = rate.rolling(20).mean() / rate.rolling(50).mean() - 1
    feats["ma_cross_50_200"] = rate.rolling(50).mean() / rate.rolling(200).mean() - 1
    feats["ma50_slope"] = rolling_slope(rate.rolling(50).mean(), 20)

    for window in (20, 60):
        feats[f"vol_{window}"] = ret.rolling(window).std()
    feats["zscore_60"] = (ret - ret.rolling(60).mean()) / ret.rolling(60).std()

    return feats


def trend_labels_v2(rate: pd.Series, horizon: int, flat_threshold: float) -> pd.Series:
    """Label at day t = direction of the cumulative log return from t to
    t+horizon. 1=up, -1=down, 0=flat (only if flat_threshold > 0). The last
    `horizon` rows are always NaN (no future window exists yet) -- callers
    must drop them."""
    fwd_ret = np.log(rate.shift(-horizon) / rate)
    label = pd.Series(np.sign(fwd_ret), index=rate.index)
    if flat_threshold > 0:
        label[fwd_ret.abs() <= flat_threshold] = 0
    return label


def trend_continuation_pred(rate: pd.Series, horizon: int, class_map: dict) -> pd.Series:
    """Honest baseline for a persistence-driven task: predict the SAME sign
    as the trailing `horizon`-day return ("the trend that's been happening
    keeps happening"). A model that can't beat this hasn't learned anything
    beyond naive trend extrapolation. A trail return of exactly 0 (rare)
    falls back to the "up" class if present, else whatever class exists."""
    fallback = class_map.get(1.0, next(iter(class_map.values())))
    trail_sign = np.sign(trailing_return(rate, horizon))
    return trail_sign.map(lambda v: class_map.get(float(v), fallback) if pd.notna(v) else np.nan)


def date_masks(index: pd.DatetimeIndex, train_end, val_end):
    train_end, val_end = pd.Timestamp(train_end), pd.Timestamp(val_end)
    train_mask = index <= train_end
    val_mask = (index > train_end) & (index <= val_end)
    test_mask = index > val_end
    return train_mask, val_mask, test_mask


def majority_class_baseline(y_train, y_eval) -> dict:
    majority = Counter(y_train).most_common(1)[0][0]
    y_pred = [majority] * len(y_eval)
    return {
        "majority_class": int(majority),
        "accuracy": float(accuracy_score(y_eval, y_pred)),
        "f1_macro": float(f1_score(y_eval, y_pred, average="macro", zero_division=0)),
    }


def continuation_baseline_metrics(y_eval, cont_pred_eval) -> dict:
    return {
        "accuracy": float(accuracy_score(y_eval, cont_pred_eval)),
        "f1_macro": float(f1_score(y_eval, cont_pred_eval, average="macro", zero_division=0)),
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--currencies", default="LKR,INR,EUR,GBP,JPY",
                    help="Comma-separated ISO codes, must be columns in exchange_rates_wide (see ../DATA_DICTIONARY.md).")
    p.add_argument("--horizon", type=int, default=90,
                    help="Forecast horizon in trading days (default: 90, ~1 quarter). Larger = more trend persistence = easier task.")
    p.add_argument("--flat-threshold", type=float, default=0.0,
                    help="Log-return magnitude below which a move counts as 'flat'. Default 0 = binary up/down only (recommended -- the flat class was unlearnable in v1 and only dilutes accuracy).")
    p.add_argument("--train-end", default="2011-12-31")
    p.add_argument("--val-end", default="2014-12-31")
    p.add_argument("--version", default="v2")
    p.add_argument("--data-dir", default=None, help="Override auto-detected data/processed directory.")
    p.add_argument("--output-dir", default=None, help="Defaults to ../models relative to this script.")
    # parse_known_args (not parse_args): when this script is pasted into a
    # Jupyter/Kaggle/Colab cell instead of run as `python script.py`, the
    # kernel's own launcher args (e.g. `-f /root/.../kernel-*.json`) end up
    # in sys.argv -- ignore anything we don't recognize instead of erroring.
    args, _unknown = p.parse_known_args()
    return args


def main():
    args = parse_args()
    set_seed()

    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]
    horizon = args.horizon
    flat_threshold = args.flat_threshold

    class_names = ["down", "flat", "up"] if flat_threshold > 0 else ["down", "up"]
    class_map = {-1.0: 0, 0.0: 1, 1.0: 2} if flat_threshold > 0 else {-1.0: 0, 1.0: 1}

    data_dir = find_data_dir(args.data_dir)
    data_path = (data_dir / "exchange_rates_wide.parquet" if (data_dir / "exchange_rates_wide.parquet").exists()
                 else data_dir / "exchange_rates_wide.csv")
    print(f"DATA_DIR = {data_dir}")
    wide = load_wide_rates(data_path)
    missing = [c for c in currencies if c not in wide.columns]
    if missing:
        raise ValueError(f"Currencies not found in data: {missing}. Available: {list(wide.columns)}")
    print(f"Loaded {wide.shape}, {wide.index.min().date()} to {wide.index.max().date()}")
    print(f"Horizon = {horizon} trading days | flat_threshold = {flat_threshold} | classes = {class_names}")

    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        try:
            output_dir = Path(__file__).resolve().parent.parent / "models"
        except NameError:
            # No __file__ (pasted into a notebook cell) -- Kaggle convention.
            output_dir = Path("/kaggle/working/models_out") if Path("/kaggle/working").exists() else Path("./models_out")
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"OUTPUT_DIR = {output_dir}")

    feature_columns = None
    results = {}
    trained_at = datetime.now(timezone.utc).isoformat()

    for ccy in currencies:
        print("=" * 70)
        print(f"Training XGBoost long-horizon ({horizon}d) trend classifier for {ccy}")
        print("=" * 70)

        series = clean_currency_series(wide[ccy])
        feats = trend_features_v2(series, horizon)
        labels = trend_labels_v2(series, horizon, flat_threshold)
        if feature_columns is None:
            feature_columns = list(feats.columns)

        cont_pred = trend_continuation_pred(series, horizon, class_map)

        data = feats.copy()
        data["label"] = labels
        data["cont_pred"] = cont_pred
        data = data.dropna(subset=feature_columns + ["label"])
        data["y"] = data["label"].map(class_map)
        data = data.dropna(subset=["y"])
        data["y"] = data["y"].astype(int)

        train_mask, val_mask, test_mask = date_masks(series.index, args.train_end, args.val_end)
        tr = data.index.isin(series.index[train_mask])
        va = data.index.isin(series.index[val_mask])
        te = data.index.isin(series.index[test_mask])
        if tr.sum() < 200:
            print(f"  Skipping {ccy}: not enough training rows ({int(tr.sum())})")
            continue

        Xtr, ytr = data.loc[tr, feature_columns], data.loc[tr, "y"]
        Xva, yva = data.loc[va, feature_columns], data.loc[va, "y"]
        Xte, yte = data.loc[te, feature_columns], data.loc[te, "y"]
        print(f"  rows: train={len(Xtr)} val={len(Xva)} test={len(Xte)}")
        print(f"  NOTE: consecutive test rows overlap ({horizon}-day forward windows) -- "
              f"not {len(Xte)} independent bets, see module docstring.")

        binary = len(class_names) == 2
        clf = xgb.XGBClassifier(
            n_estimators=400, max_depth=5, learning_rate=0.03,
            subsample=0.8, colsample_bytree=0.8,
            objective="binary:logistic" if binary else "multi:softprob",
            eval_metric="logloss" if binary else "mlogloss",
            early_stopping_rounds=30,
            random_state=SEED, n_jobs=-1,
            **({} if binary else {"num_class": len(class_names)}),
        )
        clf.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)

        pred = clf.predict(Xte)
        acc = accuracy_score(yte, pred)
        f1_macro = f1_score(yte, pred, average="macro", zero_division=0)
        maj_baseline = majority_class_baseline(ytr, yte)
        cont_baseline = continuation_baseline_metrics(yte, data.loc[te, "cont_pred"])

        print(f"  model                : accuracy={acc:.4f}  f1_macro={f1_macro:.4f}")
        print(f"  majority baseline    : accuracy={maj_baseline['accuracy']:.4f}  "
              f"(always predicts {class_names[maj_baseline['majority_class']]})")
        print(f"  trend-continuation baseline: accuracy={cont_baseline['accuracy']:.4f}  "
              "(predict current trend keeps going)")
        present = sorted(set(yte) | set(pred))
        print(classification_report(
            yte, pred, labels=present,
            target_names=[class_names[i] for i in present], zero_division=0,
        ))

        model_path = output_dir / f"xgb_trend_{ccy}_h{horizon}_{args.version}.json"
        clf.save_model(str(model_path))
        print(f"  Saved {model_path.name}")

        results[ccy] = {
            "n_train_rows": int(len(Xtr)),
            "n_val_rows": int(len(Xva)),
            "n_test_rows": int(len(Xte)),
            "model_accuracy": float(acc),
            "model_f1_macro": float(f1_macro),
            "majority_baseline": maj_baseline,
            "trend_continuation_baseline": cont_baseline,
            "best_iteration": int(clf.best_iteration) if hasattr(clf, "best_iteration") else None,
        }

    features_path = output_dir / f"xgb_trend_features_h{horizon}_{args.version}.json"
    features_path.write_text(json.dumps({"feature_columns": feature_columns}, indent=2))

    metadata = {
        "version": args.version,
        "trained_at": trained_at,
        "model_type": "xgboost_long_horizon_trend_classifier",
        "horizon_days": horizon,
        "currencies": list(results.keys()),
        "class_map": {str(k): v for k, v in class_map.items()},
        "class_names": class_names,
        "flat_threshold": flat_threshold,
        "train_end": args.train_end,
        "val_end": args.val_end,
        "seed": SEED,
        "artifact_pattern": {
            "model": "xgb_trend_{ccy}_h" + str(horizon) + "_" + args.version + ".json",
            "features": features_path.name,
        },
        "results": results,
    }
    meta_path = output_dir / f"xgb_trend_metadata_h{horizon}_{args.version}.json"
    meta_path.write_text(json.dumps(metadata, indent=2))
    print("\nWrote", features_path)
    print("Wrote", meta_path)

    # Evaluation report
    report_lines = [
        "XGBoost Long-Horizon Trend Classifier (v2) - Evaluation Report",
        "=" * 66,
        f"Generated on: {trained_at}",
        f"Version: {args.version}  |  Horizon: {horizon} trading days",
        f"Currencies: {', '.join(results.keys())}",
        f"Flat threshold: {flat_threshold} | Classes: {class_names}",
        f"Train end: {args.train_end} | Val end: {args.val_end}",
        "",
        "IMPORTANT: this predicts LONG-HORIZON trend direction, a different",
        "and easier task than next-day direction (the v1 next-day variant is",
        "described in this script's module docstring; the code itself has been",
        "removed -- see git history).",
        "Test rows less than the horizon apart overlap in their forward-return",
        "window, so treat accuracy as 'over overlapping windows', not N",
        "independent bets. The trend-continuation baseline (predict the",
        "trend keeps going) is the meaningful comparison, not 50%.",
        "",
    ]
    summary_rows = []
    for ccy, r in results.items():
        b = r["majority_baseline"]
        c = r["trend_continuation_baseline"]
        report_lines.append(f"--- {ccy} (test rows: {r['n_test_rows']}) ---")
        report_lines.append(f"  model                      : accuracy={r['model_accuracy']:.4f}  f1_macro={r['model_f1_macro']:.4f}")
        report_lines.append(f"  majority-class baseline    : accuracy={b['accuracy']:.4f}  (always predicts {class_names[b['majority_class']]})")
        report_lines.append(f"  trend-continuation baseline: accuracy={c['accuracy']:.4f}")
        report_lines.append(f"  improvement vs majority    : {(r['model_accuracy'] - b['accuracy']) * 100:+.1f} pts")
        report_lines.append(f"  improvement vs continuation: {(r['model_accuracy'] - c['accuracy']) * 100:+.1f} pts")
        report_lines.append("")
        summary_rows.append({
            "currency": ccy,
            "model_accuracy": r["model_accuracy"],
            "model_f1_macro": r["model_f1_macro"],
            "majority_baseline_accuracy": b["accuracy"],
            "continuation_baseline_accuracy": c["accuracy"],
            "improvement_vs_majority_pts": (r["model_accuracy"] - b["accuracy"]) * 100,
            "improvement_vs_continuation_pts": (r["model_accuracy"] - c["accuracy"]) * 100,
        })

    summary_df = pd.DataFrame(summary_rows)
    pd.set_option("display.width", 120)
    print("\n" + summary_df.to_string(index=False))
    print("\n" + "\n".join(report_lines))

    report_path = output_dir / f"xgb_evaluation_report_h{horizon}_{args.version}.txt"
    report_path.write_text("\n".join(report_lines) + "\n\n" + summary_df.to_string(index=False))
    summary_df.to_csv(output_dir / f"xgb_evaluation_h{horizon}_{args.version}.csv", index=False)
    print("\nWrote", report_path)
    print("Wrote", output_dir / f"xgb_evaluation_h{horizon}_{args.version}.csv")


if __name__ == "__main__":
    main()

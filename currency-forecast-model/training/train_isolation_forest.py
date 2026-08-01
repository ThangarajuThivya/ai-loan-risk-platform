#!/usr/bin/env python3
"""
Isolation Forest Anomaly Detector -- v1 (standalone script)

Fits one Isolation Forest per currency on engineered daily-move features
(return, rolling z-score, rolling realized volatility, gap from 20-day
moving average) to flag abnormal daily moves. Ported from the original
Kaggle notebook, which has since been removed -- see git history.

Realistic expectations: this is unsupervised
-- there's no ground-truth anomaly label to score accuracy against. The
"sanity check" compares the model's flagged days against a simple
statistical extreme-move threshold (|return| above its (1 - contamination)
quantile in the fit window). Rough agreement between the two is
reassuring; exact agreement is not the goal and would suggest the model
learned nothing beyond the statistical threshold.

No argparse on purpose: this runs identically whether you `python
train_isolation_forest.py` locally/on a server, or paste the whole file
into a Kaggle/Colab notebook cell -- argparse would choke on the kernel's
own launcher args (`-f kernel-*.json`) in the latter case. Edit the
constants in the Configuration section below instead of passing flags.

Run:
    Local  : cd currency-forecast-model && venv/bin/python training/train_isolation_forest.py
             (reads data/processed/, writes to ./models_out/ next to cwd --
             copy the output into models/ afterwards)
    Kaggle : paste this whole file into a cell after attaching the
             `exchange_rates_wide.csv` dataset, Run All. Kept working as a
             pasted cell on purpose (hence no argparse), but a local run is
             now the supported path -- every trainer runs locally.

Reads:  exchange_rates_wide.(csv|parquet)   (Phase 1 output)
Writes: isoforest_<CCY>_v1.joblib           (one sklearn Pipeline per currency: StandardScaler + IsolationForest)
        isoforest_features_v1.json          (shared: feature list, contamination, per-currency stats)
        isoforest_evaluation_report_v1.txt
        isoforest_evaluation_v1.csv
"""
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from joblib import dump
from sklearn.ensemble import IsolationForest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

# --------------------------------------------------------------------------
# Configuration -- edit these, not CLI flags (see module docstring for why)
#
# Each also accepts an ISOF_* environment-variable override, so a retrain can
# be scripted without editing the file, while a pasted notebook cell (where
# argparse would choke on the kernel's own launcher args) still just works:
#   ISOF_DATA_DIR=data/processed_refreshed ISOF_TRAIN_END=2022-12-31 \
#   ISOF_VAL_END=2024-06-30 ISOF_OUTPUT_DIR=/tmp/out venv/bin/python training/train_isolation_forest.py
# --------------------------------------------------------------------------
VERSION = os.environ.get("ISOF_VERSION", "v1")
CURRENCIES = ["LKR", "INR", "EUR", "GBP", "JPY"]  # edit freely -- see ../DATA_DICTIONARY.md for all 23 codes
CONTAMINATION = float(os.environ.get("ISOF_CONTAMINATION", 0.01))  # expected fraction of "abnormal" days in the fit window
TRAIN_END = os.environ.get("ISOF_TRAIN_END", "2011-12-31")
VAL_END = os.environ.get("ISOF_VAL_END", "2014-12-31")   # fit window = everything through VAL_END; eval window = after VAL_END


def _find_data_dir():
    """Kaggle's actual mount path for an attached dataset isn't a fixed
    slug you can predict in advance (it can be /kaggle/input/<slug>/... or
    a deeper nested path like /kaggle/input/datasets/<username>/<slug>/...,
    depending on how/who attached it) -- rather than guess, search
    recursively under /kaggle/input for the expected file."""
    override = os.environ.get("ISOF_DATA_DIR")
    if override:
        p = Path(override)
        if (p / "exchange_rates_wide.csv").exists() or (p / "exchange_rates_wide.parquet").exists():
            return p
        raise FileNotFoundError(f"ISOF_DATA_DIR={override} has no exchange_rates_wide.(csv|parquet)")
    local = Path("../data/processed")
    if (local / "exchange_rates_wide.csv").exists() or (local / "exchange_rates_wide.parquet").exists():
        return local  # local fallback (running outside Kaggle)
    local2 = Path("data/processed")  # in case cwd is already currency-forecast-model/
    if (local2 / "exchange_rates_wide.csv").exists() or (local2 / "exchange_rates_wide.parquet").exists():
        return local2
    kaggle_root = Path("/kaggle/input")
    if kaggle_root.exists():
        for filename in ("exchange_rates_wide.csv", "exchange_rates_wide.parquet"):
            matches = sorted(kaggle_root.rglob(filename))
            if matches:
                return matches[0].parent
    return None


DATA_DIR = _find_data_dir()
if DATA_DIR is None:
    raise FileNotFoundError(
        "Could not find exchange_rates_wide.(csv|parquet) locally or anywhere under /kaggle/input.\n"
        "Run `!find /kaggle/input -iname 'exchange_rates_wide*'` in a new cell to check "
        "what's actually attached, then set DATA_DIR manually and re-run."
    )
print("DATA_DIR   =", DATA_DIR)

OUTPUT_DIR = Path(os.environ.get("ISOF_OUTPUT_DIR") or (
    "/kaggle/working/models_out" if Path("/kaggle/working").exists() else "./models_out"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
print("OUTPUT_DIR =", OUTPUT_DIR)


# --------------------------------------------------------------------------
# Preprocessing utils (canonical source: ../training/preprocessing_utils.py)
# --------------------------------------------------------------------------

def load_wide_rates(path) -> pd.DataFrame:
    path = Path(path)
    df = (pd.read_parquet(path) if path.suffix == ".parquet"
          else pd.read_csv(path, index_col=0, parse_dates=True))
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    return df.sort_index()


def clean_currency_series(series: pd.Series) -> pd.Series:
    """Restricts to the currency's own trading window and forward-fills
    sparse ND gaps *within* that window only (never fills before the
    currency's first valid date -- see ../DATA_DICTIONARY.md)."""
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


def log_returns(rate: pd.Series) -> pd.Series:
    return np.log(rate / rate.shift(1))


def anomaly_features(rate: pd.Series) -> pd.DataFrame:
    """Engineered daily-move features. This dataset has no OHLC, only a
    daily close-equivalent, so every feature is derived from the return
    series alone."""
    ret = log_returns(rate)
    feats = pd.DataFrame(index=rate.index)
    feats["return"] = ret
    feats["abs_return"] = ret.abs()
    for window in (5, 20):
        roll_mean = ret.rolling(window).mean()
        roll_std = ret.rolling(window).std()
        feats[f"zscore_{window}"] = (ret - roll_mean) / roll_std
        feats[f"roll_vol_{window}"] = roll_std
    feats["gap_from_ma20"] = rate / rate.rolling(20).mean() - 1
    return feats


# --------------------------------------------------------------------------
# Load data
# --------------------------------------------------------------------------
wide = load_wide_rates(
    DATA_DIR / "exchange_rates_wide.parquet"
    if (DATA_DIR / "exchange_rates_wide.parquet").exists()
    else DATA_DIR / "exchange_rates_wide.csv"
)
missing = [c for c in CURRENCIES if c not in wide.columns]
if missing:
    raise ValueError(f"Currencies not found in data: {missing}. Available: {list(wide.columns)}")
print(wide.shape, wide.index.min(), "to", wide.index.max())


# --------------------------------------------------------------------------
# Fit one Isolation Forest per currency
# --------------------------------------------------------------------------
FEATURE_COLUMNS = None  # set from the first currency, shared across all currencies
results = {}
trained_at = datetime.now(timezone.utc).isoformat()

for ccy in CURRENCIES:
    print("=" * 70)
    print(f"Fitting Isolation Forest for {ccy}")
    print("=" * 70)

    series = clean_currency_series(wide[ccy])
    feats = anomaly_features(series).dropna()
    if FEATURE_COLUMNS is None:
        FEATURE_COLUMNS = list(feats.columns)

    train_mask, val_mask, test_mask = date_masks(series.index, TRAIN_END, VAL_END)
    fit_mask = feats.index.isin(series.index[train_mask]) | feats.index.isin(series.index[val_mask])
    eval_mask = feats.index.isin(series.index[test_mask])
    if fit_mask.sum() < 500:
        print(f"  Skipping {ccy}: not enough fit-window rows ({int(fit_mask.sum())})")
        continue

    X_fit, X_eval = feats.loc[fit_mask, FEATURE_COLUMNS], feats.loc[eval_mask, FEATURE_COLUMNS]
    print(f"  rows: fit={len(X_fit)} eval={len(X_eval)}")

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("iforest", IsolationForest(
            n_estimators=200, contamination=CONTAMINATION, random_state=SEED, n_jobs=-1,
        )),
    ])
    pipeline.fit(X_fit)

    fit_flags = pipeline.predict(X_fit)
    eval_flags = pipeline.predict(X_eval) if len(X_eval) else np.array([])
    fit_flagged_pct = float((fit_flags == -1).mean())
    eval_flagged_pct = float((eval_flags == -1).mean()) if len(eval_flags) else None
    print(f"  flagged in fit window : {fit_flagged_pct:.2%} (target ~{CONTAMINATION:.2%} by construction)")
    if eval_flagged_pct is not None:
        print(f"  flagged in eval window: {eval_flagged_pct:.2%}")

    # --- sanity check: overlap with a simple statistical extreme-move baseline ---
    extreme_threshold = feats.loc[fit_mask, "abs_return"].quantile(1 - CONTAMINATION)
    overlap = None
    if len(X_eval):
        statistical_flag = feats.loc[eval_mask, "abs_return"] > extreme_threshold
        model_flag = pd.Series(eval_flags == -1, index=X_eval.index)
        agree = (statistical_flag == model_flag).mean()
        both_flagged = (statistical_flag & model_flag).sum()
        overlap = {
            "agreement_rate": float(agree),
            "both_flagged_days": int(both_flagged),
            "statistical_flagged_days": int(statistical_flag.sum()),
            "model_flagged_days": int(model_flag.sum()),
        }
        print(f"  sanity check vs |return| > {extreme_threshold:.4f} threshold: "
              f"agreement={agree:.2%}, both-flagged={both_flagged} days")

    model_path = OUTPUT_DIR / f"isoforest_{ccy}_{VERSION}.joblib"
    dump(pipeline, model_path)
    print(f"  Saved {model_path.name}")

    results[ccy] = {
        "n_fit_rows": int(len(X_fit)),
        "n_eval_rows": int(len(X_eval)),
        "fit_flagged_pct": fit_flagged_pct,
        "eval_flagged_pct": eval_flagged_pct,
        "extreme_move_sanity_check": overlap,
    }


# --------------------------------------------------------------------------
# Write shared feature list / metadata
# --------------------------------------------------------------------------
features_path = OUTPUT_DIR / f"isoforest_features_{VERSION}.json"
metadata = {
    "version": VERSION,
    "trained_at": trained_at,
    "model_type": "isolation_forest",
    "currencies": list(results.keys()),
    "feature_columns": FEATURE_COLUMNS,
    "contamination": CONTAMINATION,
    "train_end": TRAIN_END,
    "val_end": VAL_END,
    "seed": SEED,
    "artifact_pattern": {"model": "isoforest_{ccy}_" + VERSION + ".joblib"},
    "results": results,
}
features_path.write_text(json.dumps(metadata, indent=2))
print("Wrote", features_path)
print(sorted(p.name for p in OUTPUT_DIR.glob("isoforest_*")))


# --------------------------------------------------------------------------
# Evaluation report
# --------------------------------------------------------------------------
report_lines = [
    "Isolation Forest Anomaly Detector - Evaluation Report",
    "=" * 60,
    f"Generated on: {trained_at}",
    f"Version: {VERSION}",
    f"Currencies: {', '.join(results.keys())}",
    f"Contamination: {CONTAMINATION}",
    f"Train end: {TRAIN_END} | Val end: {VAL_END}",
    "",
]
summary_rows = []
for ccy, r in results.items():
    sc = r["extreme_move_sanity_check"]
    report_lines.append(f"--- {ccy} (fit rows: {r['n_fit_rows']}, eval rows: {r['n_eval_rows']}) ---")
    report_lines.append(
        f"  flagged in fit window : {r['fit_flagged_pct']:.2%} (target ~{CONTAMINATION:.2%} by construction)"
    )
    eval_pct = r["eval_flagged_pct"]
    report_lines.append(
        f"  flagged in eval window: {eval_pct:.2%}" if eval_pct is not None else "  flagged in eval window: n/a"
    )
    if sc:
        vacuous = sc["model_flagged_days"] == 0 and sc["statistical_flagged_days"] == 0
        report_lines.append(
            f"  sanity check vs statistical extreme-move threshold: "
            f"model flagged {sc['model_flagged_days']} day(s), statistical baseline flagged "
            f"{sc['statistical_flagged_days']} day(s), {sc['both_flagged_days']} in common "
            f"(agreement={sc['agreement_rate']:.1%})"
            + ("  <-- agreement % is vacuous here: neither method flagged anything in this window"
               if vacuous else "")
        )
    else:
        report_lines.append("  sanity check: n/a (no eval rows)")
    report_lines.append("")
    summary_rows.append({
        "currency": ccy, "fit_flagged_pct": r["fit_flagged_pct"], "eval_flagged_pct": eval_pct,
        "sanity_agreement_rate": sc["agreement_rate"] if sc else None,
        "sanity_model_flagged_days": sc["model_flagged_days"] if sc else None,
        "sanity_statistical_flagged_days": sc["statistical_flagged_days"] if sc else None,
        "sanity_both_flagged_days": sc["both_flagged_days"] if sc else None,
    })

report_lines += [
    "Note: unsupervised model, no ground-truth anomaly labels exist. 'sanity",
    "check' compares model flags against a simple statistical extreme-move",
    "threshold from the fit period -- rough agreement is reassuring, exact",
    "agreement is not the goal -- see 'Realistic expectations' in this",
    "file's module docstring.",
]

summary_df = pd.DataFrame(summary_rows)
pd.set_option("display.width", 120)
print(summary_df.to_string(index=False))
print()
print("\n".join(report_lines))

report_path = OUTPUT_DIR / f"isoforest_evaluation_report_{VERSION}.txt"
report_path.write_text("\n".join(report_lines))
summary_df.to_csv(OUTPUT_DIR / f"isoforest_evaluation_{VERSION}.csv", index=False)
print("\nWrote", report_path)
print("Wrote", OUTPUT_DIR / f"isoforest_evaluation_{VERSION}.csv")

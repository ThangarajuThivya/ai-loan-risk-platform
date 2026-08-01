"""
Shared preprocessing utilities for the currency-forecast-model training
pipeline (see ../../ARCHITECTURE.md §8).

This is the CANONICAL source for logic reused by all four training scripts:
  - train_lstm_forecast_v2.py
  - train_xgboost_trend_v2.py
  - train_garch_volatility.py
  - train_isolation_forest.py

Each of those scripts carries an INLINED copy of the functions it actually
needs, under a "Data loading / cleaning" header, so that a single file can
still be pasted into a standalone Kaggle/Colab cell with no access to this
repo. If you change behaviour here, port the change into those scripts too.

Functionally, this module implements the feature-engineering layer: NaN
handling within each currency's real trading window, return/lag/rolling
features, walk-forward (no-shuffle) splitting, per-currency scaling helpers,
and the naive random-walk baseline the LSTM trainer reports itself against.
src/feature_engineering.py holds the serving-side copies of the two feature
builders that the FastAPI service needs at inference time.
"""
from __future__ import annotations

import random
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42


def set_seed(seed: int = SEED) -> None:
    """Seeds python's random, numpy, and (if importable) TensorFlow."""
    random.seed(seed)
    np.random.seed(seed)
    try:
        import tensorflow as tf
        tf.random.set_seed(seed)
    except ImportError:
        pass


def load_wide_rates(path) -> pd.DataFrame:
    """Loads exchange_rates_wide.{csv,parquet} (Phase 1 output).

    Returns a DatetimeIndex-indexed frame, one column per ISO currency
    code, values = currency units per 1 USD (already normalized in Phase 1
    — see DATA_DICTIONARY.md's quote_convention note). Do not load
    exchange_rates_long or raw_rate here; `rate` in the wide table is the
    only column that's directly comparable across currencies.
    """
    path = Path(path)
    df = (pd.read_parquet(path) if path.suffix == ".parquet"
          else pd.read_csv(path, index_col=0, parse_dates=True))
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    return df.sort_index()


def clean_currency_series(series: pd.Series) -> pd.Series:
    """Restricts to the currency's own trading window (first->last valid
    observation) and forward-fills sparse `ND` gaps *within* that window
    only.

    Per DATA_DICTIONARY.md: never fill before a currency's first valid
    date (e.g. EUR is genuinely absent pre-1999, not missing data) — that
    boundary is preserved by slicing to the valid window before ffill.
    """
    valid = series.dropna()
    if valid.empty:
        raise ValueError(f"{series.name}: no valid observations")
    windowed = series.loc[valid.index.min(): valid.index.max()]
    filled = windowed.ffill()
    if filled.isna().any():
        # only possible if the window's first value itself needed filling,
        # which can't happen since we sliced from the first valid index
        filled = filled.bfill()
    return filled


def log_returns(rate: pd.Series) -> pd.Series:
    return np.log(rate / rate.shift(1))


def date_masks(index: pd.DatetimeIndex, train_end, val_end):
    """Boolean masks for a chronological walk-forward split — NO shuffling,
    NO random splitting. train <= train_end < val <= val_end < test.
    """
    train_end = pd.Timestamp(train_end)
    val_end = pd.Timestamp(val_end)
    train_mask = index <= train_end
    val_mask = (index > train_end) & (index <= val_end)
    test_mask = index > val_end
    return train_mask, val_mask, test_mask


def regression_metrics(y_true, y_pred) -> dict:
    """MAE / RMSE / MAPE(%). Used identically for the model and for the
    naive random-walk baseline so the two are directly comparable."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    err = y_true - y_pred
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    nonzero = y_true != 0
    mape = (float(np.mean(np.abs(err[nonzero] / y_true[nonzero])) * 100)
            if nonzero.any() else float("nan"))
    return {"mae": mae, "rmse": rmse, "mape_pct": mape}


def naive_random_walk_baseline(rate: pd.Series, horizons: list[int],
                                eval_index: pd.DatetimeIndex) -> dict:
    """The textbook FX baseline (random walk without drift): the h-day-ahead
    forecast made *from* date t is simply rate[t] itself (no change).
    Equivalently, evaluated at target date t, the baseline prediction is
    rate[t - h]. FX rates are close to a random walk in practice (the
    Meese-Rogoff result), so a model that cannot beat this baseline is not
    a failure — see the "realistic expectations" note in each notebook.

    Returns {horizon: {mae, rmse, mape_pct}} computed only over eval_index
    rows with both a valid actual and a valid t-h anchor.
    """
    out = {}
    for h in horizons:
        anchor = rate.shift(h)
        idx = eval_index.intersection(rate.index)
        pair = pd.concat({"y_true": rate.loc[idx], "y_pred": anchor.loc[idx]}, axis=1).dropna()
        out[h] = regression_metrics(pair["y_true"], pair["y_pred"])
    return out


def make_lstm_windows(scaled: np.ndarray, dates: pd.DatetimeIndex,
                       lookback: int, horizons: list[int]):
    """Builds sliding windows for multi-horizon, multi-output regression.

    scaled: 1-D array of scaled rate values aligned with `dates`.
    Returns:
      X: (n, lookback, 1) float32 — the lookback-day input window
      y: (n, len(horizons)) float32 — scaled rate at each horizon after the
         window's last day
      sample_dates: (n,) DatetimeIndex — the *last date in the input
         window* for each sample, i.e. the date the forecast is made
         "as of". Use this to intersect samples with date_masks().
    """
    max_h = max(horizons)
    X, y, sample_dates = [], [], []
    n = len(scaled)
    for end in range(lookback - 1, n - max_h):
        X.append(scaled[end - lookback + 1: end + 1])
        y.append([scaled[end + h] for h in horizons])
        sample_dates.append(dates[end])
    X = np.asarray(X, dtype="float32").reshape(-1, lookback, 1)
    y = np.asarray(y, dtype="float32")
    return X, y, pd.DatetimeIndex(sample_dates)


def trend_features(rate: pd.Series) -> pd.DataFrame:
    """Lag/rolling features for the XGBoost trend classifier and the
    Isolation Forest anomaly detector, built purely from the univariate
    rate series (this dataset has no OHLC, only a daily close-equivalent).
    Every feature at row t only uses information available up to and
    including date t (no look-ahead)."""
    ret = log_returns(rate)
    feats = pd.DataFrame(index=rate.index)
    for lag in (0, 1, 2, 4, 9):
        feats[f"ret_lag{lag}"] = ret.shift(lag)
    for window in (5, 10, 20):
        feats[f"ret_roll_mean_{window}"] = ret.rolling(window).mean()
        feats[f"ret_roll_std_{window}"] = ret.rolling(window).std()
    feats["momentum_10"] = rate / rate.shift(10) - 1
    feats["zscore_20"] = (ret - ret.rolling(20).mean()) / ret.rolling(20).std()
    return feats


def trend_labels(rate: pd.Series, flat_threshold: float = 1e-4) -> pd.Series:
    """Next-period direction label built from tomorrow's return:
    1 = up, -1 = down, 0 = flat when |return| <= flat_threshold.
    Set flat_threshold=0 to disable the flat class (pure up/down).
    The last row is always NaN (no next-day return exists yet) — callers
    must drop it.
    """
    fwd_ret = log_returns(rate).shift(-1)
    label = pd.Series(np.sign(fwd_ret), index=rate.index)
    if flat_threshold > 0:
        label[fwd_ret.abs() <= flat_threshold] = 0
    return label


def majority_class_baseline(y_train, y_eval) -> dict:
    """Predicts the training set's single most frequent class for every
    eval row — the standard baseline for imbalanced classification."""
    from sklearn.metrics import accuracy_score, f1_score
    majority = Counter(y_train).most_common(1)[0][0]
    y_pred = [majority] * len(y_eval)
    return {
        "majority_class": majority,
        "accuracy": float(accuracy_score(y_eval, y_pred)),
        "f1_macro": float(f1_score(y_eval, y_pred, average="macro", zero_division=0)),
    }


def anomaly_features(rate: pd.Series) -> pd.DataFrame:
    """Engineered daily-move features for the Isolation Forest: raw and
    absolute return, rolling z-scores of the return, rolling realized
    volatility, and the gap between the rate and its 20-day moving
    average."""
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

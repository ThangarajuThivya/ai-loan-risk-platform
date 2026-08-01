# src/feature_engineering.py — shared train/serve feature-computation logic.
#
# Phase 4 factors this out of training/preprocessing_utils.py (the
# "canonical source" comment there flagged this as a Phase-4 TODO once the
# serving side needed the exact same feature computation as training — see
# CURRENCY_FEATURE.md §Phase 2). Every function here must stay numerically
# identical to its training-time counterpart:
#   - load_wide_rates / clean_currency_series / log_returns:
#     training/preprocessing_utils.py
#   - trailing_return / rolling_slope / trend_features_v2:
#     training/train_xgboost_trend_v2.py (the script that actually produced
#     models/xgb_trend_*_h90_v2.json — the superseded next-day v1 variant
#     has been removed; see git history if you need it)
#   - anomaly_features: training/train_isolation_forest.py (same logic as
#     training/preprocessing_utils.py's anomaly_features, kept in sync)
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


def load_wide_rates(path: Path | str) -> pd.DataFrame:
    """Loads exchange_rates_wide.{csv,parquet} (Phase 1 output). Returns a
    DatetimeIndex-indexed frame, one column per ISO currency code, values =
    currency units per 1 USD (already normalized — see DATA_DICTIONARY.md)."""
    path = Path(path)
    df = (pd.read_parquet(path) if path.suffix == ".parquet"
          else pd.read_csv(path, index_col=0, parse_dates=True))
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    return df.sort_index()


def clean_currency_series(series: pd.Series) -> pd.Series:
    """Restricts to the currency's own trading window (first->last valid
    observation) and forward-fills sparse `ND` gaps *within* that window
    only — never fills before a currency's first valid date (e.g. EUR is
    genuinely absent pre-1999, not missing data; see DATA_DICTIONARY.md)."""
    valid = series.dropna()
    if valid.empty:
        raise ValueError(f"{series.name}: no valid observations")
    windowed = series.loc[valid.index.min(): valid.index.max()]
    return windowed.ffill()


def log_returns(rate: pd.Series) -> pd.Series:
    return np.log(rate / rate.shift(1))


def trailing_return(rate: pd.Series, window: int) -> pd.Series:
    """Cumulative log return over the trailing `window` days, known as of day t."""
    return np.log(rate / rate.shift(window))


def rolling_slope(series: pd.Series, window: int) -> pd.Series:
    """OLS slope of `series` over the trailing `window` days."""
    x = np.arange(window, dtype=float)
    x_mean = x.mean()
    denom = ((x - x_mean) ** 2).sum()

    def _slope(y: np.ndarray) -> float:
        if np.isnan(y).any():
            return np.nan
        return float(((x - x_mean) * (y - y.mean())).sum() / denom)

    return series.rolling(window).apply(_slope, raw=True)


def trend_features_v2(rate: pd.Series, horizon: int) -> pd.DataFrame:
    """Long-horizon trend/momentum features — must exactly match
    training/train_xgboost_trend_v2.py's trend_features_v2() (same window
    set, same column names/order) since it defines the trained booster's
    expected feature vector."""
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


def anomaly_features(rate: pd.Series) -> pd.DataFrame:
    """Engineered daily-move features for the Isolation Forest — must
    exactly match training/train_isolation_forest.py's anomaly_features()."""
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

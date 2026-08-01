# src/config.py — shared configuration for the currency-forecast-model
# inference service (Phase 4 — see ../../CURRENCY_FEATURE.md).
#
# Mirrors the role of loan-risk-model/src/config.py: currency lists, paths,
# and artifact-naming constants used by both src/model_utils.py (loading)
# and api/main.py (validation). No model logic lives here.

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PROCESSED_DIR = BASE_DIR / "data" / "processed"
MODELS_DIR = BASE_DIR / "models"

WIDE_RATES_PARQUET = DATA_PROCESSED_DIR / "exchange_rates_wide.parquet"
WIDE_RATES_CSV = DATA_PROCESSED_DIR / "exchange_rates_wide.csv"

# Single source of truth for the data_vintage block (Phase 8 — see
# CURRENCY_FEATURE.md §10.2). Every response's actual cutoff DATE is still
# derived from the bundled historical series at load time (its last index),
# never hardcoded here or anywhere else — only the human-readable source
# name is a literal, since it can't be derived from the data itself.
TRAINING_DATA_SOURCE = "US Federal Reserve H.10"

# Every currency documented in DATA_DICTIONARY.md (Phase 1 output) — the
# full universe of what's actually in the Fed H.10 file. Used only to tell
# "not a real currency in this dataset" (400) apart from "real currency,
# just no trained model yet" (404) — see TRAINED_CURRENCIES below.
KNOWN_CURRENCIES = [
    "AUD", "BRL", "CAD", "CHF", "CNY", "DKK", "EUR", "GBP", "HKD", "INR",
    "JPY", "KRW", "LKR", "MXN", "MYR", "NOK", "NZD", "SEK", "SGD", "THB",
    "TWD", "VEB", "ZAR",
]

# Currencies that actually have trained artifacts in models/ (Phase 2/3 —
# see CURRENCY_FEATURE.md §7.1/§7.2). Every endpoint validates against this
# list, not KNOWN_CURRENCIES — a currency can be a legitimate H.10 series
# and still have no model.
TRAINED_CURRENCIES = ["LKR", "INR", "EUR", "GBP", "JPY"]

# --- v3: the 2026 data refresh ---------------------------------------------
# All four model families were retrained together on Fed H.10 data extended to
# 2026-07-24 (src/data_fetcher.py splices FRED onto the bundled Kaggle export).
# They share one version number from here on precisely because they must share
# one data vintage — a mixed set would put 2017-era and 2026-era numbers in the
# same response. Walk-forward split for all four: train <= 2022-12-31,
# val <= 2024-06-30, test = 2024-07-01 onward.

# --- LSTM forecast (one model per (currency, horizon)) ----------------------
LSTM_VERSION = "v3"
LSTM_LOOKBACK_DAYS = 60
# 90 is deliberately absent. On refreshed data the 90-day model scored 15.2%
# directional accuracy for LKR with MAE 2.7x worse than a naive random walk:
# it extrapolates the training window's trend and is systematically wrong once
# that trend reverses. It is kept in the training evaluation for the write-up
# but is NOT served. See models/lstm_metadata_v3.json's "excluded_horizons".
LSTM_HORIZONS = [1, 7, 30]

# --- XGBoost trend --------------------------------------------------------
# Predicts LONG-HORIZON (90 trading day) direction, binary up/down only (flat
# class disabled) — a different, easier task than next-day direction. See
# training/train_xgboost_trend_v2.py's module docstring for why.
# Honest status: still matches the majority-class baseline in 4 of 5
# currencies after the refresh (1/5 beat it, both before and after), so this
# is staff/admin decision support with its baseline shown, never a customer-
# facing prediction.
XGB_VERSION = "v3"
XGB_TREND_HORIZON_DAYS = 90

# --- GARCH(1,1) volatility --------------------------------------------------
# The pickled ARCHModelResult is fit on data through the training window end
# (2022-12-31), not the full history — its .forecast() is anchored there, not
# to "today"; model_utils filters the variance recursion forward over observed
# returns from that anchor. The strongest model in the stack: 13/15 cells beat
# a rolling-20-day realized-variance baseline on QLIKE after the refresh
# (10/15 before it).
GARCH_VERSION = "v3"
GARCH_DEFAULT_HORIZON_DAYS = 30
GARCH_MAX_HORIZON_DAYS = 90

# --- Isolation Forest anomaly detection -------------------------------------
ISOFOREST_VERSION = "v3"
# anomaly_features() needs a rolling(20) window on the return series, which
# itself needs a shift(1) — 20 valid returns requires 21 raw price points.
ISOFOREST_MIN_WINDOW = 21

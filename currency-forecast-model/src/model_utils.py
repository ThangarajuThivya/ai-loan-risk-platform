# src/model_utils.py — load/predict wrappers for the four trained models
# (LSTM forecast, XGBoost trend, GARCH volatility, Isolation Forest anomaly),
# called from api/main.py. Mirrors the role of
# loan-risk-model/src/model_utils.py's predict_risk() — api/main.py stays a
# thin wrapper around CurrencyModelService, no model logic inline there.
#
# Stateless per request: the only state is the immutable set of artifacts
# loaded once at startup (see load_all()) plus the bundled historical rate
# series used to build "as of the last available date" feature windows for
# /forecast, /trend, and /volatility (none of which take price data in the
# request — only /anomaly does, via `recent_window`).
from __future__ import annotations

import json
import pickle
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from src.config import (
    GARCH_VERSION,
    ISOFOREST_VERSION,
    LSTM_HORIZONS,
    LSTM_LOOKBACK_DAYS,
    LSTM_VERSION,
    MODELS_DIR,
    TRAINED_CURRENCIES,
    TRAINING_DATA_SOURCE,
    XGB_TREND_HORIZON_DAYS,
    XGB_VERSION,
)
from src.feature_engineering import (
    anomaly_features,
    clean_currency_series,
    log_returns,
    trend_features_v2,
)


class ArtifactMissingError(RuntimeError):
    """Raised at startup when a required model artifact file is missing."""


def _require_file(path: Path) -> Path:
    if not path.exists():
        raise ArtifactMissingError(f"Required model artifact missing: {path}")
    return path


class CurrencyModelService:
    """Loads every trained artifact once at startup and serves predictions
    for the TRAINED_CURRENCIES. Not thread-unsafe-mutated after load_all()."""

    def __init__(self, historical_wide: pd.DataFrame):
        self.historical = historical_wide
        self.lstm: dict[str, dict[int, dict]] = {}
        self.xgb_booster: dict[str, xgb.Booster] = {}
        self.xgb_feature_columns: list[str] = []
        self.garch: dict[str, object] = {}
        self.volatility_thresholds: dict[str, dict[str, float]] = {}
        self.isoforest: dict[str, object] = {}
        self.isoforest_feature_columns: list[str] = []
        self._series_cache: dict[str, pd.Series] = {}
        # ccy -> (params dict, filtered conditional variance path). Built
        # lazily by _filtered_garch_state() and reused across requests — the
        # recursion is O(n) over ~11k daily observations, which is cheap once
        # and wasteful per-request.
        self._garch_state_cache: dict[str, tuple[dict, np.ndarray]] = {}
        # model family -> {"version": str, "trained_at": str|None} — powers
        # every response's data_vintage block (Phase 8, CURRENCY_FEATURE.md §10.2).
        self.model_metadata: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Loading — fails clearly (raises) if any expected artifact is missing.
    # ------------------------------------------------------------------
    def load_all(self) -> None:
        self._load_lstm()
        self._load_xgb()
        self._load_garch()
        self._load_isoforest()
        self._load_model_metadata()

    def _load_lstm(self) -> None:
        import tensorflow as tf

        for ccy in TRAINED_CURRENCIES:
            self.lstm[ccy] = {}
            for h in LSTM_HORIZONS:
                model_path = _require_file(
                    MODELS_DIR / f"lstm_forecast_{ccy}_h{h}_{LSTM_VERSION}.keras"
                )
                scaler_path = _require_file(
                    MODELS_DIR / f"lstm_scalers_{ccy}_h{h}_{LSTM_VERSION}.joblib"
                )
                scalers = joblib.load(scaler_path)
                self.lstm[ccy][h] = {
                    "model": tf.keras.models.load_model(model_path),
                    "price_scaler": scalers["price_scaler"],
                    "delta_scaler": scalers["delta_scaler"],
                }

    def _load_xgb(self) -> None:
        features_path = _require_file(
            MODELS_DIR / f"xgb_trend_features_h{XGB_TREND_HORIZON_DAYS}_{XGB_VERSION}.json"
        )
        self.xgb_feature_columns = json.loads(features_path.read_text())["feature_columns"]

        for ccy in TRAINED_CURRENCIES:
            model_path = _require_file(
                MODELS_DIR / f"xgb_trend_{ccy}_h{XGB_TREND_HORIZON_DAYS}_{XGB_VERSION}.json"
            )
            booster = xgb.Booster()
            booster.load_model(str(model_path))
            if booster.feature_names and list(booster.feature_names) != self.xgb_feature_columns:
                raise ArtifactMissingError(
                    f"{model_path.name}: feature order {booster.feature_names} does not match "
                    f"xgb_trend_features_h{XGB_TREND_HORIZON_DAYS}_{XGB_VERSION}.json {self.xgb_feature_columns}"
                )
            self.xgb_booster[ccy] = booster

    def _load_garch(self) -> None:
        for ccy in TRAINED_CURRENCIES:
            pkl_path = _require_file(MODELS_DIR / f"garch_{ccy}_{GARCH_VERSION}.pkl")
            with open(pkl_path, "rb") as f:
                self.garch[ccy] = pickle.load(f)
            self.volatility_thresholds[ccy] = self._compute_volatility_thresholds(ccy)

    def _load_isoforest(self) -> None:
        features_path = _require_file(MODELS_DIR / f"isoforest_features_{ISOFOREST_VERSION}.json")
        self.isoforest_feature_columns = json.loads(features_path.read_text())["feature_columns"]

        for ccy in TRAINED_CURRENCIES:
            model_path = _require_file(MODELS_DIR / f"isoforest_{ccy}_{ISOFOREST_VERSION}.joblib")
            pipeline = joblib.load(model_path)
            fitted_names = getattr(pipeline.named_steps.get("scaler"), "feature_names_in_", None)
            if fitted_names is not None and list(fitted_names) != self.isoforest_feature_columns:
                raise ArtifactMissingError(
                    f"{model_path.name}: fitted feature order {list(fitted_names)} does not match "
                    f"isoforest_features_{ISOFOREST_VERSION}.json {self.isoforest_feature_columns}"
                )
            self.isoforest[ccy] = pipeline

    def _load_model_metadata(self) -> None:
        """Populates self.model_metadata from each model family's own saved
        training-run JSON where one exists (garch_params_*.json,
        xgb_trend_metadata_*.json, isoforest_features_*.json all carry a
        `trained_at` written at training time). The LSTM notebook doesn't
        persist a metadata file, so its `trained_at` falls back to the
        earliest artifact file's mtime — still derived from the artifacts on
        disk, never a hardcoded literal."""
        self.model_metadata = {
            "lstm": self._read_or_infer_metadata(
                MODELS_DIR / f"lstm_metadata_{LSTM_VERSION}.json",
                fallback_version=LSTM_VERSION,
                mtime_glob=f"lstm_forecast_*_{LSTM_VERSION}.keras",
            ),
            "xgb": self._read_or_infer_metadata(
                MODELS_DIR / f"xgb_trend_metadata_h{XGB_TREND_HORIZON_DAYS}_{XGB_VERSION}.json",
                fallback_version=XGB_VERSION,
                mtime_glob=f"xgb_trend_*_h{XGB_TREND_HORIZON_DAYS}_{XGB_VERSION}.json",
            ),
            "garch": self._read_or_infer_metadata(
                MODELS_DIR / f"garch_params_{GARCH_VERSION}.json",
                fallback_version=GARCH_VERSION,
                mtime_glob=f"garch_*_{GARCH_VERSION}.pkl",
            ),
            "isoforest": self._read_or_infer_metadata(
                MODELS_DIR / f"isoforest_features_{ISOFOREST_VERSION}.json",
                fallback_version=ISOFOREST_VERSION,
                mtime_glob=f"isoforest_*_{ISOFOREST_VERSION}.joblib",
            ),
        }

    @staticmethod
    def _read_or_infer_metadata(metadata_path: Path, *, fallback_version: str, mtime_glob: str) -> dict:
        if metadata_path.exists():
            meta = json.loads(metadata_path.read_text())
            return {
                "version": meta.get("version", fallback_version),
                "trained_at": meta.get("trained_at"),
            }

        candidates = sorted(MODELS_DIR.glob(mtime_glob))
        trained_at = None
        if candidates:
            earliest_mtime = min(c.stat().st_mtime for c in candidates)
            trained_at = datetime.fromtimestamp(earliest_mtime, tz=timezone.utc).isoformat()
        return {"version": fallback_version, "trained_at": trained_at}

    # Sentinel so data_vintage() can tell "caller didn't pass this" (use the
    # series-derived default) apart from "caller explicitly passed None"
    # (force null, e.g. /anomaly's last_observed_date — see predict_anomaly).
    _UNSET = object()

    def data_vintage(
        self,
        ccy: str,
        model_family: str,
        *,
        training_data_end: str | None = None,
        last_observed_rate=None,
        last_observed_date=_UNSET,
    ) -> dict:
        """The provenance block attached to every prediction response
        (Phase 8, CURRENCY_FEATURE.md §10.2) — makes explicit that this
        service has no live feed and is answering from a fixed historical
        cutoff, not "today". Defaults to the bundled H.10 series' own last
        date, but a model whose *own* fitted state stops earlier than the
        bundled series (GARCH — see predict_volatility) overrides all three
        date/rate fields with its real anchor, not the series' latest row."""
        series = self.series(ccy)
        series_end_date = series.index[-1].date().isoformat()
        series_end_rate = float(series.iloc[-1])
        meta = self.model_metadata[model_family]
        return {
            "training_data_source": TRAINING_DATA_SOURCE,
            "training_data_end": training_data_end or series_end_date,
            "last_observed_rate": series_end_rate if last_observed_rate is None else last_observed_rate,
            "last_observed_date": series_end_date if last_observed_date is self._UNSET else last_observed_date,
            "is_live": False,
            "model_version": meta["version"],
            "trained_at": meta["trained_at"],
        }

    # ------------------------------------------------------------------
    # Historical series access (bundled reference data, not live/DB-backed)
    # ------------------------------------------------------------------
    def series(self, ccy: str) -> pd.Series:
        if ccy not in self._series_cache:
            self._series_cache[ccy] = clean_currency_series(self.historical[ccy])
        return self._series_cache[ccy]

    def _compute_volatility_thresholds(self, ccy: str) -> dict[str, float]:
        """Per-currency low/medium/high volatility bands, from tertiles of
        that currency's own historical realized (rolling 20d) volatility —
        deliberately currency-specific rather than one fixed cutoff for all
        (LKR and JPY have very different baseline volatility regimes)."""
        ret = log_returns(self.series(ccy)).dropna() * 100  # match GARCH's RETURN_SCALE=100
        realized_vol = ret.rolling(20).std().dropna()
        return {
            "low": float(realized_vol.quantile(1 / 3)),
            "high": float(realized_vol.quantile(2 / 3)),
        }

    # ------------------------------------------------------------------
    # Predictions
    # ------------------------------------------------------------------
    def predict_forecast(self, ccy: str, horizons: list[int]) -> dict:
        series = self.series(ccy)
        if len(series) < LSTM_LOOKBACK_DAYS:
            raise ValueError(
                f"{ccy}: only {len(series)} observations available, need at least "
                f"{LSTM_LOOKBACK_DAYS} for the LSTM's input window"
            )
        as_of_date = series.index[-1]
        last_rate = float(series.iloc[-1])
        window = series.iloc[-LSTM_LOOKBACK_DAYS:].to_numpy().reshape(-1, 1)

        forecasts = []
        for h in horizons:
            bundle = self.lstm[ccy][h]
            price_scaler, delta_scaler, model = bundle["price_scaler"], bundle["delta_scaler"], bundle["model"]

            scaled = price_scaler.transform(window).ravel()
            X = scaled.reshape(1, LSTM_LOOKBACK_DAYS, 1).astype("float32")
            pred_delta_scaled = model.predict(X, verbose=0).ravel()
            pred_delta = delta_scaler.inverse_transform(pred_delta_scaled.reshape(-1, 1)).ravel()[0]

            anchor_scaled = scaled[-1]
            pred_level_scaled = anchor_scaled + pred_delta
            pred_rate = float(price_scaler.inverse_transform([[pred_level_scaled]])[0, 0])

            forecasts.append({
                "horizon_days": h,
                "predicted_rate": pred_rate,
                "naive_baseline_rate": last_rate,
            })

        return {
            "as_of_date": as_of_date.date().isoformat(),
            "last_known_rate": last_rate,
            "forecasts": forecasts,
            "data_vintage": self.data_vintage(ccy, "lstm"),
        }

    def predict_trend(self, ccy: str) -> dict:
        series = self.series(ccy)
        feats = trend_features_v2(series, XGB_TREND_HORIZON_DAYS)[self.xgb_feature_columns].dropna()
        if feats.empty:
            raise ValueError(f"{ccy}: not enough history to compute the long-horizon trend features")

        latest = feats.iloc[[-1]]
        as_of_date = latest.index[-1]
        dmat = xgb.DMatrix(latest.to_numpy(), feature_names=self.xgb_feature_columns)
        prob_up = float(self.xgb_booster[ccy].predict(dmat)[0])

        return {
            "as_of_date": as_of_date.date().isoformat(),
            "horizon_days": XGB_TREND_HORIZON_DAYS,
            "trend_label": "up" if prob_up >= 0.5 else "down",
            "probabilities": {"down": round(1 - prob_up, 6), "up": round(prob_up, 6)},
            "confidence": max(prob_up, 1 - prob_up),
            "data_vintage": self.data_vintage(ccy, "xgb"),
        }

    def _filtered_garch_state(self, ccy: str) -> tuple[dict, np.ndarray]:
        """Advance the fitted GARCH(1,1) state to the end of the bundled
        series, without re-estimating anything.

        The pickled ARCHModelResult's own recursive state stops at its fit
        date (TRAIN_END, 2011-12-31), six years before the series ends — so
        `res.forecast()` used to answer from 2011 state regardless of every
        observation since. GARCH's conditional variance is a deterministic
        recursion given the parameters and the observed residuals:

            sigma2[t] = omega + alpha * resid[t-1]**2 + beta * sigma2[t-1]

        so running it forward over the observed returns brings the state to
        the present. PARAMETERS are untouched — still exactly as fitted in
        2011, which keeps every post-2011 observation genuinely out of
        sample. Only the state moves. This is standard out-of-sample
        practice, and training/evaluate_garch_volatility.py measures the
        result: 14/15 (currency, horizon) cells beat a rolling realized-
        variance baseline on QLIKE (CURRENCY_FEATURE.md §28).

        Before this, the served band was materially wrong — INR's reported
        volatility was ~3x the filtered value and JPY's ~40% below it (§28.4).

        Returns (params, sigma2) where sigma2 has one element MORE than the
        return series: sigma2[-2] is the variance of the last observed
        period and sigma2[-1] is the one-step-ahead forecast from it, which
        is where the forecast path below starts.
        """
        if ccy in self._garch_state_cache:
            return self._garch_state_cache[ccy]

        res = self.garch[ccy]
        p = res.params
        params = {
            "omega": float(p["omega"]),
            "alpha": float(p["alpha[1]"]),
            "beta": float(p["beta[1]"]),
            "mu": float(p.get("mu", 0.0)),
        }

        # RETURN_SCALE=100 — the models were fit on percent log-returns
        # (garch_params_v1.json's refit_config).
        ret = log_returns(self.series(ccy)).dropna() * 100
        resid = (ret - params["mu"]).to_numpy()

        n = len(resid)
        sigma2 = np.empty(n + 1, dtype=float)
        # Seed from the fitted model's own final state so the filtered path
        # continues the pickle rather than restarting from a guess.
        sigma2[0] = float(res.conditional_volatility.iloc[-1] ** 2)
        for t in range(1, n + 1):
            sigma2[t] = (
                params["omega"]
                + params["alpha"] * resid[t - 1] ** 2
                + params["beta"] * sigma2[t - 1]
            )

        self._garch_state_cache[ccy] = (params, sigma2)
        return params, sigma2

    @staticmethod
    def _garch_forecast_path(sigma2_next: float, params: dict, horizon_days: int) -> list[float]:
        """Per-step variance forecasts for 1..horizon_days ahead.

        Standard GARCH(1,1) multi-step result: with persistence
        psi = alpha+beta and unconditional variance sbar = omega/(1-psi),

            E[sigma2[t+i] | F_t] = sbar + psi**(i-1) * (sigma2[t+1] - sbar)

        When psi -> 1 that limit diverges and the integrated form applies:

            E[sigma2[t+i] | F_t] = sigma2[t+1] + (i-1) * omega

        i.e. variance drifts linearly instead of mean-reverting. Not a
        defensive edge case here — every shipped model has persistence
        between 0.996 and 1.000, and LKR sits at 0.99999997 (§28.3), so this
        branch is load-bearing.
        """
        omega, psi = params["omega"], params["alpha"] + params["beta"]
        if abs(1.0 - psi) < 1e-6:
            return [sigma2_next + (i - 1) * omega for i in range(1, horizon_days + 1)]
        sbar = omega / (1.0 - psi)
        return [sbar + psi ** (i - 1) * (sigma2_next - sbar) for i in range(1, horizon_days + 1)]

    def predict_volatility(self, ccy: str, horizon_days: int) -> dict:
        params, sigma2 = self._filtered_garch_state(ccy)

        # sigma2[-2] = variance of the last observed period (what "current
        # volatility" means); sigma2[-1] = the one-step-ahead forecast the
        # path starts from.
        current_vol_pct = float(np.sqrt(sigma2[-2]))
        forecast_vol_pct = [
            float(np.sqrt(v)) for v in self._garch_forecast_path(sigma2[-1], params, horizon_days)
        ]

        thresholds = self.volatility_thresholds[ccy]
        if current_vol_pct <= thresholds["low"]:
            band = "low"
        elif current_vol_pct <= thresholds["high"]:
            band = "medium"
        else:
            band = "high"

        # Provenance now splits two dates that used to be collapsed into one
        # (Phase 28, CURRENCY_FEATURE.md §29):
        #   training_data_end  — when the PARAMETERS stop being informed by
        #                        data. Still 2011-12-31; filtering forward
        #                        does not retrain anything, and claiming
        #                        otherwise would overstate the model.
        #   last_observed_*    — the state's own anchor, now the series end,
        #                        because the recursion HAS consumed every
        #                        observation up to it.
        # Before the fix both reported the 2011 fit date, which was correct
        # for a forecast anchored there and is wrong for a filtered one.
        fit_end = pd.Timestamp(self.garch[ccy].conditional_volatility.index[-1]).date().isoformat()
        return {
            "horizon_days": horizon_days,
            "current_conditional_volatility_pct": current_vol_pct,
            "forecast_volatility_pct": forecast_vol_pct,
            "average_forecast_volatility_pct": float(np.mean(forecast_vol_pct)),
            "band": band,
            "data_vintage": self.data_vintage(ccy, "garch", training_data_end=fit_end),
        }

    def predict_anomaly(self, ccy: str, recent_window: list[float]) -> dict:
        feats = anomaly_features(pd.Series(recent_window, dtype=float))
        feats = feats[self.isoforest_feature_columns].dropna()
        if feats.empty:
            raise ValueError(
                "recent_window too short to compute anomaly features "
                "(need at least ISOFOREST_MIN_WINDOW valid, contiguous daily observations)"
            )

        latest = feats.iloc[[-1]]
        pipeline = self.isoforest[ccy]
        label = int(pipeline.predict(latest)[0])
        # decision_function: lower = more abnormal. Negate so higher score = more anomalous.
        score = float(-pipeline.decision_function(latest)[0])

        # Unlike the other three endpoints, /anomaly scores a caller-supplied
        # window, not the bundled series — it has no date of its own, so
        # last_observed_date is left null rather than implying one. The model
        # itself is still H.10-trained (training_data_end unchanged), even
        # though the gateway may feed this a genuinely live window.
        return {
            "is_anomalous": label == -1,
            "anomaly_score": score,
            "data_vintage": self.data_vintage(
                ccy,
                "isoforest",
                last_observed_rate=float(recent_window[-1]),
                last_observed_date=None,
            ),
        }

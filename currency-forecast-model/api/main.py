# api/main.py — currency-forecast-model service entry point.
#
# Mirrors the loan-risk-model/api/main.py convention: FastAPI app, artifacts
# loaded once at startup, stateless request/response only — no DB, no
# business logic. Called exclusively by the Node gateway (finance-backend),
# never by the SPA directly (ARCHITECTURE.md P1/P2).
import os
import sys
from typing import List, Optional

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from src.config import (
    GARCH_MAX_HORIZON_DAYS,
    GARCH_VERSION,
    ISOFOREST_MIN_WINDOW,
    ISOFOREST_VERSION,
    KNOWN_CURRENCIES,
    LSTM_HORIZONS,
    LSTM_VERSION,
    TRAINED_CURRENCIES,
    TRAINING_DATA_SOURCE,
    WIDE_RATES_CSV,
    WIDE_RATES_PARQUET,
    XGB_TREND_HORIZON_DAYS,
    XGB_VERSION,
)
from src.feature_engineering import load_wide_rates
from src.model_utils import CurrencyModelService

app = FastAPI(
    title="Currency Exchange-Rate Analytics API",
    description=(
        "Forecasts and analyzes USD-denominated exchange rates from the "
        "Federal Reserve H.10 release using four models: LSTM forecast, "
        "XGBoost long-horizon trend, GARCH volatility, Isolation Forest "
        "anomaly detection."
    ),
    version="1.0.0",
)

service: Optional[CurrencyModelService] = None


@app.on_event("startup")
def load_artifacts():
    global service
    data_path = WIDE_RATES_PARQUET if WIDE_RATES_PARQUET.exists() else WIDE_RATES_CSV
    if not data_path.exists():
        raise RuntimeError(
            f"Historical rate data not found at {WIDE_RATES_PARQUET} or {WIDE_RATES_CSV}. "
            "Run data/prepare_data.py first (see ../DATA_DICTIONARY.md)."
        )
    historical_wide = load_wide_rates(data_path)
    service = CurrencyModelService(historical_wide)
    service.load_all()
    print(f"Loaded model artifacts for: {', '.join(TRAINED_CURRENCIES)}")


def _resolve_currency(currency: str) -> str:
    ccy = currency.strip().upper()
    if ccy not in KNOWN_CURRENCIES:
        raise HTTPException(
            status_code=400,
            detail=f"'{currency}' is not a currency in the Fed H.10 dataset. "
                   f"Known currencies: {KNOWN_CURRENCIES}",
        )
    if ccy not in TRAINED_CURRENCIES:
        raise HTTPException(
            status_code=404,
            detail=f"'{ccy}' is a valid H.10 currency but has no trained model yet. "
                   f"Currently trained: {TRAINED_CURRENCIES}",
        )
    return ccy


def _require_service() -> CurrencyModelService:
    if service is None:
        raise HTTPException(status_code=503, detail="Model artifacts not loaded yet. Please try again shortly.")
    return service


# ----------------------------------------------------------------------------
# Request / response models
# ----------------------------------------------------------------------------

class ForecastRequest(BaseModel):
    currency: str = Field(..., json_schema_extra={"example": "LKR"})
    horizons: Optional[List[int]] = Field(
        default=None,
        description=f"Subset of {LSTM_HORIZONS}. Defaults to all four if omitted.",
        json_schema_extra={"example": [1, 7, 30, 90]},
    )

    @field_validator("horizons")
    @classmethod
    def _validate_horizons(cls, v):
        if v is None:
            return v
        bad = [h for h in v if h not in LSTM_HORIZONS]
        if bad:
            raise ValueError(f"Unsupported horizon(s) {bad}; must be a subset of {LSTM_HORIZONS}")
        return v


class HorizonForecast(BaseModel):
    horizon_days: int
    predicted_rate: float
    naive_baseline_rate: float


class DataVintage(BaseModel):
    """Provenance block on every prediction response (Phase 8 — see
    ../CURRENCY_FEATURE.md §10.2): makes explicit which historical cutoff a
    prediction is actually anchored to, since this service has no live feed
    and must never be mistaken for a current-market forecast."""

    training_data_source: str
    training_data_end: str
    last_observed_rate: Optional[float] = None
    last_observed_date: Optional[str] = None
    is_live: bool = False
    model_version: str
    trained_at: Optional[str] = None


class ForecastResponse(BaseModel):
    currency: str
    as_of_date: str
    last_known_rate: float
    forecasts: List[HorizonForecast]
    model_version: str = LSTM_VERSION
    data_vintage: DataVintage


class TrendRequest(BaseModel):
    currency: str = Field(..., json_schema_extra={"example": "LKR"})


class TrendResponse(BaseModel):
    currency: str
    as_of_date: str
    horizon_days: int = XGB_TREND_HORIZON_DAYS
    trend_label: str
    probabilities: dict
    confidence: float
    model_version: str = XGB_VERSION
    data_vintage: DataVintage


class VolatilityRequest(BaseModel):
    currency: str = Field(..., json_schema_extra={"example": "LKR"})
    horizon_days: int = Field(default=30, ge=1, le=GARCH_MAX_HORIZON_DAYS)


class VolatilityResponse(BaseModel):
    currency: str
    horizon_days: int
    current_conditional_volatility_pct: float
    forecast_volatility_pct: List[float]
    average_forecast_volatility_pct: float
    band: str
    model_version: str = GARCH_VERSION
    data_vintage: DataVintage


class AnomalyRequest(BaseModel):
    currency: str = Field(..., json_schema_extra={"example": "LKR"})
    recent_window: List[float] = Field(
        ...,
        min_length=ISOFOREST_MIN_WINDOW,
        description=(
            f"Most recent daily rates, oldest first, newest last. Needs at least "
            f"{ISOFOREST_MIN_WINDOW} contiguous observations to compute rolling features."
        ),
        json_schema_extra={"example": [
            290.1, 290.3, 289.9, 290.0, 291.2, 290.8, 290.5, 290.6, 290.9,
            291.0, 290.7, 290.4, 290.2, 290.1, 290.3, 290.6, 290.8, 291.1,
            291.4, 291.2, 291.0,
        ]},
    )


class AnomalyResponse(BaseModel):
    currency: str
    is_anomalous: bool
    anomaly_score: float
    model_version: str = ISOFOREST_VERSION
    data_vintage: DataVintage


class AnalyzeRequest(BaseModel):
    currency: str = Field(..., json_schema_extra={"example": "LKR"})


class AnalyzeResponse(BaseModel):
    currency: str
    forecast: ForecastResponse
    trend: TrendResponse
    volatility: VolatilityResponse
    anomaly: AnomalyResponse


# ----------------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------------

@app.get("/health")
def health():
    data_vintage = None
    if service is not None:
        # Conservative (min, not max) across trained currencies in case a
        # future currency's bundled series ever ends on a different date —
        # today all five share the same last row (2017-08-25).
        training_data_end = min(
            service.series(ccy).index[-1].date() for ccy in TRAINED_CURRENCIES
        ).isoformat()
        data_vintage = {
            "training_data_source": TRAINING_DATA_SOURCE,
            "training_data_end": training_data_end,
            "is_live": False,
            "model_version": {family: meta["version"] for family, meta in service.model_metadata.items()},
            "trained_at": {family: meta["trained_at"] for family, meta in service.model_metadata.items()},
        }

    return {
        "status": "ok",
        "service": "currency-forecast-model",
        "models_loaded": service is not None,
        "trained_currencies": TRAINED_CURRENCIES,
        "data_vintage": data_vintage,
    }


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    svc = _require_service()
    ccy = _resolve_currency(req.currency)
    horizons = req.horizons or LSTM_HORIZONS
    try:
        result = svc.predict_forecast(ccy, horizons)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Forecast error: {e}")
    return ForecastResponse(currency=ccy, **result)


@app.post("/trend", response_model=TrendResponse)
def trend(req: TrendRequest):
    svc = _require_service()
    ccy = _resolve_currency(req.currency)
    try:
        result = svc.predict_trend(ccy)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Trend error: {e}")
    return TrendResponse(currency=ccy, **result)


@app.post("/volatility", response_model=VolatilityResponse)
def volatility(req: VolatilityRequest):
    svc = _require_service()
    ccy = _resolve_currency(req.currency)
    try:
        result = svc.predict_volatility(ccy, req.horizon_days)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Volatility error: {e}")
    return VolatilityResponse(currency=ccy, **result)


@app.post("/anomaly", response_model=AnomalyResponse)
def anomaly(req: AnomalyRequest):
    svc = _require_service()
    ccy = _resolve_currency(req.currency)
    try:
        result = svc.predict_anomaly(ccy, req.recent_window)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Anomaly error: {e}")
    return AnomalyResponse(currency=ccy, **result)


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    svc = _require_service()
    ccy = _resolve_currency(req.currency)
    try:
        forecast_result = svc.predict_forecast(ccy, LSTM_HORIZONS)
        trend_result = svc.predict_trend(ccy)
        volatility_result = svc.predict_volatility(ccy, GARCH_MAX_HORIZON_DAYS // 3)
        recent_window = svc.series(ccy).iloc[-60:].tolist()
        anomaly_result = svc.predict_anomaly(ccy, recent_window)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Analyze error: {e}")

    return AnalyzeResponse(
        currency=ccy,
        forecast=ForecastResponse(currency=ccy, **forecast_result),
        trend=TrendResponse(currency=ccy, **trend_result),
        volatility=VolatilityResponse(currency=ccy, **volatility_result),
        anomaly=AnomalyResponse(currency=ccy, **anomaly_result),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.main:app", host="127.0.0.1", port=8100, reload=True)

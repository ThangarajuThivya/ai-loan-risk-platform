# api/main.py
"""
Sri Lanka Credit Risk Prediction API (v2).

A stateless features-in / risk-out service. No database, no business logic —
the Node gateway owns both (ARCHITECTURE.md P2).

WHAT CHANGED IN v2
------------------
  * The risk band is now DERIVED FROM THE PROBABILITY OF DEFAULT rather than
    read off the classifier's argmax. The model is well calibrated, so the
    band is a threshold on a meaningful number instead of the winner of a
    three-way vote — and the thresholds can be re-tuned in src/config.py
    without retraining. Measured on the held-out set, banding catches 77.7%
    of defaults against argmax's 61.9%.

  * `probability_of_default` is returned explicitly. It is the number the
    gateway should price off; the band is a convenience for display.

  * `gender` is no longer accepted. It is a protected attribute and must not
    influence a credit decision (src/config.py
    EXCLUDED_PROTECTED_ATTRIBUTES). Sending it is not an error — it is
    ignored — so an older gateway build does not break.

  * `previous_defaults` and `loan_burden_ratio` are gone. The first was an
    unused duplicate of `number_of_defaults`; the second was algebraically
    identical to `debt_to_income_ratio`.

  * Categorical values are validated against the vocabulary the model was
    actually trained on, so an unrecognised province fails loudly here rather
    than silently becoming an all-zero one-hot block downstream.
"""

import hashlib
import os
import sys

# Resolve `src` when running from the project root.
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import joblib  # noqa: E402
import pandas as pd  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from typing import Optional

from pydantic import BaseModel, Field, field_validator  # noqa: E402

from src.config import (  # noqa: E402
    EDUCATION_LEVELS,
    EMPLOYER_CATEGORIES,
    EMPLOYMENT_TYPES,
    MARITAL_STATUSES,
    OCCUPATIONS,
    PD_BAND_HIGH,
    PD_BAND_MEDIUM,
    PROVINCE_WEIGHTS,
    RISK_LABELS,
    RISK_OUTCOME_MEANING,
)
from src.model_utils import band_from_pd, predict_risk  # noqa: E402

MODEL_PATH = "model_artifacts/xgboost_model.joblib"
PREPROCESSOR_PATH = "model_artifacts/preprocessor.joblib"

app = FastAPI(
    title="Sri Lanka Credit Risk Prediction API",
    description=(
        "Predicts probability of default and a Low/Medium/High risk band "
        "using Sri Lankan CRIB-enhanced features."
    ),
    version="2.0.0",
)

model = None
preprocessor = None

# Identifies exactly which trained model produced a prediction, for the
# gateway's audit records (risk_assessments.model_version). Derived from the
# artifact FILE's own content rather than a hand-maintained version string:
# retraining and redeploying changes this automatically, with no step to
# forget and no way for the label to drift from the file in use.
MODEL_VERSION = None

PROVINCES = list(PROVINCE_WEIGHTS.keys())


def _artifact_hash(path: str, length: int = 12) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()[:length]


@app.on_event("startup")
def load_artifacts():
    global model, preprocessor, MODEL_VERSION
    if not os.path.exists(MODEL_PATH) or not os.path.exists(PREPROCESSOR_PATH):
        raise RuntimeError(
            "Model artifacts not found. Run 'python -m src.data_generator' then "
            "'python -m src.model_utils' to build them."
        )
    model = joblib.load(MODEL_PATH)
    preprocessor = joblib.load(PREPROCESSOR_PATH)
    MODEL_VERSION = _artifact_hash(MODEL_PATH)
    print(f"Model and preprocessor loaded. model_version={MODEL_VERSION}")


def _one_of(field_name: str, allowed: list):
    """Reject a categorical the model was never trained on, rather than
    letting OneHotEncoder(handle_unknown='ignore') quietly zero it out."""

    def _check(v: str) -> str:
        if v not in allowed:
            raise ValueError(
                f"{field_name} must be one of {allowed} (received {v!r})"
            )
        return v

    return _check


class LoanApplicant(BaseModel):
    """
    The raw applicant fields. The derived features (emi, debt_to_income_ratio,
    disposable_income, guarantor_risk_score, financial_stability_score, ...)
    are computed server-side and are deliberately NOT accepted here — a caller
    must not be able to hand the model a flattering stability score, and
    train/serve logic cannot drift because both sides call the same function.

    Unknown fields are ignored rather than rejected, so a gateway still
    sending v1's `gender` / `previous_defaults` keeps working.
    """

    model_config = {"extra": "ignore"}

    # --- Personal ---
    age: int = Field(..., ge=18, le=100, examples=[34])
    marital_status: str = Field(..., examples=["Married"])
    province: str = Field(..., examples=["Western"])
    education_level: str = Field(..., examples=["Bachelor"])
    occupation: str = Field(..., examples=["Private Sector"])
    employment_type: str = Field(..., examples=["Permanent"])
    years_employed: int = Field(..., ge=0, le=60, examples=[7])

    # --- Income ---
    monthly_salary: float = Field(..., ge=0, examples=[185000])
    additional_income: float = Field(..., ge=0, examples=[25000])
    income_stability: float = Field(..., ge=0, le=1, examples=[0.85])
    employer_category: str = Field(..., examples=["Large Corporate"])

    # --- Expenses & banking ---
    monthly_expenses: float = Field(..., ge=0, examples=[125000])
    rent: float = Field(..., ge=0, examples=[45000])
    savings_ratio: float = Field(..., ge=0, le=1, examples=[0.18])
    avg_bank_balance: float = Field(..., ge=0, examples=[420000])
    digital_payment_ratio: float = Field(..., ge=0, le=1, examples=[0.75])

    # --- The loan being applied for ---
    existing_loans: Optional[int] = Field(None, ge=0, examples=[1])
    loan_amount: float = Field(..., gt=0, examples=[2500000])
    loan_tenure_months: int = Field(..., gt=0, le=480, examples=[36])
    interest_rate: float = Field(
        ..., ge=0, le=100, examples=[14.5],
        description="The loan product's BASE rate. Not the risk-priced rate — "
                    "that is an output of this assessment, not an input to it.",
    )

    # --- CRIB / internal behavioural history ---
    crib_score: Optional[int] = Field(None, ge=250, le=900, examples=[720])
    active_facilities: Optional[int] = Field(None, ge=0, examples=[2])
    credit_utilization: Optional[float] = Field(None, ge=0, le=100, examples=[35])
    number_of_defaults: Optional[int] = Field(None, ge=0, examples=[0])
    overdue_installments: Optional[int] = Field(None, ge=0, examples=[0])
    settled_loans: Optional[int] = Field(None, ge=0, examples=[3])
    historical_delinquencies: Optional[int] = Field(None, ge=0, examples=[1])
    credit_inquiry_count: Optional[int] = Field(None, ge=0, examples=[2])
    guarantor_exposure: float = Field(..., ge=0, examples=[0])
    guarantor_defaults: int = Field(
        ..., ge=0, examples=[0],
        description="Times this applicant, as guarantor, had to settle another "
                    "borrower's defaulted facility.",
    )
    loan_restructuring_history: Optional[int] = Field(None, ge=0, examples=[0])
    highest_outstanding_balance: Optional[float] = Field(None, ge=0, examples=[1800000])
    avg_repayment_behaviour: Optional[float] = Field(None, ge=0, le=1, examples=[0.92])

    _v_marital = field_validator("marital_status")(
        _one_of("marital_status", MARITAL_STATUSES))
    _v_province = field_validator("province")(_one_of("province", PROVINCES))
    _v_education = field_validator("education_level")(
        _one_of("education_level", EDUCATION_LEVELS))
    _v_occupation = field_validator("occupation")(
        _one_of("occupation", OCCUPATIONS))
    _v_employment = field_validator("employment_type")(
        _one_of("employment_type", EMPLOYMENT_TYPES))
    _v_employer = field_validator("employer_category")(
        _one_of("employer_category", EMPLOYER_CATEGORIES))


class PredictionResponse(BaseModel):
    """
    NOTE on the two different things in here, because they are easy to
    conflate:

      probabilities          the model's estimate of the three OUTCOMES —
                             repaid cleanly / delinquent / defaulted. Keyed by
                             the historical "Low/Medium/High Risk" names so
                             the gateway's existing splitProbabilities() and
                             the NOT NULL risk_assessments.prob_low/medium/high
                             columns keep working unchanged.

      risk_label             the reported BAND, from thresholding
                             probability_of_default (= probabilities["High
                             Risk"]) at the policy cut-offs in src/config.py.

    They can legitimately disagree: an applicant may most likely repay cleanly
    and still carry a 12% chance of default, which is a Medium-risk band. That
    is a scorecard cut-off doing its job, not an inconsistency.
    """

    risk_label: int
    risk_category: str
    probability_of_default: float
    probabilities: dict
    model_version: str


@app.get("/")
def root():
    return {
        "message": "Sri Lanka Credit Risk Prediction API v2. See /docs.",
        "model_version": MODEL_VERSION,
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "model_loaded": model is not None}


@app.get("/model-info")
def model_info():
    """Which model is loaded, and what its outputs mean. Lets an operator
    cross-check an audit record's model_version against what is running."""
    return {
        "model_version": MODEL_VERSION,
        "model_path": MODEL_PATH,
        "api_version": app.version,
        "risk_labels": RISK_LABELS,
        "outcome_meaning": RISK_OUTCOME_MEANING,
        "pd_bands": {"medium_at_or_above": PD_BAND_MEDIUM,
                     "high_at_or_above": PD_BAND_HIGH},
        "excluded_protected_attributes": ["gender"],
    }


@app.post("/predict", response_model=PredictionResponse)
def predict(applicant: LoanApplicant):
    if model is None or preprocessor is None:
        raise HTTPException(
            status_code=503, detail="Model not loaded yet. Please retry shortly."
        )

    try:
        input_df = pd.DataFrame([applicant.model_dump()])
        _, proba = predict_risk(model, preprocessor, input_df)
    except Exception as e:  # noqa: BLE001 — surfaced to the caller as a 400
        raise HTTPException(status_code=400, detail=f"Prediction error: {e}")

    row = proba[0]
    pd_value = float(row[2])

    # The band comes from the calibrated PD, NOT from argmax — see the module
    # docstring. Threshold and vote disagree near the boundaries, and the
    # threshold is the one that can be reasoned about and re-tuned.
    label = band_from_pd(pd_value)

    return PredictionResponse(
        risk_label=label,
        risk_category=RISK_LABELS[label],
        probability_of_default=round(pd_value, 6),
        probabilities={
            "Low Risk": round(float(row[0]), 6),
            "Medium Risk": round(float(row[1]), 6),
            "High Risk": round(float(row[2]), 6),
        },
        model_version=MODEL_VERSION,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)

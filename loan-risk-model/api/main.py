# api/main.py

import sys
import os

# Robust import fix so `src` package resolves when running from project root
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.model_utils import predict_risk

MODEL_PATH = "model_artifacts/xgboost_model.joblib"
PREPROCESSOR_PATH = "model_artifacts/preprocessor.joblib"

app = FastAPI(
    title="Sri Lanka Credit Risk Prediction API",
    description="Predicts loan default risk (Low / Medium / High) using Sri Lankan CRIB-enhanced features.",
    version="1.1.0"
)

# Load model artifacts once at startup
model = None
preprocessor = None


@app.on_event("startup")
def load_artifacts():
    global model, preprocessor
    if not os.path.exists(MODEL_PATH) or not os.path.exists(PREPROCESSOR_PATH):
        raise RuntimeError(
            f"Model artifacts not found. Run 'python -m src.model_utils' first to train and save the model."
        )
    model = joblib.load(MODEL_PATH)
    preprocessor = joblib.load(PREPROCESSOR_PATH)
    print("✅ Model and preprocessor loaded successfully.")


RISK_LABELS = {0: "Low Risk", 1: "Medium Risk", 2: "High Risk"}


class LoanApplicant(BaseModel):
    # --- Personal ---
    age: int = Field(..., example=34)
    gender: str = Field(..., example="Male")
    marital_status: str = Field(..., example="Married")
    province: str = Field(..., example="Western")
    education_level: str = Field(..., example="Bachelor")
    occupation: str = Field(..., example="Private Sector")
    employment_type: str = Field(..., example="Permanent")
    years_employed: int = Field(..., example=7)

    # --- Income ---
    monthly_salary: float = Field(..., example=185000)
    additional_income: float = Field(..., example=25000)
    income_stability: float = Field(..., example=0.85)
    employer_category: str = Field(..., example="Large Corporate")

    # --- Expenses & Banking ---
    monthly_expenses: float = Field(..., example=125000)
    rent: float = Field(..., example=45000)
    savings_ratio: float = Field(..., example=0.28)
    avg_bank_balance: float = Field(..., example=420000)
    digital_payment_ratio: float = Field(..., example=0.75)

    # --- Loan ---
    existing_loans: int = Field(..., example=1)
    loan_amount: float = Field(..., example=2500000)
    loan_tenure_months: int = Field(..., example=36)
    interest_rate: float = Field(..., example=14.5)
    previous_defaults: int = Field(..., example=0)

    # --- CRIB ---
    crib_score: int = Field(..., example=720)
    active_facilities: int = Field(..., example=2)
    credit_utilization: float = Field(..., example=35)
    number_of_defaults: int = Field(..., example=0)
    overdue_installments: int = Field(..., example=0)
    settled_loans: int = Field(..., example=3)
    historical_delinquencies: int = Field(..., example=1)
    credit_inquiry_count: int = Field(..., example=2)
    guarantor_exposure: float = Field(..., example=0)
    guarantor_defaults: int = Field(
        ..., example=0,
        description="Number of times the applicant, as a guarantor, had to settle "
                    "another borrower's defaulted facility."
    )
    loan_restructuring_history: int = Field(..., example=0)
    highest_outstanding_balance: float = Field(..., example=1800000)
    avg_repayment_behaviour: float = Field(..., example=0.92)


class PredictionResponse(BaseModel):
    risk_label: int
    risk_category: str
    probabilities: dict


@app.get("/")
def root():
    return {"message": "Sri Lanka Credit Risk Prediction API is running. Visit /docs for the interactive UI."}


@app.get("/health")
def health_check():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/predict", response_model=PredictionResponse)
def predict(applicant: LoanApplicant):
    if model is None or preprocessor is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet. Please try again shortly.")

    try:
        # Convert the raw request body into a single-row DataFrame.
        # NOTE: derived features (debt_to_income_ratio, expense_ratio,
        # guarantor_risk_score, etc.) are calculated automatically inside
        # predict_risk() -> add_derived_features().
        input_df = pd.DataFrame([applicant.dict()])

        pred, proba = predict_risk(model, preprocessor, input_df)

        predicted_class = int(pred[0])
        class_probabilities = {
            RISK_LABELS[i]: round(float(p), 4) for i, p in enumerate(proba[0])
        }

        return PredictionResponse(
            risk_label=predicted_class,
            risk_category=RISK_LABELS[predicted_class],
            probabilities=class_probabilities
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Prediction error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=True)
# src/preprocessing.py
"""
The preprocessing pipeline, fitted on the training split only and persisted
alongside the model so inference applies the identical transform.

WHY NUMERIC FEATURES ARE PASSED THROUGH RATHER THAN SCALED
----------------------------------------------------------
v1 (and the first cut of v2) ran a `StandardScaler` over the numeric columns.
For a tree ensemble that is a no-op on accuracy — splits are threshold-based
and invariant to monotone rescaling — so it was only ever there in case a
distance- or gradient-based model was swapped in later.

It is now actively harmful, because `StandardScaler` cannot pass a NaN
through: it propagates NaN into the scaled output and then the mean/variance
statistics themselves are polluted. And NaN is exactly what this system needs
to send.

The reason is the thin-file problem. Most CRIB and behavioural fields have no
source for a first-time applicant, and the gateway used to substitute a
"neutral" population-average value for each one. Those substitutes are not
neutral in effect — `avg_repayment_behaviour = 0.85` asserts that someone
pays reliably, and `overdue_installments = 0` asserts they are never late.
Together the fabricated block accounted for roughly 40% of the model's gain,
so the model was being told good things about applicants nobody knew anything
about. Measured before this change, an applicant who declared three defaults
still scored PD 0.0065 — "Low Risk" — because every other input claimed
exemplary conduct.

XGBoost handles genuine missingness natively: its sparsity-aware split finding
(Chen & Guestrin, 2016, §3.4) learns a default branch direction per split from
the training data, rather than needing a value invented for it. Passing the
numeric block through untouched lets NaN reach the booster so that mechanism
can do its job.

Categoricals still go through `OneHotEncoder(handle_unknown='ignore')`; a
missing categorical becomes an all-zero block, which is its own honest
representation of "not stated".
"""

import os
import sys

import joblib
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.preprocessing import OneHotEncoder  # noqa: E402

from src.config import CATEGORICAL_COLS, NUMERICAL_COLS, TARGET  # noqa: E402


def create_preprocessing_pipeline():
    return ColumnTransformer(
        transformers=[
            # Passthrough, NOT StandardScaler — see the module docstring. NaN
            # must survive to the booster so its own missing-value handling
            # applies.
            ("num", "passthrough", NUMERICAL_COLS),
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_COLS,
            ),
        ]
    )


def save_pipeline(pipeline, path="model_artifacts/preprocessor.joblib"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    joblib.dump(pipeline, path)
    print(f"Pipeline saved to {path}")


if __name__ == "__main__":
    print("Loading dataset...")
    df = pd.read_csv("data/sri_lanka_credit_risk.csv")

    pipeline = create_preprocessing_pipeline()
    pipeline.fit(df.drop(columns=[TARGET]))

    save_pipeline(pipeline)
    print("Preprocessing pipeline saved.")

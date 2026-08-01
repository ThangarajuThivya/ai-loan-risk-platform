# src/feature_engineering.py
"""
Computes the derived features that the model's preprocessor was trained on:
- debt_to_income_ratio
- expense_ratio
- loan_burden_ratio
- repayment_consistency_score
- financial_stability_score
- guarantor_risk_score

These are NOT supplied by the API caller. They must be calculated from the raw
input fields using the exact same formulas as src/data_generator.py, then
attached to the input DataFrame BEFORE calling preprocessor.transform().
"""

import numpy as np
import pandas as pd


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Takes a DataFrame containing the raw input columns (see
    src.config.RAW_INPUT_FEATURES) and returns a new DataFrame with the
    derived columns added.
    """
    df = df.copy()

    total_income = df['monthly_salary'] + df['additional_income']
    # Avoid divide-by-zero for edge cases; works for both scalar and Series
    total_income_safe = np.maximum(total_income, 1)

    df['debt_to_income_ratio'] = (df['loan_amount'] / 12) / total_income_safe
    df['expense_ratio'] = df['monthly_expenses'] / total_income_safe
    df['loan_burden_ratio'] = df['loan_amount'] / (total_income_safe * 12)
    df['repayment_consistency_score'] = (
        df['avg_repayment_behaviour'] * (1 - df['overdue_installments'] / 12)
    )

    # Guarantor risk score (0 = no guarantor risk, 1 = maximum guarantor risk).
    # Mirrors src/data_generator.py exactly.
    guarantor_exposure_ratio = np.clip(df['guarantor_exposure'] / (total_income_safe * 12), 0, 1)
    guarantor_default_ratio = np.clip(df['guarantor_defaults'] / 3, 0, 1)
    df['guarantor_risk_score'] = np.clip(
        guarantor_exposure_ratio * 0.5 + guarantor_default_ratio * 0.5, 0, 1
    )

    df['financial_stability_score'] = np.clip(
        df['savings_ratio'] * 0.30 +
        df['income_stability'] * 0.30 +
        (df['crib_score'] / 900) * 0.25 -
        df['guarantor_risk_score'] * 0.15,
        0, 1
    )

    return df
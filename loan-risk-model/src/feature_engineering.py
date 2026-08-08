# src/feature_engineering.py
"""
The derived features, computed identically at training time and at inference
time.

This module is the SINGLE implementation. src/data_generator.py calls it while
building the dataset and src/model_utils.py calls it on every prediction, so
the two cannot drift apart. v1 duplicated these formulas across the generator
and this file, which is exactly how a train/serve skew starts.

They are never accepted from the caller: a client must not be able to hand a
flattering `financial_stability_score` straight to the model.

WHAT CHANGED IN v2
------------------
  emi                   NEW. The real reducing-balance instalment. v1 had no
                        concept of an instalment at all.
  debt_to_income_ratio  REPAIRED. Was loan_amount/(12*income) — the loan repaid
                        over 12 months at zero interest, which made tenure and
                        interest rate irrelevant to affordability (measured:
                        identical mean risk at every tenure from 12 to 84
                        months). Now emi/income, the ratio a credit officer
                        actually computes.
  loan_burden_ratio     REMOVED. Was algebraically identical to v1's
                        debt_to_income_ratio (correlation 1.0, max absolute
                        difference 5e-15) — one quantity under two names.
  disposable_income     NEW. Income minus expenses minus the instalment: what
                        is actually left to absorb a shock. Residual income is
                        a stronger affordability signal than any ratio, and
                        the credit policy engine in finance-backend already
                        judges applicants on it (RESIDUAL_INCOME rule).
  expense_ratio         Unchanged in formula, but meaningful for the first
                        time: v1 generated expenses as income*U(0.45,0.82), so
                        this echoed back a uniform draw.
"""

import numpy as np
import pandas as pd


def compute_emi(principal, annual_rate_pct, tenure_months):
    """
    Monthly instalment on a reducing-balance loan:

        EMI = P * r * (1+r)^n / ((1+r)^n - 1),    r = annual% / 12 / 100

    Mirrors finance-backend/src/services/amortization.service.js so the figure
    the model reasons about is the figure the borrower is actually quoted.

    Zero (or effectively zero) interest degrades to straight-line repayment
    rather than dividing by zero. A non-positive tenure yields 0.

    Works elementwise on arrays/Series and on plain scalars.
    """
    principal = np.asarray(principal, dtype=float)
    annual_rate_pct = np.asarray(annual_rate_pct, dtype=float)
    tenure_months = np.asarray(tenure_months, dtype=float)

    n = np.maximum(tenure_months, 0)
    r = annual_rate_pct / 12.0 / 100.0

    # Guard the compound term before it is used, so the interest-free branch
    # never evaluates a degenerate expression.
    safe_r = np.where(np.abs(r) < 1e-12, 1e-12, r)
    growth = np.power(1.0 + safe_r, n)
    denom = growth - 1.0
    denom = np.where(np.abs(denom) < 1e-12, 1e-12, denom)

    emi_interest = principal * safe_r * growth / denom
    emi_straight = np.divide(
        principal, n, out=np.zeros_like(principal, dtype=float), where=n > 0
    )

    emi = np.where(np.abs(r) < 1e-12, emi_straight, emi_interest)
    return np.where(n > 0, emi, 0.0)


def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Take a DataFrame of the raw input columns (src.config.RAW_INPUT_FEATURES)
    and return a copy with the derived columns attached.
    """
    df = df.copy()

    total_income = df['monthly_salary'] + df['additional_income']
    total_income_safe = np.maximum(total_income, 1)

    # --- Affordability -------------------------------------------------
    df['emi'] = compute_emi(
        df['loan_amount'], df['interest_rate'], df['loan_tenure_months']
    )
    df['debt_to_income_ratio'] = df['emi'] / total_income_safe
    df['expense_ratio'] = df['monthly_expenses'] / total_income_safe
    df['disposable_income'] = total_income - df['monthly_expenses'] - df['emi']

    # --- Repayment track record ----------------------------------------
    # Punctuality discounted by how many instalments are currently overdue.
    df['repayment_consistency_score'] = np.clip(
        df['avg_repayment_behaviour'] * (1 - df['overdue_installments'] / 12),
        0, 1,
    )

    # --- Guarantor liability -------------------------------------------
    # Combines how large the guarantee is relative to the applicant's own
    # annual income with how often it has already been called up. A guarantee
    # that dwarfs someone's income is a real threat to their own repayment
    # capacity the moment it crystallises.
    guarantor_exposure_ratio = np.clip(
        df['guarantor_exposure'] / (total_income_safe * 12), 0, 1
    )
    guarantor_default_ratio = np.clip(df['guarantor_defaults'] / 3, 0, 1)
    df['guarantor_risk_score'] = np.clip(
        guarantor_exposure_ratio * 0.5 + guarantor_default_ratio * 0.5, 0, 1
    )

    # --- Overall stability ---------------------------------------------
    # Savings, income security and bureau standing, penalised by contingent
    # guarantor liability: someone who looks stable on paper but carries a
    # heavy guarantee is less stable than the raw numbers suggest.
    df['financial_stability_score'] = np.clip(
        df['savings_ratio'] * 0.30
        + df['income_stability'] * 0.30
        + (df['crib_score'] / 900) * 0.25
        - df['guarantor_risk_score'] * 0.15,
        0, 1,
    )

    return df

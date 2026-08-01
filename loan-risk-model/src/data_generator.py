# src/data_generator.py

import numpy as np
import pandas as pd
import sys
import os

# Robust import fix
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import FINAL_FEATURES, PROVINCE_WEIGHTS
from faker import Faker

fake = Faker('en_IN')


def generate_sri_lanka_credit_dataset(n_rows: int = 150_000, seed: int = 42) -> pd.DataFrame:
    np.random.seed(seed)

    df = pd.DataFrame()

    # === Personal ===
    df['age'] = np.random.randint(21, 65, n_rows)
    df['gender'] = np.random.choice(['Male', 'Female'], n_rows, p=[0.55, 0.45])
    df['marital_status'] = np.random.choice(['Single', 'Married', 'Divorced'], n_rows, p=[0.35, 0.55, 0.10])

    provinces = list(PROVINCE_WEIGHTS.keys())
    weights = list(PROVINCE_WEIGHTS.values())
    df['province'] = np.random.choice(provinces, n_rows, p=weights)

    df['education_level'] = np.random.choice(['Below O/L', 'O/L', 'A/L', 'Bachelor', 'Master or Higher'], n_rows, p=[0.15, 0.25, 0.30, 0.22, 0.08])
    df['occupation'] = np.random.choice(['Private Sector', 'Government', 'Business Owner', 'Teacher', 'Driver', 'IT/Tech', 'Garment', 'Other'], n_rows)
    df['employment_type'] = np.random.choice(['Permanent', 'Contract', 'Self-Employed', 'Government'], n_rows, p=[0.45, 0.25, 0.20, 0.10])
    df['years_employed'] = np.clip(np.random.normal(8, 7, n_rows).astype(int), 0, 40)
    df['employer_category'] = np.random.choice(['Large Corporate', 'SME', 'Government', 'Startup', 'Other'], n_rows)

    # === Income ===
    df['monthly_salary'] = np.clip(np.random.normal(135_000, 85_000, n_rows), 45_000, 1_800_000).astype(int)
    df['additional_income'] = np.random.exponential(25_000, n_rows).astype(int).clip(0, 500_000)
    df['income_stability'] = np.random.uniform(0.65, 0.98, n_rows)

    # === Expenses & Banking ===
    df['monthly_expenses'] = (df['monthly_salary'] + df['additional_income']) * np.random.uniform(0.45, 0.82, n_rows)
    df['rent'] = np.where(df['province'] == 'Western',
                           (df['monthly_salary'] * np.random.uniform(0.28, 0.48, n_rows)).astype(int),
                           (df['monthly_salary'] * np.random.uniform(0.18, 0.38, n_rows)).astype(int))
    df['avg_bank_balance'] = (df['monthly_salary'] * np.random.uniform(0.6, 3.5, n_rows)).astype(int)
    df['savings_ratio'] = np.clip(np.random.beta(2.5, 5, n_rows), 0.05, 0.65)
    df['digital_payment_ratio'] = np.random.uniform(0.4, 0.95, n_rows)

    # === Loan ===
    df['existing_loans'] = np.random.poisson(1.1, n_rows)
    df['loan_amount'] = np.random.randint(250_000, 10_000_000, n_rows)
    df['loan_tenure_months'] = np.random.choice([12, 24, 36, 48, 60, 84], n_rows, p=[0.12, 0.22, 0.28, 0.18, 0.15, 0.05])
    df['interest_rate'] = np.random.uniform(9.5, 23.0, n_rows)
    df['previous_defaults'] = np.random.poisson(0.18, n_rows)

    # === CRIB Features ===
    df['crib_score'] = np.random.randint(320, 890, n_rows)
    df['active_facilities'] = np.random.randint(0, 9, n_rows)
    df['credit_utilization'] = np.random.uniform(5, 92, n_rows)
    df['number_of_defaults'] = np.random.poisson(0.14, n_rows)
    df['overdue_installments'] = np.random.poisson(0.9, n_rows)
    df['settled_loans'] = np.random.poisson(2.8, n_rows)
    df['historical_delinquencies'] = np.random.poisson(1.1, n_rows)
    df['credit_inquiry_count'] = np.random.randint(0, 15, n_rows)

    # --- Guarantor behaviour (realistic Sri Lankan banking / CRIB practice) ---
    # Standing as a guarantor for a relative's or colleague's facility is very
    # common in SL banking (govt employees, pawning, leasing, personal loans).
    # CRIB records the guarantor's exposure against their own name, and a bank
    # will treat a "called-up" guarantee (i.e. the guarantor had to actually
    # pay because the borrower defaulted) almost as seriously as the person's
    # own default history when assessing a new facility.
    is_guarantor = np.random.choice([0, 1], n_rows, p=[0.70, 0.30])

    income_for_guarantee = df['monthly_salary'] + df['additional_income']

    # Exposure is the outstanding balance the applicant is contingently liable
    # for as guarantor. Loosely scaled to the applicant's own income capacity
    # (banks size guarantor eligibility off the guarantor's income), capped at
    # ~15x monthly income so it stays in a realistic band.
    raw_exposure = np.random.exponential(scale=800_000, size=n_rows)
    df['guarantor_exposure'] = np.where(
        is_guarantor == 1,
        np.clip(raw_exposure, 0, income_for_guarantee * 15),
        0
    ).astype(int)

    # Guarantor defaults: number of times the primary borrower defaulted and
    # CRIB/the bank called on this applicant (as guarantor) to settle the
    # facility. Only possible where guarantor exposure actually exists.
    guarantor_default_base = np.random.poisson(0.12, n_rows)
    df['guarantor_defaults'] = np.where(
        df['guarantor_exposure'] > 0, guarantor_default_base, 0
    ).astype(int)

    df['loan_restructuring_history'] = np.random.poisson(0.25, n_rows)
    df['highest_outstanding_balance'] = (df['loan_amount'] * np.random.uniform(0.7, 1.25, n_rows)).astype(int)
    df['avg_repayment_behaviour'] = np.random.uniform(0.68, 0.97, n_rows)

    # === Derived Features ===
    total_income = df['monthly_salary'] + df['additional_income']
    total_income_safe = total_income.clip(lower=1)

    df['debt_to_income_ratio'] = (df['loan_amount'] / 12) / total_income_safe
    df['expense_ratio'] = df['monthly_expenses'] / total_income_safe
    df['loan_burden_ratio'] = df['loan_amount'] / (total_income_safe * 12)
    df['repayment_consistency_score'] = df['avg_repayment_behaviour'] * (1 - df['overdue_installments'] / 12)

    # Guarantor risk score (0 = no guarantor risk, 1 = maximum guarantor risk).
    # Combines:
    #   - how large the guaranteed exposure is relative to the applicant's own
    #     annual income (a guarantee that dwarfs their income is a real threat
    #     to their own repayment capacity if it's ever called), and
    #   - how many times that guarantee has already turned into an actual
    #     liability (guarantor_defaults) — the strongest guarantor red flag.
    guarantor_exposure_ratio = np.clip(df['guarantor_exposure'] / (total_income_safe * 12), 0, 1)
    guarantor_default_ratio = np.clip(df['guarantor_defaults'] / 3, 0, 1)
    df['guarantor_risk_score'] = np.clip(
        guarantor_exposure_ratio * 0.5 + guarantor_default_ratio * 0.5, 0, 1
    )

    # Financial stability score now penalises guarantor risk: someone who
    # looks financially stable on paper but carries heavy contingent
    # guarantor liability is genuinely less stable than the raw income/savings
    # numbers suggest.
    df['financial_stability_score'] = np.clip(
        df['savings_ratio'] * 0.30 +
        df['income_stability'] * 0.30 +
        (df['crib_score'] / 900) * 0.25 -
        df['guarantor_risk_score'] * 0.15,
        0, 1
    )

    # === Risk Label ===
    score = np.zeros(n_rows)
    score += (df['debt_to_income_ratio'] > 0.45) * 2.8
    score += (df['number_of_defaults'] > 0) * 3.8
    score += (df['overdue_installments'] > 2) * 2.2
    score += (df['credit_utilization'] > 78) * 2.5
    score += (df['crib_score'] < 580) * 3.2
    score -= (df['savings_ratio'] > 0.28) * 1.8
    score -= (df['financial_stability_score'] > 0.72) * 2.3

    # --- Guarantor risk penalties ---
    # A guarantor default is a strong negative signal in SL CRIB practice: the
    # applicant already proved unable/unwilling to honour a guaranteed
    # obligation, which is treated close to a personal default.
    score += (df['guarantor_defaults'] > 0) * 3.5
    score += (df['guarantor_defaults'] > 1) * 1.5          # repeat guarantor defaulters
    score += (df['guarantor_risk_score'] > 0.5) * 2.5       # high combined guarantor risk
    score += (guarantor_exposure_ratio > 0.6) * 1.5         # exposure alone > 60% of annual income

    score += np.random.normal(0, 0.8, n_rows)

    df['risk_label'] = np.select(
        [score <= 3.5, (score > 3.5) & (score <= 8.5), score > 8.5],
        [0, 1, 2],
        default=1
    ).astype(int)

    return df[FINAL_FEATURES]


if __name__ == "__main__":
    print("Generating Sri Lankan Credit Risk Dataset...")
    df = generate_sri_lanka_credit_dataset(n_rows=150_000)

    os.makedirs('data', exist_ok=True)
    df.to_csv('data/sri_lanka_credit_risk.csv', index=False)

    print("✅ Dataset successfully generated!")
    print(f"Shape: {df.shape}")
    print("\nRisk Distribution:")
    print(df['risk_label'].value_counts(normalize=True))
    print("\nGuarantor Stats:")
    print(f"  % with guarantor exposure : {(df['guarantor_exposure'] > 0).mean()*100:.1f}%")
    print(f"  % with guarantor defaults : {(df['guarantor_defaults'] > 0).mean()*100:.1f}%")
    print("\nSample:")
    print(df.head(3))
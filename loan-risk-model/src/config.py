# src/config.py

FINAL_FEATURES = [
    # Personal
    'age', 'gender', 'marital_status', 'province', 'education_level',
    'occupation', 'employment_type', 'years_employed',

    # Income
    'monthly_salary', 'additional_income', 'income_stability', 'employer_category',

    # Expenses & Banking
    'monthly_expenses', 'rent', 'savings_ratio', 'avg_bank_balance',
    'digital_payment_ratio',

    # Loan
    'existing_loans', 'loan_amount', 'loan_tenure_months', 'interest_rate',
    'previous_defaults',

    # CRIB (Sri Lankan focus)
    'crib_score', 'active_facilities', 'credit_utilization',
    'number_of_defaults', 'overdue_installments', 'settled_loans',
    'historical_delinquencies', 'credit_inquiry_count', 'guarantor_exposure',
    'guarantor_defaults',                       # NEW: times paid as guarantor for a defaulted borrower
    'loan_restructuring_history', 'highest_outstanding_balance',
    'avg_repayment_behaviour',

    # Derived
    'debt_to_income_ratio', 'expense_ratio', 'loan_burden_ratio',
    'repayment_consistency_score', 'financial_stability_score',
    'guarantor_risk_score',                     # NEW: derived guarantor risk

    # Target
    'risk_label'  # 0=Low, 1=Medium, 2=High
]

CATEGORICAL_COLS = [
    'gender', 'marital_status', 'province', 'education_level',
    'occupation', 'employment_type', 'employer_category'
]

NUMERICAL_COLS = [f for f in FINAL_FEATURES if f not in CATEGORICAL_COLS and f != 'risk_label']

# Features that are CALCULATED from raw inputs (not supplied by the API caller).
# These must be computed by add_derived_features() before preprocessing.
DERIVED_FEATURES = [
    'debt_to_income_ratio', 'expense_ratio', 'loan_burden_ratio',
    'repayment_consistency_score', 'financial_stability_score',
    'guarantor_risk_score'
]

# Features the API/Swagger request body should accept directly.
# = FINAL_FEATURES minus derived features minus the target label.
RAW_INPUT_FEATURES = [
    f for f in FINAL_FEATURES
    if f not in DERIVED_FEATURES and f != 'risk_label'
]

# Sri Lankan realistic ranges
PROVINCE_WEIGHTS = {
    'Western': 0.28, 'Central': 0.12, 'Southern': 0.13, 'Northern': 0.09,
    'Eastern': 0.10, 'North Western': 0.10, 'North Central': 0.07,
    'Uva': 0.06, 'Sabaragamuwa': 0.05
}
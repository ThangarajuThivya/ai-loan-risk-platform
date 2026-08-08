# src/config.py
"""
Feature schema for the Sri Lanka credit risk model (v2).

WHAT CHANGED FROM v1, AND WHY
-----------------------------
v1 carried 41 features, of which an audit found 16 had |corr| < 0.02 with the
target and two (`debt_to_income_ratio` / `loan_burden_ratio`) were the SAME
number under two names (corr = 1.0). v2 removes what measurably did nothing
and repairs what was mis-specified:

  REMOVED  loan_burden_ratio       identical to debt_to_income_ratio
  REMOVED  previous_defaults       an independent second draw of the same
                                   real-world quantity as number_of_defaults;
                                   uncorrelated with it (r = -0.0008) and with
                                   the target (r = 0.003). One concept, one
                                   column.
  REPAIRED debt_to_income_ratio    was loan_amount/(12*income) — the loan
                                   repaid over 12 months at zero interest, so
                                   tenure and rate could not affect
                                   affordability. Now the real reducing-balance
                                   EMI over the actual tenure at the actual
                                   rate.
  REPAIRED expense_ratio           v1 generated expenses as income*U(0.45,0.82),
                                   making the ratio that uniform draw echoed
                                   back — pure noise by construction. v2
                                   generates expenses from income following
                                   Engel's law, so the ratio carries real
                                   information about financial pressure.
  ADDED    emi                     the actual monthly instalment; the quantity
                                   affordability genuinely turns on.
  ADDED    disposable_income       income minus expenses minus the new EMI —
                                   what is left to absorb a shock.

The target is unchanged in SHAPE (0/1/2) but completely different in MEANING —
see data_generator.py. It is now a sampled repayment OUTCOME, not a threshold
rule, so downstream consumers (risk_assessments.prob_low/medium/high,
adverse_action_records, the Gemini prompt) keep working untouched.
"""

# ---------------------------------------------------------------------------
# Column groups
# ---------------------------------------------------------------------------

PERSONAL_COLS = [
    'age', 'marital_status', 'province', 'education_level',
    'occupation', 'employment_type', 'years_employed',
]

# DELIBERATELY NOT A MODEL INPUT: gender.
#
# It is a protected attribute under fair-lending practice, and a credit
# decision must not turn on it. v1 fed it to the model, where it was harmless
# only by accident — the v1 generator drew the label independently of it, so
# the measured spread in mean risk between men and women was 0.0005. Relying
# on an attribute being accidentally uninformative is not a fairness control;
# not collecting it into the model is.
#
# The column still exists on customer_profiles for demographic reporting. It
# is simply never sent to /predict. See ARCHITECTURE.md 7.2.
EXCLUDED_PROTECTED_ATTRIBUTES = ['gender']

INCOME_COLS = [
    'monthly_salary', 'additional_income', 'income_stability',
    'employer_category',
]

BANKING_COLS = [
    'monthly_expenses', 'rent', 'savings_ratio', 'avg_bank_balance',
    'digital_payment_ratio',
]

LOAN_COLS = [
    'existing_loans', 'loan_amount', 'loan_tenure_months', 'interest_rate',
]

# Sri Lankan credit-bureau (CRIB) and internal behavioural history.
CRIB_COLS = [
    'crib_score', 'active_facilities', 'credit_utilization',
    'number_of_defaults', 'overdue_installments', 'settled_loans',
    'historical_delinquencies', 'credit_inquiry_count',
    'guarantor_exposure', 'guarantor_defaults',
    'loan_restructuring_history', 'highest_outstanding_balance',
    'avg_repayment_behaviour',
]

# Computed server-side at inference time from the raw fields above. Never
# accepted from the caller — a client must not be able to hand-craft a
# flattering financial_stability_score, and train/serve logic cannot drift
# because both call add_derived_features().
DERIVED_FEATURES = [
    'emi',
    'debt_to_income_ratio',
    'expense_ratio',
    'disposable_income',
    'repayment_consistency_score',
    'guarantor_risk_score',
    'financial_stability_score',
]

RAW_INPUT_FEATURES = (
    PERSONAL_COLS + INCOME_COLS + BANKING_COLS + LOAN_COLS + CRIB_COLS
)

TARGET = 'risk_label'  # 0 = Repaid cleanly, 1 = Delinquent, 2 = Defaulted

FINAL_FEATURES = RAW_INPUT_FEATURES + DERIVED_FEATURES + [TARGET]

CATEGORICAL_COLS = [
    'marital_status', 'province', 'education_level',
    'occupation', 'employment_type', 'employer_category',
]

NUMERICAL_COLS = [
    f for f in FINAL_FEATURES
    if f not in CATEGORICAL_COLS and f != TARGET
]

# ---------------------------------------------------------------------------
# Category vocabularies — the single source of truth for both the generator
# and the API's validation. finance-backend/src/services/mlClient.service.js
# mirrors these; they must stay in step.
# ---------------------------------------------------------------------------

MARITAL_STATUSES = ['Single', 'Married', 'Divorced']
EDUCATION_LEVELS = ['Below O/L', 'O/L', 'A/L', 'Bachelor', 'Master or Higher']
OCCUPATIONS = [
    'Private Sector', 'Government', 'Business Owner', 'Teacher',
    'Driver', 'IT/Tech', 'Garment', 'Other',
]
EMPLOYMENT_TYPES = ['Permanent', 'Contract', 'Self-Employed', 'Government']
EMPLOYER_CATEGORIES = ['Large Corporate', 'SME', 'Government', 'Startup', 'Other']

RISK_LABELS = {
    0: 'Low Risk',
    1: 'Medium Risk',
    2: 'High Risk',
}

# What each class actually MEANS as an observed repayment outcome. Surfaced on
# /model-info so the semantics travel with the service rather than living only
# in a document someone has to find.
RISK_OUTCOME_MEANING = {
    0: 'Repaid cleanly — no instalment ever fell overdue',
    1: 'Delinquent — repaid, but at least one instalment fell overdue',
    2: 'Defaulted — the facility was charged off',
}

# ---------------------------------------------------------------------------
# Sri Lankan context
# ---------------------------------------------------------------------------

# Population-weighted, per Department of Census and Statistics proportions.
PROVINCE_WEIGHTS = {
    'Western': 0.28, 'Central': 0.12, 'Southern': 0.13, 'Northern': 0.09,
    'Eastern': 0.10, 'North Western': 0.10, 'North Central': 0.07,
    'Uva': 0.06, 'Sabaragamuwa': 0.05,
}

# Relative income multiplier by province. Western (Colombo) is the commercial
# centre and pays materially more for equivalent work; the estate and former
# conflict-affected provinces sit lowest.
PROVINCE_INCOME_FACTOR = {
    'Western': 1.35, 'Central': 0.92, 'Southern': 0.95, 'Northern': 0.78,
    'Eastern': 0.80, 'North Western': 0.93, 'North Central': 0.85,
    'Uva': 0.76, 'Sabaragamuwa': 0.83,
}

EDUCATION_INCOME_FACTOR = {
    'Below O/L': 0.62, 'O/L': 0.80, 'A/L': 1.00,
    'Bachelor': 1.45, 'Master or Higher': 1.95,
}

# Employment type drives both pay level and INCOME STABILITY. Government work
# in Sri Lanka pays less than the private sector but is close to unlosable,
# which is exactly why it is prized as security for a loan.
EMPLOYMENT_INCOME_FACTOR = {
    'Permanent': 1.00, 'Contract': 0.88, 'Self-Employed': 1.10, 'Government': 0.86,
}
EMPLOYMENT_STABILITY = {
    'Permanent': 0.86, 'Contract': 0.62, 'Self-Employed': 0.55, 'Government': 0.95,
}

# The real CRIB score band published by the Credit Information Bureau of
# Sri Lanka. v1 used 320-890, which matches no real scale.
CRIB_MIN = 250
CRIB_MAX = 900

# The bands the service reports. Derived from the model's predicted
# probability of default, not from a separate rule.
PD_BAND_MEDIUM = 0.08   # PD at or above this is at least Medium risk
PD_BAND_HIGH = 0.22     # PD at or above this is High risk

# ---------------------------------------------------------------------------
# Portfolio assumptions for the generator
# ---------------------------------------------------------------------------
# The share of the book that ends in each outcome. These are ASSUMPTIONS, set
# here as explicit named constants rather than buried in a hand-tuned logistic
# intercept, and the generator solves for the intercept that reproduces them
# (see data_generator.py _solve_intercept). Stating them this way means the
# assumption can be argued with, which a magic -3.05 cannot.
#
# Chosen to sit at the stressed end of plausible for Sri Lankan unsecured
# retail lending in the period following the 2022 economic crisis, when
# non-performing loans across the licensed banking sector rose sharply. A
# benign 2-3% book would make the High-risk class so rare that the model
# could not learn it.
TARGET_DEFAULT_RATE = 0.075      # class 2 — facility charged off
TARGET_DELINQUENCY_RATE = 0.185  # class 1 — repaid, but fell overdue

# Typical loan-to-annual-income. Median ~0.7x, with a long right tail for
# housing-scale borrowing. Sized so the resulting DTI clusters below the 40%
# refer / 55% decline thresholds that finance-backend's credit policy engine
# applies, rather than putting the whole synthetic book in breach.
LTI_LOG_MEAN = -0.70
# ---------------------------------------------------------------------------
# Missingness — what the gateway genuinely cannot know
# ---------------------------------------------------------------------------
# These fields are sourced from the customer's own accounts with this
# institution (finance-backend behaviouralFeatures.service.js). A first-time
# applicant has none of them and there is no CRIB feed, so they arrive as
# null. Training injects the same missingness at THIN_FILE_RATE so the model
# learns a default branch for "unknown" rather than a relationship to a
# fabricated population average — see data_generator.py section 6b.
BEHAVIOURAL_COLS = [
    'active_facilities',
    'credit_utilization',
    'overdue_installments',
    'settled_loans',
    'historical_delinquencies',
    'credit_inquiry_count',
    'loan_restructuring_history',
    'highest_outstanding_balance',
    'avg_repayment_behaviour',
]

# Share of applicants with no usable history with this institution. Set high
# because the system is new: most applicants really are first-time borrowers
# here, and the model must be good at exactly that case.
THIN_FILE_RATE = 0.55
LTI_LOG_SIGMA = 0.65
LTI_MIN = 0.12
LTI_MAX = 8.0

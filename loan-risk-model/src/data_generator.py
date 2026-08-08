# src/data_generator.py
"""
Sri Lanka credit risk dataset generator (v2) — a causal data-generating
process with SAMPLED repayment outcomes.

WHY v2 EXISTS
-------------
v1 drew every feature independently and then applied a deterministic threshold
rule to produce the label. An audit of the shipped dataset showed what that
costs:

  * crib_score correlated with number_of_defaults at r = +0.001, with
    overdue_installments at +0.003, with income at -0.005. A bureau score is a
    FUNCTION of those things; drawing it independently makes every row
    internally contradictory — an 880 CRIB score sitting beside four defaults.
  * age and years_employed were independent, so 12.6% of rows described people
    who started work before they were 18 (a 25-year-old with 37 years served).
  * The label was a weighted threshold rule plus N(0, 0.8). A depth-8 decision
    tree on 9 of the 41 features scored 88.42% — BETTER than the shipped
    41-feature XGBoost's 88.10%. The headline accuracy measured "can a tree
    recover a rule I wrote", which is not a credit-risk result.

v2 inverts the construction. Rather than sampling features and deriving a
label, it samples a LATENT BORROWER and derives both the features and the
outcome from it. Two applicants with identical paperwork can now repay
differently, because the outcome is drawn, not computed.

THE GENERATIVE STRUCTURE
------------------------
    z ~ N(0, 1)                    latent creditworthiness (never observed)
      │
      ├─> demographics ─> income ─> expenses ─> savings
      │                     │
      │                     └─> loan request ─> EMI ─> affordability
      │
      ├─> credit behaviour (defaults, overdues, utilisation, punctuality)
      │        │
      │        └─> crib_score = f(that behaviour)      <- computed, not drawn
      │
      └─> PD = sigmoid(g(affordability, z, guarantor, stability))
               │
               └─> outcome ~ Categorical(clean / delinquent / default)

The target is the SAMPLED outcome:

    0  Repaid cleanly      no instalment ever fell overdue
    1  Delinquent          repaid, but at least one instalment fell overdue
    2  Defaulted           the facility was charged off

All three are states a real lender genuinely observes and records, which is
what makes this a legitimate supervised target rather than a rule in disguise.
It is also ORDINAL — worsening in one direction — which matches how the
downstream banding (Low / Medium / High) is meant to be read.

WHAT THIS DOES AND DOES NOT CLAIM
---------------------------------
This is still synthetic data, and no synthetic dataset can prove a model
predicts real Sri Lankan defaults. What v2 legitimately buys:

  * Features that are jointly coherent, so learned relationships are not
    artefacts of contradictory rows.
  * A stochastic target with irreducible noise, so accuracy has a real ceiling
    below 100% and the model must learn a RANKING rather than invert a formula.
  * Calibrated, meaningful probabilities: P(class 2) is a probability of
    default that can be compared against realised default rates.

The honest limitation, which must be stated in any write-up: the PD function
below is still authored. The model learns the risk ORDERING that function
implies, observed through noisy sampled outcomes. What transfers to real data
is the pipeline, the feature engineering and the calibration — not the
performance number.

No real applicant data is used at any point.
"""

import os
import sys

import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import (  # noqa: E402
    BEHAVIOURAL_COLS,
    CRIB_MAX,
    CRIB_MIN,
    EDUCATION_INCOME_FACTOR,
    EDUCATION_LEVELS,
    EMPLOYER_CATEGORIES,
    EMPLOYMENT_INCOME_FACTOR,
    EMPLOYMENT_STABILITY,
    EMPLOYMENT_TYPES,
    FINAL_FEATURES,
    LTI_LOG_MEAN,
    LTI_LOG_SIGMA,
    LTI_MAX,
    LTI_MIN,
    MARITAL_STATUSES,
    OCCUPATIONS,
    PROVINCE_INCOME_FACTOR,
    PROVINCE_WEIGHTS,
    TARGET_DEFAULT_RATE,
    TARGET_DELINQUENCY_RATE,
    THIN_FILE_RATE,
)
from src.feature_engineering import add_derived_features  # noqa: E402


def _map(series: pd.Series, table: dict) -> np.ndarray:
    """Vectorised lookup of a category -> factor table."""
    return series.map(table).astype(float).to_numpy()


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _solve_intercept(strain: np.ndarray, target_rate: float,
                     tol: float = 1e-6, max_iter: int = 200) -> float:
    """
    Find the intercept b0 such that mean(sigmoid(b0 + strain)) == target_rate.

    The portfolio's outcome rates are a stated ASSUMPTION (config.TARGET_*),
    so the intercept that produces them is solved for rather than guessed.
    Hand-tuning it means the assumption is implicit in a magic number nobody
    can check; solving it means changing the assumption is a one-line edit and
    the generator stays consistent with it.

    Bisection rather than Newton: mean(sigmoid(b0 + strain)) is monotonically
    increasing in b0 and bounded in (0, 1), so a bracket always exists and
    bisection cannot diverge. Speed is irrelevant here — this runs once.
    """
    lo, hi = -30.0, 30.0
    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        rate = float(np.mean(_sigmoid(mid + strain)))
        if abs(rate - target_rate) < tol:
            return mid
        if rate < target_rate:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def generate_sri_lanka_credit_dataset(
    n_rows: int = 150_000, seed: int = 42
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame()

    # ======================================================================
    # 0. LATENT CREDITWORTHINESS
    # ======================================================================
    # The unobserved "type" of the borrower. Positive z = more reliable.
    # Everything downstream that should plausibly correlate does so BECAUSE
    # it is generated from this shared cause, rather than being correlated by
    # hand afterwards.
    z = rng.normal(0, 1, n_rows)

    # ======================================================================
    # 1. DEMOGRAPHICS
    # ======================================================================
    # Right-skewed toward younger working adults, which is the shape of a
    # retail lending book.
    age = np.clip(rng.gamma(shape=7.5, scale=4.2, size=n_rows) + 20, 21, 65)
    df['age'] = age.astype(int)

    # NOTE: gender is deliberately absent — see config.EXCLUDED_PROTECTED_ATTRIBUTES.
    df['province'] = rng.choice(
        list(PROVINCE_WEIGHTS.keys()), n_rows, p=list(PROVINCE_WEIGHTS.values())
    )

    # Marital status depends on age — a 22-year-old is rarely divorced.
    p_married = np.clip((df['age'] - 20) / 30, 0.05, 0.80)
    p_divorced = np.clip((df['age'] - 30) / 200, 0.0, 0.12)
    u = rng.random(n_rows)
    df['marital_status'] = np.where(
        u < p_divorced, MARITAL_STATUSES[2],
        np.where(u < p_divorced + p_married, MARITAL_STATUSES[1], MARITAL_STATUSES[0]),
    )

    # National attainment: O/L and A/L dominate. Mildly correlated with z,
    # since education and financial reliability share upstream causes
    # (household stability, opportunity) without one determining the other.
    edu_score = 0.75 * rng.normal(0, 1, n_rows) + 0.25 * z
    edu_cuts = np.quantile(edu_score, [0.15, 0.40, 0.70, 0.92])
    df['education_level'] = np.select(
        [edu_score < edu_cuts[0], edu_score < edu_cuts[1],
         edu_score < edu_cuts[2], edu_score < edu_cuts[3]],
        EDUCATION_LEVELS[:4],
        default=EDUCATION_LEVELS[4],
    )

    df['employment_type'] = rng.choice(
        EMPLOYMENT_TYPES, n_rows, p=[0.45, 0.25, 0.20, 0.10]
    )
    df['occupation'] = rng.choice(OCCUPATIONS, n_rows)
    df['employer_category'] = rng.choice(
        EMPLOYER_CATEGORIES, n_rows, p=[0.22, 0.38, 0.14, 0.08, 0.18]
    )

    # THE v1 COHERENCE BUG, FIXED: years employed cannot exceed working life.
    # Drawn as a fraction of the years since 18, so a 24-year-old can have at
    # most 6 years and the impossible rows of v1 cannot occur.
    working_years = np.maximum(df['age'].to_numpy() - 18, 0)
    tenure_frac = rng.beta(2.2, 2.0, n_rows)
    df['years_employed'] = np.floor(working_years * tenure_frac).astype(int)

    # Income stability follows employment type, nudged by z.
    stability_base = _map(df['employment_type'], EMPLOYMENT_STABILITY)
    df['income_stability'] = np.clip(
        stability_base + 0.05 * z + rng.normal(0, 0.05, n_rows), 0.30, 0.99
    )

    # ======================================================================
    # 2. INCOME — a function of who the person is, not an independent draw
    # ======================================================================
    experience = np.log1p(df['years_employed'].to_numpy()) / np.log(41)
    log_income = (
        np.log(62_000)
        + np.log(_map(df['province'], PROVINCE_INCOME_FACTOR))
        + np.log(_map(df['education_level'], EDUCATION_INCOME_FACTOR))
        + np.log(_map(df['employment_type'], EMPLOYMENT_INCOME_FACTOR))
        + 0.55 * experience
        + 0.10 * z
        + rng.normal(0, 0.38, n_rows)
    )
    df['monthly_salary'] = np.clip(np.exp(log_income), 30_000, 2_500_000).astype(int)

    # Most people have none; business owners and the self-employed more often
    # do. Zero-inflated rather than a bare exponential.
    has_extra = rng.random(n_rows) < np.where(
        df['employment_type'].to_numpy() == 'Self-Employed', 0.55, 0.22
    )
    df['additional_income'] = np.where(
        has_extra,
        rng.exponential(0.22 * df['monthly_salary'].to_numpy()),
        0,
    ).astype(int)

    total_income = (df['monthly_salary'] + df['additional_income']).to_numpy()

    # ======================================================================
    # 3. EXPENSES — Engel's law, not a flat uniform draw
    # ======================================================================
    # v1 set expenses = income * U(0.45, 0.82), which made expense_ratio a
    # pure noise feature. In reality the share of income consumed FALLS as
    # income rises, and rises with dependants. Reliable types also run a
    # little leaner.
    # Calibrated so that after the instalment is deducted the MAJORITY of
    # applicants still have positive residual income — the population a lender
    # actually sees. An earlier calibration left 87.7% of the book with
    # negative disposable income, which would mean almost every application
    # breaching the credit policy's RESIDUAL_INCOME rule before it was even
    # scored.
    income_pressure = np.clip(
        0.66 - 0.10 * np.log(total_income / 60_000), 0.25, 0.80
    )
    dependants_uplift = np.where(
        df['marital_status'].to_numpy() == 'Married', 0.07, 0.0
    )
    expense_share = np.clip(
        income_pressure + dependants_uplift - 0.045 * z + rng.normal(0, 0.055, n_rows),
        0.28, 0.97,
    )
    df['monthly_expenses'] = (total_income * expense_share).astype(int)

    # Rent is a component of expenses, higher in the Western province.
    rent_share = np.where(
        df['province'].to_numpy() == 'Western',
        rng.uniform(0.26, 0.44, n_rows),
        rng.uniform(0.14, 0.32, n_rows),
    )
    df['rent'] = (df['monthly_expenses'].to_numpy() * rent_share).astype(int)

    surplus = np.clip(total_income - df['monthly_expenses'].to_numpy(), 0, None)

    # savings_ratio is the share of income genuinely SAVED, not the arithmetic
    # surplus. Defining it as surplus/income would make it exactly
    # 1 - expense_ratio — a perfect duplicate, which is the very defect v2
    # exists to remove (v1 shipped one such pair). Two people with the same
    # surplus save different amounts, and how much of it they keep is a
    # behavioural trait, so it is driven by the latent type.
    saving_propensity = np.clip(
        0.42 + 0.20 * z + rng.normal(0, 0.14, n_rows), 0.02, 0.98
    )
    df['savings_ratio'] = np.clip(
        (surplus / np.maximum(total_income, 1)) * saving_propensity, 0.0, 0.72
    )

    # Accumulated balance grows with what is actually saved, plus how long
    # they have been saving it.
    monthly_saved = surplus * saving_propensity
    df['avg_bank_balance'] = np.clip(
        monthly_saved * rng.uniform(3.0, 18.0, n_rows)
        * (1 + 0.03 * (df['age'].to_numpy() - 21)),
        0, None,
    ).astype(int)

    df['digital_payment_ratio'] = np.clip(
        0.42
        + 0.22 * (df['province'].to_numpy() == 'Western')
        + 0.14 * np.isin(df['education_level'].to_numpy(),
                         ['Bachelor', 'Master or Higher'])
        - 0.004 * (df['age'].to_numpy() - 35)
        + rng.normal(0, 0.10, n_rows),
        0.05, 0.99,
    )

    # ======================================================================
    # 4. CREDIT BEHAVIOUR — all driven by the same latent z
    # ======================================================================
    # Credit history needs time to accumulate, so exposure scales with the
    # years someone has been economically active.
    credit_age = np.clip((df['age'].to_numpy() - 21) / 25, 0.05, 1.0)

    df['number_of_defaults'] = rng.poisson(
        np.clip(0.30 * np.exp(-1.15 * z) * credit_age, 0, 6), n_rows
    )
    df['overdue_installments'] = rng.poisson(
        np.clip(1.5 * np.exp(-1.0 * z) * credit_age, 0, 20), n_rows
    )
    df['historical_delinquencies'] = rng.poisson(
        np.clip(1.8 * np.exp(-0.95 * z) * credit_age, 0, 25), n_rows
    )
    df['loan_restructuring_history'] = rng.poisson(
        np.clip(0.35 * np.exp(-0.9 * z) * credit_age, 0, 5), n_rows
    )
    df['settled_loans'] = rng.poisson(
        np.clip(3.2 * credit_age * np.exp(0.28 * z), 0, 15), n_rows
    )
    df['active_facilities'] = rng.poisson(
        np.clip(1.5 * credit_age * np.exp(-0.20 * z), 0, 9), n_rows
    )
    df['existing_loans'] = np.minimum(
        df['active_facilities'], rng.poisson(1.1, n_rows)
    )
    df['credit_inquiry_count'] = rng.poisson(
        np.clip(2.2 * np.exp(-0.42 * z), 0, 18), n_rows
    )

    df['credit_utilization'] = np.clip(
        52 - 15.5 * z + rng.normal(0, 12, n_rows), 1, 99
    )
    df['avg_repayment_behaviour'] = np.clip(
        0.86 + 0.085 * z - 0.020 * df['historical_delinquencies'].to_numpy()
        + rng.normal(0, 0.045, n_rows),
        0.30, 1.0,
    )

    # ------------------------------------------------------------------
    # The TRUE bureau score, computed from the behaviour above. A bureau score
    # is a summary of a credit file, so deriving it is what makes the dataset
    # internally consistent: a file with four defaults cannot carry an 880
    # score. This value drives the repayment outcome further down.
    # ------------------------------------------------------------------
    crib_raw = (
        720
        - 42.0 * df['number_of_defaults'].to_numpy()
        - 9.5 * df['overdue_installments'].to_numpy()
        - 6.5 * df['historical_delinquencies'].to_numpy()
        - 14.0 * df['loan_restructuring_history'].to_numpy()
        - 1.35 * (df['credit_utilization'].to_numpy() - 40)
        + 128.0 * (df['avg_repayment_behaviour'].to_numpy() - 0.85)
        + 7.5 * df['settled_loans'].to_numpy()
        - 4.0 * df['credit_inquiry_count'].to_numpy()
        + 38.0 * credit_age
        + rng.normal(0, 22, n_rows)   # bureau scoring the model cannot see
    )
    crib_true = np.clip(crib_raw, CRIB_MIN, CRIB_MAX)

    # ------------------------------------------------------------------
    # WHAT THE MODEL ACTUALLY RECEIVES: a self-DECLARED score, not the true
    # one.
    #
    # This is the second train/serve mismatch found in v2 (the first was
    # interest_rate, above). There is no CRIB integration in this system, so
    # `crib_score` reaching /predict is a number the applicant typed on a form
    # with nothing to verify it against. Training on the TRUE score taught the
    # model that this input is an almost perfect summary of a credit file —
    # true of the training variable, false of the production one.
    #
    # The cost was measured and severe. With the true score in training,
    # crib_score took 37.8% of total model gain, and an applicant with three
    # defaults, six overdue instalments and 92% utilisation could move
    # themselves from High risk (PD 0.849) to Low risk (PD 0.078) by declaring
    # 900 instead of their implied 348 — a 90.8% cut in PD from an
    # unverifiable claim, on a joint input that appears zero times in 150,000
    # training rows.
    #
    # Modelling the declaration process fixes this at the source: the model
    # learns from data in which the field is unreliable, so it discounts the
    # field and leans on behaviour it can actually observe. Three populations,
    # matching what the gateway really sends:
    #
    #   ~40%  leave it blank        -> mlClient.service.js substitutes its
    #                                  neutral default of 700, so the model
    #                                  should learn 700 means "unknown"
    #   ~40%  declare honestly      -> true score, plus ordinary recall error
    #   ~20%  declare optimistically-> inflated, occasionally wildly
    #
    # The OUTCOME below is still driven by the TRUE score. That asymmetry is
    # the whole point: reality follows the real credit file, the model only
    # gets the claim about it.
    #   ~40%  leave it blank        -> NaN, a genuine "not stated"
    #   ~40%  declare honestly      -> true score, plus ordinary recall error
    #   ~20%  declare optimistically-> inflated, occasionally wildly
    u_decl = rng.random(n_rows)
    honest = crib_true + rng.normal(0, 30, n_rows)
    # One-sided inflation: people over-state a credit score, never under-state
    # it, so the error is exponential rather than symmetric.
    optimistic = crib_true + rng.exponential(95, n_rows)

    # Honest below the 0.80 mark, optimistic above it — then the lowest 40%
    # are blanked entirely.
    stated = np.clip(np.where(u_decl < 0.80, honest, optimistic), CRIB_MIN, CRIB_MAX)

    # Blank means MISSING, not a sentinel. An earlier cut substituted 700 here,
    # mirroring the gateway's old neutral default — but that teaches the model
    # that an unknown score is an average one, which is a claim about the
    # applicant rather than an admission of ignorance. NaN lets XGBoost learn
    # its own default branch instead.
    df['crib_score'] = np.where(u_decl < 0.40, np.nan, stated)

    # ======================================================================
    # 5. THE LOAN BEING APPLIED FOR
    # ======================================================================
    # Sized off income, as a real request is, with a long right tail.
    # LTI is a multiple of ANNUAL income (see config.LTI_*), so the resulting
    # instalment lands in a range a lender would actually consider rather than
    # putting the entire synthetic book beyond affordability.
    lti = np.clip(
        rng.lognormal(LTI_LOG_MEAN, LTI_LOG_SIGMA, n_rows), LTI_MIN, LTI_MAX
    )
    df['loan_amount'] = np.clip(
        total_income * 12 * lti, 100_000, 25_000_000
    ).astype(int)

    # Bigger loans are taken over longer terms.
    size_rank = pd.Series(df['loan_amount']).rank(pct=True).to_numpy()
    tenure_choices = np.array([12, 24, 36, 48, 60, 84])
    tenure_idx = np.clip(
        (size_rank * 5 + rng.normal(0, 1.1, n_rows)).round().astype(int), 0, 5
    )
    df['loan_tenure_months'] = tenure_choices[tenure_idx]

    # The PRODUCT'S BASE RATE — deliberately NOT priced off the applicant's
    # own risk.
    #
    # This mirrors what production actually sends. ARCHITECTURE.md 9.1.3 is
    # explicit that the rate fed to the model is always the product's base
    # rate, because the risk-based rate is an OUTPUT of the assessment
    # (interestPricing.service.js runs after predictRisk returns). An earlier
    # draft here derived the rate from crib_score, which gave interest_rate a
    # 0.47 correlation with default in training that simply does not exist at
    # inference time — a train/serve mismatch that would have let the model
    # lean on a proxy for the bureau score it will never actually receive.
    #
    # Base rates therefore vary by facility shape (bigger/longer secured-style
    # lending is cheaper than small short-term credit), not by the borrower.
    tenure_years = df['loan_tenure_months'].to_numpy() / 12.0
    size_discount = 1.6 * np.clip(np.log10(df['loan_amount'].to_numpy() / 1e5), 0, 2.2)
    df['interest_rate'] = np.clip(
        19.5 - size_discount - 0.35 * tenure_years + rng.normal(0, 0.9, n_rows),
        8.5, 28.0,
    )

    df['highest_outstanding_balance'] = np.clip(
        df['loan_amount'].to_numpy() * rng.uniform(0.25, 1.35, n_rows)
        * np.clip(credit_age * 1.4, 0.1, 1.0),
        0, None,
    ).astype(int)

    # ======================================================================
    # 6. GUARANTOR LIABILITY (the applicant standing for someone ELSE)
    # ======================================================================
    # Common in Sri Lankan retail lending, and CRIB records it against the
    # guarantor's own name. A called-up guarantee is treated nearly as
    # seriously as a personal default.
    is_guarantor = rng.random(n_rows) < 0.30
    df['guarantor_exposure'] = np.where(
        is_guarantor,
        np.clip(rng.exponential(850_000, n_rows), 0, total_income * 15),
        0,
    ).astype(int)

    # A guarantee can only be called up if one exists, and weaker networks
    # (correlated with z) call up more often.
    df['guarantor_defaults'] = np.where(
        df['guarantor_exposure'].to_numpy() > 0,
        rng.poisson(np.clip(0.30 * np.exp(-0.85 * z), 0, 4), n_rows),
        0,
    ).astype(int)

    # ======================================================================
    # 7. DERIVED FEATURES — one shared implementation with inference
    # ======================================================================
    # Calling the SAME function the API calls is what guarantees train/serve
    # consistency. v1 duplicated these formulas in two files, which is how
    # they can silently drift apart.
    df = add_derived_features(df)

    # ======================================================================
    # 8. THE OUTCOME — sampled, not computed
    # ======================================================================
    dti = df['debt_to_income_ratio'].to_numpy()
    disposable = df['disposable_income'].to_numpy()

    # Residual income matters more than any ratio: what is actually left after
    # the instalment is what absorbs a shock.
    residual_strain = np.clip(1.0 - disposable / 25_000, 0, 1)

    guarantor_strain = np.clip(
        df['guarantor_exposure'].to_numpy() / np.maximum(total_income * 12, 1), 0, 1.5
    )

    # Credit strain, in log-odds, EXCLUDING the intercept. Every term is a
    # quantity a credit officer would actually cite, which is what keeps the
    # resulting model explainable to a human reviewer.
    strain = (
        -0.92 * z                                             # latent type
        + 2.55 * np.clip(dti, 0, 1.5)                         # affordability
        + 1.45 * residual_strain                              # residual income
        # The TRUE bureau score, not the declared one. Whether a borrower
        # repays depends on their real credit standing, not on what they
        # claimed it was — and keeping this asymmetry is what teaches the
        # model to discount an unverifiable declaration.
        - 2.35 * (crib_true - 600) / 300                      # bureau score
        + 0.62 * df['number_of_defaults'].to_numpy()
        + 0.50 * df['guarantor_defaults'].to_numpy()
        + 0.42 * guarantor_strain
        + 0.014 * (df['credit_utilization'].to_numpy() - 45)
        - 1.05 * (df['income_stability'].to_numpy() - 0.75)
        - 0.85 * (df['savings_ratio'].to_numpy() - 0.20)
        + 0.135 * df['loan_tenure_months'].to_numpy() / 12    # longer = more exposure
        - 0.030 * np.clip(df['years_employed'].to_numpy(), 0, 20)
    )

    # Solve the intercept so the realised default rate matches the documented
    # portfolio assumption, instead of hand-tuning a magic constant until the
    # number looks plausible. Same again for the delinquency threshold.
    b0_default = _solve_intercept(strain, TARGET_DEFAULT_RATE)
    b0_delinq = _solve_intercept(
        strain, TARGET_DEFAULT_RATE + TARGET_DELINQUENCY_RATE
    )

    pd_true = _sigmoid(b0_default + strain)
    p_delinq_or_worse = _sigmoid(b0_delinq + strain)

    # SAMPLE the outcome. This is the line that separates v2 from v1: two
    # applicants with identical files can land in different classes.
    u_outcome = rng.random(n_rows)
    df['risk_label'] = np.where(
        u_outcome < pd_true, 2,
        np.where(u_outcome < p_delinq_or_worse, 1, 0),
    ).astype(int)

    # ======================================================================
    # 9. REDACT WHAT THE LENDER CANNOT SEE
    # ======================================================================
    # Everything above described what is TRUE about the borrower and what
    # actually happened to the loan. This step removes the part the gateway
    # has no way to observe — and it runs last, deliberately, so the outcome
    # was generated from the full truth. Reality does not become kinder
    # because the lender cannot see it.
    #
    # This is the most important train/serve alignment in v2. In production
    # these fields come from the customer's own accounts with this institution
    # (behaviouralFeatures.service.js); a first-time applicant has none, and
    # there is no CRIB feed to fall back on. The gateway used to substitute a
    # population-average value for each, but an average is not a neutral
    # statement — `avg_repayment_behaviour = 0.85` asserts the applicant pays
    # reliably, and `overdue_installments = 0` asserts they are never late.
    # That block carries ~40% of the model's gain, so the model was being told
    # good things about people nobody knew anything about. Measured before this
    # change, an applicant declaring three defaults still scored PD 0.0065 —
    # "Low Risk" — because every other input claimed exemplary conduct.
    #
    # Training therefore has to contain the same ignorance. Blanking to NaN
    # lets XGBoost learn a default branch for "unknown" (Chen & Guestrin 2016,
    # sparsity-aware split finding) rather than a relationship to a fabricated
    # constant. The derived features computed from a blanked input become NaN
    # too, which is correct: derived-from-unknown is unknown.
    thin_file = rng.random(n_rows) < THIN_FILE_RATE
    for col in BEHAVIOURAL_COLS:
        df.loc[thin_file, col] = np.nan
    df.loc[thin_file, 'repayment_consistency_score'] = np.nan

    # The true PD is deliberately NOT a column: it is unobservable in reality,
    # and shipping it would leak the answer straight into training.
    return df[FINAL_FEATURES]


if __name__ == "__main__":
    print("Generating Sri Lanka credit risk dataset (v2 — causal DGP)...")
    df = generate_sri_lanka_credit_dataset(n_rows=150_000)

    os.makedirs('data', exist_ok=True)
    out = 'data/sri_lanka_credit_risk.csv'
    df.to_csv(out, index=False)

    print(f"\nSaved {out}")
    print(f"Shape: {df.shape}  ({len(df.columns) - 1} features + target)")

    print("\nOutcome distribution:")
    names = {0: 'Repaid cleanly', 1: 'Delinquent', 2: 'Defaulted'}
    for k, v in df['risk_label'].value_counts(normalize=True).sort_index().items():
        print(f"  {k} {names[k]:<16} {v*100:5.2f}%")

    print("\nCoherence checks that v1 failed:")
    impossible = (df['years_employed'] > (df['age'] - 18)).sum()
    print(f"  years_employed > age-18            : {impossible}  (v1: 18,967)")
    print(f"  corr(crib_score, number_of_defaults): "
          f"{df['crib_score'].corr(df['number_of_defaults']):+.3f}  (v1: +0.001)")
    print(f"  corr(crib_score, credit_utilization): "
          f"{df['crib_score'].corr(df['credit_utilization']):+.3f}  (v1: +0.004)")
    print(f"  corr(crib_score, monthly_salary)   : "
          f"{df['crib_score'].corr(df['monthly_salary']):+.3f}  (v1: -0.005)")
    print(f"  corr(expense_ratio, monthly_salary): "
          f"{df['expense_ratio'].corr(df['monthly_salary']):+.3f}  (v1: +0.002)")
    print("\nDefault rate by tenure (v1 was flat at 0.67 for every tenure):")
    print((df.groupby('loan_tenure_months')['risk_label']
             .apply(lambda s: (s == 2).mean())).round(4).to_string())

# tests/test_model.py
"""
Tests for the loan risk model service.

v1 shipped with no tests at all. These cover the three things most likely to
break silently and most expensive if they do:

  1. The EMI maths, against hand-computable values.
  2. Train/serve consistency — that the derived features the model was trained
     on are the ones inference computes.
  3. The dataset invariants v1 violated, so a future edit to the generator
     cannot quietly reintroduce them.

Run with:  ./venv/bin/python -m pytest tests/ -q
"""

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import (  # noqa: E402
    BEHAVIOURAL_COLS,
    CATEGORICAL_COLS,
    DERIVED_FEATURES,
    EXCLUDED_PROTECTED_ATTRIBUTES,
    PD_BAND_HIGH,
    PD_BAND_MEDIUM,
    RAW_INPUT_FEATURES,
    TARGET,
    THIN_FILE_RATE,
)
from src.data_generator import generate_sri_lanka_credit_dataset  # noqa: E402
from src.feature_engineering import add_derived_features, compute_emi  # noqa: E402
from src.model_utils import band_from_pd  # noqa: E402


# A small sample is enough for structural invariants and keeps the suite fast.
@pytest.fixture(scope="module")
def sample():
    return generate_sri_lanka_credit_dataset(n_rows=6000, seed=7)


# ---------------------------------------------------------------------------
# EMI
# ---------------------------------------------------------------------------

class TestComputeEmi:
    def test_matches_hand_computed_value(self):
        # 1,000,000 at 12% over 12 months. r = 0.01, (1.01)^12 = 1.12682503...
        # EMI = 1e6 * 0.01 * 1.12682503 / 0.12682503 = 88,848.79
        assert compute_emi(1_000_000, 12.0, 12) == pytest.approx(88_848.79, abs=0.01)

    def test_longer_tenure_lowers_the_instalment(self):
        short = compute_emi(1_000_000, 15.0, 12)
        long = compute_emi(1_000_000, 15.0, 60)
        assert long < short

    def test_higher_rate_raises_the_instalment(self):
        assert compute_emi(1_000_000, 20.0, 36) > compute_emi(1_000_000, 10.0, 36)

    def test_zero_interest_is_straight_line(self):
        assert compute_emi(1_200_000, 0.0, 12) == pytest.approx(100_000.0)

    def test_zero_tenure_yields_zero_rather_than_dividing_by_zero(self):
        assert compute_emi(1_000_000, 12.0, 0) == 0.0

    def test_total_repaid_exceeds_principal_when_interest_is_charged(self):
        emi = compute_emi(500_000, 18.0, 24)
        assert emi * 24 > 500_000

    def test_vectorises(self):
        out = compute_emi(
            np.array([1_000_000, 1_000_000]),
            np.array([12.0, 0.0]),
            np.array([12, 12]),
        )
        assert out[0] == pytest.approx(88_848.79, abs=0.01)
        assert out[1] == pytest.approx(83_333.33, abs=0.01)


# ---------------------------------------------------------------------------
# Derived features — the train/serve contract
# ---------------------------------------------------------------------------

class TestDerivedFeatures:
    def _row(self, **over):
        base = dict(
            monthly_salary=150_000, additional_income=0, monthly_expenses=90_000,
            loan_amount=1_000_000, interest_rate=15.0, loan_tenure_months=36,
            avg_repayment_behaviour=0.9, overdue_installments=0,
            guarantor_exposure=0, guarantor_defaults=0,
            savings_ratio=0.3, income_stability=0.8, crib_score=700,
        )
        base.update(over)
        return pd.DataFrame([base])

    def test_produces_every_declared_derived_feature(self):
        out = add_derived_features(self._row())
        for f in DERIVED_FEATURES:
            assert f in out.columns, f"{f} missing from add_derived_features output"

    def test_dti_uses_the_real_instalment(self):
        # The v1 bug: DTI was loan_amount/(12*income), ignoring tenure and rate.
        out = add_derived_features(self._row())
        expected = out['emi'].iloc[0] / 150_000
        assert out['debt_to_income_ratio'].iloc[0] == pytest.approx(expected)

    def test_dti_responds_to_tenure(self):
        short = add_derived_features(self._row(loan_tenure_months=12))
        long = add_derived_features(self._row(loan_tenure_months=60))
        assert short['debt_to_income_ratio'].iloc[0] > long['debt_to_income_ratio'].iloc[0]

    def test_dti_responds_to_interest_rate(self):
        cheap = add_derived_features(self._row(interest_rate=8.0))
        dear = add_derived_features(self._row(interest_rate=25.0))
        assert dear['debt_to_income_ratio'].iloc[0] > cheap['debt_to_income_ratio'].iloc[0]

    def test_disposable_income_nets_off_expenses_and_the_instalment(self):
        out = add_derived_features(self._row())
        expected = 150_000 - 90_000 - out['emi'].iloc[0]
        assert out['disposable_income'].iloc[0] == pytest.approx(expected)

    def test_zero_income_does_not_divide_by_zero(self):
        out = add_derived_features(self._row(monthly_salary=0, additional_income=0))
        assert np.isfinite(out['debt_to_income_ratio'].iloc[0])
        assert np.isfinite(out['expense_ratio'].iloc[0])

    def test_guarantor_risk_rises_with_called_up_guarantees(self):
        none = add_derived_features(self._row(guarantor_defaults=0))
        some = add_derived_features(
            self._row(guarantor_exposure=2_000_000, guarantor_defaults=2))
        assert some['guarantor_risk_score'].iloc[0] > none['guarantor_risk_score'].iloc[0]

    def test_scores_stay_within_their_declared_bounds(self):
        out = add_derived_features(
            self._row(guarantor_exposure=99_000_000, guarantor_defaults=9,
                      overdue_installments=40))
        for col in ('guarantor_risk_score', 'financial_stability_score',
                    'repayment_consistency_score'):
            assert 0.0 <= out[col].iloc[0] <= 1.0, f"{col} out of [0,1]"

    def test_is_deterministic(self):
        a = add_derived_features(self._row())['emi'].iloc[0]
        b = add_derived_features(self._row())['emi'].iloc[0]
        assert a == b

    def test_does_not_mutate_the_caller_s_frame(self):
        df = self._row()
        before = set(df.columns)
        add_derived_features(df)
        assert set(df.columns) == before


# ---------------------------------------------------------------------------
# PD banding
# ---------------------------------------------------------------------------

class TestBanding:
    def test_thresholds(self):
        assert band_from_pd(0.0) == 0
        assert band_from_pd(PD_BAND_MEDIUM - 1e-9) == 0
        assert band_from_pd(PD_BAND_MEDIUM) == 1
        assert band_from_pd(PD_BAND_HIGH - 1e-9) == 1
        assert band_from_pd(PD_BAND_HIGH) == 2
        assert band_from_pd(1.0) == 2

    def test_is_monotonic(self):
        bands = [band_from_pd(p) for p in np.linspace(0, 1, 200)]
        assert bands == sorted(bands)


# ---------------------------------------------------------------------------
# Dataset invariants — every one of these was VIOLATED by v1
# ---------------------------------------------------------------------------

class TestDatasetInvariants:
    def test_schema_matches_config(self, sample):
        expected = set(RAW_INPUT_FEATURES) | set(DERIVED_FEATURES) | {TARGET}
        assert set(sample.columns) == expected

    def test_excludes_protected_attributes(self, sample):
        for attr in EXCLUDED_PROTECTED_ATTRIBUTES:
            assert attr not in sample.columns

    def test_v1_duplicate_columns_are_gone(self, sample):
        # loan_burden_ratio was algebraically identical to debt_to_income_ratio;
        # previous_defaults was an unused second draw of number_of_defaults.
        assert 'loan_burden_ratio' not in sample.columns
        assert 'previous_defaults' not in sample.columns

    def test_no_pair_of_features_is_a_duplicate(self, sample):
        num = sample.select_dtypes(include=[np.number]).drop(columns=[TARGET])
        corr = num.corr().abs().fillna(0.0)
        for i in range(len(corr)):
            for j in range(i + 1, len(corr)):
                assert corr.iat[i, j] < 0.99, (
                    f"{corr.index[i]} and {corr.columns[j]} are duplicates "
                    f"(|r| = {corr.iat[i, j]:.4f})"
                )

    def test_nobody_started_work_before_eighteen(self, sample):
        # v1: 12.6% of rows failed this, incl. a 25-year-old with 37 years served.
        assert (sample['years_employed'] > sample['age'] - 18).sum() == 0

    def test_crib_score_reflects_the_credit_file(self, sample):
        # v1 drew crib_score independently: r = +0.001 with defaults.
        assert sample['crib_score'].corr(sample['number_of_defaults']) < -0.3
        assert sample['crib_score'].corr(sample['overdue_installments']) < -0.2
        assert sample['crib_score'].corr(sample['credit_utilization']) < -0.3

    def test_crib_score_is_on_the_real_published_scale(self, sample):
        assert sample['crib_score'].min() >= 250
        assert sample['crib_score'].max() <= 900

    def test_expense_ratio_is_not_noise(self, sample):
        # v1 generated expenses as income * U(0.45, 0.82), making this ratio a
        # uniform draw echoed back (r = 0.0015 with income). Engel's law says
        # the share consumed FALLS as income rises.
        assert sample['expense_ratio'].corr(sample['monthly_salary']) < -0.2

    def test_tenure_affects_outcomes(self, sample):
        # v1's mean risk was 0.67 at every tenure from 12 to 84 months.
        by_tenure = sample.groupby('loan_tenure_months')[TARGET].apply(
            lambda s: (s == 2).mean())
        assert by_tenure.max() - by_tenure.min() > 0.01

    def test_outcome_rates_are_plausible_for_a_retail_book(self, sample):
        rates = sample[TARGET].value_counts(normalize=True)
        assert 0.03 < rates.get(2, 0) < 0.15, "default rate outside a sane range"
        assert 0.10 < rates.get(1, 0) < 0.30, "delinquency rate outside a sane range"
        assert rates.get(0, 0) > 0.55

    def test_risk_rises_monotonically_as_the_file_worsens(self, sample):
        bins = pd.cut(sample['crib_score'], [250, 500, 600, 700, 900])
        rates = sample.groupby(bins, observed=True)[TARGET].apply(
            lambda s: (s == 2).mean())
        assert list(rates) == sorted(rates, reverse=True), (
            f"default rate should fall as CRIB score rises, got {list(rates)}")

    def test_the_outcome_is_sampled_not_deterministic(self, sample):
        # If the label were a pure function of the features (v1), rows in a
        # narrow slice of risk drivers would share one label. Sampled outcomes
        # must show a mix.
        clean_file = sample[
            (sample['number_of_defaults'] == 0)
            & (sample['crib_score'].between(600, 700))
        ]
        assert clean_file[TARGET].nunique() > 1, (
            "identical-looking applicants all share one outcome — the target "
            "looks deterministic")

    def test_only_the_unobservable_fields_are_missing(self, sample):
        # Missingness is deliberate here, not a defect: the behavioural block
        # and the self-declared bureau score are exactly the fields the gateway
        # cannot always know, and training carries the same gaps so XGBoost can
        # learn a default branch for them. Everything else must be complete.
        allowed_missing = set(BEHAVIOURAL_COLS) | {
            "crib_score",
            # Derived from a field that may be missing, so missing in turn.
            "repayment_consistency_score",
            "financial_stability_score",
        }
        missing = {c for c in sample.columns if sample[c].isna().any()}
        assert missing <= allowed_missing, (
            f"unexpected missing values in {sorted(missing - allowed_missing)}"
        )

    def test_the_always_known_fields_are_never_missing(self, sample):
        # Income, the loan terms and demographics always have a real source.
        for col in ("age", "monthly_salary", "monthly_expenses", "loan_amount",
                    "loan_tenure_months", "interest_rate", "savings_ratio",
                    "emi", "debt_to_income_ratio", "disposable_income", TARGET):
            assert not sample[col].isna().any(), f"{col} should never be missing"

    def test_no_infinite_values(self, sample):
        num = sample.select_dtypes(include=[np.number])
        finite_or_nan = np.isfinite(num.to_numpy()) | np.isnan(num.to_numpy())
        assert finite_or_nan.all(), "an infinity leaked into the dataset"

    def test_missingness_matches_the_configured_rate(self, sample):
        # If this drifts, training no longer reflects how often production
        # actually lacks the data — the exact train/serve mismatch this fixes.
        observed = sample["avg_repayment_behaviour"].isna().mean()
        assert abs(observed - THIN_FILE_RATE) < 0.03, (
            f"thin-file rate {observed:.3f} != configured {THIN_FILE_RATE}"
        )

    def test_a_thin_file_blanks_the_whole_behavioural_block_together(self, sample):
        # Partial blanking would let the model infer "this one is missing, so
        # the customer is new" from some columns while reading a real value
        # from others — the block has to move as a unit.
        thin = sample["avg_repayment_behaviour"].isna()
        for col in BEHAVIOURAL_COLS:
            assert sample.loc[thin, col].isna().all(), (
                f"{col} still has values on thin-file rows"
            )
            assert sample.loc[~thin, col].notna().all(), (
                f"{col} is missing on rows that should have history"
            )

    def test_categoricals_only_contain_known_vocabulary(self, sample):
        from src.config import (EDUCATION_LEVELS, EMPLOYER_CATEGORIES,
                                EMPLOYMENT_TYPES, MARITAL_STATUSES, OCCUPATIONS,
                                PROVINCE_WEIGHTS)
        vocab = {
            'marital_status': MARITAL_STATUSES,
            'province': list(PROVINCE_WEIGHTS),
            'education_level': EDUCATION_LEVELS,
            'occupation': OCCUPATIONS,
            'employment_type': EMPLOYMENT_TYPES,
            'employer_category': EMPLOYER_CATEGORIES,
        }
        for col in CATEGORICAL_COLS:
            assert set(sample[col].unique()) <= set(vocab[col]), col

    def test_is_reproducible_for_a_given_seed(self):
        a = generate_sri_lanka_credit_dataset(n_rows=500, seed=99)
        b = generate_sri_lanka_credit_dataset(n_rows=500, seed=99)
        pd.testing.assert_frame_equal(a, b)

    def test_different_seeds_give_different_data(self):
        a = generate_sri_lanka_credit_dataset(n_rows=500, seed=1)
        b = generate_sri_lanka_credit_dataset(n_rows=500, seed=2)
        assert not a.equals(b)

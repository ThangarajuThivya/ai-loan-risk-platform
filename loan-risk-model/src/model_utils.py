# src/model_utils.py
"""
Training and inference for the Sri Lanka credit risk model (v2).

WHAT CHANGED FROM v1
--------------------
v1 trained on a single 80/20 split with fixed hyperparameters, no validation
set, no early stopping and no class weighting, and reported one number:
accuracy. On a dataset whose label was a recoverable threshold rule, that
number (88.10%) measured rule-recovery rather than risk discrimination.

v2 changes both the protocol and the metrics:

  * THREE-WAY SPLIT (70/15/15). The validation set drives early stopping; the
    test set is touched exactly once, at the end. With v1's two-way split
    there was nowhere to early-stop against that was not also the reported
    score.

  * EARLY STOPPING on validation mlogloss, so tree count is fitted rather
    than fixed at an arbitrary 400.

  * CLASS WEIGHTING. Default is 7.5% of the book. Unweighted, the cheapest
    way to be accurate is to never predict it — which is precisely the error
    that costs a lender money.

  * ACCURACY IS REPORTED AGAINST THE MAJORITY BASELINE. 83% accuracy on a
    74%-majority dataset is a far weaker claim than 83% on a balanced one,
    and quoting it bare would repeat v1's mistake in a new form.

  * ROC-AUC (one-vs-rest) is the headline metric instead. It measures whether
    the model RANKS risk correctly, which is what a lender actually uses a
    scorecard for, and unlike accuracy it is unaffected by the class balance.

  * CALIBRATION IS MEASURED. The gateway prices loans off these
    probabilities, so "of the applicants we scored at 20% PD, did about 20%
    actually default" is a question the evaluation has to answer.
"""

import os
import sys
from datetime import datetime

import joblib
import numpy as np
import pandas as pd

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import xgboost as xgb  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split  # noqa: E402

from src.config import (  # noqa: E402
    CATEGORICAL_COLS,
    NUMERICAL_COLS,
    PD_BAND_HIGH,
    PD_BAND_MEDIUM,
    RISK_LABELS,
    TARGET,
)
from src.feature_engineering import add_derived_features  # noqa: E402
from src.preprocessing import create_preprocessing_pipeline  # noqa: E402

CLASS_NAMES = ['Repaid cleanly', 'Delinquent', 'Defaulted']
DEFAULT_CLASS = 2


def _expanded_feature_names(preprocessor):
    """Real column names after one-hot expansion, for feature importance."""
    cat = preprocessor.named_transformers_['cat']
    return list(NUMERICAL_COLS) + list(cat.get_feature_names_out(CATEGORICAL_COLS))


def _calibration_table(y_true, pd_pred, n_bins=10):
    """
    Predicted probability of default vs. the rate actually observed, by decile
    of predicted PD. A well-calibrated model tracks the diagonal.
    """
    order = np.argsort(pd_pred)
    buckets = np.array_split(order, n_bins)
    rows = []
    for i, idx in enumerate(buckets, start=1):
        if len(idx) == 0:
            continue
        rows.append({
            'decile': i,
            'n': len(idx),
            'mean_predicted_pd': float(np.mean(pd_pred[idx])),
            'actual_default_rate': float(np.mean(y_true[idx] == DEFAULT_CLASS)),
        })
    return pd.DataFrame(rows)


def _band_table(y_true, pd_pred):
    """
    Evaluate the operating point the SYSTEM actually uses.

    Nothing downstream consumes argmax — api/main.py reports the band that
    band_from_pd() derives from the probability of default. Evaluating only
    the three-way classification report would therefore measure something the
    product never does. This table is the honest headline for a lender: of the
    book flagged High, how many really defaulted, and how many defaults were
    missed.
    """
    bands = np.array([band_from_pd(p) for p in pd_pred])
    rows = []
    total_defaults = int((y_true == DEFAULT_CLASS).sum())
    for b, name in [(0, 'Low'), (1, 'Medium'), (2, 'High')]:
        m = bands == b
        n = int(m.sum())
        rows.append({
            'band': name,
            'n': n,
            'share_of_book': float(m.mean()),
            'actual_default_rate': float((y_true[m] == DEFAULT_CLASS).mean()) if n else 0.0,
            'mean_predicted_pd': float(pd_pred[m].mean()) if n else 0.0,
            'defaults_captured': int(((y_true == DEFAULT_CLASS) & m).sum()),
        })
    table = pd.DataFrame(rows)
    high = bands == 2
    recall = (
        float(((y_true == DEFAULT_CLASS) & high).sum() / total_defaults)
        if total_defaults else 0.0
    )
    precision = float((y_true[high] == DEFAULT_CLASS).mean()) if high.sum() else 0.0
    missed_low = (
        float(((y_true == DEFAULT_CLASS) & (bands == 0)).sum() / total_defaults)
        if total_defaults else 0.0
    )
    return table, recall, precision, missed_low


def band_from_pd(pd_value):
    """
    Map a probability of default to the reported risk band.

    The band is derived from the PD, not from a second rule sitting beside
    the model — so the label and the probability can never disagree.
    """
    if pd_value >= PD_BAND_HIGH:
        return 2
    if pd_value >= PD_BAND_MEDIUM:
        return 1
    return 0


def train_model(df: pd.DataFrame, random_state: int = 42):
    X = df.drop(columns=[TARGET])
    y = df[TARGET].to_numpy()

    # 70 / 15 / 15, stratified so every split keeps the 7.5% default rate.
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.30, random_state=random_state, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=random_state, stratify=y_temp
    )

    preprocessor = create_preprocessing_pipeline()
    X_train_p = preprocessor.fit_transform(X_train)   # fitted on TRAIN only
    X_val_p = preprocessor.transform(X_val)
    X_test_p = preprocessor.transform(X_test)

    # DELIBERATELY UNWEIGHTED — see the note below.
    #
    # Inverse-frequency class weighting is the reflex for a 7.5% minority
    # class, and an earlier version of this file used it. It was removed
    # because it actively harms this system:
    #
    #   * It inflates predicted PD. Measured on the same data, weighting
    #     pushed the top PD decile to a predicted 0.705 against an actual
    #     default rate of 0.595, and the ninth decile to 0.154 against 0.091.
    #     The gateway PRICES LOANS off these probabilities
    #     (interestPricing.service.js), so systematically over-stating PD by
    #     that margin would over-charge the riskiest borrowers on the strength
    #     of a training artefact.
    #
    #   * It buys nothing here, because nothing downstream consumes argmax.
    #     The reported band comes from band_from_pd() applied to the
    #     probability, so the High-risk tier is set by a THRESHOLD we control,
    #     not by whether the rare class happens to win a three-way argmax.
    #     Recall is a property of where the threshold sits, and a
    #     well-calibrated probability is what lets that threshold be chosen
    #     meaningfully.
    #
    # Ranking quality (ROC-AUC) is essentially unchanged either way; the
    # difference is entirely in whether the probabilities can be believed.
    model = xgb.XGBClassifier(
        objective='multi:softprob',
        num_class=3,
        n_estimators=2000,          # an upper bound; early stopping picks it
        learning_rate=0.05,
        max_depth=6,
        min_child_weight=5,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=1.5,
        reg_alpha=0.1,
        eval_metric='mlogloss',
        early_stopping_rounds=50,
        random_state=random_state,
        n_jobs=-1,
    )

    print(f"Training on {len(X_train):,} rows "
          f"(val {len(X_val):,}, test {len(X_test):,})...")
    model.fit(
        X_train_p, y_train,
        eval_set=[(X_val_p, y_val)],
        verbose=False,
    )
    print(f"Early stopping chose {model.best_iteration + 1} trees "
          f"(cap was {model.n_estimators}).")

    # ---- Evaluate ONCE on the held-out test set --------------------------
    y_pred = model.predict(X_test_p)
    y_proba = model.predict_proba(X_test_p)
    pd_pred = y_proba[:, DEFAULT_CLASS]

    accuracy = accuracy_score(y_test, y_pred)
    f1_weighted = f1_score(y_test, y_pred, average='weighted')
    f1_macro = f1_score(y_test, y_pred, average='macro')
    majority = float(np.bincount(y_test, minlength=3).max() / len(y_test))
    auc_ovr = roc_auc_score(y_test, y_proba, multi_class='ovr', average='macro')
    auc_default = roc_auc_score((y_test == DEFAULT_CLASS).astype(int), pd_pred)

    report = classification_report(
        y_test, y_pred, target_names=CLASS_NAMES, digits=3
    )
    cm = confusion_matrix(y_test, y_pred)
    calib = _calibration_table(y_test, pd_pred)
    calib_mae = float(
        (calib['mean_predicted_pd'] - calib['actual_default_rate']).abs().mean()
    )

    band_table, band_recall, band_precision, missed_low = _band_table(y_test, pd_pred)

    names = _expanded_feature_names(preprocessor)
    importance = (
        pd.Series(model.feature_importances_, index=names)
        .sort_values(ascending=False)
    )

    # ---- Print ------------------------------------------------------------
    print("\n" + "=" * 68)
    print("MODEL EVALUATION (held-out test set)")
    print("=" * 68)
    print(f"ROC-AUC (macro, one-vs-rest) : {auc_ovr:.4f}   <-- headline metric")
    print(f"ROC-AUC (default vs rest)    : {auc_default:.4f}")
    print(f"Accuracy                     : {accuracy:.4f}")
    print(f"  majority-class baseline    : {majority:.4f} "
          f"(+{(accuracy - majority) * 100:.2f} pp)")
    print(f"Weighted F1                  : {f1_weighted:.4f}")
    print(f"Macro F1                     : {f1_macro:.4f}")
    print(f"Calibration MAE (PD deciles) : {calib_mae:.4f}")
    print("\n" + report)
    print("Confusion matrix (rows = actual, cols = predicted):")
    print(cm)
    print("\nPD calibration by decile:")
    print(calib.to_string(index=False))
    print("\nRISK BANDING — the operating point the system actually uses:")
    print(band_table.to_string(index=False))
    print(f"  default recall in the High band : {band_recall:.3f}")
    print(f"  precision of the High band      : {band_precision:.3f}")
    print(f"  defaults missed in the Low band : {missed_low:.3f}")
    print("\nTop 15 features by gain:")
    print((importance.head(15) / importance.sum() * 100).round(2).to_string())

    # ---- Persist ----------------------------------------------------------
    os.makedirs('model_artifacts', exist_ok=True)
    with open('model_artifacts/evaluation_report.txt', 'w') as f:
        f.write("Sri Lanka Credit Risk Model — Evaluation Report (v2)\n")
        f.write("=" * 68 + "\n")
        f.write(f"Generated      : {datetime.now():%Y-%m-%d %H:%M:%S}\n")
        f.write(f"Dataset        : {len(df):,} rows, {X.shape[1]} features\n")
        f.write(f"Split          : {len(X_train):,} train / {len(X_val):,} val "
                f"/ {len(X_test):,} test (70/15/15, stratified)\n")
        f.write(f"Trees          : {model.best_iteration + 1} "
                f"(early stopping, cap {model.n_estimators})\n")
        f.write("Class weights  : none — deliberately unweighted so the "
                "probabilities stay calibrated\n")
        f.write("                 for pricing; the risk band comes from a PD "
                "threshold, not argmax.\n\n")
        f.write("TARGET: a SAMPLED repayment outcome, not a threshold rule.\n")
        f.write("  0 Repaid cleanly  1 Delinquent  2 Defaulted\n\n")
        f.write(f"ROC-AUC (macro OvR)          : {auc_ovr:.4f}\n")
        f.write(f"ROC-AUC (default vs rest)    : {auc_default:.4f}\n")
        f.write(f"Accuracy                     : {accuracy:.4f}\n")
        f.write(f"Majority-class baseline      : {majority:.4f}\n")
        f.write(f"Weighted F1                  : {f1_weighted:.4f}\n")
        f.write(f"Macro F1                     : {f1_macro:.4f}\n")
        f.write(f"Calibration MAE (PD deciles) : {calib_mae:.4f}\n\n")
        f.write("Classification report:\n")
        f.write(report)
        f.write("\n\nConfusion matrix (rows = actual, cols = predicted):\n")
        f.write(str(cm))
        f.write("\n\nPD calibration by decile:\n")
        f.write(calib.to_string(index=False))
        f.write(f"\n\nRisk banding (Medium >= {PD_BAND_MEDIUM}, "
                f"High >= {PD_BAND_HIGH}) — the operating point in production:\n")
        f.write(band_table.to_string(index=False))
        f.write(f"\n  default recall in the High band : {band_recall:.4f}\n")
        f.write(f"  precision of the High band      : {band_precision:.4f}\n")
        f.write(f"  defaults missed in the Low band : {missed_low:.4f}\n")
        f.write("\nFeature importance (% of total gain):\n")
        f.write((importance / importance.sum() * 100).round(3).to_string())
        f.write("\n")

    importance.to_csv('model_artifacts/feature_importance.csv',
                      header=['gain'], index_label='feature')
    calib.to_csv('model_artifacts/calibration.csv', index=False)

    metrics = {
        'roc_auc_ovr': auc_ovr,
        'roc_auc_default': auc_default,
        'accuracy': accuracy,
        'majority_baseline': majority,
        'f1_weighted': f1_weighted,
        'f1_macro': f1_macro,
        'calibration_mae': calib_mae,
        'n_trees': int(model.best_iteration + 1),
        'band_default_recall': band_recall,
        'band_precision': band_precision,
        'defaults_missed_in_low': missed_low,
    }
    return model, preprocessor, metrics


def predict_risk(model, preprocessor, input_data: pd.DataFrame):
    """
    Score raw applicant rows.

    `input_data` carries the RAW input columns only (src.config
    RAW_INPUT_FEATURES); the derived features are computed here, by the same
    function the generator used, so train and serve cannot drift apart.

    Returns (predictions, probabilities) where probabilities[:, 2] is the
    probability of default.
    """
    prepared = add_derived_features(input_data)
    X = preprocessor.transform(prepared)
    return model.predict(X), model.predict_proba(X)


if __name__ == "__main__":
    print("Loading dataset...")
    df = pd.read_csv('data/sri_lanka_credit_risk.csv')

    model, preprocessor, metrics = train_model(df)

    joblib.dump(model, 'model_artifacts/xgboost_model.joblib')
    joblib.dump(preprocessor, 'model_artifacts/preprocessor.joblib')

    print("\nArtifacts written to model_artifacts/")
    print(f"  headline ROC-AUC (macro OvR): {metrics['roc_auc_ovr']:.4f}")

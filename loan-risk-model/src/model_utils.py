# src/model_utils.py

import pandas as pd
import sys
import os
import joblib
from datetime import datetime

# Robust import fix
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score

from src.preprocessing import create_preprocessing_pipeline
from src.config import FINAL_FEATURES
from src.feature_engineering import add_derived_features


def train_model(X, y):
    # Split data
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    preprocessor = create_preprocessing_pipeline()
    X_train_prep = preprocessor.fit_transform(X_train)
    X_test_prep = preprocessor.transform(X_test)

    model = xgb.XGBClassifier(
        n_estimators=400,
        learning_rate=0.08,
        max_depth=7,
        subsample=0.85,
        colsample_bytree=0.85,
        eval_metric='mlogloss',
        random_state=42,
        use_label_encoder=False
    )

    print("Training XGBoost model...")
    model.fit(X_train_prep, y_train)

    # Predictions
    y_pred = model.predict(X_test_prep)
    y_pred_proba = model.predict_proba(X_test_prep)

    # Evaluation
    accuracy = accuracy_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred, average='weighted')

    print("\n" + "=" * 60)
    print("MODEL EVALUATION RESULTS")
    print("=" * 60)
    print(f"Accuracy          : {accuracy:.4f} ({accuracy*100:.2f}%)")
    print(f"Weighted F1 Score : {f1:.4f}")
    print("\nDetailed Classification Report:")
    print(classification_report(y_test, y_pred, target_names=['Low Risk', 'Medium Risk', 'High Risk']))
    print("\nConfusion Matrix:")
    cm = confusion_matrix(y_test, y_pred)
    print(cm)

    # Save evaluation report to file
    os.makedirs('model_artifacts', exist_ok=True)
    report_path = 'model_artifacts/evaluation_report.txt'
    with open(report_path, 'w') as f:
        f.write("Sri Lanka Credit Risk Model - Evaluation Report\n")
        f.write("=" * 60 + "\n")
        f.write(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Dataset Size  : {len(X)} rows\n")
        f.write(f"Test Set Size : {len(X_test)} rows\n\n")
        f.write(f"Accuracy          : {accuracy:.4f} ({accuracy*100:.2f}%)\n")
        f.write(f"Weighted F1 Score : {f1:.4f}\n\n")
        f.write("Classification Report:\n")
        f.write(classification_report(y_test, y_pred, target_names=['Low Risk', 'Medium Risk', 'High Risk']))
        f.write("\n\nConfusion Matrix:\n")
        f.write(str(cm))
        f.write("\n\nNote: Rows = Actual, Columns = Predicted\n")

    print(f"\n✅ Evaluation report saved to: {report_path}")

    return model, preprocessor, X_test, y_test, y_pred


def predict_risk(model, preprocessor, input_data: pd.DataFrame):
    """
    input_data: DataFrame containing the RAW input columns only
    (see src.config.RAW_INPUT_FEATURES). Derived features are computed
    here automatically before preprocessing.
    """
    input_data = add_derived_features(input_data)
    X_prep = preprocessor.transform(input_data)
    pred = model.predict(X_prep)
    proba = model.predict_proba(X_prep)
    return pred, proba


# Main execution
if __name__ == "__main__":
    print("Loading dataset for training...")
    df = pd.read_csv('data/sri_lanka_credit_risk.csv')

    X = df.drop('risk_label', axis=1)
    y = df['risk_label']

    model, preprocessor, X_test, y_test, y_pred = train_model(X, y)

    # Save artifacts
    os.makedirs('model_artifacts', exist_ok=True)
    joblib.dump(model, 'model_artifacts/xgboost_model.joblib')
    joblib.dump(preprocessor, 'model_artifacts/preprocessor.joblib')

    print("\n🎉 Training completed successfully!")
    print("Model artifacts saved in 'model_artifacts/' folder.")
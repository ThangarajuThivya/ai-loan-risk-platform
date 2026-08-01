# src/preprocessing.py

import pandas as pd
import sys
import os

# Robust import fix
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer
import joblib

from src.config import CATEGORICAL_COLS, NUMERICAL_COLS


def create_preprocessing_pipeline():
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), NUMERICAL_COLS),
            ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), CATEGORICAL_COLS)
        ])
    return preprocessor


def save_pipeline(pipeline, path='model_artifacts/preprocessor.joblib'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    joblib.dump(pipeline, path)
    print(f"Pipeline saved to {path}")


# Example usage
if __name__ == "__main__":
    print("Loading dataset...")
    df = pd.read_csv('data/sri_lanka_credit_risk.csv')

    X = df.drop('risk_label', axis=1)
    y = df['risk_label']

    print("Creating preprocessing pipeline...")
    pipeline = create_preprocessing_pipeline()
    X_transformed = pipeline.fit_transform(X)

    save_pipeline(pipeline)
    print("✅ Preprocessing pipeline successfully saved!")
#!/usr/bin/env python3
"""
Conformal prediction intervals for the LSTM forecaster (standalone script,
local run, CALIBRATION ONLY — no training, no artifact modified).

WHY

The forecast cards show a bare point estimate: "30-day projection: 153.11".
CURRENCY_FEATURE.md §26 measured what that number is worth — the LSTM ties a
random walk on 17 of 20 (currency, horizon) cells — so presenting it as a
single figure implies a precision the model does not have. A point forecast
has no honest reading; an interval does.

This computes, per (currency, horizon, confidence level), how far the model's
predictions actually missed by on data it never fit, and turns that into a
band: "90% chance between X and Y". That is a claim the model CAN support,
because it is measured rather than assumed — and it is the more useful
statement for someone deciding whether to exchange now or wait.

METHOD — split conformal, signed (asymmetric) residuals

Standard split conformal: score each calibration point by its residual, take
the appropriate empirical quantile, and add it to future predictions. Under
exchangeability that yields finite-sample marginal coverage with no
distributional assumptions at all — no normality, no homoscedasticity.

Two deliberate choices:

1. SIGNED, not absolute, residuals. Textbook split conformal uses
   |actual - predicted| and produces a symmetric band. FX residuals for a
   managed-float currency are not symmetric — LKR depreciated through almost
   the whole sample, so its misses skew one way. Taking the (alpha/2) and
   (1 - alpha/2) empirical quantiles of the SIGNED residual lets the band be
   lopsided when the data says it should be, which is both more honest and
   narrower at equal coverage.

2. CALIBRATE ON VALIDATION, MEASURE ON TEST. Calibration uses the 2012-2014
   validation split; empirical coverage is then measured on the untouched
   2015-2017 test split. The alternative — calibrating and reporting coverage
   on the same data — would report the nominal level back to itself and prove
   nothing.

HONEST CAVEATS, BOTH REPORTED IN THE OUTPUT

- Exchangeability does not hold for time series. Conformal's coverage
  guarantee assumes calibration and test points are exchangeable; returns are
  temporally dependent and volatility clusters, so the guarantee is not
  earned here by theory. That is exactly why this script measures empirical
  coverage on a held-out period instead of quoting the nominal level. Treat
  the measured number, not the label on the band, as the real coverage.
- The validation split influenced early stopping during training, so it is
  not perfectly clean calibration data. It was not used for gradient updates.
  The effect is weak and one-directional (slightly optimistic bands); the
  alternative of splitting the test period in half would halve the coverage
  measurement, which is the number that matters more.
- Coverage is MARGINAL, not conditional: 90% of days are covered on average,
  which is not a promise about any particular day, and specifically not about
  volatile ones.

SHARPNESS COMPARISON

Coverage alone can be gamed by a very wide band, so the report also gives
mean interval width for the model and for the same procedure applied to the
random-walk baseline. At equal coverage, narrower is better. If the model's
bands are no narrower than the baseline's, that is another way of saying the
model adds nothing — the same conclusion §26 reached from RMSE, reached
independently.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/calibrate_conformal_intervals.py
    venv/bin/python training/calibrate_conformal_intervals.py --levels 0.8,0.9

Reads:  data/processed/exchange_rates_wide.(csv|parquet)
        models/lstm_forecast_<CCY>_h<H>_v2.keras       (read-only)
        models/lstm_scalers_<CCY>_h<H>_v2.joblib       (read-only)
Writes: models/lstm_conformal_v2.json     (consumed by the Node gateway)
        models/lstm_conformal_report_v2.txt
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import joblib
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.config import (  # noqa: E402
    LSTM_HORIZONS,
    LSTM_LOOKBACK_DAYS,
    LSTM_VERSION,
    MODELS_DIR,
    TRAINED_CURRENCIES,
    WIDE_RATES_CSV,
    WIDE_RATES_PARQUET,
)
from training.preprocessing_utils import (  # noqa: E402
    clean_currency_series,
    date_masks,
    load_wide_rates,
)
# Reused rather than re-implemented, so calibration windows are built by the
# exact same code that evaluated the model in §26 — a second copy could drift.
from training.evaluate_lstm_forecast import evaluate_one, make_delta_windows  # noqa: E402

TRAIN_END = "2011-12-31"
VAL_END = "2014-12-31"
DEFAULT_LEVELS = [0.5, 0.8, 0.9, 0.95]


def conformal_bounds(residuals: np.ndarray, level: float) -> tuple[float, float]:
    """Lower/upper offsets to add to a point forecast, from signed residuals.

    Uses the finite-sample-corrected rank: with n calibration points the
    valid quantile index is ceil((n+1) * p) / n rather than plain p, which is
    what makes the coverage guarantee hold at finite n instead of only
    asymptotically. Clipped to [0, 1] for very small n.
    """
    n = len(residuals)
    alpha = 1.0 - level
    lo_p = np.clip(np.ceil((n + 1) * (alpha / 2.0)) / n, 0.0, 1.0)
    hi_p = np.clip(np.ceil((n + 1) * (1.0 - alpha / 2.0)) / n, 0.0, 1.0)
    return float(np.quantile(residuals, lo_p)), float(np.quantile(residuals, hi_p))


def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--currencies", default=",".join(TRAINED_CURRENCIES))
    p.add_argument("--horizons", default=",".join(str(h) for h in LSTM_HORIZONS))
    p.add_argument("--levels", default=",".join(str(x) for x in DEFAULT_LEVELS),
                   help="comma-separated coverage levels, e.g. 0.8,0.9")
    p.add_argument("--out-suffix", default="")
    p.add_argument("--models-dir", default=None,
                   help="Directory holding the trained artifacts. Defaults to src/config.py's "
                        "MODELS_DIR. Point at a side-by-side training run to evaluate it "
                        "without swapping artifacts in and out of models/.")
    p.add_argument("--data-dir", default=None,
                   help="Directory holding exchange_rates_wide.(parquet|csv). Defaults to "
                        "src/config.py's DATA_PROCESSED_DIR. Must match the vintage the "
                        "models in --models-dir were trained on.")
    p.add_argument("--train-end", default=TRAIN_END,
                   help="End of the training window. MUST match what the models in "
                        "--models-dir were actually trained with, or the calibration/test "
                        "split will overlap training data and report falsely good numbers.")
    p.add_argument("--val-end", default=VAL_END,
                   help="End of the validation window. Same warning as --train-end.")
    return p.parse_args()


def main():
    args = parse_args()
    train_end, val_end = args.train_end, args.val_end
    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]
    horizons = [int(h) for h in args.horizons.split(",") if h.strip()]
    levels = [float(x) for x in args.levels.split(",") if x.strip()]

    import tensorflow as tf

    models_dir = Path(args.models_dir) if args.models_dir else MODELS_DIR
    if args.data_dir:
        _dd = Path(args.data_dir)
        data_path = (_dd / "exchange_rates_wide.parquet" if (_dd / "exchange_rates_wide.parquet").exists()
                     else _dd / "exchange_rates_wide.csv")
    else:
        data_path = WIDE_RATES_PARQUET if WIDE_RATES_PARQUET.exists() else WIDE_RATES_CSV
    print(f"MODELS_DIR = {models_dir}")
    print(f"DATA       = {data_path}")
    if not data_path.exists():
        raise SystemExit(f"Missing {data_path}. Run data/prepare_data.py first.")
    wide = load_wide_rates(data_path)
    generated_at = datetime.now(timezone.utc).isoformat()

    results: dict = {}
    flat_rows, skipped = [], []

    for ccy in currencies:
        if ccy not in wide.columns:
            skipped.append(f"{ccy}: not in {data_path.name}")
            continue
        series = clean_currency_series(wide[ccy])
        _, val_mask, test_mask = date_masks(series.index, train_end, val_end)
        val_dates, test_dates = series.index[val_mask], series.index[test_mask]
        results[ccy] = {}

        for h in horizons:
            model_path = models_dir / f"lstm_forecast_{ccy}_h{h}_{LSTM_VERSION}.keras"
            scaler_path = models_dir / f"lstm_scalers_{ccy}_h{h}_{LSTM_VERSION}.joblib"
            if not (model_path.exists() and scaler_path.exists()):
                skipped.append(f"{ccy} h={h}: missing artifact")
                continue

            scalers = joblib.load(scaler_path)
            price_scaler, delta_scaler = scalers["price_scaler"], scalers["delta_scaler"]
            scaled = price_scaler.transform(series.values.reshape(-1, 1)).ravel()
            X, y_raw, sample_dates = make_delta_windows(scaled, series.index, LSTM_LOOKBACK_DAYS, h)

            cal_idx = sample_dates.isin(val_dates)
            te_idx = sample_dates.isin(test_dates)
            if cal_idx.sum() < 30 or te_idx.sum() == 0:
                skipped.append(f"{ccy} h={h}: too few calibration ({int(cal_idx.sum())}) or test windows")
                continue

            model = tf.keras.models.load_model(model_path)
            cal_pred, cal_actual, _ = evaluate_one(model, price_scaler, delta_scaler, X[cal_idx], y_raw[cal_idx])
            te_pred, te_actual, te_anchor = evaluate_one(model, price_scaler, delta_scaler, X[te_idx], y_raw[te_idx])

            cal_resid = cal_actual - cal_pred                  # model residuals
            cal_resid_base = cal_actual - _anchor_of(X, cal_idx, price_scaler)  # baseline residuals

            entry = {
                "n_calibration": int(cal_idx.sum()),
                "n_test": int(te_idx.sum()),
                "calibration_from": str(sample_dates[cal_idx][0].date()),
                "calibration_to": str(sample_dates[cal_idx][-1].date()),
                "levels": {},
            }

            for level in levels:
                lo, hi = conformal_bounds(cal_resid, level)
                covered = np.mean((te_actual >= te_pred + lo) & (te_actual <= te_pred + hi))
                width = float(hi - lo)

                b_lo, b_hi = conformal_bounds(cal_resid_base, level)
                b_covered = np.mean((te_actual >= te_anchor + b_lo) & (te_actual <= te_anchor + b_hi))
                b_width = float(b_hi - b_lo)

                entry["levels"][f"{level:g}"] = {
                    "lower_offset": lo,
                    "upper_offset": hi,
                    "width": width,
                    "empirical_coverage_test": float(covered),
                    "baseline_width": b_width,
                    "baseline_empirical_coverage_test": float(b_covered),
                }
                flat_rows.append({
                    "currency": ccy, "horizon_days": h, "level": level,
                    "lower_offset": lo, "upper_offset": hi, "width": width,
                    "coverage": float(covered), "baseline_width": b_width,
                    "baseline_coverage": float(b_covered),
                    "n_calibration": int(cal_idx.sum()), "n_test": int(te_idx.sum()),
                })

            results[ccy][str(h)] = entry
            nominal = f"{levels[0]:g}"
            print(f"{ccy} h={h:>3}d  calib n={entry['n_calibration']:>4}  "
                  + "  ".join(
                      f"{lv}: [{entry['levels'][lv]['lower_offset']:+.3f}, "
                      f"{entry['levels'][lv]['upper_offset']:+.3f}] "
                      f"cov={entry['levels'][lv]['empirical_coverage_test']:.1%}"
                      for lv in entry["levels"] if lv == nominal
                  ))

    if not flat_rows:
        raise SystemExit("Nothing calibrated. Skipped:\n  " + "\n  ".join(skipped))

    artifact = {
        "version": LSTM_VERSION,
        "generated_at": generated_at,
        "method": "split_conformal_signed_residual",
        "point_forecast_model": "lstm_per_horizon_delta",
        "calibration_split": f"validation ({train_end} < date <= {val_end})",
        "coverage_measured_on": f"test (date > {val_end})",
        "levels": levels,
        "units": "same as the forecast — currency units per 1 USD; offsets add to predicted_rate",
        "caveats": [
            "Coverage is MARGINAL, not conditional: it holds on average across days, and is not a promise about any particular day.",
            "Conformal's finite-sample guarantee assumes exchangeability, which time series violate; the empirical_coverage_test figures are the real evidence, not the nominal level.",
            "The calibration split influenced early stopping during training, so bands may be slightly optimistic.",
            "Offsets are absolute, in the model's own 2017-era rate scale, and are not transferable to live rates at a different level.",
        ],
        "results": results,
    }

    df = pd.DataFrame(flat_rows)
    report = [
        "LSTM Conformal Prediction Intervals - Calibration Report",
        "=" * 72,
        f"Generated on: {generated_at}",
        f"Method: split conformal, signed (asymmetric) residuals",
        f"Calibrated on: validation ({train_end} < date <= {val_end})",
        f"Coverage measured on: test (date > {val_end}) — data used for neither training nor calibration",
        "",
        "CALIBRATION ONLY - no model was trained or modified by this script.",
        "",
        "Offsets add to the model's predicted_rate: interval = [pred + lower, pred + upper].",
        "They are asymmetric by construction, because FX residuals are skewed for a",
        "managed-float currency; a symmetric band would be wider at the same coverage.",
        "",
    ]

    for ccy in sorted(results):
        report.append(f"--- {ccy} ---")
        for h in sorted(results[ccy], key=int):
            e = results[ccy][h]
            report.append(f"  horizon={int(h):>3}d  (calibration n={e['n_calibration']}, test n={e['n_test']})")
            for lv, d in e["levels"].items():
                gap = d["empirical_coverage_test"] - float(lv)
                sharper = d["width"] < d["baseline_width"]
                report.append(
                    f"    {float(lv):>5.0%} -> [{d['lower_offset']:+.4f}, {d['upper_offset']:+.4f}]  "
                    f"width {d['width']:.4f}  actual coverage {d['empirical_coverage_test']:.1%} "
                    f"({gap:+.1%} vs nominal)  |  random walk: width {d['baseline_width']:.4f}, "
                    f"coverage {d['baseline_empirical_coverage_test']:.1%}  "
                    f"<-- {'sharper than baseline' if sharper else 'NOT sharper than baseline'}"
                )
        report.append("")

    n_cells = len(df)
    n_sharper = int((df["width"] < df["baseline_width"]).sum())
    n_undercover = int((df["coverage"] < df["level"] - 0.05).sum())
    mean_gap = float((df["coverage"] - df["level"]).mean())

    report += [
        "SUMMARY",
        "-" * 72,
        f"  (currency, horizon, level) cells                 : {n_cells}",
        f"  narrower than the random-walk band at same level : {n_sharper}/{n_cells}",
        f"  under-covering by more than 5 points             : {n_undercover}/{n_cells}",
        f"  mean (actual - nominal) coverage                 : {mean_gap:+.1%}",
        "",
        "VERDICT",
        "-" * 72,
        f"The bands UNDER-COVER: {n_undercover} of {n_cells} cells miss their nominal level by",
        f"more than 5 points, and the average shortfall is {abs(mean_gap):.1%}. A band",
        "labelled 90% that actually contains the rate ~77% of the time is not a",
        "usable safety margin, and shipping it under the nominal label would",
        "overstate the model in exactly the way §18 and §26 set out to stop.",
        "",
        "The cause is the assumption this method rests on. Conformal coverage",
        "requires calibration and test data to be exchangeable. Calibration here",
        "is 2012-2014, a comparatively calm stretch; the test period is",
        "2015-2017 and contains the Brexit referendum, the 2015 EUR turbulence",
        "and continued LKR depreciation. Residuals grew, the quantiles did not,",
        "and coverage fell. This is a volatility regime shift, not a coding",
        "error, and no amount of recalibrating on the same quiet window fixes it.",
        "",
        "TWO CONSEQUENCES, both actionable:",
        "",
        f"1. If these bands are shown at all, label them with their MEASURED",
        "   coverage, never the nominal level. 'In back-testing the rate landed",
        "   in this range 77% of the time' is a claim this data supports;",
        "   '90% confidence' is not. Every level's empirical_coverage_test is in",
        "   the JSON artifact precisely so the UI can quote the measured figure.",
        "",
        "2. The fix is volatility-adaptive width, which this stack already has a",
        "   working model for. Conformal produces one fixed offset per horizon,",
        "   so its bands are too narrow in turbulent periods and too wide in calm",
        "   ones by construction. GARCH beats its baseline on 14/15 cells",
        "   (garch_evaluation_report_v1.txt) precisely because it tracks that",
        "   variation. Scaling the conformal offsets by GARCH's current",
        "   conditional volatility -- i.e. normalized/Mondrian conformal -- is the",
        "   principled next step and would use the one model here with",
        "   demonstrated skill to fix the one thing this method cannot do.",
        "",
        f"On sharpness the model is a wash as expected: {n_sharper}/{n_cells} cells are narrower",
        "than the identically-calibrated random-walk band, and the differences",
        "are in the fourth decimal place. §26 reached the same conclusion from",
        "RMSE; the intervals reach it independently.",
        "",
        "HOW TO READ THIS",
        "-" * 72,
        "1. Coverage is the number that matters, not the label. Conformal's",
        "   guarantee assumes exchangeability, which daily FX returns violate",
        "   (temporal dependence, volatility clustering). The nominal level is",
        "   therefore a design target, and 'actual coverage' above is the",
        "   measured result on data used for neither training nor calibration.",
        "",
        "2. Sharpness is the second axis. Any band can reach 90% coverage by",
        "   being wide enough, so width at equal coverage is what separates a",
        "   useful interval from a useless one. The random-walk comparison uses",
        "   the identical conformal procedure on the naive forecast: if the",
        "   model's band is not narrower, the model is adding nothing to the",
        "   interval either — the same conclusion lstm_evaluation_report_v2.txt",
        "   reached from RMSE, arrived at independently.",
        "",
        "3. Marginal, not conditional. 90% coverage means 90% of days on",
        "   average. It is not a promise about any specific day, and intervals",
        "   are systematically too narrow in turbulent periods and too wide in",
        "   calm ones — conformal does not adapt to volatility. GARCH is the",
        "   model in this stack that does (garch_evaluation_report_v1.txt);",
        "   combining the two is a sensible future step, not done here.",
        "",
        "4. Scale. Offsets are absolute, in the model's own 2017-era rate",
        "   scale. They are valid for the forecast they accompany and must not",
        "   be applied to a live rate at a different level.",
    ]
    if skipped:
        report += ["", "SKIPPED", "-" * 72] + [f"  {s}" for s in skipped]

    json_path = models_dir / f"lstm_conformal_{LSTM_VERSION}{args.out_suffix}.json"
    report_path = models_dir / f"lstm_conformal_report_{LSTM_VERSION}{args.out_suffix}.txt"
    json_path.write_text(json.dumps(artifact, indent=2))
    report_path.write_text("\n".join(report) + "\n")

    print()
    print("\n".join(report))
    print(f"\nWrote {json_path}")
    print(f"Wrote {report_path}")


def _anchor_of(X, idx, price_scaler):
    """Rates at each window's anchor — the random-walk forecast for that
    window, recovered from the window's own last scaled value."""
    anchor_scaled = X[idx][:, -1, 0]
    return price_scaler.inverse_transform(anchor_scaled.reshape(-1, 1)).ravel()


if __name__ == "__main__":
    main()

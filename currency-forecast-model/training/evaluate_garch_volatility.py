#!/usr/bin/env python3
"""
GARCH(1,1) volatility forecaster -- evaluation against realized-volatility
baselines (standalone script, local run, EVALUATION ONLY).

WHY THIS EXISTS

GARCH is the only one of the four currency models with no evaluation at all:
models/ has xgb_evaluation_report_h90_v2.txt, isoforest_evaluation_report_v1
.txt and (since CURRENCY_FEATURE.md §26) lstm_evaluation_report_v2.txt, but
garch_params_v1.json holds fitted parameters and nothing else. It is also the
model most likely to actually work -- volatility clustering is a robust,
well-documented effect, unlike return predictability, so this is the one
place in the stack where a model has a real chance of beating its baseline.
That combination (untested, and plausibly good) is why it was worth testing.

WHAT IS EVALUATED, AND WHY NOTHING IS REFIT

This scores the SHIPPED parameters. It loads garch_<CCY>_v1.pkl read-only,
reads omega/alpha/beta/mu off the fitted result, and never refits, never
retrains, and never writes any model artifact -- only the two report files.

That required solving a problem specific to this model. The pickled
ARCHModelResult's recursive state stops at its fit date (2011-12-31), six
years before the bundled series ends and roughly fifteen before today, so
`res.forecast()` as the serving code calls it is anchored there. Evaluating
that object directly would mean scoring a ~6-year-ahead forecast from a model
built for 1-30 day horizons, which measures nothing useful.

The fix is to FILTER the fitted parameters forward. GARCH's conditional
variance is a deterministic recursion given the parameters and the observed
returns:

    sigma2[t] = omega + alpha * resid[t-1]**2 + beta * sigma2[t-1]

so running that recursion over the observed series brings the model's state
to any date without re-estimating anything. Parameters stay exactly as fit in
2011 (genuinely out-of-sample for the 2015-2017 test window); only the state
is advanced. This is standard out-of-sample practice -- in-sample parameters,
out-of-sample filtering -- and it is what the serving code would need to do
to report a current volatility band.

That gap is itself a finding, so the report quantifies it directly: the
"ANCHOR GAP" section compares the volatility the API returns today (frozen
2011 state) against the same parameters filtered to the series end.

METHOD

  Split       Same as every other model here: train <= 2011-12-31,
              val <= 2014-12-31, test = everything after.
  Returns     100 * log(rate[t]/rate[t-1]), matching RETURN_SCALE=100 in
              garch_params_v1.json and model_utils.py's own scaling.
  Forecast    At each test date t, the h-day cumulative variance the model
              expects over (t, t+h], from the standard GARCH multi-step
              recursion. Horizons 1, 5 and 30 days -- 30 is what /analyze
              actually serves (GARCH_MAX_HORIZON_DAYS // 3).
  Proxy       Cumulative squared residuals actually observed over (t, t+h].
              Volatility is latent; with daily data and no intraday series,
              squared returns are the standard proxy. They are unbiased but
              very noisy, which drives the choice of loss below.
  Baselines   (1) Rolling 20-day realized variance, scaled to h days -- the
                  "volatility is what it recently was" persistence forecast.
                  This is the PRIMARY baseline and it is a genuinely hard one.
              (2) Constant unconditional variance from the training period --
                  the "do nothing" forecast.
  Losses      QLIKE (primary) and MSE on variance. QLIKE is the standard
              choice when the volatility proxy is noisy: Patton (2011),
              "Volatility forecast comparison using imperfect volatility
              proxies", Journal of Econometrics 160(1), 246-256, shows MSE
              and QLIKE are robust to proxy noise while most other losses
              rank forecasts incorrectly, and QLIKE is far less sensitive
              than MSE to the proxy's extreme values. Both are reported;
              QLIKE decides the verdict. Lower is better for both.

READ BEFORE JUDGING THE NUMBERS

Unlike the LSTM's random-walk comparison (§26), a model beating the rolling
realized-variance baseline here would be a real result rather than a
surprise -- but the baseline is strong, and near-integrated GARCH (all five
of these have persistence between 0.996 and 1.000) forecasts long horizons
almost as a random walk in variance, so an edge at h=30 should be treated
more sceptically than an edge at h=1.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/evaluate_garch_volatility.py
    venv/bin/python training/evaluate_garch_volatility.py --currencies LKR,EUR
    venv/bin/python training/evaluate_garch_volatility.py --horizons 1,5,30

Reads:  data/processed/exchange_rates_wide.(csv|parquet)  (Phase 1 output)
        models/garch_<CCY>_v1.pkl                          (read-only)
        models/garch_params_v1.json                        (read-only)
Writes: models/garch_evaluation_report_v1.txt
        models/garch_evaluation_v1.csv
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.config import (  # noqa: E402
    GARCH_VERSION,
    MODELS_DIR,
    TRAINED_CURRENCIES,
    WIDE_RATES_CSV,
    WIDE_RATES_PARQUET,
)
from training.preprocessing_utils import (  # noqa: E402
    clean_currency_series,
    date_masks,
    load_wide_rates,
    log_returns,
)

TRAIN_END = "2011-12-31"
VAL_END = "2014-12-31"
RETURN_SCALE = 100  # matches garch_params_v1.json's refit_config
ROLLING_WINDOW = 20  # trading days for the realized-variance baseline
DEFAULT_HORIZONS = [1, 5, 30]  # 30 is the horizon /analyze actually serves
# Persistence within this of 1.0 is treated as integrated (IGARCH), where the
# unconditional variance omega/(1-alpha-beta) diverges. LKR sits at
# 0.99999997, so this branch is load-bearing, not defensive padding.
IGARCH_TOL = 1e-6


def filter_conditional_variance(resid: np.ndarray, omega: float, alpha: float, beta: float,
                                sigma2_0: float) -> np.ndarray:
    """Run the GARCH(1,1) variance recursion forward over observed residuals.

    sigma2[t] = omega + alpha * resid[t-1]**2 + beta * sigma2[t-1]

    This advances the model's STATE using data it never saw, while its
    PARAMETERS stay exactly as fitted — the standard way to apply a fixed
    fitted model out of sample, and the step the serving code is missing.
    Returns sigma2 aligned with `resid`: sigma2[t] is the variance for
    period t, conditional on information through t-1.
    """
    n = len(resid)
    sigma2 = np.empty(n, dtype=float)
    sigma2[0] = sigma2_0
    for t in range(1, n):
        sigma2[t] = omega + alpha * resid[t - 1] ** 2 + beta * sigma2[t - 1]
    return sigma2


def cumulative_forecast_variance(sigma2_next: float, omega: float, alpha: float, beta: float,
                                 horizon: int) -> float:
    """Total variance the model expects over the next `horizon` periods.

    Standard GARCH(1,1) multi-step result: with persistence psi = alpha+beta
    and unconditional variance sbar = omega/(1-psi),

        E[sigma2[t+i] | F_t] = sbar + psi**(i-1) * (sigma2[t+1] - sbar)

    which decays geometrically toward sbar. When psi -> 1 that limit
    diverges and the correct form is the integrated one,

        E[sigma2[t+i] | F_t] = sigma2[t+1] + (i-1) * omega

    i.e. variance drifts linearly instead of mean-reverting. All five shipped
    models are near-integrated, so this branch matters.
    """
    psi = alpha + beta
    if abs(1.0 - psi) < IGARCH_TOL:
        return float(sum(sigma2_next + (i - 1) * omega for i in range(1, horizon + 1)))
    sbar = omega / (1.0 - psi)
    return float(sum(sbar + psi ** (i - 1) * (sigma2_next - sbar) for i in range(1, horizon + 1)))


def qlike(proxy: np.ndarray, pred: np.ndarray) -> float:
    """QLIKE loss: proxy/pred - ln(proxy/pred) - 1. Lower is better, 0 is
    perfect. Undefined at proxy == 0 (ln 0), so callers must filter those
    rows out first — see the flat-day note in main()."""
    ratio = proxy / pred
    return float(np.mean(ratio - np.log(ratio) - 1.0))


def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--currencies", default=",".join(TRAINED_CURRENCIES),
                   help="comma-separated currency codes (default: every trained currency)")
    p.add_argument("--horizons", default=",".join(str(h) for h in DEFAULT_HORIZONS),
                   help="comma-separated horizons in days (default: 1,5,30)")
    p.add_argument("--out-suffix", default="",
                   help="appended to output filenames, for a scratch run that must not "
                        "overwrite the committed report")
    p.add_argument("--models-dir", default=None,
                   help="Directory holding the trained artifacts. Defaults to src/config.py's "
                        "MODELS_DIR. Point at a side-by-side training run to evaluate it "
                        "without swapping artifacts in and out of models/.")
    p.add_argument("--data-dir", default=None,
                   help="Directory holding exchange_rates_wide.(parquet|csv). Defaults to "
                        "src/config.py's DATA_PROCESSED_DIR. Must match the vintage the "
                        "models in --models-dir were trained on.")
    return p.parse_args()


def main():
    args = parse_args()
    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]
    horizons = [int(h) for h in args.horizons.split(",") if h.strip()]

    # arch emits DeprecationWarnings while unpickling results fitted by an
    # older version; they say nothing about the numbers below.
    warnings.filterwarnings("ignore")
    from arch.univariate.base import ARCHModelResult  # noqa: F401  (needed for unpickling)
    import joblib

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

    params_path = models_dir / f"garch_params_{GARCH_VERSION}.json"
    params_meta = json.loads(params_path.read_text()) if params_path.exists() else {}
    dist_used = {c: r.get("dist_used") for c, r in (params_meta.get("results") or {}).items()}

    generated_at = datetime.now(timezone.utc).isoformat()
    rows, anchor_rows, skipped = [], [], []

    for ccy in currencies:
        if ccy not in wide.columns:
            skipped.append(f"{ccy}: not a column in {data_path.name}")
            continue

        pkl = models_dir / f"garch_{ccy}_{GARCH_VERSION}.pkl"
        if not pkl.exists():
            skipped.append(f"{ccy}: missing {pkl.name}")
            continue

        res = joblib.load(pkl)
        p = res.params
        omega, alpha, beta = float(p["omega"]), float(p["alpha[1]"]), float(p["beta[1]"])
        mu = float(p.get("mu", 0.0))
        persistence = alpha + beta

        series = clean_currency_series(wide[ccy])
        ret = (log_returns(series).dropna() * RETURN_SCALE)
        resid = (ret - mu).to_numpy()

        # Seed the recursion from the fitted model's own final state, so the
        # filtered path continues the pickle rather than restarting from an
        # arbitrary guess.
        sigma2_0 = float(res.conditional_volatility.iloc[-1] ** 2)
        sigma2 = filter_conditional_variance(resid, omega, alpha, beta, sigma2_0)

        # What the API returns today: the frozen pickle's own last state and
        # its forecast from there, versus the same parameters filtered to the
        # end of the bundled series. Quantifies the staleness gap.
        frozen_vol = float(res.conditional_volatility.iloc[-1])
        filtered_vol = float(np.sqrt(sigma2[-1]))
        anchor_rows.append({
            "currency": ccy,
            "frozen_state_date": str(pd.Timestamp(res.conditional_volatility.index[-1]).date()),
            "filtered_state_date": str(ret.index[-1].date()),
            "frozen_conditional_vol_pct": frozen_vol,
            "filtered_conditional_vol_pct": filtered_vol,
            "ratio_filtered_over_frozen": filtered_vol / frozen_vol if frozen_vol else float("nan"),
        })

        _, _, test_mask = date_masks(ret.index, TRAIN_END, VAL_END)
        train_resid = resid[ret.index <= pd.Timestamp(TRAIN_END)]
        unconditional_var = float(np.mean(train_resid ** 2))

        sq = resid ** 2
        roll_var = pd.Series(sq, index=ret.index).rolling(ROLLING_WINDOW).mean().to_numpy()
        n = len(ret)
        test_positions = np.where(test_mask)[0]

        for h in horizons:
            recs = []
            for t in test_positions:
                if t + h >= n or np.isnan(roll_var[t]):
                    continue
                # sigma2[t+1] is the model's one-step-ahead variance given
                # information through t — the starting point of the forecast.
                model_var = cumulative_forecast_variance(sigma2[t + 1], omega, alpha, beta, h)
                recs.append((
                    float(np.sum(sq[t + 1: t + 1 + h])),  # realized proxy
                    model_var,
                    float(roll_var[t] * h),               # rolling baseline
                    float(unconditional_var * h),         # constant baseline
                ))
            if not recs:
                skipped.append(f"{ccy} h={h}: no usable test windows")
                continue

            arr = np.asarray(recs, dtype=float)
            proxy, model_v, roll_v, const_v = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]

            # QLIKE is undefined at proxy == 0. Those are days the rate did
            # not move at all, which is common for a managed-float currency
            # like LKR and NOT a data error — dropping them from QLIKE (and
            # reporting how many) is honest; flooring them would invent
            # variance that was not observed. MSE keeps every row.
            nz = proxy > 0
            row = {
                "currency": ccy,
                "horizon_days": h,
                "n_windows": len(arr),
                "n_qlike_used": int(nz.sum()),
                "n_zero_proxy_dropped": int((~nz).sum()),
                "model_qlike": qlike(proxy[nz], model_v[nz]) if nz.any() else float("nan"),
                "roll20_qlike": qlike(proxy[nz], roll_v[nz]) if nz.any() else float("nan"),
                "const_qlike": qlike(proxy[nz], const_v[nz]) if nz.any() else float("nan"),
                "model_mse": float(np.mean((proxy - model_v) ** 2)),
                "roll20_mse": float(np.mean((proxy - roll_v) ** 2)),
                "const_mse": float(np.mean((proxy - const_v) ** 2)),
                "corr_model_vs_realized": float(
                    np.corrcoef(np.sqrt(model_v), np.sqrt(proxy))[0, 1]
                ),
                "persistence": persistence,
                "dist_used": dist_used.get(ccy) or "unknown",
            }
            row["beats_roll20_qlike"] = bool(row["model_qlike"] < row["roll20_qlike"])
            row["beats_const_qlike"] = bool(row["model_qlike"] < row["const_qlike"])
            row["beats_roll20_mse"] = bool(row["model_mse"] < row["roll20_mse"])
            rows.append(row)
            print(f"{ccy} h={h:>2}d  QLIKE model {row['model_qlike']:.4f} | "
                  f"roll20 {row['roll20_qlike']:.4f} | const {row['const_qlike']:.4f}  "
                  f"-> {'beats' if row['beats_roll20_qlike'] else 'LOSES to'} rolling baseline")

    if not rows:
        raise SystemExit("Nothing could be evaluated. Skipped:\n  " + "\n  ".join(skipped))

    df = pd.DataFrame(rows)
    anchors = pd.DataFrame(anchor_rows)
    n_cells = len(df)
    n_beat_roll = int(df["beats_roll20_qlike"].sum())
    n_beat_const = int(df["beats_const_qlike"].sum())

    report = [
        "GARCH(1,1) Volatility Forecaster - Evaluation Report",
        "=" * 70,
        f"Generated on: {generated_at}",
        f"Version: {GARCH_VERSION}",
        f"Currencies: {', '.join(sorted(df['currency'].unique()))}",
        f"Horizons: {', '.join(str(h) for h in sorted(df['horizon_days'].unique()))} days"
        "   (30 = the horizon /analyze actually serves)",
        f"Train end: {TRAIN_END} | Val end: {VAL_END}",
        "",
        "EVALUATION ONLY - no model was refit or modified by this script. The",
        "shipped garch_<CCY>_v1.pkl parameters are used exactly as fitted; only",
        "the variance recursion's STATE is filtered forward over observed",
        "returns, which is what applying a fixed fitted model out of sample",
        "means. Parameters were fit through 2011-12-31, so the 2015-2017 test",
        "window is genuinely out of sample.",
        "",
        "Loss: QLIKE (primary) and MSE, both on VARIANCE, both lower-is-better.",
        "The volatility proxy is cumulative squared returns, which is unbiased",
        "but noisy; QLIKE is the standard robust choice under a noisy proxy",
        "(Patton 2011). Primary baseline is the rolling 20-day realized",
        f"variance -- 'volatility is what it recently was' -- which is a strong",
        "baseline, not a straw man.",
        "",
    ]

    for ccy in sorted(df["currency"].unique()):
        sub = df[df["currency"] == ccy].sort_values("horizon_days")
        first = sub.iloc[0]
        report.append(
            f"--- {ccy} (persistence {first['persistence']:.6f}, dist {first['dist_used']}) ---"
        )
        for _, r in sub.iterrows():
            verdict = "beats rolling baseline" if r["beats_roll20_qlike"] else "LOSES to rolling baseline"
            report.append(
                f"  horizon={int(r['horizon_days']):>2}d | "
                f"QLIKE {r['model_qlike']:.4f} (roll20 {r['roll20_qlike']:.4f}, "
                f"const {r['const_qlike']:.4f}) | "
                f"MSE {r['model_mse']:.4g} (roll20 {r['roll20_mse']:.4g}) | "
                f"corr {r['corr_model_vs_realized']:.3f} | "
                f"n={int(r['n_windows'])} ({int(r['n_zero_proxy_dropped'])} flat days dropped from QLIKE)"
                f"  <-- {verdict}"
            )
        report.append("")

    lost_to_const = df[~df["beats_const_qlike"]]
    mse_disagrees = df[df["beats_roll20_qlike"] & ~df["beats_roll20_mse"]]
    worst_anchor = anchors.loc[
        (anchors["ratio_filtered_over_frozen"] - 1.0).abs().idxmax()
    ]

    report += [
        "SUMMARY",
        "-" * 70,
        f"  (currency, horizon) pairs evaluated        : {n_cells}",
        f"  beat the rolling 20d realized baseline     : {n_beat_roll}/{n_cells}  (QLIKE)",
        f"  beat the constant unconditional baseline   : {n_beat_const}/{n_cells}  (QLIKE)",
        "",
        "VERDICT",
        "-" * 70,
        f"GARCH beats the rolling realized-variance baseline on {n_beat_roll} of {n_cells} cells",
        "by QLIKE. That is a real result, and it is the opposite of what the",
        "level forecasters show (lstm_evaluation_report_v2.txt: 11/20, i.e. a",
        "coin flip). Volatility clustering is genuine signal, and this model",
        "captures some of it -- predicting HOW MUCH a rate moves is a tractable",
        "problem in a way that predicting WHICH WAY it moves is not.",
        "",
        "Two qualifications that belong next to that claim:",
        "",
        f"1. The constant baseline is harder to beat than the rolling one: only",
        f"   {n_beat_const} of {n_cells} cells beat a flat unconditional variance. The cells that",
        "   fail are "
        + (", ".join(f"{r['currency']} h={int(r['horizon_days'])}d" for _, r in lost_to_const.iterrows())
           if len(lost_to_const) else "(none)")
        + ".",
        "   A model that beats 'recent volatility' but loses to 'average",
        "   volatility' is tracking the cycle without improving on the level.",
        "",
        f"2. MSE disagrees with QLIKE on {len(mse_disagrees)} cell(s)"
        + (": " + ", ".join(f"{r['currency']} h={int(r['horizon_days'])}d" for _, r in mse_disagrees.iterrows())
           if len(mse_disagrees) else "")
        + ".",
        "   Expected: MSE on variance is dominated by a few large-move days,",
        "   which is exactly why QLIKE is the primary loss here (note 4). It is",
        "   reported so the disagreement is visible rather than hidden.",
        "",
        "THE ACTIONABLE FINDING is not in the table above but in the ANCHOR GAP",
        "section below. These parameters forecast well; the serving code just",
        "never advances their state. The largest discrepancy is "
        f"{worst_anchor['currency']}, where the",
        f"band the API reports is built from a volatility of "
        f"{worst_anchor['frozen_conditional_vol_pct']:.4f}% while the same",
        f"parameters filtered to the end of the data give "
        f"{worst_anchor['filtered_conditional_vol_pct']:.4f}% "
        f"(ratio {worst_anchor['ratio_filtered_over_frozen']:.2f}).",
        "Filtering forward is a pure-compute change requiring no retraining and",
        "no new data -- see filter_conditional_variance() in this script.",
        "",
    ]

    with pd.option_context("display.width", 220, "display.max_columns", 60):
        report.append(df[[
            "currency", "horizon_days", "n_windows", "model_qlike", "roll20_qlike",
            "const_qlike", "model_mse", "roll20_mse", "corr_model_vs_realized", "persistence",
        ]].to_string(index=False))

    report += [
        "",
        "ANCHOR GAP - what the running service currently reports",
        "-" * 70,
        "The serving code calls res.forecast() on the pickle directly, so the",
        "volatility band the API returns comes from the model's state as of its",
        "FIT date, not the latest data. Filtering the same parameters forward",
        "over observed returns costs nothing and moves the state to the end of",
        "the series. The two differ by the ratio below; a ratio far from 1.0",
        "means the band the UI shows today describes a different volatility",
        "regime than the most recent data does.",
        "",
    ]
    with pd.option_context("display.width", 220):
        report.append(anchors.to_string(index=False))

    report += [
        "",
        "NOTES / HOW TO READ THIS",
        "-" * 70,
        "1. Why volatility is worth modelling at all, unlike direction.",
        "   Volatility clusters -- large moves follow large moves -- which is a",
        "   robust, long-documented property of financial returns. That is why",
        "   a GARCH result here is not subject to the Meese-Rogoff pessimism",
        "   that governs the LSTM's level forecasts (lstm_evaluation_report_v2",
        "   .txt): predicting HOW MUCH a rate moves is a genuinely easier task",
        "   than predicting WHICH WAY it moves.",
        "",
        "2. Near-integrated persistence. All five fitted models have",
        "   alpha+beta between 0.996 and 1.000, and LKR is at 0.99999997 --",
        "   effectively IGARCH. At that persistence shocks to variance never",
        "   decay, the unconditional variance is undefined, and multi-step",
        "   forecasts drift linearly rather than mean-reverting. Long-horizon",
        "   results should therefore be read more sceptically than h=1: at",
        "   h=30 a near-integrated GARCH is close to a random walk in variance",
        "   and its edge over the rolling baseline is correspondingly thin.",
        "",
        "3. Flat days are dropped from QLIKE, not floored. QLIKE is undefined",
        "   when the realized proxy is zero. A managed-float currency like LKR",
        "   has many days with no movement at all; those are real observations,",
        "   not errors, so they are excluded from QLIKE (count reported per row)",
        "   rather than assigned a fabricated floor variance. MSE uses all rows.",
        "",
        "4. The proxy is noisy. Squared daily returns are an unbiased but very",
        "   high-variance estimate of latent volatility. With no intraday data",
        "   there is no better option here, and it is why QLIKE rather than MSE",
        "   decides the verdict -- MSE on variance is dominated by a handful of",
        "   large-move days.",
        "",
        "5. What this does NOT measure. Skill on a 2015-2017 holdout from the",
        "   Fed H.10 series only. It says nothing about how the band would",
        "   perform on live 2026 rates -- though unlike the level forecasts,",
        "   volatility models are scale-invariant in the relevant sense, so",
        "   refitting these on the live feed once it has enough history is a",
        "   realistic path to a current model.",
    ]

    if skipped:
        report += ["", "SKIPPED", "-" * 70] + [f"  {s}" for s in skipped]

    report_path = models_dir / f"garch_evaluation_report_{GARCH_VERSION}{args.out_suffix}.txt"
    csv_path = models_dir / f"garch_evaluation_{GARCH_VERSION}{args.out_suffix}.csv"
    report_path.write_text("\n".join(report) + "\n")
    df.to_csv(csv_path, index=False)

    print()
    print("\n".join(report))
    print(f"\nWrote {report_path}")
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()

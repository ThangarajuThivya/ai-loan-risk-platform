#!/usr/bin/env python3
"""
GARCH(1,1) Volatility Model -- v1 (standalone script, local run)

Script port of the original Kaggle notebook (since removed -- see git
history). Same model, same split, same seed, same artifact names: the
notebook was Kaggle-only, and retraining on refreshed H.10 data needs to be
runnable locally without a Kaggle round-trip. Verified bit-exact against the
notebook on the same machine before the notebook was deleted, so any change
in the numbers from here on is attributable to the data, not to this port.

NOTE ON REPRODUCIBILITY: this script does NOT reproduce the shipped
garch_*_v1.pkl artifacts, which were fitted on Kaggle. Same data and same
code, but a different arch/scipy build converges differently on these
near-unit-root likelihood surfaces, so the dist='normal' fallback below
fires on different currencies (locally: LKR/INR/GBP/EUR keep 't', JPY falls
back; on Kaggle it was the reverse for four of the five). Any before/after
comparison must therefore be local-vs-local, never local-vs-Kaggle.

WHAT THIS MODEL DOES:
Fits a GARCH(1,1) on each currency's daily percent log-returns, with Student-t
innovations by default (fatter tails than Normal -- a better fit for daily FX).
It answers "how MUCH will the rate move", not "which way" -- volatility is
persistent and clusters (big moves follow big moves), which is precisely the
property GARCH exploits and precisely why this model has skill where the
level-based models do not.

REALISTIC EXPECTATIONS -- read before judging the numbers:
There is NO ground-truth volatility series to score against, so there is no
accuracy metric and no baseline model in this script by design. What is
reported instead is a fit-quality signal: the correlation between the fitted
in-sample conditional volatility and realized (rolling 20-day std) volatility
over the same window. Out-of-sample scoring against a rolling-realized-variance
baseline lives in training/evaluate_garch_volatility.py -- run that after this.

Two fit hazards this script handles explicitly rather than hiding:
  1. Student-t's extra shape parameter can make the likelihood surface hard to
     optimize on series with many exact-zero returns (forward-filled ND gaps --
     see clean_currency_series()). On non-convergence it retries once with
     dist='normal' rather than silently keeping a bad fit.
  2. A converged fit is not automatically a GOOD fit. Currencies with
     correlation < 0.5 are FLAGGED in the report even when the optimizer
     reported success.

IMPORTANT -- the fitted model is anchored to TRAIN_END, not to "today":
res.forecast() projects forward from the end of the training window
(default 2011-12-31), which is why the served volatility endpoint reports a
different data vintage than the forecast/trend/anomaly endpoints. Refitting on
a fresh window is the intended way to move that anchor; the recipe is stored in
the metadata JSON's refit_config block.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/train_garch_volatility.py
    venv/bin/python training/train_garch_volatility.py --currencies LKR --dist normal
    venv/bin/python training/train_garch_volatility.py --output-dir /tmp/control_run

Reads:  data/processed/exchange_rates_wide.(csv|parquet)  (Phase 1 output;
        run data/prepare_data.py first if missing)
Writes: models/garch_<CCY>_v1.pkl                (pickled ARCHModelResult, one per currency)
        models/garch_params_v1.json              (params + refit recipe + fit diagnostics)
        models/garch_evaluation_report_v1.txt
        models/garch_evaluation_v1.csv
"""
from __future__ import annotations

import argparse
import json
import pickle
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from arch import arch_model

SEED = 42


def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)


# --------------------------------------------------------------------------
# Data loading / cleaning (same contract as training/preprocessing_utils.py)
# --------------------------------------------------------------------------

def load_wide_rates(path: Path) -> pd.DataFrame:
    df = (pd.read_parquet(path) if path.suffix == ".parquet"
          else pd.read_csv(path, index_col=0, parse_dates=True))
    df.index = pd.to_datetime(df.index)
    df.index.name = "date"
    return df.sort_index()


def clean_currency_series(series: pd.Series) -> pd.Series:
    """Restrict to the currency's own trading window and forward-fill ND gaps
    *within* that window only -- never fill before its first valid date (see
    ../DATA_DICTIONARY.md).

    Note: a ffilled gap followed by the next real observation shows up as one
    large single-day return (a real multi-day move compressed into one
    business-day step). That is expected given a business-day-only series with
    ND gaps, not a bug, but it matters here -- it is the main source of the
    zero-return point mass that can destabilize the Student-t fit.
    """
    valid = series.dropna()
    if valid.empty:
        raise ValueError(f"{series.name}: no valid observations")
    windowed = series.loc[valid.index.min(): valid.index.max()]
    return windowed.ffill()


def date_masks(index, train_end, val_end):
    """Chronological walk-forward split -- NO shuffling."""
    train_end, val_end = pd.Timestamp(train_end), pd.Timestamp(val_end)
    train_mask = index <= train_end
    val_mask = (index > train_end) & (index <= val_end)
    test_mask = index > val_end
    return train_mask, val_mask, test_mask


def log_returns(rate: pd.Series) -> pd.Series:
    return np.log(rate / rate.shift(1))


def _has_wide_file(p: Path) -> bool:
    return (p / "exchange_rates_wide.csv").exists() or (p / "exchange_rates_wide.parquet").exists()


def find_data_dir(explicit: str | None) -> Path:
    """Resolution order: explicit --data-dir -> local repo layout -> recursive
    search under /kaggle/input (kept so this file still works if pasted into a
    Kaggle cell, where the mount path isn't a predictable slug)."""
    if explicit:
        p = Path(explicit)
        if _has_wide_file(p):
            return p
        raise FileNotFoundError(f"No exchange_rates_wide.(csv|parquet) under {p}")

    try:
        local = Path(__file__).resolve().parent.parent / "data" / "processed"
        if _has_wide_file(local):
            return local
    except NameError:
        pass

    kaggle_root = Path("/kaggle/input")
    if kaggle_root.exists():
        for filename in ("exchange_rates_wide.csv", "exchange_rates_wide.parquet"):
            matches = sorted(kaggle_root.rglob(filename))
            if matches:
                return matches[0].parent

    raise FileNotFoundError(
        "Could not find exchange_rates_wide.(csv|parquet). Run data/prepare_data.py "
        "first, or pass --data-dir explicitly."
    )


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--currencies", default="LKR,INR,EUR,GBP,JPY",
                   help="Comma-separated ISO codes, must be columns in exchange_rates_wide (see ../DATA_DICTIONARY.md).")
    p.add_argument("--train-end", default="2011-12-31")
    p.add_argument("--val-end", default="2014-12-31")
    p.add_argument("--dist", default="t", choices=["t", "normal", "skewt", "ged"],
                   help="Innovation distribution. Default 't' (Student-t): fatter tails, a better fit for daily FX returns.")
    p.add_argument("--return-scale", type=float, default=100,
                   help="Returns are multiplied by this before fitting -- arch's numerical-stability convention (100 = percent returns).")
    p.add_argument("--min-train-returns", type=int, default=500,
                   help="Skip a currency with fewer training returns than this.")
    p.add_argument("--version", default="v1")
    p.add_argument("--data-dir", default=None, help="Override auto-detected data/processed directory.")
    p.add_argument("--output-dir", default=None, help="Defaults to ../models relative to this script.")
    p.add_argument("--quiet", action="store_true", help="Suppress the per-currency arch summary tables.")
    # parse_known_args (not parse_args): when this script is pasted into a
    # Jupyter/Kaggle/Colab cell, the kernel's own launcher args end up in
    # sys.argv -- ignore anything unrecognized instead of erroring.
    args, _unknown = p.parse_known_args()
    return args


def main():
    args = parse_args()
    set_seed()

    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]
    return_scale = args.return_scale
    dist = args.dist

    data_dir = find_data_dir(args.data_dir)
    data_path = (data_dir / "exchange_rates_wide.parquet"
                 if (data_dir / "exchange_rates_wide.parquet").exists()
                 else data_dir / "exchange_rates_wide.csv")
    print(f"DATA_DIR = {data_dir}")
    wide = load_wide_rates(data_path)
    missing = [c for c in currencies if c not in wide.columns]
    if missing:
        raise ValueError(f"Currencies not found in data: {missing}. Available: {list(wide.columns)}")
    print(f"Loaded {wide.shape}, {wide.index.min().date()} to {wide.index.max().date()}")
    print(f"Distribution = {dist} | Return scale = {return_scale}")

    if args.output_dir:
        output_dir = Path(args.output_dir)
    else:
        try:
            output_dir = Path(__file__).resolve().parent.parent / "models"
        except NameError:
            output_dir = Path("/kaggle/working/models_out") if Path("/kaggle/working").exists() else Path("./models_out")
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"OUTPUT_DIR = {output_dir}")

    results: dict = {}
    trained_at = datetime.now(timezone.utc).isoformat()

    for ccy in currencies:
        print("=" * 70)
        print(f"Fitting GARCH(1,1) for {ccy}")
        print("=" * 70)

        series = clean_currency_series(wide[ccy])
        ret = log_returns(series).dropna() * return_scale

        train_mask, val_mask, test_mask = date_masks(series.index, args.train_end, args.val_end)
        train_idx = ret.index.intersection(series.index[train_mask])
        test_idx = ret.index.intersection(series.index[test_mask])
        if len(train_idx) < args.min_train_returns:
            print(f"  Skipping {ccy}: not enough training returns ({len(train_idx)})")
            continue

        am = arch_model(ret.loc[train_idx], vol="Garch", p=1, q=1, dist=dist)
        res = am.fit(disp="off")
        dist_used = dist
        if res.convergence_flag != 0 and dist != "normal":
            # Student-t's extra shape parameter can make the likelihood surface
            # harder to optimize on noisy/degenerate series (e.g. a currency
            # with many exact-zero returns from forward-filled gaps -- see
            # clean_currency_series()'s docstring). Retry once with the simpler
            # Normal distribution rather than silently keeping a non-converged fit.
            print(f"  WARNING: {dist} fit did not converge (flag={res.convergence_flag}) "
                  f"-- retrying with dist='normal'")
            am = arch_model(ret.loc[train_idx], vol="Garch", p=1, q=1, dist="normal")
            res = am.fit(disp="off")
            dist_used = "normal"
        if res.convergence_flag != 0:
            print(f"  WARNING: fit still did not converge after fallback (flag={res.convergence_flag}) "
                  f"-- treat this currency's params with caution, do not present as a clean fit")
        if not args.quiet:
            print(res.summary())

        omega = float(res.params["omega"])
        alpha1 = float(res.params["alpha[1]"])
        beta1 = float(res.params["beta[1]"])
        persistence = alpha1 + beta1
        print(f"  persistence (alpha+beta) = {persistence:.4f} "
              f"({'stable, mean-reverting' if persistence < 1 else 'NON-STATIONARY - check the fit'})")

        # --- sanity check: no ground-truth volatility exists, so correlate the
        # in-sample conditional volatility against realized (rolling 20-day std)
        # volatility on the same window as a fit-quality signal, not an accuracy metric ---
        realized_vol = ret.loc[train_idx].rolling(20).std()
        corr = float(pd.concat([res.conditional_volatility, realized_vol], axis=1).dropna().corr().iloc[0, 1])
        print(f"  sanity check: corr(fitted conditional vol, realized 20d rolling vol) = {corr:.4f}")

        # Multi-step variance forecast over the test window length, purely
        # illustrative -- it is anchored at TRAIN_END, not at "today".
        test_forecast_vol = None
        if len(test_idx) > 0:
            fc = res.forecast(horizon=min(len(test_idx), 90), reindex=False)
            test_forecast_vol = np.sqrt(fc.variance.values[-1]).tolist()

        pkl_path = output_dir / f"garch_{ccy}_{args.version}.pkl"
        with open(pkl_path, "wb") as f:
            pickle.dump(res, f)
        print(f"  Saved {pkl_path.name}")

        results[ccy] = {
            "n_train_returns": int(len(train_idx)),
            "n_test_returns": int(len(test_idx)),
            "dist_used": dist_used,
            "converged": bool(res.convergence_flag == 0),
            "convergence_flag": int(res.convergence_flag),
            "omega": omega,
            "alpha1": alpha1,
            "beta1": beta1,
            "persistence": persistence,
            "mu": float(res.params.get("mu", 0.0)),
            "nu_student_t_dof": float(res.params["nu"]) if "nu" in res.params else None,
            "log_likelihood": float(res.loglikelihood),
            "aic": float(res.aic),
            "bic": float(res.bic),
            "conditional_vol_vs_realized_vol_corr": corr,
            "last_conditional_volatility_pct": float(res.conditional_volatility.iloc[-1]),
            "forecast_horizon_volatility_pct": test_forecast_vol,
        }

    # ----------------------------------------------------------------------
    # Metadata / refit recipe
    # ----------------------------------------------------------------------
    metadata = {
        "version": args.version,
        "trained_at": trained_at,
        "model_type": "garch_1_1",
        "currencies": list(results.keys()),
        "refit_config": {
            "p": 1, "q": 1, "dist": dist,
            "return_scale": return_scale,
            "vol_model": "Garch",
            "note": "Re-run arch_model(returns_pct, vol='Garch', p=1, q=1, dist=DIST) "
                    "on a fresh rolling window using this recipe to refit periodically.",
        },
        "train_end": args.train_end,
        "val_end": args.val_end,
        "data_start": str(wide.index.min().date()),
        "data_end": str(wide.index.max().date()),
        "seed": SEED,
        "artifact_pattern": {"pickle": "garch_{ccy}_" + args.version + ".pkl"},
        "results": results,
    }
    meta_path = output_dir / f"garch_params_{args.version}.json"
    meta_path.write_text(json.dumps(metadata, indent=2))
    print("\nWrote", meta_path)

    # ----------------------------------------------------------------------
    # Evaluation report
    # ----------------------------------------------------------------------
    report_lines = [
        "GARCH(1,1) Volatility Model - Evaluation Report",
        "=" * 60,
        f"Generated on: {trained_at}",
        f"Version: {args.version}",
        f"Currencies: {', '.join(results.keys())}",
        f"Distribution: {dist} | Return scale: {return_scale}",
        f"Train end: {args.train_end} | Val end: {args.val_end}",
        f"Data range: {wide.index.min().date()} to {wide.index.max().date()}",
        "",
    ]
    summary_rows = []
    flagged = []
    for ccy, r in results.items():
        stability = "stable" if r["persistence"] < 1 else "NON-STATIONARY -- check the fit"
        conv_flag = "OK" if r["converged"] else f"DID NOT CONVERGE (flag={r['convergence_flag']})"
        low_corr = r["conditional_vol_vs_realized_vol_corr"] < 0.5
        if not r["converged"] or low_corr:
            reason = []
            if not r["converged"]:
                reason.append("did not converge")
            if low_corr:
                reason.append(f"low fit-quality correlation ({r['conditional_vol_vs_realized_vol_corr']:.2f})")
            flagged.append(f"{ccy} ({', '.join(reason)})")
        report_lines.append(f"--- {ccy} (train returns: {r['n_train_returns']}, dist={r['dist_used']}) ---")
        report_lines.append(f"  convergence: {conv_flag}")
        report_lines.append(
            f"  omega={r['omega']:.4f}  alpha[1]={r['alpha1']:.4f}  beta[1]={r['beta1']:.4f}  "
            f"persistence={r['persistence']:.4f} ({stability})"
        )
        report_lines.append(
            f"  log-likelihood={r['log_likelihood']:.1f}  AIC={r['aic']:.1f}  BIC={r['bic']:.1f}"
        )
        report_lines.append(
            f"  sanity check corr(fitted conditional vol, realized vol) = "
            f"{r['conditional_vol_vs_realized_vol_corr']:.4f}"
            + ("  <-- LOW: treat this fit with caution, see convergence status above"
               if r["conditional_vol_vs_realized_vol_corr"] < 0.5 else "")
        )
        report_lines.append("")
        summary_rows.append({
            "currency": ccy, "dist_used": r["dist_used"], "converged": r["converged"],
            "omega": r["omega"], "alpha1": r["alpha1"], "beta1": r["beta1"],
            "persistence": r["persistence"], "log_likelihood": r["log_likelihood"],
            "aic": r["aic"], "bic": r["bic"],
            "conditional_vol_vs_realized_vol_corr": r["conditional_vol_vs_realized_vol_corr"],
        })

    if flagged:
        report_lines.append(
            f"FLAGGED: {'; '.join(flagged)} -- do not present these currencies' params as a clean "
            "fit without re-examining them; low correlation can occur even when the optimizer "
            "reports convergence (a converged fit is not automatically a good fit). See the "
            "module docstring for the likely cause: forward-filled zero-return point mass "
            "distorting the likelihood surface."
        )
        report_lines.append("")

    report_lines += [
        "Note: GARCH has no ground-truth volatility to score accuracy against --",
        "'sanity check' correlates the fitted conditional volatility against",
        "realized (rolling 20-day std) volatility on the same window. There is",
        "no baseline model here by design -- out-of-sample scoring against a",
        "rolling-realized-variance baseline lives in evaluate_garch_volatility.py.",
    ]

    summary_df = pd.DataFrame(summary_rows)
    pd.set_option("display.width", 120)
    print("\n" + summary_df.to_string(index=False))
    print("\n" + "\n".join(report_lines))

    report_path = output_dir / f"garch_evaluation_report_{args.version}.txt"
    report_path.write_text("\n".join(report_lines))
    summary_df.to_csv(output_dir / f"garch_evaluation_{args.version}.csv", index=False)
    print("\nWrote", report_path)
    print("Wrote", output_dir / f"garch_evaluation_{args.version}.csv")


if __name__ == "__main__":
    main()

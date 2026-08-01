#!/usr/bin/env python3
"""
Historical-simulation VaR scenario builder (standalone script, local run,
DATA PREPARATION ONLY — no model is trained, loaded or modified).

WHY

The admin FX views show the bank's net position per currency
(GET /api/currency/exchange/admin/position) but say nothing about the RISK
that position carries. "We are long 4.2M LKR of EUR" is an exposure; "a bad
day costs us ~180k LKR, and 1 day in 100 costs more than 310k" is a decision
input. Value at Risk is the standard way to turn one into the other.

This is also the right use of the 2017 dataset. Everything §26 and §32 found
about the LSTM is a consequence of trying to predict LEVELS from a stale
file. VaR needs neither: it uses the RETURN DISTRIBUTION and the
CROSS-CURRENCY CORRELATION STRUCTURE, both of which are far more stable over
time than any price level, and both of which are scale-invariant — applied to
whatever position the bank holds today, at today's rates.

METHOD — historical simulation

Not variance-covariance (which assumes joint normality that FX returns
famously violate — fat tails, skew), and not Monte Carlo (which needs a
distributional assumption of its own). Historical simulation replays actual
past days: each row of the output is one real day's joint move across every
tradable currency, so the correlation structure and the fat tails come from
the data rather than from a model of the data. The Node side applies these
scenarios to the live position at request time.

THE CROSS-RATE POINT, WHICH IS EASY TO GET WRONG

The bank's exposure is denominated in LKR, and its risk is that the
CROSS RATE against LKR moves — not that the currency moves against the USD.
The Fed H.10 file stores everything per-USD, so the cross return has to be
built:

    LKR per 1 unit of C  =  (LKR per USD) / (C per USD)
    => log-return_C/LKR  =  dlog(LKR per USD) - dlog(C per USD)

with the USD case falling out naturally as dlog(LKR per USD) - 0. This
mirrors what finance-backend/src/services/crossRate.service.js does to build
the customer board, so the risk figures describe the same pair the bank
actually trades. Using raw per-USD returns instead would measure the wrong
risk — and would, for instance, report a USD position as risk-free.

SIGN CONVENTION

A scenario return is the gain on being LONG one LKR of that currency. The
Node side multiplies by the signed net position, so a short position
(net_lkr_amount < 0) loses when the return is positive, automatically.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python training/build_var_scenarios.py
    venv/bin/python training/build_var_scenarios.py --from-date 2005-01-01

Reads:  data/processed/exchange_rates_wide.(csv|parquet)
Writes: models/fx_var_scenarios_v1.json      (consumed by the Node gateway)
        models/fx_var_scenarios_report_v1.txt
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.config import MODELS_DIR, WIDE_RATES_CSV, WIDE_RATES_PARQUET  # noqa: E402
from training.preprocessing_utils import clean_currency_series, load_wide_rates  # noqa: E402

# v3 tracks the 2026 data refresh, in step with the four model families in
# src/config.py — these scenarios are drawn from the same H.10 series, so a
# mismatched version here would mean the VaR panel and the models disagree
# about what history is. The consumer filename is pinned in
# finance-backend/src/services/fxVar.service.js (SCENARIOS_FILE); bump both.
VERSION = "v3"
QUOTE_CURRENCY = "LKR"
# Every currency tradable on the board (fx_rate_board_config), which is what
# a position can actually be held in — a superset of the TRAINED_CURRENCIES,
# since USD is tradable but is not itself a model target.
DEFAULT_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "INR"]


def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--currencies", default=",".join(DEFAULT_CURRENCIES))
    p.add_argument(
        "--from-date",
        default="1999-01-01",
        help="earliest scenario date (default 1999-01-01, when EUR begins — "
             "an earlier start drops EUR from the joint set entirely)",
    )
    p.add_argument("--out-suffix", default="")
    return p.parse_args()


def main():
    args = parse_args()
    currencies = [c.strip().upper() for c in args.currencies.split(",") if c.strip()]

    data_path = WIDE_RATES_PARQUET if WIDE_RATES_PARQUET.exists() else WIDE_RATES_CSV
    if not data_path.exists():
        raise SystemExit(f"Missing {data_path}. Run data/prepare_data.py first.")
    wide = load_wide_rates(data_path)

    if QUOTE_CURRENCY not in wide.columns:
        raise SystemExit(f"{QUOTE_CURRENCY} is not in {data_path.name}; cannot build LKR cross rates.")
    lkr = clean_currency_series(wide[QUOTE_CURRENCY])

    # Build the LKR-per-unit cross series for each tradable currency.
    cross = {}
    skipped = []
    for c in currencies:
        if c == "USD":
            # LKR per USD is the H.10 series itself — no cross needed.
            cross[c] = lkr
            continue
        if c not in wide.columns:
            skipped.append(f"{c}: not a column in {data_path.name}")
            continue
        per_usd = clean_currency_series(wide[c])
        # LKR per 1 C = (LKR per USD) / (C per USD), on shared dates only.
        idx = lkr.index.intersection(per_usd.index)
        cross[c] = (lkr.loc[idx] / per_usd.loc[idx]).dropna()

    if not cross:
        raise SystemExit("No currencies could be built. Skipped:\n  " + "\n  ".join(skipped))

    frame = pd.DataFrame(cross).sort_index()
    frame = frame.loc[frame.index >= pd.Timestamp(args.from_date)]
    # Joint scenarios require every currency observed on the same day —
    # dropping partial rows is what preserves the correlation structure. A
    # per-currency fill would fabricate co-movement that never happened.
    frame = frame.dropna(how="any")

    returns = np.log(frame / frame.shift(1)).dropna(how="any")
    if returns.empty:
        raise SystemExit("No overlapping days across the requested currencies.")

    codes = list(returns.columns)
    matrix = [[round(float(v), 8) for v in row] for row in returns.to_numpy()]
    dates = [d.date().isoformat() for d in returns.index]

    corr = returns.corr()
    ann_vol = (returns.std() * np.sqrt(252) * 100)

    generated_at = datetime.now(timezone.utc).isoformat()
    artifact = {
        "version": VERSION,
        "generated_at": generated_at,
        "method": "historical_simulation",
        "quote_currency": QUOTE_CURRENCY,
        "return_type": "log",
        "pair_convention": f"{QUOTE_CURRENCY} per 1 unit of each currency (the board's convention)",
        "source": "US Federal Reserve H.10 via data/processed/exchange_rates_wide",
        "scenario_from": dates[0],
        "scenario_to": dates[-1],
        "n_scenarios": len(dates),
        "currencies": codes,
        "caveats": [
            f"Scenarios span {dates[0]} to {dates[-1]}, the underlying dataset's own range — "
            "derived from the data, not hardcoded, so this line stays true after a refresh. "
            "They describe the return DISTRIBUTION and CORRELATION structure, which are far "
            "more stable over time than price levels, but they cannot reflect a regime change "
            "occurring after the end date.",
            "Historical simulation can only produce losses of a kind that already happened in this window; it is not a stress test and will understate a genuinely unprecedented move.",
            "Scenarios are equally weighted, so a calm recent period does not reduce the influence of an old crisis day (and vice versa).",
            "VaR is a quantile, not a worst case: it says nothing about how bad the tail beyond it is. Expected Shortfall is reported alongside for that reason.",
        ],
        "dates": dates,
        "returns": matrix,
    }

    out_json = MODELS_DIR / f"fx_var_scenarios_{VERSION}{args.out_suffix}.json"
    out_json.write_text(json.dumps(artifact))

    report = [
        "FX VaR Historical-Simulation Scenarios - Build Report",
        "=" * 70,
        f"Generated on: {generated_at}",
        f"Method: historical simulation | Return type: log | Quote: {QUOTE_CURRENCY}",
        f"Pair convention: {QUOTE_CURRENCY} per 1 unit (matches the trading board)",
        f"Scenarios: {len(dates)} days, {dates[0]} -> {dates[-1]}",
        f"Currencies: {', '.join(codes)}",
        "",
        "DATA PREPARATION ONLY - no model was trained, loaded or modified.",
        "",
        "Cross rates, not per-USD rates. The bank's exposure is in LKR, so its",
        "risk is the cross rate against LKR moving. H.10 stores everything",
        "per-USD, so each series is rebuilt as (LKR per USD)/(C per USD) before",
        "differencing — the same construction crossRate.service.js uses for the",
        "customer board. Using raw per-USD returns would measure the wrong risk",
        "and would report a USD position as risk-free.",
        "",
        "Rows where any currency is missing are dropped rather than filled.",
        "Joint scenarios are the whole point: filling per-currency would",
        "fabricate co-movement that never occurred and quietly corrupt the",
        "correlation structure the diversification benefit is computed from.",
        "",
        "ANNUALIZED VOLATILITY (%, from these scenarios)",
        "-" * 70,
    ]
    for c in codes:
        report.append(f"  {c:<5} {ann_vol[c]:>8.2f}%")

    report += [
        "",
        "CORRELATION MATRIX (daily log returns vs LKR)",
        "-" * 70,
        corr.round(3).to_string(),
        "",
        "Correlation is what makes portfolio VaR smaller than the sum of the",
        "per-currency VaRs — the diversification benefit the Node side reports.",
        "Note these are all cross rates against a common quote currency, so",
        "they share the LKR leg and are correlated partly for that reason",
        "alone; the benefit is real but smaller than an uncorrelated book's.",
        "",
        "CAVEATS",
        "-" * 70,
    ]
    for c in artifact["caveats"]:
        report.append(f"  - {c}")
    if skipped:
        report += ["", "SKIPPED", "-" * 70] + [f"  {s}" for s in skipped]

    out_txt = MODELS_DIR / f"fx_var_scenarios_report_{VERSION}{args.out_suffix}.txt"
    out_txt.write_text("\n".join(report) + "\n")

    print("\n".join(report))
    print(f"\nWrote {out_json} ({out_json.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {out_txt}")


if __name__ == "__main__":
    main()

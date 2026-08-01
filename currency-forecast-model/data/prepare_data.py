"""
Cleans the raw Federal Reserve H.10 exchange-rate CSV (Kaggle "Federal
Reserve Exchange Rates" dataset) into model-ready artifacts.

The raw file has SIX metadata header rows before the data starts:
  1. Series Description   4. Currency:          (quoted/counter currency code)
  2. Unit:                5. Unique Identifier:
  3. Multiplier:           6. Time Period         (column header row, first
                                                    cell "Time Period", rest
                                                    are internal FRED series
                                                    codes)
Row 7 onward is one row per date.

Two quoting conventions are mixed in this file:
  - Most columns are "<currency> per 1 USD"      (Unit "Currency:_Per_USD",
    e.g. LKR/USD = 153.90).
  - EUR, GBP, AUD, NZD are quoted the other way round, "USD per 1 <currency>"
    (Unit "Currency:_Per_EUR" etc., Currency field says "USD"). This mirrors
    real-world market convention (these are quoted as the "big" currency).
  - Three columns (Nominal Broad/Major/OITP Dollar Index) are trade-weighted
    USD indices, not bilateral currency pairs — no ISO code, excluded from
    the currency tables and written separately.

Run: venv/bin/python data/prepare_data.py
Outputs: data/processed/{exchange_rates_long,exchange_rates_wide,
         series_metadata,dollar_indices_wide}.{csv,parquet}
         DATA_DICTIONARY.md (repo root of this service)
"""
import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

SERVICE_ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = SERVICE_ROOT / "data" / "raw" / "exchange_rates.csv"
PROCESSED_DIR = SERVICE_ROOT / "data" / "processed"
DATA_DICTIONARY_PATH = SERVICE_ROOT / "DATA_DICTIONARY.md"

HEADER_ROWS = 6  # rows 0-5; data begins at row 6 (0-based) / line 7
MISSING_MARKERS = ["ND", ""]

# Cosmetic ISO-4217 -> human name lookup, used only to make the dictionary
# readable. The set of codes itself always comes from the file, never from
# this dict.
ISO_NAMES = {
    "USD": "US Dollar", "EUR": "Euro", "GBP": "British Pound Sterling",
    "BRL": "Brazilian Real", "CNY": "Chinese Yuan Renminbi",
    "DKK": "Danish Krone", "INR": "Indian Rupee", "JPY": "Japanese Yen",
    "KRW": "South Korean Won", "MYR": "Malaysian Ringgit",
    "MXN": "Mexican Peso", "NOK": "Norwegian Krone", "SEK": "Swedish Krona",
    "ZAR": "South African Rand", "SGD": "Singapore Dollar",
    "CHF": "Swiss Franc", "TWD": "New Taiwan Dollar", "THB": "Thai Baht",
    "VEB": "Venezuelan Bolivar (pre-2008 redenomination)",
    "AUD": "Australian Dollar", "NZD": "New Zealand Dollar",
    "CAD": "Canadian Dollar", "HKD": "Hong Kong Dollar",
    "LKR": "Sri Lankan Rupee",
}

FLAT_RUN_ALERT_DAYS = 250  # ~1 trading year of an unchanged value = likely a peg


def country_label(description: str) -> str:
    """Fallback label derived from the raw Series Description column."""
    desc = description.strip()
    if desc.startswith("SPOT EXCHANGE RATE - "):
        return desc[len("SPOT EXCHANGE RATE - "):].strip().title()
    match = re.match(r"^(.*?)\s*--\s*SPOT EXCHANGE RATE", desc)
    if match:
        return match.group(1).strip().title()
    return desc


def load_column_metadata(raw_path: Path) -> pd.DataFrame:
    """Parses header rows 0-4 into one metadata row per data column."""
    header = pd.read_csv(raw_path, header=None, nrows=HEADER_ROWS - 1)
    description, unit, multiplier, currency_field, unique_id = (
        header.iloc[0], header.iloc[1], header.iloc[2], header.iloc[3], header.iloc[4]
    )

    rows = []
    for col_idx in range(1, header.shape[1]):
        unit_field = str(unit[col_idx]).strip()
        curr_field = str(currency_field[col_idx]).strip()
        is_index = unit_field.startswith("Index:")

        currency_code = None
        quote_convention = None
        if not is_index:
            unit_suffix = unit_field.split("_Per_")[-1] if "_Per_" in unit_field else None
            if unit_suffix and unit_suffix != "USD":
                # e.g. Currency:_Per_EUR with Currency field "USD"
                currency_code = unit_suffix
                quote_convention = "usd_per_unit"
            else:
                # e.g. Currency:_Per_USD with Currency field "LKR"
                currency_code = curr_field
                quote_convention = "per_usd"

        rows.append({
            "col_index": col_idx,
            "description": str(description[col_idx]).strip(),
            "unit_field": unit_field,
            "multiplier": float(multiplier[col_idx]),
            "currency_field": curr_field,
            "unique_identifier": str(unique_id[col_idx]).strip(),
            "currency_code": currency_code,
            "quote_convention": quote_convention,
            "is_index": is_index,
            "human_name": (
                ISO_NAMES.get(currency_code, country_label(str(description[col_idx])))
                if currency_code else str(description[col_idx]).strip()
            ),
        })
    return pd.DataFrame(rows).set_index("col_index")


def load_raw_data(raw_path: Path, n_cols: int) -> pd.DataFrame:
    df = pd.read_csv(
        raw_path, skiprows=HEADER_ROWS, header=None,
        na_values=MISSING_MARKERS, keep_default_na=True,
    )
    df.columns = ["date"] + list(range(1, n_cols + 1))
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date").reset_index(drop=True)


def longest_flat_run(series: pd.Series) -> int:
    """Longest run of consecutive, identical, non-null values (peg detector)."""
    valid = series.dropna()
    if valid.empty:
        return 0
    changed = valid.ne(valid.shift())
    run_id = changed.cumsum()
    return int(valid.groupby(run_id).transform("count").max())


def build_currency_tables(raw: pd.DataFrame, meta: pd.DataFrame):
    currency_cols = meta[~meta["is_index"]]
    long_frames = []
    for col_idx, row in currency_cols.iterrows():
        raw_rate = raw[col_idx]
        rate = raw_rate if row["quote_convention"] == "per_usd" else 1 / raw_rate
        long_frames.append(pd.DataFrame({
            "date": raw["date"],
            "base_currency": "USD",
            "currency_code": row["currency_code"],
            "raw_rate": raw_rate,
            "quote_convention": row["quote_convention"],
            "rate": rate,  # normalized: units of currency_code per 1 USD
        }))
    long_df = pd.concat(long_frames, ignore_index=True)
    long_df = long_df.dropna(subset=["raw_rate"]).sort_values(
        ["currency_code", "date"]
    ).reset_index(drop=True)

    wide_df = long_df.pivot(index="date", columns="currency_code", values="rate")
    wide_df = wide_df.reindex(pd.DatetimeIndex(sorted(raw["date"].unique())))
    wide_df.index.name = "date"
    return long_df, wide_df


def build_index_table(raw: pd.DataFrame, meta: pd.DataFrame) -> pd.DataFrame:
    index_cols = meta[meta["is_index"]]
    out = pd.DataFrame({"date": raw["date"]})
    for col_idx, row in index_cols.iterrows():
        slug = re.sub(r"[^a-z0-9]+", "_", row["description"].strip().lower()).strip("_")
        out[slug] = raw[col_idx]
    return out.dropna(how="all", subset=[c for c in out.columns if c != "date"])


def compute_dictionary_stats(raw: pd.DataFrame, meta: pd.DataFrame) -> pd.DataFrame:
    full_start, full_end = raw["date"].min(), raw["date"].max()
    rows = []
    for col_idx, row in meta.iterrows():
        s = raw[col_idx]
        valid = s.dropna()
        if valid.empty:
            rows.append({**row.to_dict(), "first_date": None, "last_date": None,
                         "pct_missing_in_window": 100.0, "pct_missing_overall": 100.0,
                         "n_observations": 0, "longest_flat_run_days": 0})
            continue
        first_idx, last_idx = valid.index.min(), valid.index.max()
        first_date, last_date = raw.loc[first_idx, "date"], raw.loc[last_idx, "date"]
        window = raw.loc[first_idx:last_idx, col_idx]
        rows.append({
            **row.to_dict(),
            "first_date": first_date, "last_date": last_date,
            "pct_missing_in_window": round(window.isna().mean() * 100, 2),
            "pct_missing_overall": round(s.isna().mean() * 100, 2),
            "n_observations": int(valid.shape[0]),
            "longest_flat_run_days": longest_flat_run(s),
        })
    stats = pd.DataFrame(rows)
    stats.attrs["full_start"] = full_start
    stats.attrs["full_end"] = full_end
    return stats


def write_data_dictionary(stats: pd.DataFrame, out_path: Path):
    full_start = stats.attrs["full_start"].date()
    full_end = stats.attrs["full_end"].date()
    currencies = stats[~stats["is_index"]].sort_values("currency_code")
    indices = stats[stats["is_index"]]

    lines = [
        "# Currency Exchange-Rate Data Dictionary",
        "",
        f"Generated from `data/raw/exchange_rates.csv` "
        f"(Kaggle Federal Reserve H.10 exchange rates dataset) by "
        f"`data/prepare_data.py`. Full file date range: **{full_start} to "
        f"{full_end}** ({(stats.attrs['full_end'] - stats.attrs['full_start']).days} "
        "calendar days, business days only — no weekend/holiday rows).",
        "",
        f"**{len(currencies)} currency pairs** (all vs. USD) + "
        f"**{len(indices)} trade-weighted dollar indices** (not currency pairs, "
        "kept separate).",
        "",
        "## Currency pairs",
        "",
        "All rates are USD-based. `quote_convention` tells you how the raw "
        "column was published:",
        "- `per_usd`: raw value = units of the currency per 1 USD (e.g. LKR/USD).",
        "- `usd_per_unit`: raw value = USD per 1 unit of the currency "
        "(EUR, GBP, AUD, NZD only — market convention).",
        "",
        "`rate` in the processed tables is **normalized to `per_usd` for every "
        "currency** (currency units per 1 USD), so the wide table is directly "
        "comparable across columns. `raw_rate` (long table only) preserves the "
        "as-published value.",
        "",
        "| Code | Name | First Date | Last Date | Observations | % Missing (in-window) | % Missing (full range) | Quote Convention | Notes |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for _, r in currencies.iterrows():
        notes = []
        if r["first_date"] is not None and r["first_date"].date() > full_start:
            notes.append("starts late")
        if r["longest_flat_run_days"] >= FLAT_RUN_ALERT_DAYS:
            notes.append(f"long flat run ({r['longest_flat_run_days']}d, likely a peg)")
        if r["pct_missing_in_window"] > 6:
            notes.append("sparse within its own window")
        note_str = "; ".join(notes) if notes else "—"
        first_d = r["first_date"].date() if r["first_date"] is not None else "—"
        last_d = r["last_date"].date() if r["last_date"] is not None else "—"
        lines.append(
            f"| {r['currency_code']} | {r['human_name']} | {first_d} | {last_d} | "
            f"{r['n_observations']} | {r['pct_missing_in_window']}% | "
            f"{r['pct_missing_overall']}% | {r['quote_convention']} | {note_str} |"
        )

    lines += [
        "",
        "## Excluded from currency tables: trade-weighted dollar indices",
        "",
        "These are indices (base 100 at a reference date), not bilateral "
        "currency pairs — no ISO code, excluded from `exchange_rates_long` / "
        "`exchange_rates_wide`, written to `dollar_indices_wide.csv` instead.",
        "",
        "| Description | Unit | First Date | Last Date | % Missing (full range) |",
        "|---|---|---|---|---|",
    ]
    for _, r in indices.iterrows():
        first_d = r["first_date"].date() if r["first_date"] is not None else "—"
        last_d = r["last_date"].date() if r["last_date"] is not None else "—"
        lines.append(
            f"| {r['description']} | {r['unit_field']} | {first_d} | {last_d} | "
            f"{r['pct_missing_overall']}% |"
        )

    lines += [
        "",
        "## Missing-value handling",
        "",
        "- The raw file marks missing observations as `ND` or an empty cell; "
        "both are read as `NaN`. No imputation/fill is applied in this phase "
        "— that belongs to feature engineering (Phase 2).",
        "- Rows exist only for business days already; there are no weekend "
        "rows to drop and no synthetic calendar rows were added.",
        "- `% Missing (in-window)` is computed between each currency's own "
        "first and last valid observation (its real trading history). "
        "`% Missing (full range)` is computed against the full 1971-2017 file "
        "range and will be large for any currency that simply starts later "
        "(e.g. EUR, introduced 1999) — that is expected, not a data-quality "
        "problem.",
        "",
        "## Caveats later phases must respect",
        "",
        "- **Mixed quote convention.** Do not treat `raw_rate` as directly "
        "comparable across currencies — always use the normalized `rate` "
        "column (or invert consistently) when combining series.",
        "- **VEB (Venezuelan Bolivar)** holds a long flat/pegged stretch "
        "toward the end of its history — that's an official fixed rate under "
        "capital controls, not a market-clearing rate; treat pre/post-peg "
        "periods as different regimes if VEB is ever modeled.",
        "- **Currencies with late starts** (EUR 1999, BRL/VEB 1995, MXN 1993, "
        "KRW 1981, etc.) will be all-`NaN` in the wide table before their "
        "first date — do not forward-fill across that boundary.",
        "- **LKR (Sri Lankan Rupee)**, the currency most relevant to this "
        "project, starts 1973-01-02 and has no long flat runs — clean series.",
    ]
    out_path.write_text("\n".join(lines) + "\n")


def print_eda_summary(raw: pd.DataFrame, stats: pd.DataFrame):
    currencies = stats[~stats["is_index"]]
    full_start, full_end = stats.attrs["full_start"].date(), stats.attrs["full_end"].date()
    print("=" * 60)
    print("EDA SUMMARY")
    print("=" * 60)
    print(f"Date range   : {full_start} to {full_end} ({len(raw)} business-day rows)")
    print(f"Currencies   : {len(currencies)} (vs USD) + {stats['is_index'].sum()} dollar indices")
    print()
    late_start = currencies[currencies["first_date"] > stats.attrs["full_start"] + pd.Timedelta(days=30)]
    print(f"Currencies starting later than the file start ({len(late_start)}):")
    for _, r in late_start.sort_values("first_date").iterrows():
        print(f"  - {r['currency_code']:4s} first observed {r['first_date'].date()}")
    print()
    flat = currencies[currencies["longest_flat_run_days"] >= FLAT_RUN_ALERT_DAYS]
    print(f"Currencies with a long flat/pegged run (>= {FLAT_RUN_ALERT_DAYS} days unchanged), possible peg or discontinuation artifact ({len(flat)}):")
    for _, r in flat.sort_values("longest_flat_run_days", ascending=False).iterrows():
        print(f"  - {r['currency_code']:4s} longest flat run: {r['longest_flat_run_days']} days")
    print()
    sparse = currencies[currencies["pct_missing_in_window"] > 6]
    print(f"Currencies sparse within their own trading window (>6% missing) ({len(sparse)}):")
    for _, r in sparse.sort_values("pct_missing_in_window", ascending=False).iterrows():
        print(f"  - {r['currency_code']:4s} {r['pct_missing_in_window']}% missing in-window")
    print("=" * 60)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--raw-path", default=str(RAW_PATH),
        help="Raw H.10 CSV to process. Defaults to the bundled Kaggle export "
             "(ends 2017-08-25). Pass data/raw/exchange_rates_refreshed.csv to "
             "use the FRED-spliced file produced by `python -m src.data_fetcher`.",
    )
    p.add_argument(
        "--processed-dir", default=str(PROCESSED_DIR),
        help="Where to write the processed artifacts. Override to build a "
             "side-by-side dataset without clobbering the current one.",
    )
    p.add_argument(
        "--data-dictionary", default=str(DATA_DICTIONARY_PATH),
        help="Where to write DATA_DICTIONARY.md. Override alongside "
             "--processed-dir for a side-by-side build: this file is NOT "
             "tracked in git, so overwriting it cannot be undone.",
    )
    return p.parse_args()


def main():
    args = parse_args()
    raw_path = Path(args.raw_path)
    processed_dir = Path(args.processed_dir)

    if not raw_path.exists():
        raise FileNotFoundError(
            f"Expected raw file at {raw_path} — place the Kaggle Federal "
            "Reserve H.10 exchange-rates CSV there (filename: exchange_rates.csv), "
            "or run `python -m src.data_fetcher` to build a FRED-refreshed one."
        )
    print(f"Raw file      : {raw_path}")
    print(f"Processed dir : {processed_dir}")

    meta = load_column_metadata(raw_path)
    raw = load_raw_data(raw_path, n_cols=meta.index.max())

    long_df, wide_df = build_currency_tables(raw, meta)
    indices_wide = build_index_table(raw, meta)
    stats = compute_dictionary_stats(raw, meta)

    processed_dir.mkdir(parents=True, exist_ok=True)
    long_df.to_parquet(processed_dir / "exchange_rates_long.parquet", index=False)
    long_df.to_csv(processed_dir / "exchange_rates_long.csv", index=False)
    wide_df.to_parquet(processed_dir / "exchange_rates_wide.parquet")
    wide_df.to_csv(processed_dir / "exchange_rates_wide.csv")
    indices_wide.to_parquet(processed_dir / "dollar_indices_wide.parquet", index=False)
    indices_wide.to_csv(processed_dir / "dollar_indices_wide.csv", index=False)
    meta.reset_index().to_csv(processed_dir / "series_metadata.csv", index=False)

    data_dictionary_path = Path(args.data_dictionary)
    write_data_dictionary(stats, data_dictionary_path)
    print_eda_summary(raw, stats)
    print(f"\nWrote processed artifacts to {processed_dir}")
    print(f"Wrote {data_dictionary_path}")


if __name__ == "__main__":
    main()

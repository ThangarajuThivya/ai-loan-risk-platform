#!/usr/bin/env python3
"""
Fetches current Federal Reserve H.10 exchange rates from FRED and splices them
onto the bundled historical raw file.

WHY THIS EXISTS
The bundled data/raw/exchange_rates.csv is a Kaggle export of the Fed H.10
release that stops at 2017-08-25. Every model trained from it is therefore
anchored in 2017 -- which, for LKR in particular, means the training window
ends *before* the 2022 Sri Lankan currency crisis (152.90 -> 355 LKR/USD in a
matter of weeks). The Fed still publishes all five modelled currencies, free
and without an API key, so there is no reason to stay anchored there.

WHAT IT DOES
Downloads one CSV covering the five modelled currencies from FRED, checks it
against the bundled file on their overlapping dates, then appends the
post-2017 rows to a *copy* of the raw file in the exact 6-metadata-row H.10
layout that data/prepare_data.py already parses. No parser changes needed.

Columns that are NOT refreshed (the other 18 currencies and the 3 trade-
weighted dollar indices) get "ND" -- the H.10 file's own missing-data marker,
which prepare_data.py already treats as missing and clean_currency_series()
already handles by restricting each currency to its own valid window. So those
series simply end at 2017-08-25 as before; nothing downstream special-cases it.

THE OVERLAP CHECK IS THE POINT
Two of the five series are quoted the other way round (EUR and GBP are USD per
unit; LKR/INR/JPY are units per USD). Rather than trust that FRED's convention
matches the bundled file's, this script verifies it numerically across every
shared date and refuses to write if they disagree. A silent convention flip
would invert a currency's entire history.

SAFETY
data/raw/ is gitignored -- the bundled file is a Kaggle download that cannot be
recovered from git. This script therefore NEVER overwrites its input. It writes
to a separate output path, and refuses to clobber an existing output unless
--force is passed.

Run (from currency-forecast-model/, using the repo's venv):
    venv/bin/python -m src.data_fetcher
    venv/bin/python -m src.data_fetcher --check-only
    venv/bin/python -m src.data_fetcher --out data/raw/exchange_rates_2026.csv

Then rebuild the processed artifacts from the spliced file:
    venv/bin/python data/prepare_data.py --raw-path data/raw/exchange_rates_refreshed.csv

Reads:  data/raw/exchange_rates.csv          (bundled Kaggle H.10 export, untouched)
        https://fred.stlouisfed.org/...      (live, no API key)
Writes: data/raw/exchange_rates_refreshed.csv
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_RAW = BASE_DIR / "data" / "raw" / "exchange_rates.csv"
DEFAULT_OUT = BASE_DIR / "data" / "raw" / "exchange_rates_refreshed.csv"

FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={ids}"

# FRED series id -> the ISO code as it appears in the bundled H.10 file's
# header. Only the five currencies with trained models are refreshed; extend
# this dict to cover more (each id must use the SAME quote convention as that
# column in the bundled file -- the overlap check enforces it).
#
#   DEXSLUS  Sri Lankan Rupees per USD      -> LKR column (Currency:_Per_USD)
#   DEXINUS  Indian Rupees per USD          -> INR column (Currency:_Per_USD)
#   DEXJPUS  Japanese Yen per USD           -> JPY column (Currency:_Per_USD)
#   DEXUSEU  USD per Euro                   -> EUR column (Currency:_Per_EUR)
#   DEXUSUK  USD per Pound Sterling         -> GBP column (Currency:_Per_GBP)
SERIES_MAP = {
    "DEXSLUS": "LKR",
    "DEXINUS": "INR",
    "DEXJPUS": "JPY",
    "DEXUSEU": "EUR",
    "DEXUSUK": "GBP",
}

HEADER_ROWS = 6      # rows 0-5 are metadata; data begins at row 6
UNIT_ROW = 1         # header row holding "Currency:_Per_USD" / "Index:_..."
CURRENCY_ROW = 3     # header row holding the ISO code
MISSING = "ND"       # the H.10 file's own missing-data marker

# Values are compared as floats with a small relative tolerance -- FRED and the
# Kaggle export can differ in trailing-zero formatting (64.0000 vs 64.0) but
# must not differ in value.
OVERLAP_TOLERANCE = 1e-6
# A handful of dates can legitimately differ if the Fed revised a print after
# the Kaggle export was taken. Fail only if disagreement is widespread.
MAX_OVERLAP_MISMATCH_PCT = 1.0


def fetch_fred_csv(series_ids: list[str], timeout: int = 60) -> str:
    """Downloads one multi-series CSV from FRED. No API key required.

    DO NOT set a browser-like User-Agent here. This endpoint silently drops
    requests claiming to be a browser (a 'Mozilla/5.0' UA hangs until timeout,
    and a custom app UA is refused outright), while urllib's own default UA and
    curl's are served normally -- verified against the live endpoint. The
    failure mode is a read timeout, which looks like a network fault rather
    than a rejected request, so leave the headers alone.
    """
    url = FRED_CSV_URL.format(ids=",".join(series_ids))
    print(f"Fetching {url}")
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                raise RuntimeError(f"FRED returned HTTP {resp.status}")
            return resp.read().decode("utf-8")
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Could not reach FRED ({exc}). This script needs network access; "
            "re-run when online."
        ) from exc


def parse_fred_csv(text: str) -> tuple[list[str], dict[str, dict[str, str]]]:
    """Returns (series_ids_in_column_order, {date_str: {series_id: value}}).

    FRED writes an empty cell for a missing observation; those are dropped here
    rather than carried through as empty strings.
    """
    reader = csv.reader(io.StringIO(text))
    header = next(reader)
    series_ids = header[1:]
    out: dict[str, dict[str, str]] = {}
    for row in reader:
        if not row or not row[0]:
            continue
        values = {sid: v.strip() for sid, v in zip(series_ids, row[1:]) if v.strip()}
        if values:
            out[row[0]] = values
    return series_ids, out


def read_raw_h10(path: Path) -> tuple[list[list[str]], list[list[str]]]:
    """Splits the bundled H.10 file into (6 metadata rows, data rows)."""
    with open(path, newline="") as fh:
        rows = list(csv.reader(fh))
    if len(rows) <= HEADER_ROWS:
        raise ValueError(f"{path} has no data rows below the {HEADER_ROWS} metadata rows")
    return rows[:HEADER_ROWS], rows[HEADER_ROWS:]


def currency_column_index(header: list[list[str]]) -> dict[str, int]:
    """Maps ISO code -> column index.

    Note EUR/GBP: for those columns the 'Currency:' cell says USD (they are
    quoted as USD per EUR / USD per GBP), so the code is taken from the Unit
    row instead -- 'Currency:_Per_EUR' -> EUR.
    """
    unit_row, ccy_row = header[UNIT_ROW], header[CURRENCY_ROW]
    mapping: dict[str, int] = {}
    for col in range(1, len(ccy_row)):
        unit = unit_row[col].strip()
        if unit.startswith("Index:"):
            continue
        code = ccy_row[col].strip()
        if unit.startswith("Currency:_Per_") and unit != "Currency:_Per_USD":
            code = unit.rsplit("_", 1)[-1]  # Currency:_Per_EUR -> EUR
        if code:
            mapping.setdefault(code, col)
    return mapping


def check_overlap(data_rows: list[list[str]], col_of: dict[str, int],
                  fred: dict[str, dict[str, str]]) -> None:
    """Verifies FRED and the bundled file agree on their shared dates.

    This is what catches a quote-convention mismatch (e.g. pulling a
    'per USD' series into a 'USD per unit' column), which would otherwise
    invert that currency's entire post-2017 history without any visible error.
    """
    print("\nOverlap check (bundled file vs FRED, shared dates):")
    failed = []
    for sid, iso in SERIES_MAP.items():
        col = col_of[iso]
        compared = mismatched = 0
        worst = None
        for row in data_rows:
            fred_row = fred.get(row[0])
            if not fred_row or sid not in fred_row:
                continue
            bundled = row[col].strip()
            if not bundled or bundled == MISSING:
                continue
            a, b = float(bundled), float(fred_row[sid])
            compared += 1
            if abs(a - b) > OVERLAP_TOLERANCE * max(1.0, abs(a)):
                mismatched += 1
                if worst is None or abs(a - b) > worst[1]:
                    worst = (row[0], abs(a - b), a, b)
        if compared == 0:
            failed.append(f"{iso}/{sid}: no overlapping dates to verify")
            print(f"  {iso} ({sid}): NO OVERLAP -- cannot verify convention")
            continue
        pct = mismatched / compared * 100
        status = "OK" if pct <= MAX_OVERLAP_MISMATCH_PCT else "MISMATCH"
        detail = f"  worst: {worst[0]} bundled={worst[2]} fred={worst[3]}" if worst else ""
        print(f"  {iso} ({sid}): {compared} dates compared, "
              f"{mismatched} differ ({pct:.3f}%)  {status}{detail}")
        if pct > MAX_OVERLAP_MISMATCH_PCT:
            failed.append(f"{iso}/{sid}: {pct:.2f}% of {compared} shared dates disagree")

    if failed:
        raise SystemExit(
            "\nABORTING -- FRED does not agree with the bundled file:\n  "
            + "\n  ".join(failed)
            + "\n\nMost likely a quote-convention mismatch in SERIES_MAP (a 'per USD'"
              "\nseries pointed at a 'USD per unit' column, or vice versa). Fix the"
              "\nmapping before writing -- do NOT relax the tolerance."
        )
    print("  -> all series agree; quote conventions confirmed.")


def build_appended_rows(header: list[list[str]], last_date: str,
                        col_of: dict[str, int],
                        fred: dict[str, dict[str, str]]) -> list[list[str]]:
    """Builds new data rows for every FRED date after `last_date`.

    Non-refreshed columns get "ND" (the file's own missing marker), so those
    currencies simply end at the bundled file's last date.
    """
    n_cols = len(header[CURRENCY_ROW])
    new_rows = []
    for d in sorted(k for k in fred if k > last_date):
        row = [d] + [MISSING] * (n_cols - 1)
        wrote_any = False
        for sid, iso in SERIES_MAP.items():
            value = fred[d].get(sid)
            if value:
                row[col_of[iso]] = value
                wrote_any = True
        if wrote_any:
            new_rows.append(row)
    return new_rows


def parse_args():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--raw-path", default=str(DEFAULT_RAW),
                   help="Bundled H.10 file to splice onto. Read-only; never modified.")
    p.add_argument("--out", default=str(DEFAULT_OUT),
                   help="Where to write the spliced file.")
    p.add_argument("--force", action="store_true",
                   help="Overwrite --out if it already exists.")
    p.add_argument("--check-only", action="store_true",
                   help="Run the overlap check and report what would be appended, then exit without writing.")
    p.add_argument("--timeout", type=int, default=60)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    raw_path, out_path = Path(args.raw_path), Path(args.out)

    if raw_path.resolve() == out_path.resolve():
        raise SystemExit(
            f"--out must differ from --raw-path. {raw_path} is a gitignored Kaggle "
            "download and cannot be recovered if overwritten."
        )
    if out_path.exists() and not args.force and not args.check_only:
        raise SystemExit(f"{out_path} already exists. Pass --force to overwrite.")
    if not raw_path.exists():
        raise SystemExit(f"Bundled raw file not found at {raw_path}")

    header, data_rows = read_raw_h10(raw_path)
    last_date = data_rows[-1][0]
    print(f"Bundled file : {raw_path}")
    print(f"               {len(data_rows)} rows, {data_rows[0][0]} to {last_date}")

    col_of = currency_column_index(header)
    missing_cols = [iso for iso in SERIES_MAP.values() if iso not in col_of]
    if missing_cols:
        raise SystemExit(f"Currencies not found as columns in {raw_path}: {missing_cols}")
    print("Target columns: " + ", ".join(f"{iso}=col{col_of[iso]}" for iso in SERIES_MAP.values()))

    text = fetch_fred_csv(list(SERIES_MAP), timeout=args.timeout)
    series_ids, fred = parse_fred_csv(text)
    unknown = set(SERIES_MAP) - set(series_ids)
    if unknown:
        raise SystemExit(f"FRED response is missing requested series: {sorted(unknown)}")
    fred_dates = sorted(fred)
    print(f"FRED         : {len(fred_dates)} rows, {fred_dates[0]} to {fred_dates[-1]}")

    check_overlap(data_rows, col_of, fred)

    new_rows = build_appended_rows(header, last_date, col_of, fred)
    if not new_rows:
        print(f"\nNothing to append -- FRED has no observations after {last_date}.")
        return 0

    print(f"\nWould append {len(new_rows)} rows: {new_rows[0][0]} to {new_rows[-1][0]}")
    for iso in SERIES_MAP.values():
        col = col_of[iso]
        n = sum(1 for r in new_rows if r[col] != MISSING)
        first = next((r[col] for r in new_rows if r[col] != MISSING), None)
        last = next((r[col] for r in reversed(new_rows) if r[col] != MISSING), None)
        print(f"  {iso}: {n} new observations, {first} -> {last}")

    if args.check_only:
        print("\n--check-only: nothing written.")
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerows(header)
        writer.writerows(data_rows)
        writer.writerows(new_rows)
    total = len(data_rows) + len(new_rows)
    print(f"\nWrote {out_path}")
    print(f"  {total} data rows, {data_rows[0][0]} to {new_rows[-1][0]}")
    print(f"  (bundled file at {raw_path} left untouched)")
    print(f"\nNext: venv/bin/python data/prepare_data.py --raw-path {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

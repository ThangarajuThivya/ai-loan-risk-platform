# Currency Exchange-Rate Data Dictionary

Generated from `data/raw/exchange_rates.csv` (Kaggle Federal Reserve H.10 exchange rates dataset) by `data/prepare_data.py`. Full file date range: **1971-01-04 to 2026-07-24** (20290 calendar days, business days only — no weekend/holiday rows).

**23 currency pairs** (all vs. USD) + **3 trade-weighted dollar indices** (not currency pairs, kept separate).

## Currency pairs

All rates are USD-based. `quote_convention` tells you how the raw column was published:
- `per_usd`: raw value = units of the currency per 1 USD (e.g. LKR/USD).
- `usd_per_unit`: raw value = USD per 1 unit of the currency (EUR, GBP, AUD, NZD only — market convention).

`rate` in the processed tables is **normalized to `per_usd` for every currency** (currency units per 1 USD), so the wide table is directly comparable across columns. `raw_rate` (long table only) preserves the as-published value.

| Code | Name | First Date | Last Date | Observations | % Missing (in-window) | % Missing (full range) | Quote Convention | Notes |
|---|---|---|---|---|---|---|---|---|
| AUD | Australian Dollar | 1971-01-04 | 2017-08-25 | 11702 | 3.85% | 18.7% | usd_per_unit | — |
| BRL | Brazilian Real | 1995-01-02 | 2017-08-25 | 5692 | 3.69% | 60.45% | per_usd | starts late |
| CAD | Canadian Dollar | 1971-01-04 | 2017-08-25 | 11715 | 3.74% | 18.61% | per_usd | — |
| CHF | Swiss Franc | 1971-01-04 | 2017-08-25 | 11709 | 3.79% | 18.65% | per_usd | — |
| CNY | Chinese Yuan Renminbi | 1981-01-02 | 2017-08-25 | 9149 | 4.31% | 36.43% | per_usd | starts late; long flat run (668d, likely a peg) |
| DKK | Danish Krone | 1971-01-04 | 2017-08-25 | 11708 | 3.8% | 18.65% | per_usd | — |
| EUR | Euro | 1999-01-04 | 2026-07-24 | 6911 | 2.5% | 51.98% | usd_per_unit | starts late |
| GBP | British Pound Sterling | 1971-01-04 | 2026-07-24 | 13932 | 3.2% | 3.2% | usd_per_unit | — |
| HKD | Hong Kong Dollar | 1981-01-02 | 2017-08-25 | 9209 | 3.68% | 36.02% | per_usd | starts late |
| INR | Indian Rupee | 1973-01-02 | 2026-07-24 | 13424 | 3.23% | 6.73% | per_usd | starts late |
| JPY | Japanese Yen | 1971-01-04 | 2026-07-24 | 13926 | 3.24% | 3.24% | per_usd | — |
| KRW | South Korean Won | 1981-04-13 | 2017-08-25 | 9095 | 4.16% | 36.81% | per_usd | starts late |
| LKR | Sri Lankan Rupee | 1973-01-02 | 2026-07-24 | 13072 | 5.77% | 9.18% | per_usd | starts late |
| MXN | Mexican Peso | 1993-11-08 | 2017-08-25 | 5977 | 3.75% | 58.47% | per_usd | starts late |
| MYR | Malaysian Ringgit | 1971-01-04 | 2017-08-25 | 11687 | 3.97% | 18.8% | per_usd | long flat run (738d, likely a peg) |
| NOK | Norwegian Krone | 1971-01-04 | 2017-08-25 | 11708 | 3.8% | 18.65% | per_usd | — |
| NZD | New Zealand Dollar | 1971-01-04 | 2017-08-25 | 11693 | 3.92% | 18.76% | usd_per_unit | — |
| SEK | Swedish Krona | 1971-01-04 | 2017-08-25 | 11708 | 3.8% | 18.65% | per_usd | — |
| SGD | Singapore Dollar | 1981-01-02 | 2017-08-25 | 9208 | 3.69% | 36.02% | per_usd | starts late |
| THB | Thai Baht | 1981-01-02 | 2017-08-25 | 9128 | 4.53% | 36.58% | per_usd | starts late |
| TWD | New Taiwan Dollar | 1983-10-03 | 2017-08-25 | 8222 | 7.04% | 42.88% | per_usd | starts late; sparse within its own window |
| VEB | Venezuelan Bolivar (pre-2008 redenomination) | 1995-01-02 | 2017-08-25 | 5686 | 3.79% | 60.49% | per_usd | starts late; long flat run (828d, likely a peg) |
| ZAR | South African Rand | 1980-01-02 | 2017-08-25 | 9452 | 3.78% | 34.33% | per_usd | starts late |

## Excluded from currency tables: trade-weighted dollar indices

These are indices (base 100 at a reference date), not bilateral currency pairs — no ISO code, excluded from `exchange_rates_long` / `exchange_rates_wide`, written to `dollar_indices_wide.csv` instead.

| Description | Unit | First Date | Last Date | % Missing (full range) |
|---|---|---|---|---|
| Nominal Broad Dollar Index | Index:_1973_Mar_100 | 1995-01-04 | 2017-08-25 | 60.53% |
| Nominal Major Currencies Dollar Index | Index:_1973_Mar_100 | 1973-01-02 | 2017-08-25 | 22.26% |
| Nominal Other Important Trading Partners Dollar Index | Index:_1997_Jan_100 | 1995-01-04 | 2017-08-25 | 60.53% |

## Missing-value handling

- The raw file marks missing observations as `ND` or an empty cell; both are read as `NaN`. No imputation/fill is applied in this phase — that belongs to feature engineering (Phase 2).
- Rows exist only for business days already; there are no weekend rows to drop and no synthetic calendar rows were added.
- `% Missing (in-window)` is computed between each currency's own first and last valid observation (its real trading history). `% Missing (full range)` is computed against the full 1971-2017 file range and will be large for any currency that simply starts later (e.g. EUR, introduced 1999) — that is expected, not a data-quality problem.

## Caveats later phases must respect

- **Mixed quote convention.** Do not treat `raw_rate` as directly comparable across currencies — always use the normalized `rate` column (or invert consistently) when combining series.
- **VEB (Venezuelan Bolivar)** holds a long flat/pegged stretch toward the end of its history — that's an official fixed rate under capital controls, not a market-clearing rate; treat pre/post-peg periods as different regimes if VEB is ever modeled.
- **Currencies with late starts** (EUR 1999, BRL/VEB 1995, MXN 1993, KRW 1981, etc.) will be all-`NaN` in the wide table before their first date — do not forward-fill across that boundary.
- **LKR (Sri Lankan Rupee)**, the currency most relevant to this project, starts 1973-01-02 and has no long flat runs — clean series.

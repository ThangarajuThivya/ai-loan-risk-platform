import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Coins,
  Loader2,
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Gauge,
  History,
  ArrowLeftRight,
  ListChecks,
} from "lucide-react";
import api from "../../api/axios";
import CurrencyChart from "../../components/currency/CurrencyChart";
import ChartControls from "../../components/currency/ChartControls";
import DataVintageBadge from "../../components/currency/DataVintageBadge";
import LiveTrendBadge from "../../components/currency/LiveTrendBadge";
import LiveRateBadge from "../../components/currency/LiveRateBadge";
import RateBoardTable from "../../components/currency/RateBoardTable";
import useChartFilters from "../../components/currency/useChartFilters";
import useRateHistory from "../../components/currency/useRateHistory";
import useLiveForecast from "../../components/currency/useLiveForecast";
import { sourceParamFor, resolveRangeBounds } from "../../components/currency/chartUtils";

/**
 * Customer chart defaults, rewritten for the v3 data refresh.
 *
 * The previous defaults (3-month window, `historical: false`,
 * `demoSeed: true`) were built around a data gap that no longer exists. The
 * bundled Fed H.10 series stopped at 2017-08-25 and only a shallow live feed
 * covered the present, so any long range drew a mostly-empty panel and the
 * 2017→today stretch had to be filled with clearly-labelled fake
 * "demo-bridge" rows just so the chart didn't read as broken.
 *
 * `src/data_fetcher.py` now extends H.10 to 2026-07-24 and
 * `scripts/backfillCurrencyHistory.js` has loaded that whole span into
 * `currency_rate_history`, so there is one continuous REAL series from 1971
 * to today. Consequently:
 *  - `historical: true` — this is now the chart's primary series at every
 *    range, not a pre-2017 curiosity behind a toggle.
 *  - `demoSeed` is gone entirely; those rows were deleted from the database.
 *  - `preset: "1Y"` — a year of real daily data is a sensible opening view
 *    and covers the ranges a customer actually cares about.
 *  - `forecast: false` — customers no longer receive model forecasts at all
 *    (see currency.controller.js `simplifyForCustomer`), so the series would
 *    be empty regardless.
 *
 * `volatility` and `anomalies` stay off: they are staff analysis series and
 * ChartControls' customer variant doesn't offer them.
 */
const DEFAULT_CHART_FILTERS = {
  preset: "1Y",
  from: undefined,
  to: undefined,
  sourceFilterId: "both",
  series: {
    historical: true,
    live: true,
    forecast: false,
    liveTrend: true,
    volatility: false,
    anomalies: false,
  },
  compareMode: false,
};

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

const VOLATILITY_STYLES = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-rose-100 text-rose-800 border-rose-200",
};


export default function CustomerCurrency() {
  const { t } = useTranslation();
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(true);
  const [currenciesError, setCurrenciesError] = useState("");
  const [selected, setSelected] = useState("");

  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  // Storage key is versioned, and the version is bumped whenever the
  // DEFAULT_CHART_FILTERS above change in a way a stored value would
  // override. useChartFilters merges saved values OVER the defaults —
  // including key-by-key inside `series` — so without a bump a returning
  // customer keeps whatever they last had and never sees the new default.
  //   v2 (Phase 20, §21) — escaped the stored `preset: "1Y"` + all-series-on
  //   v3 (Phase 30, §31) — escaped the stored `demoSeed:false, liveTrend:false`
  //   v4 (v3 data refresh) — escaped the stored `historical:false` + 3M window,
  //     which would otherwise keep hiding the newly-real 1971→today series
  // Orphaned earlier keys are harmless and self-evict on the next storage
  // clear. Bump again on the next defaults change of this kind.
  const [chartFilters, updateChartFilters] = useChartFilters("customer-v4", DEFAULT_CHART_FILTERS);
  const { rows: history, loading: historyLoading, error: historyError } = useRateHistory(selected, {
    preset: chartFilters.preset,
    from: chartFilters.from,
    to: chartFilters.to,
    source: sourceParamFor(chartFilters.sourceFilterId),
  });

  // The live-only trend estimate (GET /live-forecast/:code) — a SEPARATE
  // signal from `analysis` (the trained model) below, never merged with it.
  // See CURRENCY_FEATURE.md §16/§17 and LiveTrendBadge.
  const { data: liveTrend } = useLiveForecast(selected, { horizonDays: 7 });

  // The live rate board — a separate data plane from the model analysis
  // above (see currency.controller.js), fetched once and independent of
  // which currency is selected, since it covers every tradable currency.
  const [board, setBoard] = useState(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/board");
        if (!cancelled) setBoard(res.data);
      } catch (err) {
        if (!cancelled) {
          setBoard(null);
          setBoardError(err.response?.data?.message || t("customer.currencyAnalytics.boardErrorDefault"));
        }
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Supported currencies (active only, since this is the customer view).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/currencies");
        if (cancelled) return;
        const list = res.data?.currencies || [];
        setCurrencies(list);
        if (list.length > 0) setSelected(list[0].code);
      } catch (err) {
        if (cancelled) return;
        setCurrenciesError(
          err.response?.data?.message || t("customer.currencyAnalytics.currenciesErrorDefault")
        );
      } finally {
        if (!cancelled) setCurrenciesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // Debounced analysis fetch on currency change, mirroring the EMI
  // calculator's debounce so switching currencies quickly doesn't fire a
  // burst of requests. Rate history is fetched separately by useRateHistory
  // above, which reacts to both the selected currency and the chart filters.
  useEffect(() => {
    if (!selected) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setAnalysisLoading(true);
      setAnalysisError("");

      try {
        const res = await api.get(`/currency/analyze/${selected}`, { signal: controller.signal });
        setAnalysis(res.data);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") {
          setAnalysisError(
            err.response?.data?.message || t("customer.currencyAnalytics.analysisErrorDefault")
          );
          setAnalysis(null);
        }
      } finally {
        setAnalysisLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selected, t]);

  const volatilityBand = analysis?.volatility?.band;

  // GARCH's cutoff is genuinely earlier than the forecast's for some
  // currencies and identical for others. The model section keeps a separate
  // volatility vintage badge only in the former case (Phase 23, §24).
  const volatilityVintageEnd = analysis?.volatility?.data_vintage?.training_data_end;
  const volatilityVintageDiffers =
    !!volatilityVintageEnd && volatilityVintageEnd !== analysis?.data_vintage?.training_data_end;

  const liveRow = board?.rates?.find((r) => r.currency === (selected === "LKR" ? "USD" : selected)) || null;

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-8 pt-6 bg-brand-bg min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center space-x-3">
            <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t("customer.currencyAnalytics.pageEyebrow")}</p>
              <h1 className="text-sm font-bold text-slate-800">{t("customer.currencyAnalytics.pageTitle")}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/dashboard/currency/exchange/requests"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 border border-slate-200 hover:border-brand-primary/40 bg-white transition-colors"
            >
              <ListChecks className="w-3.5 h-3.5" />
              {t("customer.currencyAnalytics.myRequests")}
            </Link>
            <Link
              to="/dashboard/currency/exchange"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 transition-colors shadow-sm"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              {t("customer.currencyAnalytics.exchangeCurrency")}
            </Link>
          </div>
        </div>

        {/* Rate board — the bank's published buy/sell rates, LKR per unit
            (CURRENCY_FEATURE.md §12.1), separate from the model forecast
            below. Shown here so a customer can see it before ever starting
            an exchange request. */}
        <div className="mb-6">
          <RateBoardTable board={board} loading={boardLoading} error={boardError} />
        </div>

        {/* Currency picker */}
        <div className="mb-6">
          {currenciesLoading && (
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("customer.currencyAnalytics.loadingCurrencies")}
            </div>
          )}

          {!currenciesLoading && currenciesError && (
            <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-3 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{currenciesError}</span>
            </div>
          )}

          {!currenciesLoading && !currenciesError && currencies.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 text-center text-xs text-slate-400">
              {t("customer.currencyAnalytics.noCurrenciesAvailable")}
            </div>
          )}

          {!currenciesLoading && !currenciesError && currencies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {currencies.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setSelected(c.code)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    selected === c.code
                      ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:border-brand-primary/40"
                  }`}
                >
                  {c.code}
                  <span className="hidden sm:inline text-xs font-normal opacity-80"> · {c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div className="space-y-6">
            {/* ─── LIVE plane (primary) ────────────────────────────────────
                The page's hero figure is the LIVE rate, not the model's
                `last_known_rate` (Phase 18, CURRENCY_FEATURE.md §19). The
                model is permanently anchored at its 2017 Fed H.10 training
                vintage — ~152.90 LKR/USD against a live rate near 300 — so
                rendering the model number as the page's only 3xl stat read
                as a current market quote to anyone not parsing the badge
                underneath it.

                No new request: `board`/`liveRow` are the same state already
                fetched above for RateBoardTable and LiveRateBadge. */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              {boardLoading && (
                <div className="flex items-center justify-center py-10 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              )}

              {!boardLoading && boardError && (
                <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{boardError}</span>
                </div>
              )}

              {!boardLoading && !boardError && (
                <>
                  <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1">
                    {t("customer.currencyAnalytics.liveRateMidMarket")}
                    {liveRow && (
                      <span className="normal-case font-normal text-slate-300">
                        {" "}
                        · 1 {liveRow.currency} → LKR
                      </span>
                    )}
                  </p>
                  <p className="text-3xl font-display font-bold text-slate-900">
                    {liveRow ? formatRate(liveRow.mid_rate) : "—"}
                  </p>
                  {/* The hero figure is the MID rate, which is neither of the
                      two rates a customer actually trades at. RateBoardTable's
                      header comment (CURRENCY_FEATURE.md §12.1) records that
                      collapsing buy/sell into a single "the rate" number is
                      this feature's most common source of customer confusion —
                      so the two tradable rates are stated immediately under
                      the hero, not left to the board table further up. */}
                  {liveRow && (
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Bank buys at <strong className="font-mono">{formatRate(liveRow.buy_rate)}</strong> · sells at{" "}
                      <strong className="font-mono">{formatRate(liveRow.sell_rate)}</strong> — those are the rates
                      you trade at; the figure above is the mid-market midpoint.
                    </p>
                  )}
                  {/* The live plane's ONE provenance notice (Phase 23, §24):
                      source, timestamp, staleness. Its different-pair
                      sub-note is switched off here — the collapsed model
                      section below already states "not comparable to the
                      figure above", which is the same sentence from the
                      other side. Staff keeps the sub-note. */}
                  <LiveRateBadge
                    board={board}
                    row={liveRow}
                    selectedCode={selected}
                    showPairingNote={false}
                    className="mt-3"
                  />
                </>
              )}
            </div>

            {/* ─── MODEL plane (secondary, collapsed by default) ───────────
                A structurally separate block from the live figure above —
                never interleaved with it, and with NO delta computed between
                the two. They are different quote conventions (LKR-per-unit
                vs. units-per-USD) observed on dates ~9 years apart, so any
                difference between them would be a meaningless number
                (CURRENCY_FEATURE.md §10.2). */}
            <details className="group bg-white rounded-2xl border border-slate-100 shadow-sm">
              <summary className="flex items-start justify-between gap-3 p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-start gap-2 min-w-0">
                  <History className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                      {t("customer.currencyAnalytics.modelOutlook")}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Historical study — Fed H.10 data through{" "}
                      {analysis?.data_vintage?.training_data_end
                        ? formatDate(analysis.data_vintage.training_data_end)
                        : "2017"}
                      . Not a live rate, and not comparable to the figure above.
                    </span>
                  </span>
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-0.5 transition-transform group-open:rotate-180" />
              </summary>

              <div className="px-6 pb-6">
                {analysisLoading && (
                  <div className="flex items-center justify-center py-10 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                )}

                {!analysisLoading && analysisError && (
                  <div className="flex items-start space-x-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{analysisError}</span>
                  </div>
                )}

                {/* Two tiles, not three — the 90-Day Trend tile was removed in
                    Phase 17 (CURRENCY_FEATURE.md §18); its XGBoost source model
                    scores at or below its own majority-class baseline. */}
                {!analysisLoading && !analysisError && analysis && (
                  <div className="border-t border-slate-100 pt-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1">
                          USD / {analysis.currency}{" "}
                          <span className="normal-case font-normal text-slate-300">(model)</span>
                        </p>
                        {/* Deliberately xl, not 3xl — the live figure above is
                            this page's only hero stat. */}
                        <p className="text-xl font-display font-bold text-slate-600">
                          {formatRate(analysis.last_known_rate)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                          <CalendarClock className="w-3 h-3" />
                          {t("customer.currencyAnalytics.asOf", { date: formatDate(analysis.as_of_date) })}
                        </p>
                        {/* No per-tile vintage badge — this section's single
                            DataVintageBadge at the bottom covers it, and the
                            summary line above already carries the date. */}
                      </div>

                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
                          {t("customer.currencyAnalytics.volatility")}
                        </p>
                        {volatilityBand ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border capitalize ${
                              VOLATILITY_STYLES[volatilityBand] || "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                          >
                            <Gauge className="w-3.5 h-3.5" />
                            {volatilityBand}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">{t("customer.currencyAnalytics.notAvailable")}</span>
                        )}
                        {/* Kept ONLY when GARCH's cutoff genuinely differs from
                            the forecast's — that difference is real (see
                            currency.controller.js's simplifyForCustomer note),
                            so collapsing it into the section badge would lose
                            information rather than de-duplicate. When the two
                            dates match it is a pure duplicate and is dropped. */}
                        {volatilityVintageDiffers && (
                          <DataVintageBadge vintage={analysis.volatility?.data_vintage} compact />
                        )}
                      </div>
                    </div>

                    {/* Forecast cards removed in v3. The gateway no longer
                        sends `forecasts` to customers at all (see
                        finance-backend/src/controllers/currency.controller.js
                        simplifyForCustomer): retrained on data through
                        2026-07-24, the 90-day LSTM scored 15.2% directional
                        accuracy for LKR with MAE 2.7x worse than a naive
                        random walk, and the 1/7/30-day models still do not
                        beat that baseline on average. Staff/admin keep the
                        1/7/30 breakdown with the baseline shown alongside;
                        the customer keeps the GARCH volatility band, which is
                        the one model here with demonstrated out-of-sample
                        skill. */}

                    {/* THE model plane's one disclaimer — full (non-compact)
                        wording, covering the rate, the volatility band and the
                        forecast cards above it. */}
                    <DataVintageBadge vintage={analysis.data_vintage} />
                  </div>
                )}
              </div>
            </details>

            {/* Rate history chart. Customer variant: six range pills
                (1M→MAX), nothing else — the series toggles and source
                filters stay on staff/admin. The historical-study toggle is
                gone; with one continuous real series to today, picking a
                range is all that's needed. */}
            <ChartControls
              filters={chartFilters}
              onChange={updateChartFilters}
              variant="customer"
            />
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              {/* Fixed title again. It was made conditional because the old
                  default range could contain neither of the series the name
                  promised; both the gap and the customer-facing forecast are
                  gone, so this now says exactly what is plotted. */}
              <div className="mb-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {t("customer.currencyAnalytics.recentRates")}
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t("customer.currencyAnalytics.recentRatesSubtitle")}
                </p>
              </div>
              <CurrencyChart
                currency={selected}
                historyRows={history}
                historyLoading={historyLoading}
                historyError={historyError}
                /* No `forecasts` array for customers since v3, so the chart's
                   model-forecast overlay stays empty by construction rather
                   than by an absent field. as_of_date/last_known_rate are
                   still passed: they anchor the historical series and the
                   vintage badge, which are not forecasts. */
                forecast={
                  analysis
                    ? {
                        as_of_date: analysis.as_of_date,
                        last_known_rate: analysis.last_known_rate,
                        forecasts: [],
                        data_vintage: analysis.data_vintage,
                      }
                    : null
                }
                liveTrend={liveTrend}
                visibleSeries={chartFilters.series}
                rangeBounds={resolveRangeBounds(chartFilters)}
              />
              {/* Live trend estimate's own provenance/disclaimer badge — a
                  SEPARATE block from DataVintageBadge above, never sharing
                  its tooltip or wording (CURRENCY_FEATURE.md §16/§17).

                  Now gated on the series actually being drawn (Phase 23,
                  §24). Phase 20 defaulted `liveTrend` to false and Phase 21
                  removed the customer's series toggles, so this badge was
                  describing a line that is currently never on the chart.
                  Gating rather than deleting means it returns on its own if
                  the series is re-enabled. */}
              {chartFilters.series?.liveTrend && (
                <LiveTrendBadge liveForecast={liveTrend} className="mt-4" />
              )}
            </div>

            {/* The page-level not-financial-advice notice. Wording is
                UNCHANGED by Phase 23 (§24) and deliberately stays here, at
                page level and always visible, rather than being folded into
                either the live block above or the collapsed model section —
                relocating a legal notice into a section that is closed by
                default would hide it, which is a weakening dressed up as
                de-duplication.

                Its "live trend estimate" clause is currently dormant: that
                series is off by default (§21) and the customer variant has
                no toggle to enable it (§22), so nothing on this page renders
                it today. The clause is left in place because it costs
                nothing and becomes accurate again the moment the series is
                re-enabled — see the gated LiveTrendBadge above. */}
            <div className="flex items-start space-x-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-4 text-xs leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t("customer.currencyAnalytics.adviceDisclaimer")}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

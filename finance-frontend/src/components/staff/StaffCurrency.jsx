import { useEffect, useState } from "react";
import {
  Coins,
  TrendingUp,
  TrendingDown,
  Loader2,
  AlertTriangle,
  Info,
  CalendarClock,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  ScaleIcon,
  ListChecks,
  Bell,
} from "lucide-react";
import api from "../../api/axios";
import CurrencyChart from "../currency/CurrencyChart";
import CurrencyCompareChart from "../currency/CurrencyCompareChart";
import ChartControls from "../currency/ChartControls";
import CurrencyPicker from "../currency/CurrencyPicker";
import AnomalyLog from "../currency/AnomalyLog";
import DataVintageBadge from "../currency/DataVintageBadge";
import LiveTrendBadge from "../currency/LiveTrendBadge";
import LiveRateBadge from "../currency/LiveRateBadge";
import useChartFilters from "../currency/useChartFilters";
import useRateHistory from "../currency/useRateHistory";
import useMultiRateHistory from "../currency/useMultiRateHistory";
import useLiveForecast from "../currency/useLiveForecast";
import { sourceParamFor, resolveRangeBounds } from "../currency/chartUtils";

const DEFAULT_CHART_FILTERS = {
  preset: "1Y",
  from: undefined,
  to: undefined,
  sourceFilterId: "both",
  series: {
    historical: true,
    live: true,
    forecast: true,
    liveTrend: true,
    volatility: true,
    anomalies: true,
  },
  compareMode: false,
  normalize: true,
};

const formatRate = (value) =>
  value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

const formatPercent = (value) =>
  value === null || value === undefined ? "—" : `${Math.round(Number(value) * 100)}%`;

const formatPct1dp = (value) =>
  value === null || value === undefined ? "—" : `${Number(value).toFixed(2)}%`;

const VOLATILITY_STYLES = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-rose-100 text-rose-800 border-rose-200",
};

const HORIZON_LABELS = { 1: "1 Day", 7: "7 Days", 30: "30 Days", 90: "90 Days" };

const SUB_TABS = [
  { id: "analysis", label: "Decision Aid", icon: ListChecks },
  { id: "compare", label: "Compare Currencies", icon: ScaleIcon },
  { id: "anomalies", label: "Anomaly Alerts", icon: Bell },
];

function StatBlock({ label, children }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function AnalysisView({ currencies }) {
  // currencies is already loaded by the time this view mounts (the parent
  // gates rendering on it), so the first code is a safe lazy initial value.
  const [selected, setSelected] = useState(() => currencies[0]?.code || "");
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [anomalies, setAnomalies] = useState([]);

  const [chartFilters, updateChartFilters] = useChartFilters("staff", DEFAULT_CHART_FILTERS);
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

  // Anomaly markers for the chart — same endpoint AnomalyLog uses, scoped to
  // the selected currency only, refetched whenever the analysis recomputes
  // (a fresh /analyze call is what appends a new row to this log).
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/anomalies", { params: { currency: selected, limit: 50 } });
        if (!cancelled) setAnomalies(res.data?.anomalies || []);
      } catch {
        if (!cancelled) setAnomalies([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, analysis]);

  // Live rate board — separate data plane from the model analysis below,
  // fetched once (it covers every tradable currency, not just `selected`).
  const [board, setBoard] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/board");
        if (!cancelled) setBoard(res.data);
      } catch {
        if (!cancelled) setBoard(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
            err.response?.data?.message || "Couldn't load the analysis for this currency. Please try again."
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
  }, [selected]);

  const upProb = analysis?.trend?.probabilities?.up;
  const downProb = analysis?.trend?.probabilities?.down;
  const isAnomalous = analysis?.anomaly?.is_anomalous;
  const liveRow = board?.rates?.find((r) => r.currency === (selected === "LKR" ? "USD" : selected)) || null;

  return (
    <div className="space-y-6">
      <CurrencyPicker currencies={currencies} selected={selected} onSelect={setSelected} />

      {selected && (
        <>
          <LiveRateBadge board={board} row={liveRow} selectedCode={selected} />

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
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

            {!analysisLoading && !analysisError && analysis && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
                  <StatBlock label={`USD / ${analysis.currency} (model)`}>
                    <p className="text-2xl font-display font-bold text-slate-900">
                      {formatRate(analysis.forecast?.last_known_rate)}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      <CalendarClock className="w-3 h-3" />
                      As of {formatDate(analysis.forecast?.as_of_date)}
                      {analysis.cached && <span className="ml-1 text-slate-300">· cached</span>}
                    </p>
                    <DataVintageBadge vintage={analysis.forecast?.data_vintage} technical compact />
                  </StatBlock>

                  <StatBlock label="90-Day Trend">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
                        analysis.trend?.trend_label === "up"
                          ? "bg-rose-100 text-rose-800 border-rose-200"
                          : "bg-emerald-100 text-emerald-800 border-emerald-200"
                      }`}
                    >
                      {analysis.trend?.trend_label === "up" ? (
                        <TrendingDown className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingUp className="w-3.5 h-3.5" />
                      )}
                      {analysis.trend?.trend_label === "up" ? "Weakening" : "Strengthening"}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Confidence: {formatPercent(analysis.trend?.confidence)}
                    </p>
                    <DataVintageBadge vintage={analysis.trend?.data_vintage} technical compact />
                  </StatBlock>

                  <StatBlock label="Volatility">
                    {analysis.volatility?.band ? (
                      <>
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border capitalize ${
                            VOLATILITY_STYLES[analysis.volatility.band] || "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          <Gauge className="w-3.5 h-3.5" />
                          {analysis.volatility.band}
                        </span>
                        <p className="text-[11px] text-slate-400 mt-1.5">
                          {formatPct1dp(analysis.volatility.average_forecast_volatility_pct)} avg /{" "}
                          {analysis.volatility.horizon_days}d
                        </p>
                        <DataVintageBadge vintage={analysis.volatility?.data_vintage} technical compact />
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Not available</span>
                    )}
                  </StatBlock>

                  <StatBlock label="Anomaly Check">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
                        isAnomalous
                          ? "bg-rose-100 text-rose-800 border-rose-200"
                          : "bg-emerald-100 text-emerald-800 border-emerald-200"
                      }`}
                    >
                      {isAnomalous ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                      {isAnomalous ? "Flagged" : "Normal"}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Score: {analysis.anomaly?.anomaly_score?.toFixed?.(3) ?? "—"}
                    </p>
                    <DataVintageBadge vintage={analysis.anomaly?.data_vintage} technical compact />
                  </StatBlock>
                </div>

                {/* Trend probabilities */}
                {upProb !== undefined && downProb !== undefined && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
                      Trend Probability (90-day)
                    </p>
                    {[
                      { label: "Up (weakening)", value: upProb, bar: "bg-rose-500" },
                      { label: "Down (strengthening)", value: downProb, bar: "bg-emerald-500" },
                    ].map((row) => (
                      <div key={row.label}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-600">{row.label}</span>
                          <span className="font-mono font-semibold text-slate-800">{formatPercent(row.value)}</span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div style={{ width: `${Math.round(row.value * 100)}%` }} className={`h-full ${row.bar}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Full forecast horizons */}
                {analysis.forecast?.forecasts?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-3">
                      Rate Forecast
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {analysis.forecast.forecasts.map((f) => {
                        const delta = f.predicted_rate - analysis.forecast.last_known_rate;
                        const deltaPct = analysis.forecast.last_known_rate
                          ? (delta / analysis.forecast.last_known_rate) * 100
                          : 0;
                        const up = delta > 0;
                        return (
                          <div key={f.horizon_days} className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
                              {HORIZON_LABELS[f.horizon_days] || `${f.horizon_days}d`}
                            </p>
                            <p className="text-sm font-bold text-slate-800 font-mono">{formatRate(f.predicted_rate)}</p>
                            <p
                              className={`text-[11px] font-semibold mt-0.5 flex items-center gap-1 ${
                                up ? "text-rose-600" : "text-emerald-600"
                              }`}
                            >
                              {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {deltaPct >= 0 ? "+" : ""}
                              {deltaPct.toFixed(2)}%
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Baseline {formatRate(f.naive_baseline_rate)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Volatility forecast series */}
                {analysis.volatility?.forecast_volatility_pct?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">
                      Forecast Volatility (daily, next {analysis.volatility.horizon_days} days)
                    </p>
                    <div className="flex items-end gap-0.5 h-16">
                      {analysis.volatility.forecast_volatility_pct.map((v, i) => {
                        const max = Math.max(...analysis.volatility.forecast_volatility_pct);
                        const h = max > 0 ? Math.max(4, (v / max) * 100) : 4;
                        return (
                          <div
                            key={i}
                            title={`Day ${i + 1}: ${formatPct1dp(v)}`}
                            style={{ height: `${h}%` }}
                            className="flex-1 bg-brand-secondary/50 rounded-t"
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {analysis.anomaly?.is_anomalous && (
                  <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      This currency's recent rate movement was flagged as anomalous by the isolation-forest
                      model (score {analysis.anomaly.anomaly_score?.toFixed?.(3)}). Consider this before advising
                      customers on timing.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <ChartControls
            filters={chartFilters}
            onChange={updateChartFilters}
            allowVolatility
            allowAnomalies
          />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
              Rate History, Forecast &amp; Anomalies
            </h2>
            <CurrencyChart
              currency={selected}
              historyRows={history}
              historyLoading={historyLoading}
              historyError={historyError}
              forecast={analysis?.forecast}
              volatility={analysis?.volatility}
              anomalies={anomalies}
              liveTrend={liveTrend}
              visibleSeries={chartFilters.series}
              rangeBounds={resolveRangeBounds(chartFilters)}
            />
            {/* Live trend estimate's own provenance/disclaimer badge —
                SEPARATE from the DataVintageBadge instances above, never
                sharing their tooltip or wording (CURRENCY_FEATURE.md §16/§17). */}
            <LiveTrendBadge liveForecast={liveTrend} className="mt-4" />
          </div>
        </>
      )}
    </div>
  );
}

const COMPARE_CHART_DEFAULTS = { preset: "1Y", from: undefined, to: undefined, sourceFilterId: "both", normalize: true };

function CompareView({ currencies }) {
  const [selected, setSelected] = useState([]);
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [chartFilters, updateChartFilters] = useChartFilters("staff-compare", COMPARE_CHART_DEFAULTS);
  const { seriesByCode, loading: chartLoading, error: chartError } = useMultiRateHistory(selected, {
    preset: chartFilters.preset,
    from: chartFilters.from,
    to: chartFilters.to,
    source: sourceParamFor(chartFilters.sourceFilterId),
  });
  const compareSeriesList = selected.map((code) => ({ code, rows: seriesByCode[code] || [] }));

  const toggle = (code) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const runComparison = async () => {
    if (selected.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const settled = await Promise.allSettled(
        selected.map((code) => api.get(`/currency/analyze/${code}`).then((res) => [code, res.data]))
      );
      const next = {};
      let anyFailed = false;
      settled.forEach((outcome) => {
        if (outcome.status === "fulfilled") {
          const [code, data] = outcome.value;
          next[code] = data;
        } else {
          anyFailed = true;
        }
      });
      setResults(next);
      if (anyFailed) setError("Some currencies couldn't be loaded. Showing the ones that succeeded.");
    } finally {
      setLoading(false);
    }
  };

  const rows = selected.map((code) => results[code]).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Select currencies to compare
        </p>
        <CurrencyPicker currencies={currencies} selected={selected} onSelect={toggle} multi />
        <button
          type="button"
          onClick={runComparison}
          disabled={selected.length === 0 || loading}
          className="inline-flex items-center gap-2 bg-brand-primary hover:bg-brand-primary/95 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScaleIcon className="w-4 h-4" />}
          <span>Compare Selected</span>
        </button>
      </div>

      {error && (
        <div className="flex items-start space-x-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {selected.length > 0 && (
        <>
          <ChartControls
            filters={chartFilters}
            onChange={updateChartFilters}
            showSeriesToggles={false}
            showNormalizeToggle
          />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
              Rate History — {chartFilters.normalize ? "Normalized" : "Raw"}
            </h2>
            <CurrencyCompareChart
              seriesList={compareSeriesList}
              normalize={chartFilters.normalize}
              loading={chartLoading}
              error={chartError}
            />
          </div>
        </>
      )}

      {rows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                  <th className="px-4 py-3">Currency</th>
                  <th className="px-4 py-3">Model Rate (H.10)</th>
                  <th className="px-4 py-3">90d Trend</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Volatility</th>
                  <th className="px-4 py-3">Anomaly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((data) => {
                  const weakening = data.trend?.trend_label === "up";
                  const band = data.volatility?.band;
                  const anomalous = data.anomaly?.is_anomalous;
                  return (
                    <tr key={data.currency} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-bold text-slate-800">{data.currency}</td>
                      <td className="px-4 py-3 font-mono text-slate-700">
                        {formatRate(data.forecast?.last_known_rate)}
                        <span className="block text-[10px] font-sans text-slate-400 mt-0.5">
                          as of {data.forecast?.as_of_date || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${
                            weakening
                              ? "bg-rose-100 text-rose-800 border-rose-200"
                              : "bg-emerald-100 text-emerald-800 border-emerald-200"
                          }`}
                        >
                          {weakening ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                          {weakening ? "Weakening" : "Strengthening"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono">{formatPercent(data.trend?.confidence)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-[11px] font-bold border capitalize ${
                            VOLATILITY_STYLES[band] || "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          {band || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {anomalous ? (
                          <span className="inline-flex items-center gap-1 text-rose-600 font-semibold text-[11px]">
                            <ShieldAlert className="w-3.5 h-3.5" /> Flagged
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Normal</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 px-4 py-3 border-t border-slate-100">
            All figures above are historical projections from Fed H.10 data, not live market forecasts. Volatility
            specifically is anchored to each currency's GARCH fit cutoff, which can be earlier than the model rate's
            "as of" date shown per row — see each currency's Decision Aid tab for its exact volatility vintage.
          </p>
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <ScaleIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">No comparison yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Pick two or more currencies above, then run the comparison.
          </p>
        </div>
      )}
    </div>
  );
}

export default function StaffCurrency() {
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(true);
  const [currenciesError, setCurrenciesError] = useState("");
  const [tab, setTab] = useState("analysis");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/currency/currencies");
        if (!cancelled) setCurrencies(res.data?.currencies || []);
      } catch (err) {
        if (!cancelled) {
          setCurrenciesError(
            err.response?.data?.message || "Couldn't load supported currencies. Please refresh the page."
          );
        }
      } finally {
        if (!cancelled) setCurrenciesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <div className="bg-brand-primary/10 text-brand-primary p-2.5 rounded-xl shrink-0">
          <Coins className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Currency Analytics</p>
          <h1 className="text-sm font-bold text-slate-800">Decision Aids &amp; Anomaly Monitoring</h1>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-100">
        {SUB_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
              tab === id
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {currenciesLoading && (
        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading currencies…
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
          No currencies are available right now.
        </div>
      )}

      {!currenciesLoading && !currenciesError && currencies.length > 0 && (
        <>
          {tab === "analysis" && <AnalysisView currencies={currencies} />}
          {tab === "compare" && <CompareView currencies={currencies} />}
          {tab === "anomalies" && <AnomalyLog currencies={currencies} />}
        </>
      )}

      <div className="flex items-start space-x-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-4 text-xs leading-relaxed">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          These figures are AI-generated statistical projections computed from historical Fed H.10 exchange-rate
          data (see the vintage note under each stat above) — not live market forecasts. The chart's separate
          "live trend estimate" is a naive statistical extrapolation from recent live rates, not the trained
          model. Use these to advise customers alongside the live rate board, not as a guarantee of future
          rates.
        </span>
      </div>
    </div>
  );
}

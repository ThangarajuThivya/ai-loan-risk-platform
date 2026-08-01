import { useEffect, useState } from "react";
import {
  Coins,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  Database,
  Gauge,
  Bell,
  ListChecks,
  History,
  LineChart,
  ScaleIcon,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";
import AnomalyLog from "../currency/AnomalyLog";
import CurrencyChart from "../currency/CurrencyChart";
import CurrencyCompareChart from "../currency/CurrencyCompareChart";
import ChartControls from "../currency/ChartControls";
import CurrencyPicker from "../currency/CurrencyPicker";
import LiveRateFeedPanel from "../currency/LiveRateFeedPanel";
import LiveTrendBadge from "../currency/LiveTrendBadge";
import useChartFilters from "../currency/useChartFilters";
import useRateHistory from "../currency/useRateHistory";
import useMultiRateHistory from "../currency/useMultiRateHistory";
import useLiveForecast from "../currency/useLiveForecast";
import { sourceParamFor, resolveRangeBounds } from "../currency/chartUtils";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" })
    : "—";

// Mirrors currency.controller.js's CACHE_TTL_MS (24h) — client-side only, to
// show whether a cached currency will be recomputed on its next request.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SUB_TABS = [
  { id: "status", label: "Model Status", icon: Server },
  { id: "charts", label: "Rate Charts", icon: LineChart },
  { id: "settings", label: "Currency Settings", icon: Gauge },
  { id: "anomalies", label: "Anomaly Monitoring", icon: Bell },
];

const CHART_DEFAULTS = {
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
};

const COMPARE_CHART_DEFAULTS = { preset: "1Y", from: undefined, to: undefined, sourceFilterId: "both", normalize: true };

function RateChartsView({ currencies }) {
  const [selected, setSelected] = useState(() => currencies[0]?.code || "");
  const [analysis, setAnalysis] = useState(null);
  const [anomalies, setAnomalies] = useState([]);

  const [chartFilters, updateChartFilters] = useChartFilters("admin", CHART_DEFAULTS);
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

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/currency/analyze/${selected}`, { signal: controller.signal });
        setAnalysis(res.data);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") setAnalysis(null);
      }
      try {
        const anomalyRes = await api.get("/currency/anomalies", {
          params: { currency: selected, limit: 50 },
          signal: controller.signal,
        });
        setAnomalies(anomalyRes.data?.anomalies || []);
      } catch (err) {
        if (err.code !== "ERR_CANCELED") setAnomalies([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selected]);

  const [compareSelected, setCompareSelected] = useState([]);
  const [compareFilters, updateCompareFilters] = useChartFilters("admin-compare", COMPARE_CHART_DEFAULTS);
  const { seriesByCode, loading: compareLoading, error: compareError } = useMultiRateHistory(compareSelected, {
    preset: compareFilters.preset,
    from: compareFilters.from,
    to: compareFilters.to,
    source: sourceParamFor(compareFilters.sourceFilterId),
  });
  const toggleCompare = (code) =>
    setCompareSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  const compareSeriesList = compareSelected.map((code) => ({ code, rows: seriesByCode[code] || [] }));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Currency</p>
        <CurrencyPicker currencies={currencies} selected={selected} onSelect={setSelected} />
      </div>

      <ChartControls filters={chartFilters} onChange={updateChartFilters} allowVolatility allowAnomalies />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
          {selected} — Rate History, Forecast &amp; Anomalies
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
        {/* Live trend estimate's own provenance/disclaimer badge — SEPARATE
            block, never sharing a tooltip or wording with the ML forecast's
            data-vintage note (CURRENCY_FEATURE.md §16/§17). */}
        <LiveTrendBadge liveForecast={liveTrend} className="mt-4" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-slate-500">
          <ScaleIcon className="w-4 h-4" />
          <p className="text-xs font-bold uppercase tracking-wider">Compare Currencies</p>
        </div>
        <CurrencyPicker currencies={currencies} selected={compareSelected} onSelect={toggleCompare} multi />
      </div>

      {compareSelected.length > 0 && (
        <>
          <ChartControls
            filters={compareFilters}
            onChange={updateCompareFilters}
            showSeriesToggles={false}
            showNormalizeToggle
          />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
              Compare — {compareFilters.normalize ? "Normalized" : "Raw"}
            </h2>
            <CurrencyCompareChart
              seriesList={compareSeriesList}
              normalize={compareFilters.normalize}
              loading={compareLoading}
              error={compareError}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One model's accuracy-vs-baseline table (Phase 26, CURRENCY_FEATURE.md §27).
 *
 * Deliberately model-agnostic: every label, metric name, baseline name and
 * number comes from the endpoint's normalized `evaluation.models[]` payload,
 * which is itself read from the training artifacts on disk. Nothing about
 * XGBoost, the LSTM or the Isolation Forest is encoded here — adding a fifth
 * model needs no frontend change.
 *
 * `higher_is_better` drives the verdict column:
 *   true  — accuracy-style, model must exceed the baseline
 *   false — error-style (RMSE), model must fall below it
 *   null  — not a contest (unsupervised sanity check); no verdict is shown,
 *           because inventing a pass/fail the evaluation never claimed would
 *           be worse than showing none.
 */
function ModelEvaluationTable({ model }) {
  const fmt = (v) =>
    v === null || v === undefined
      ? "—"
      : Math.abs(v) < 1 && v !== 0
        ? Number(v).toFixed(4)
        : Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 });

  const baselineLabels = model.rows?.[0]?.baselines?.map((b) => b.label) || [];
  const scored = model.higher_is_better !== null && model.higher_is_better !== undefined;
  const failing = scored ? model.rows.filter((r) => r.beats_primary_baseline === false).length : 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <ScaleIcon className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{model.label}</h3>
        </div>
        {scored && model.rows.length > 0 && (
          <span
            className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
              failing > 0
                ? "bg-amber-100 text-amber-800 border-amber-200"
                : "bg-emerald-100 text-emerald-800 border-emerald-200"
            }`}
          >
            {model.rows.length - failing}/{model.rows.length} beat baseline
          </span>
        )}
      </div>

      <p className="text-[10px] text-slate-400 font-mono mb-3">
        {model.source_file}
        {model.split ? ` · ${model.split}` : ""}
      </p>

      {!model.available ? (
        <p className="text-xs text-slate-400 leading-relaxed">{model.reason}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 text-left">
                  <th className="py-1.5 pr-4">Scope</th>
                  <th className="py-1.5 pr-4 text-right">n</th>
                  <th className="py-1.5 pr-4 text-right">Model {model.metric_label}</th>
                  {baselineLabels.map((label) => (
                    <th key={label} className="py-1.5 pr-4 text-right">
                      {label}
                    </th>
                  ))}
                  {scored && <th className="py-1.5">Verdict</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {model.rows.map((r) => {
                  // A row is flagged when the model does NOT beat its primary
                  // baseline — the whole point of surfacing this table.
                  const failed = r.beats_primary_baseline === false;
                  return (
                    <tr key={r.scope} className={failed ? "bg-amber-50/60" : undefined}>
                      <td className="py-1.5 pr-4 font-semibold text-slate-700">{r.scope}</td>
                      <td className="py-1.5 pr-4 text-right text-slate-400">{r.n ?? "—"}</td>
                      <td
                        className={`py-1.5 pr-4 text-right font-mono font-bold ${
                          failed ? "text-amber-800" : "text-slate-800"
                        }`}
                      >
                        {fmt(r.model)}
                      </td>
                      {r.baselines.map((b) => (
                        <td key={b.label} className="py-1.5 pr-4 text-right font-mono text-slate-500">
                          {fmt(b.value)}
                        </td>
                      ))}
                      {scored && (
                        <td className="py-1.5">
                          {r.beats_primary_baseline === null ? (
                            <span className="text-slate-400">—</span>
                          ) : failed ? (
                            <span className="inline-flex items-center gap-1 text-amber-800 font-semibold">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              at/below baseline
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              beats baseline
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {model.note && <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">{model.note}</p>}
        </>
      )}
    </div>
  );
}

function ModelStatusView() {
  const { showToast } = useToast();
  const [status, setStatus] = useState(null);
  // Captured when `status` is fetched, so the cache-freshness column below
  // can compare against a stable value instead of calling Date.now() in render.
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStatus = async () => {
    const res = await api.get("/currency/admin/model-status");
    return res.data;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchStatus();
        if (!cancelled) {
          setStatus(data);
          setLoadedAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Couldn't load model status. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await fetchStatus());
      setLoadedAt(Date.now());
      showToast({ type: "success", title: "Refreshed", message: "Model status reloaded." });
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load model status. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start space-x-2 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  const isUp = status?.service?.status === "ok";

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-slate-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Python Service Health
            </h2>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:text-brand-primary/80"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">Status</p>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
                isUp
                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                  : "bg-rose-100 text-rose-800 border-rose-200"
              }`}
            >
              {isUp ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {isUp ? "Reachable" : "Unreachable"}
            </span>
            {status?.service?.error && (
              <p className="text-[11px] text-rose-500 mt-1.5">{status.service.error}</p>
            )}
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">Base URL</p>
            <p className="text-xs font-mono text-slate-700 break-all">{status?.service?.url}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
              Trained Currencies
            </p>
            <p className="text-xs font-mono text-slate-700">
              {(status?.service?.trained_currencies || []).join(", ") || "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <ListChecks className="w-4 h-4 text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Model Versions</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(status?.models || {}).map(([name, version]) => (
            <div key={name} className="flex items-center justify-between bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
              <span className="text-xs font-semibold text-slate-600 capitalize">{name.replace(/_/g, " ")}</span>
              <span className="text-xs font-mono font-bold text-slate-800">{version}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data vintage — from Python /health's data_vintage block (Phase 8,
          CURRENCY_FEATURE.md §10.2). Staff/admin need the exact trained_at
          per model family, not just the version string above. */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Data Vintage</h2>
        </div>
        {status?.service?.data_vintage ? (
          <>
            <p className="text-xs text-slate-600 mb-4">
              All models are trained on{" "}
              <span className="font-semibold">{status.service.data_vintage.training_data_source}</span> data
              through <span className="font-semibold">{formatDate(status.service.data_vintage.training_data_end)}</span> —
              this service has no live feed and never predicts from current-market data.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 text-left">
                    <th className="py-1.5 pr-4">Model</th>
                    <th className="py-1.5 pr-4">Version</th>
                    <th className="py-1.5">Trained At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(status.service.data_vintage.model_version || {}).map(([family, version]) => (
                    <tr key={family}>
                      <td className="py-1.5 pr-4 font-semibold text-slate-700 capitalize">{family}</td>
                      <td className="py-1.5 pr-4 font-mono text-slate-600">{version}</td>
                      <td className="py-1.5 text-slate-500">
                        {formatDateTime(status.service.data_vintage.trained_at?.[family])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-400">Not available — the Python service may be unreachable.</p>
        )}
      </div>

      {/* Model evaluation vs baselines (Phase 26, CURRENCY_FEATURE.md §27).
          These numbers previously existed only as .txt/.json/.csv files
          inside currency-forecast-model/models/, which nobody running the
          app ever saw — so the one question that decides how much weight a
          model's output deserves ("does it beat doing nothing?") was
          invisible in the UI. Every figure is read from those artifacts at
          request time; none is hardcoded on either side. */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Model Accuracy vs Baselines
          </h2>
          <p className="text-[10px] text-slate-400 font-mono break-all">
            {status?.evaluation?.artifacts_dir}
          </p>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Read from the training artifacts on disk at request time. A model at or below its baseline is
          flagged — it means that model is not measurably better than the trivial alternative (predicting the
          majority class, or predicting no change), which is the expected outcome for FX at these horizons
          rather than a fault.
        </p>
        {(status?.evaluation?.models || []).map((m) => (
          <ModelEvaluationTable key={m.key} model={m} />
        ))}
        {(status?.evaluation?.models || []).length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <p className="text-xs text-slate-400">
              No evaluation data was returned by the server.
            </p>
          </div>
        )}
      </div>

      {/* Live rate board — the SECOND, separate data plane (Phase 7). Shown
          here so admins can see both planes without either ever implying
          the other. Never merged with the model data above. Extracted to
          LiveRateFeedPanel (Phase 12) so the FX exchange admin console can
          reuse the exact same fetch/refresh logic instead of a second copy. */}
      <LiveRateFeedPanel />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-6 pb-0">
          <Database className="w-4 h-4 text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Cache Freshness</h2>
        </div>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">As Of</th>
                <th className="px-4 py-3">Computed At</th>
                <th className="px-4 py-3">Freshness</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(status?.cache || []).map((row) => {
                const fresh = loadedAt - new Date(row.computed_at).getTime() < CACHE_TTL_MS;
                return (
                  <tr key={row.currency_code} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-bold text-slate-800">{row.currency_code}</td>
                    <td className="px-4 py-3 text-slate-600">{row.as_of_date}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{formatDateTime(row.computed_at)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-[11px] font-bold border ${
                          fresh
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                            : "bg-amber-100 text-amber-800 border-amber-200"
                        }`}
                      >
                        {fresh ? "Fresh" : "Stale (will recompute)"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(!status?.cache || status.cache.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">
                    No currency has been analyzed yet — the cache fills in as customers/staff use the feature.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CurrencySettingsView({ currencies, onCurrenciesChange }) {
  const { showToast } = useToast();
  const [togglingCode, setTogglingCode] = useState(null);
  const [refreshingCode, setRefreshingCode] = useState(null);

  const handleToggle = async (currency) => {
    const nextActive = !currency.is_active;
    setTogglingCode(currency.code);
    try {
      await api.patch(`/currency/admin/currencies/${currency.code}/status`, { is_active: nextActive });
      onCurrenciesChange((prev) =>
        prev.map((c) => (c.code === currency.code ? { ...c, is_active: nextActive } : c))
      );
      showToast({
        type: "success",
        title: nextActive ? "Currency Activated" : "Currency Deactivated",
        message: nextActive
          ? `${currency.code} is now visible to customers and staff.`
          : `${currency.code} is hidden from customers and staff.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Couldn't update this currency's status.",
      });
    } finally {
      setTogglingCode(null);
    }
  };

  const handleForceRefresh = async (currency) => {
    setRefreshingCode(currency.code);
    try {
      const res = await api.post(`/currency/admin/analyze/${currency.code}/refresh`);
      showToast({
        type: "success",
        title: "Analysis Refreshed",
        message: `${currency.code} recomputed as of ${res.data?.forecast?.as_of_date || "now"}, bypassing the cache.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Refresh Failed",
        message: err.response?.data?.message || "Couldn't recompute this currency's analysis.",
      });
    } finally {
      setRefreshingCode(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase font-semibold tracking-wider text-slate-500 text-left">
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {currencies.map((currency) => (
              <tr key={currency.code} className="hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <p className="font-bold text-slate-800">{currency.code}</p>
                  <p className="text-[11px] text-slate-400">{currency.name}</p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border uppercase ${
                      currency.is_active
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                        : "bg-slate-50 text-slate-500 border-slate-100"
                    }`}
                  >
                    {currency.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleForceRefresh(currency)}
                      disabled={refreshingCode === currency.code}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-primary border border-brand-primary/20 hover:bg-brand-primary/5 disabled:opacity-50 transition-colors"
                    >
                      {refreshingCode === currency.code ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Force Refresh
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggle(currency)}
                      disabled={togglingCode === currency.code}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50 transition-colors ${
                        currency.is_active
                          ? "text-rose-600 border-rose-200 hover:bg-rose-50"
                          : "text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                      }`}
                    >
                      {togglingCode === currency.code ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : currency.is_active ? (
                        <XCircle className="w-3.5 h-3.5" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      {currency.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminCurrency() {
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(true);
  const [currenciesError, setCurrenciesError] = useState("");
  const [tab, setTab] = useState("status");

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
          <h1 className="text-sm font-bold text-slate-800">Model Status &amp; Configuration</h1>
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

      {tab === "status" && <ModelStatusView />}

      {tab === "charts" && (
        <>
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
          {!currenciesLoading && !currenciesError && currencies.length > 0 && (
            <RateChartsView currencies={currencies} />
          )}
        </>
      )}

      {tab === "settings" && (
        <>
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
          {!currenciesLoading && !currenciesError && (
            <CurrencySettingsView currencies={currencies} onCurrenciesChange={setCurrencies} />
          )}
        </>
      )}

      {tab === "anomalies" && (
        <>
          {currenciesLoading && (
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading currencies…
            </div>
          )}
          {!currenciesLoading && !currenciesError && <AnomalyLog currencies={currencies} />}
        </>
      )}
    </div>
  );
}

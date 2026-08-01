import { ShieldAlert, Info } from "lucide-react";

const formatLkr = (v) =>
  v === null || v === undefined
    ? "—"
    : `LKR ${Math.round(Number(v)).toLocaleString("en-LK")}`;

/**
 * Historical-simulation Value at Risk on the bank's net FX position
 * (Phase 32, CURRENCY_FEATURE.md §33).
 *
 * Everything here comes from GET /currency/exchange/admin/position's `risk`
 * block, computed from the same committed-only `net_lkr_amount` figures the
 * exposure chart above it plots — so the risk number can never describe a
 * different book than the chart. Nothing is hardcoded; the horizons, levels
 * and caveats are all read from the payload, so re-running the scenario
 * builder with different settings changes this panel with no edit.
 *
 * Deliberately reports Expected Shortfall next to VaR. VaR is a quantile and
 * says nothing about how bad the tail beyond it gets — the single most common
 * misreading of the measure — so the average loss *given* that the VaR is
 * breached is shown beside it rather than left for a reader to ask about.
 */
export default function FxRiskPanel({ risk }) {
  if (!risk) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
          Position Risk (VaR)
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          No scenario data available. Generate it with{" "}
          <span className="font-mono">
            venv/bin/python training/build_var_scenarios.py
          </span>{" "}
          in <span className="font-mono">currency-forecast-model/</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Position Risk (Value at Risk)
          </h2>
        </div>
        <p className="text-[10px] text-slate-400">
          {risk.method?.replace(/_/g, " ")} · {risk.n_scenarios?.toLocaleString()} scenarios ·{" "}
          {risk.scenario_from} → {risk.scenario_to}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1">
            Gross exposure
          </p>
          <p className="text-lg font-bold text-slate-800 font-mono">
            {formatLkr(risk.gross_exposure_lkr)}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Sum of absolute positions</p>
        </div>
        <div className="bg-slate-50 rounded-xl border border-slate-100 p-4">
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-1">
            Net exposure
          </p>
          <p className="text-lg font-bold text-slate-800 font-mono">
            {formatLkr(risk.net_exposure_lkr)}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Long minus short</p>
        </div>
      </div>

      {risk.uncovered_currencies?.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-800 rounded-xl px-3 py-2 text-[11px] leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            No scenario history for <strong>{risk.uncovered_currencies.join(", ")}</strong> — those
            positions are excluded from every figure below, so the real book carries more risk than
            shown.
          </span>
        </div>
      )}

      {risk.horizons?.map((h) => (
        <div key={h.horizon_days}>
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">
            {h.horizon_days}-day holding period
            <span className="normal-case font-normal text-slate-300"> · {h.n_scenarios?.toLocaleString()} windows</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 text-left">
                  <th className="py-1.5 pr-4">Confidence</th>
                  <th className="py-1.5 pr-4 text-right">VaR</th>
                  <th className="py-1.5 pr-4 text-right">Expected shortfall</th>
                  <th className="py-1.5 pr-4 text-right">Sum of standalone</th>
                  <th className="py-1.5 text-right">Diversification benefit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {h.levels?.map((L) => (
                  <tr key={L.level}>
                    <td className="py-1.5 pr-4 font-semibold text-slate-700">
                      {(L.level * 100).toFixed(0)}%
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono font-bold text-rose-700">
                      {formatLkr(L.value_at_risk_lkr)}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono text-rose-500">
                      {formatLkr(L.expected_shortfall_lkr)}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono text-slate-400">
                      {formatLkr(L.sum_of_standalone_var_lkr)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-emerald-700">
                      {formatLkr(L.diversification_benefit_lkr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Per-currency standalone VaR at the highest reported confidence —
          which currency actually drives the book's risk. */}
      {(() => {
        const last = risk.horizons?.[0]?.levels?.[risk.horizons[0].levels.length - 1];
        if (!last?.per_currency?.length) return null;
        return (
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">
              Standalone VaR by currency · {risk.horizons[0].horizon_days}-day,{" "}
              {(last.level * 100).toFixed(0)}%
            </p>
            <div className="flex flex-wrap gap-2">
              {[...last.per_currency]
                .sort((a, b) => (b.var || 0) - (a.var || 0))
                .map((c) => (
                  <span
                    key={c.currency_code}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs"
                  >
                    <span className="font-bold text-slate-700">{c.currency_code}</span>
                    <span className="font-mono text-rose-700">{formatLkr(c.var)}</span>
                    <span className="text-[10px] text-slate-400">
                      {c.net_lkr_amount >= 0 ? "long" : "short"}
                    </span>
                  </span>
                ))}
            </div>
          </div>
        );
      })()}

      {risk.caveats?.length > 0 && (
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-1.5">
          <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider">
            How to read this
          </p>
          <ul className="text-[11px] text-slate-500 leading-relaxed list-disc pl-4 space-y-1">
            {risk.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

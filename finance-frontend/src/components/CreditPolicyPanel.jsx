import { ScrollText, ShieldCheck, ShieldAlert, ShieldX, MinusCircle } from "lucide-react";

/**
 * The deterministic credit-policy verdict (D1), rendered from the `policy`
 * object the backend attaches to an application or an assessment response
 * (see loan.controller.js serializePolicy).
 *
 * Deliberately presented as its own panel, separate from the AI risk block:
 * the two are independent judgements and collapsing them into one card would
 * imply the model had a say in the mandatory criteria, which it does not.
 * A `decline` here is NOT a decision on the application — staff still decide
 * — so the wording throughout says "criteria", never "rejected".
 *
 * Two audiences, one component:
 *   detailed=false (customer) — the verdict, the headline figures, and only
 *     the rules that were not met. A clean file shows a single reassuring
 *     line rather than a wall of green ticks.
 *   detailed=true (staff)     — every rule including the ones that could not
 *     be evaluated, because "we never saw a CRIB score" is information a
 *     reviewer needs and an applicant doesn't.
 *
 * `labels` keeps this component language-agnostic: customer screens pass
 * translated headlines, admin screens take the English defaults (staff
 * tooling stays English by project convention). Rule text itself always
 * comes from the server in English.
 */

const OUTCOME_STYLES = {
  pass: {
    icon: ShieldCheck,
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    panel: "bg-emerald-50/50 border-emerald-100",
    accent: "text-emerald-700",
  },
  refer: {
    icon: ShieldAlert,
    chip: "bg-amber-100 text-amber-800 border-amber-200",
    panel: "bg-amber-50/50 border-amber-100",
    accent: "text-amber-700",
  },
  decline: {
    icon: ShieldX,
    chip: "bg-rose-100 text-rose-800 border-rose-200",
    panel: "bg-rose-50/50 border-rose-100",
    accent: "text-rose-700",
  },
};

const STATUS_STYLES = {
  pass: { dot: "bg-emerald-500", text: "text-slate-600" },
  refer: { dot: "bg-amber-500", text: "text-amber-800" },
  fail: { dot: "bg-rose-500", text: "text-rose-800" },
  skipped: { dot: "bg-slate-300", text: "text-slate-400" },
};

const DEFAULT_LABELS = {
  title: "Credit Policy Check",
  outcomePass: "All criteria met",
  outcomeRefer: "Manual review",
  outcomeDecline: "Criteria not met",
  summaryPass: "This application meets every mandatory lending criterion.",
  summaryRefer: "Within the mandatory limits, but some criteria need a reviewer's judgement.",
  summaryDecline: "One or more mandatory lending criteria were not met.",
  metricDti: "Instalment / income",
  metricResidual: "Left after instalment",
  metricLti: "Loan / annual income",
  metricAgeAtMaturity: "Age at final payment",
  notEvaluated: "Not evaluated",
  footnote:
    "These are fixed lending rules, checked separately from the AI risk score. They do not decide the application on their own.",
};

const formatCurrency = (value) =>
  value === null || value === undefined
    ? "—"
    : `LKR ${Number(value).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const formatRatioPercent = (value) =>
  value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(1)}%`;

const formatMultiple = (value) =>
  value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}×`;

export default function CreditPolicyPanel({ policy, detailed = false, labels = {} }) {
  // Applications assessed before D1 carry no evaluation. Rendering nothing is
  // the honest option — an empty panel would read as a clean pass.
  if (!policy) return null;

  const L = { ...DEFAULT_LABELS, ...labels };
  const style = OUTCOME_STYLES[policy.outcome] || OUTCOME_STYLES.refer;
  const OutcomeIcon = style.icon;
  const metrics = policy.metrics || {};
  const rules = Array.isArray(policy.rules) ? policy.rules : [];

  const outcomeLabel = {
    pass: L.outcomePass,
    refer: L.outcomeRefer,
    decline: L.outcomeDecline,
  }[policy.outcome];

  const summary = {
    pass: L.summaryPass,
    refer: L.summaryRefer,
    decline: L.summaryDecline,
  }[policy.outcome];

  // Customers see only what went wrong; staff see the whole checklist,
  // failures first so the deciding rule is never buried under passes.
  const RANK = { fail: 0, refer: 1, pass: 2, skipped: 3 };
  const shownRules = (detailed ? [...rules] : rules.filter((r) => r.status !== "pass" && r.status !== "skipped"))
    .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));

  const metricTiles = [
    { label: L.metricDti, value: formatRatioPercent(metrics.dti) },
    { label: L.metricResidual, value: formatCurrency(metrics.residual_income) },
    { label: L.metricLti, value: formatMultiple(metrics.loan_to_income) },
    {
      label: L.metricAgeAtMaturity,
      value: metrics.age_at_maturity ?? "—",
    },
  ];

  return (
    <div className={`rounded-2xl border p-5 space-y-4 ${style.panel}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
          <ScrollText className="w-4 h-4 text-slate-500" />
          {L.title}
        </h4>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border uppercase ${style.chip}`}
        >
          <OutcomeIcon className="w-3.5 h-3.5" />
          {outcomeLabel}
        </span>
      </div>

      <p className={`text-sm leading-relaxed ${style.accent}`}>{summary}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {metricTiles.map((tile) => (
          <div key={tile.label} className="bg-white/70 rounded-xl border border-white p-3">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block leading-tight">
              {tile.label}
            </span>
            <span className="text-sm font-bold text-slate-800 font-mono">{tile.value}</span>
          </div>
        ))}
      </div>

      {shownRules.length > 0 && (
        <ul className="space-y-2">
          {shownRules.map((rule) => {
            const rs = STATUS_STYLES[rule.status] || STATUS_STYLES.skipped;
            return (
              <li key={rule.code} className="flex items-start gap-2.5">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${rs.dot}`} />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-slate-700">{rule.label}</span>
                  {rule.status === "skipped" && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] uppercase font-semibold tracking-wider text-slate-400">
                      <MinusCircle className="w-3 h-3" />
                      {L.notEvaluated}
                    </span>
                  )}
                  <p className={`text-xs leading-relaxed ${rs.text}`}>{rule.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {detailed && policy.policy_version && (
        <p className="text-[10px] text-slate-400 font-mono pt-1">
          policy {policy.policy_version}
          {policy.reason_codes?.length ? ` · ${policy.reason_codes.join(", ")}` : ""}
        </p>
      )}

      {!detailed && <p className="text-[10px] text-slate-500 leading-relaxed">{L.footnote}</p>}
    </div>
  );
}

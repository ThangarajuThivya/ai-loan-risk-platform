import { Percent } from "lucide-react";

/**
 * The rate an application was actually assessed and quoted at (D3), from
 * the `pricing` object the backend attaches to an assess response or an
 * application (see loan.controller.js serializePricing).
 *
 * Rendered as its own small badge rather than folded into the EMI tile
 * next to it: the RATE is the thing risk-based pricing changes, and giving
 * it a name (a tier chip) is what makes "why is my rate different from the
 * one advertised" self-explanatory instead of something support has to
 * answer by hand.
 *
 * `risk_based: false` (a flat-rate product, or an application assessed
 * before D3) renders the rate with no tier chip — there is nothing to name,
 * it is simply the product's rate.
 *
 * `labels` keeps this component language-agnostic, the same convention as
 * CreditPolicyPanel: customer screens pass translated headlines, admin
 * screens take the English defaults (staff tooling stays English by
 * project convention).
 */

const DEFAULT_LABELS = {
  rateLabel: "Interest Rate",
  tierPreferential: "Preferential",
  tierStandard: "Standard",
  tierPremium: "Premium",
  riskBasedNote: "Priced according to your risk assessment.",
};

const TIER_STYLES = {
  preferential: "bg-emerald-100 text-emerald-800 border-emerald-200",
  standard: "bg-slate-100 text-slate-700 border-slate-200",
  premium: "bg-amber-100 text-amber-800 border-amber-200",
};

export default function PricingBadge({ pricing, labels = {}, detailed = false }) {
  // Applications assessed before D3 carry no pricing. Rendering nothing is
  // the honest option — falling back to the product's current base rate
  // would show a number this specific application was never actually
  // quoted at.
  if (!pricing) return null;

  const L = { ...DEFAULT_LABELS, ...labels };
  const tierLabel = {
    preferential: L.tierPreferential,
    standard: L.tierStandard,
    premium: L.tierPremium,
  }[pricing.tier];

  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-brand-accent/10 flex items-center justify-center shrink-0">
        <Percent className="w-5 h-5 text-brand-accent" />
      </div>
      <div className="min-w-0">
        <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block">
          {L.rateLabel}
        </span>
        <span className="text-xl font-bold text-slate-800 font-mono">
          {Number(pricing.interest_rate).toFixed(2)}%
        </span>
        {pricing.risk_based && tierLabel && (
          <span
            className={`ml-2 inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide align-middle ${
              TIER_STYLES[pricing.tier] || TIER_STYLES.standard
            }`}
          >
            {tierLabel}
          </span>
        )}
        {detailed && pricing.risk_based && (
          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{L.riskBasedNote}</p>
        )}
      </div>
    </div>
  );
}

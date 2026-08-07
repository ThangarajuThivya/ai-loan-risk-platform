import { ShieldOff, Info } from "lucide-react";

/**
 * The standardized reasons an application was declined (D4), from the
 * `adverse_action` object the backend attaches to an application (see
 * loan.controller.js serializeAdverseAction) — the LATEST record only; a
 * reject-reopen-reject cycle's full history lives at
 * GET /loans/:id/adverse-actions, not shown here.
 *
 * Deliberately separate from CreditPolicyPanel: that shows the mandatory
 * CRITERIA (pass/refer/decline, independent of whether the application was
 * actually rejected); this shows the REASONS an actual rejection was
 * decided on — which can include reasons a reviewer picked that the policy
 * engine never flagged (ADVERSE_INFORMATION, HIGH_RISK_ASSESSMENT), and
 * which is null on every application that was never rejected.
 *
 * Per the same convention as CreditPolicyPanel/PricingBadge: reason
 * `label`/`description` are server-generated content and stay English for
 * every viewer, matching the project's headline-level-only translation
 * policy — only this panel's own chrome (`labels`) is translated for
 * customer screens.
 *
 * `detailed=true` (staff) additionally shows the immutable technical
 * snapshot — risk band, model/policy/matrix version, who decided and how —
 * which a customer has no use for and no need to see.
 */

const DEFAULT_LABELS = {
  title: "Why This Application Was Declined",
  automatedNote: "This decision was made automatically by our credit checks.",
  footnote: "If you believe this decision was made in error, please contact us.",
};

export default function AdverseActionPanel({ adverseAction, labels = {}, detailed = false }) {
  // Never rejected, or rejected before D4 existed. Rendering nothing is the
  // honest option — there is no standardized reason to show for either.
  if (!adverseAction) return null;

  const L = { ...DEFAULT_LABELS, ...labels };
  const reasons = Array.isArray(adverseAction.reasons) ? adverseAction.reasons : [];

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5 space-y-4">
      <h4 className="text-xs font-bold text-rose-900 uppercase tracking-wider flex items-center gap-1.5">
        <ShieldOff className="w-4 h-4 text-rose-600" />
        {L.title}
      </h4>

      {reasons.length > 0 && (
        <ul className="space-y-2.5">
          {reasons.map((r) => (
            <li key={r.code} className="flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-rose-500" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-slate-700">{r.label}</span>
                <p className="text-xs text-slate-600 leading-relaxed">{r.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adverseAction.note && (
        <div className="flex items-start gap-2 pt-1 border-t border-rose-100">
          <Info className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700 leading-relaxed">{adverseAction.note}</p>
        </div>
      )}

      {!detailed && adverseAction.decision_source === "system" && (
        <p className="text-[10px] text-slate-500 italic">{L.automatedNote}</p>
      )}

      {detailed && (
        <div className="pt-2 border-t border-rose-100 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-slate-500 font-mono">
          <span>
            source: {adverseAction.decision_source}
            {adverseAction.decision_source === "system" ? " (automatic)" : ""}
          </span>
          {adverseAction.risk_category && <span>model band: {adverseAction.risk_category}</span>}
          {adverseAction.model_version && <span>model: {adverseAction.model_version}</span>}
          {adverseAction.policy_version && <span>policy: {adverseAction.policy_version}</span>}
          {adverseAction.matrix_version && <span>matrix: {adverseAction.matrix_version}</span>}
        </div>
      )}

      {!detailed && <p className="text-[10px] text-slate-500 leading-relaxed">{L.footnote}</p>}
    </div>
  );
}

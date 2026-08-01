import RiskCalculator from "../RiskCalculator";

export default function AdminRiskAnalysis() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-xl text-slate-900">
          AI Risk Analysis
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Run an instant, indicative risk assessment for a prospect who isn't
          (yet) a registered customer — nothing here is saved.
        </p>
      </div>
      <RiskCalculator />
    </div>
  );
}

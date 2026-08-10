import { Check, X, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { deriveLeaseProgress, haltedMessageKey, progressFromRow, LEASE_STEPS } from "./leaseProgress";

// Same reasoning as LeaseNextAction.jsx: staff sees this component too (with
// audience="staff"), and must always get English regardless of whatever
// language a customer session left the shared i18n instance in.
const tEnglish = i18n.getFixedT("en");

/**
 * The same progress, small enough for a list row or a queue line.
 *
 * Segments rather than numbered dots: at this size a label is unreadable, so
 * it becomes a bar with the current step named beside it. Driven by
 * `progressFromRow`, the SAME derivation the full tracker uses, so a list and
 * the page it links to cannot disagree.
 */
export function LeaseProgressBar({ row, className = "", audience = "customer" }) {
  const { t: tAmbient } = useTranslation();
  const t = audience === "staff" ? tEnglish : tAmbient;
  const { steps, currentIndex, halted, complete } = progressFromRow(row);
  const current = steps[currentIndex];
  const currentLabel = t(current.labelKey);

  // Whose move it is, on the row itself. Without this a list can only be
  // read by opening every lease in turn to find the one that needs
  // something — which is exactly how work sits unnoticed in a queue.
  const yours = !halted && !complete && current.who === (audience === "staff" ? "us" : "you");

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-center gap-0.5" title={t(current.hintKey)}>
        {steps.map((step, i) => (
          <span
            key={step.key}
            className={`h-1.5 flex-1 rounded-full ${
              halted
                ? i <= currentIndex
                  ? "bg-slate-300"
                  : "bg-slate-100"
                : complete || i < currentIndex
                  ? "bg-emerald-400"
                  : i === currentIndex
                    ? yours
                      ? "bg-amber-500"
                      : "bg-brand-primary"
                    : "bg-slate-200"
            }`}
          />
        ))}
      </div>
      <p className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
        {halted ? (
          <span className="text-slate-400">
            {t("leaseProgress.tracker.stoppedAt", { step: currentLabel.toLowerCase() })}
          </span>
        ) : complete ? (
          <span className="text-emerald-700 font-semibold">{t("leaseProgress.tracker.complete")}</span>
        ) : (
          <>
            {yours && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                {t(audience === "staff" ? "leaseProgress.tone.actionNeeded" : "leaseProgress.tone.yourTurn")}
              </span>
            )}
            <span>
              {t("leaseProgress.tracker.stepOf", { current: currentIndex + 1, total: LEASE_STEPS.length })}{" "}
              ·{" "}
              <span className="font-semibold text-slate-500">{currentLabel}</span>
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * A horizontal tracker for one lease, shown identically to the lessee, staff
 * and admin.
 *
 * TWO JOBS, AND THE SECOND IS THE POINT. It says where this lease has got to
 * — and it teaches the sequence to someone who has never seen it. Sri Lankan
 * finance leasing has steps a borrower has no equivalent of (a down payment
 * before anything is bought, the institution buying the vehicle, the CR
 * naming it as absolute owner), and people reasonably do not know what
 * happens next or whose turn it is. So every step carries a plain-English
 * hint, and the current one says whether it is waiting on us or on them.
 *
 * IDENTICAL ACROSS THE THREE PORTALS, deliberately. A lessee ringing to ask
 * "what's happening with my lease?" and the officer who answers should be
 * reading the same description of the same workflow. `deriveLeaseProgress`
 * is the single source; only the framing sentence changes by audience.
 *
 * The bar scrolls horizontally rather than wrapping. A wrapped stepper stops
 * reading as a sequence, which is the one thing it has to do.
 */

const DOT = {
  done: "bg-emerald-500 border-emerald-500 text-white",
  current: "bg-brand-primary border-brand-primary text-white ring-4 ring-brand-primary/15",
  upcoming: "bg-white border-slate-200 text-slate-300",
  halted: "bg-slate-100 border-slate-200 text-slate-300",
};

const LABEL = {
  done: "text-slate-600",
  current: "text-slate-900 font-bold",
  upcoming: "text-slate-400",
  halted: "text-slate-300",
};

const WHO_KEY = {
  us: "leaseProgress.tracker.withUs",
  you: "leaseProgress.tracker.overToYou",
};

export default function LeaseProgressTracker({
  application,
  quotations,
  downPayment,
  purchase,
  agreement,
  audience = "customer",
}) {
  const { t: tAmbient } = useTranslation();
  const t = audience === "staff" ? tEnglish : tAmbient;
  const { steps, currentIndex, halted, haltedStatus, complete } = deriveLeaseProgress({
    application,
    quotations,
    downPayment,
    purchase,
    agreement,
  });

  const current = steps[currentIndex];
  const waitingOnLessee = current?.who === "you";

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
          {t(
            audience === "customer"
              ? "leaseProgress.tracker.stepByStepCustomer"
              : "leaseProgress.tracker.stepByStepStaff"
          )}
        </p>
        {!halted && !complete && (
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border ${
              waitingOnLessee
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-sky-50 text-sky-700 border-sky-200"
            }`}
          >
            {audience === "customer"
              ? t(WHO_KEY[current.who])
              : t(
                  waitingOnLessee ? "leaseProgress.tone.waitingOnLessee" : "leaseProgress.tracker.waitingOnUs"
                )}
          </span>
        )}
        {complete && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
            {t("leaseProgress.tracker.complete")}
          </span>
        )}
      </div>

      {/* The bar itself. overflow-x keeps it a single line on a phone; a
          wrapped stepper stops reading as a sequence. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <ol className="flex items-start min-w-[640px]">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li key={step.key} className="flex-1 flex flex-col items-center relative">
                {/* Connector, drawn behind the dot and only between steps. */}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-3.5 left-1/2 w-full h-0.5 ${
                      i < currentIndex ? "bg-emerald-400" : "bg-slate-200"
                    }`}
                  />
                )}

                <span
                  className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    DOT[step.state]
                  }`}
                  title={t(step.hintKey)}
                >
                  {step.state === "done" ? (
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  ) : step.state === "halted" ? (
                    <X className="w-3 h-3" strokeWidth={3} />
                  ) : (
                    <span className="text-[10px] font-bold">{i + 1}</span>
                  )}
                </span>

                <span
                  className={`mt-2 text-[10px] text-center leading-tight px-1 ${LABEL[step.state]}`}
                >
                  {t(step.labelKey)}
                </span>
                {step.detail && (
                  <span className="text-[9px] text-center leading-tight px-1 text-slate-400 mt-0.5">
                    {t(`leaseProgress.detail.${step.detail.key}`, step.detail.params)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* What is happening now, in a sentence. This is the part that answers
          "so what do I actually do?". */}
      {halted ? (
        <p className="flex items-start gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          {t(`leaseProgress.halted.${haltedMessageKey(haltedStatus)}`)}
        </p>
      ) : (
        <p
          className={`flex items-start gap-2 text-[11px] rounded-xl px-3 py-2 border ${
            complete
              ? "text-emerald-800 bg-emerald-50 border-emerald-200"
              : "text-slate-600 bg-slate-50 border-slate-200"
          }`}
        >
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
          <span>
            <span className="font-bold">{t(current.labelKey)}.</span> {t(current.hintKey)}
          </span>
        </p>
      )}
    </div>
  );
}

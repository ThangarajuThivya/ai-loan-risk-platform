import { ArrowRight, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { deriveNextAction } from "./leaseProgress";

// Staff always resolves this component's copy in English, regardless of the
// UI language a customer session left in localStorage — the two portals
// share one i18n instance (see src/i18n/index.js), and staff has no
// language switcher of its own to override it with. getFixedT sidesteps the
// ambient language entirely rather than relying on staff never toggling it.
const tEnglish = i18n.getFixedT("en");

/**
 * "So what happens next?", answered at the top of every lease surface.
 *
 * The problem this solves: both the lessee's page and the officer's review
 * drawer were a long vertical stack of every panel that could ever apply,
 * with nothing marking which one mattered now. The reader had to scroll the
 * whole thing and infer. That is how an approved lease sat for days with the
 * lessee waiting for a payment link and the officer waiting for a payment —
 * neither of them wrong, just never told.
 *
 * So each surface now LEADS with one sentence and one button.
 *
 * COLOUR CARRIES MEANING, not decoration:
 *   amber  — it's your move, something is expected of you
 *   sky    — it's the other side's move, you're waiting
 *   emerald— finished
 *   slate  — stopped, nothing further
 *
 * `onGo` is optional. Where a surface can route to the controls (the staff
 * drawer's tabs) it passes one; where the action is elsewhere entirely (the
 * lessee waiting on us) there is nothing to click, and no button is drawn
 * rather than a dead one.
 */
export default function LeaseNextAction({
  application,
  quotations,
  downPayment,
  purchase,
  agreement,
  valuationCompleted,
  audience = "customer",
  onGo,
  goLabel,
}) {
  const { t: tAmbient } = useTranslation();
  const t = audience === "staff" ? tEnglish : tAmbient;

  const action = deriveNextAction({
    application,
    quotations,
    downPayment,
    purchase,
    agreement,
    valuationCompleted,
  });

  const raw = action[audience] || action.customer;
  const copy = { label: t(raw.labelKey, raw.params), hint: t(raw.hintKey, raw.params) };
  const isYours = action.actor === audience;
  const finished = action.key === "complete";
  const stopped = action.key === "halted";
  const resolvedGoLabel = goLabel ?? t("leaseProgress.tone.goThere");

  const tone = stopped
    ? {
        wrap: "bg-slate-50 border-slate-200",
        icon: "bg-slate-200 text-slate-500",
        eyebrow: "text-slate-400",
        title: "text-slate-600",
        Icon: XCircle,
        eyebrowText: t("leaseProgress.tone.closed"),
      }
    : finished
      ? {
          wrap: "bg-emerald-50 border-emerald-200",
          icon: "bg-emerald-500 text-white",
          eyebrow: "text-emerald-700",
          title: "text-emerald-900",
          Icon: CheckCircle2,
          eyebrowText: t("leaseProgress.tone.complete"),
        }
      : isYours
        ? {
            wrap: "bg-amber-50 border-amber-200",
            icon: "bg-amber-500 text-white",
            eyebrow: "text-amber-700",
            title: "text-amber-900",
            Icon: ArrowRight,
            eyebrowText: t(
              audience === "customer" ? "leaseProgress.tone.yourTurn" : "leaseProgress.tone.actionNeeded"
            ),
          }
        : {
            wrap: "bg-sky-50 border-sky-200",
            icon: "bg-sky-500 text-white",
            eyebrow: "text-sky-700",
            title: "text-sky-900",
            Icon: Clock,
            eyebrowText: t(
              audience === "customer"
                ? "leaseProgress.tone.withUs"
                : action.actor === "customer"
                  ? "leaseProgress.tone.waitingOnLessee"
                  : "leaseProgress.tone.inProgress"
            ),
          };

  const { Icon } = tone;

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${tone.wrap}`}>
      <div className="flex items-start gap-3.5">
        <span className={`p-2 rounded-xl shrink-0 ${tone.icon}`}>
          <Icon className="w-4 h-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${tone.eyebrow}`}
          >
            {tone.eyebrowText}
          </p>
          <p className={`text-sm font-bold leading-snug ${tone.title}`}>{copy.label}</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">{copy.hint}</p>
        </div>

        {/* Only drawn when there is somewhere to go. A button that scrolls
            to a panel the reader is already looking at is noise. */}
        {onGo && isYours && !finished && !stopped && (
          <button
            type="button"
            onClick={() => onGo(action.tab)}
            className="shrink-0 self-center inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            {resolvedGoLabel}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

import { ShieldCheck, ShieldQuestion, ShieldAlert } from "lucide-react";

export const RISK_STYLES = {
  0: {
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    bar: "bg-emerald-500",
    icon: ShieldCheck,
  },
  1: {
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    bar: "bg-amber-500",
    icon: ShieldQuestion,
  },
  2: {
    badge: "bg-rose-100 text-rose-800 border-rose-200",
    bar: "bg-rose-500",
    icon: ShieldAlert,
  },
};

// Keyed by loan_applications.status — see the backend's
// src/services/applicationStatus.service.js for the lifecycle itself.
// Amber = waiting on the bank, sky = waiting on the applicant,
// emerald = good outcome, rose = declined, slate = over and done with.
export const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  under_review: "bg-amber-50 text-amber-700 border-amber-100",
  more_info_required: "bg-sky-50 text-sky-700 border-sky-100",
  // Approved = an offer is waiting on the applicant, so it reads as an
  // action state (sky) rather than a finished-good one.
  approved: "bg-sky-50 text-sky-700 border-sky-100",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-100",
  disbursed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rejected: "bg-rose-50 text-rose-700 border-rose-100",
  withdrawn: "bg-slate-50 text-slate-600 border-slate-200",
  closed: "bg-slate-50 text-slate-600 border-slate-200",
};

/** "more_info_required" → "more info required", for display. */
export const formatStatus = (status) =>
  String(status || "").replace(/_/g, " ");

export const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", {
    maximumFractionDigits: 0,
  })}`;

export const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

/**
 * Calendar dates (due dates, maturity) arrive as bare "YYYY-MM-DD" — they
 * have no time and no timezone. `new Date("2026-09-05")` would parse that
 * as UTC midnight, so any browser west of UTC would render the day before.
 * Parsing the parts into a LOCAL date keeps the day the server meant.
 * Full timestamps still go through the normal Date constructor.
 */
const parseDate = (value) => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
};

export const formatDate = (value) =>
  value
    ? parseDate(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * What, if anything, this application needs FROM THE CUSTOMER right now —
 * drives both the applications list's attention chip and MyApplications'
 * filter pills, kept in one place so the two can never disagree about what
 * counts as "needs action". Returns null when nothing is waiting on the
 * customer, otherwise { type: "offer" | "info_request" }.
 */
export function getAttention(application) {
  const offer = application?.offer;
  const canAnswerOffer =
    Boolean(offer?.is_actionable) &&
    (application?.allowed_transitions || []).includes("accepted");
  if (canAnswerOffer) return { type: "offer" };

  // "under_review" only ever appears in a CUSTOMER's allowed_transitions
  // when the application is currently more_info_required with no response
  // yet — see applicationStatus.service.js TRANSITIONS.
  const canRespond = (application?.allowed_transitions || []).includes("under_review");
  if (canRespond) return { type: "info_request" };

  return null;
}

/** Coarse bucket for filtering a list of applications (MyApplications). */
export function getApplicationBucket(application) {
  if (getAttention(application)) return "needs_action";
  if (["pending", "under_review", "more_info_required"].includes(application.status)) {
    return "in_review";
  }
  if (["approved", "accepted", "disbursed"].includes(application.status)) {
    return "active";
  }
  return "closed"; // rejected, withdrawn, closed
}

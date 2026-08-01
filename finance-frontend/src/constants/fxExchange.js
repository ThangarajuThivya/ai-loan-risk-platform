// Must match finance-backend/src/routes/fxExchange.routes.js exactly — these
// are the closed sets the server itself validates against (Phase 10,
// CURRENCY_FEATURE.md §12). Client-side use here is for UX only (a
// restricted dropdown, an early "this will be rejected" message); the
// server remains the authority on every one of these rules.

export const PURPOSE_CODE_OPTIONS = [
  { value: "travel", label: "Travel" },
  { value: "education", label: "Education" },
  { value: "medical", label: "Medical" },
  { value: "family_maintenance", label: "Family Maintenance" },
  { value: "investment", label: "Investment" },
  { value: "import_payment", label: "Import Payment" },
  { value: "gift", label: "Gift" },
  { value: "other", label: "Other" },
];

// 'approved' is a reserved-but-never-set status (CURRENCY_FEATURE.md §12.2) —
// included here only so an unexpected value doesn't render as "unknown".
export const STATUS_META = {
  pending_review: { label: "Pending Review", className: "bg-amber-100 text-amber-800 border-amber-200" },
  approved: { label: "Approved", className: "bg-sky-100 text-sky-800 border-sky-200" },
  ready_for_settlement: {
    label: "Ready for Settlement",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  settled: { label: "Settled", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  rejected: { label: "Rejected", className: "bg-rose-100 text-rose-800 border-rose-200" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600 border-slate-200" },
  expired: { label: "Expired", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

export const STATUS_FILTER_OPTIONS = Object.keys(STATUS_META).filter((s) => s !== "approved");

export const DIRECTION_META = {
  buy: {
    label: "Buy foreign currency",
    verb: "buy",
    hint: "You pay LKR and receive foreign currency — priced at the bank's sell rate.",
  },
  sell: {
    label: "Sell foreign currency",
    verb: "sell",
    hint: "You hand over foreign currency and receive LKR — priced at the bank's buy rate.",
  },
};

// Must match finance-backend/src/routes/contactMessage.routes.js's
// STATUS_VALUES exactly — the server is the authority on this set, this is
// for UX only (status chip colors, a filter dropdown).

export const STATUS_META = {
  open: { label: "Open", className: "bg-amber-100 text-amber-800 border-amber-200" },
  in_progress: { label: "In Progress", className: "bg-sky-100 text-sky-800 border-sky-200" },
  resolved: { label: "Resolved", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

export const STATUS_FILTER_OPTIONS = Object.keys(STATUS_META);

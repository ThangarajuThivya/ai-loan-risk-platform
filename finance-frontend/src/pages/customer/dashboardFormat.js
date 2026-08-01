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

export const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rejected: "bg-rose-50 text-rose-700 border-rose-100",
};

export const formatCurrency = (value) =>
  `LKR ${Number(value || 0).toLocaleString("en-LK", {
    maximumFractionDigits: 0,
  })}`;

export const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

export const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-LK", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

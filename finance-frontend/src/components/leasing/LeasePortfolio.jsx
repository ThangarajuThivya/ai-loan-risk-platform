import { useEffect, useState } from "react";
import {
  Car,
  Loader2,
  AlertTriangle,
  Wallet,
  KeyRound,
  ClipboardList,
  TrendingUp,
} from "lucide-react";
import api from "../../api/axios";

/**
 * The leasing book (L8.1).
 *
 * Kept separate from the loan portfolio deliberately: a lease book and a
 * loan book are separately regulated and separately accounted for, and one
 * combined total would be the same misclassification the schema was
 * corrected of, just moved into reporting.
 *
 * The line a lender has no equivalent of is "vehicles owned" — under a
 * finance lease the institution holds the asset, not merely a claim, and
 * that is the number a lessor actually watches.
 */

const lkr = (v) =>
  v === null || v === undefined
    ? "—"
    : `LKR ${Number(v).toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;

const humanize = (s) => String(s || "").replace(/_/g, " ");

function Stat({ label, value, hint, icon: Icon, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-500",
    brand: "bg-brand-primary/10 text-brand-primary",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`p-1.5 rounded-lg ${tones[tone]}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
          {label}
        </span>
      </div>
      <p className="text-xl font-bold font-mono text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Breakdown({ title, entries, empty }) {
  const rows = Object.entries(entries || {});
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-3">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2 text-xs">
              <span className="text-slate-600 capitalize">{humanize(k)}</span>
              <span className="font-mono font-bold text-slate-800">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LeasePortfolio() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/leases/review/portfolio");
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Couldn't load the leasing portfolio.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl flex items-start gap-3 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    );
  }

  const { applications, agreements, book, title } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-2xl text-slate-900">Leasing Portfolio</h2>
        <p className="text-slate-500 text-sm mt-1.5">
          The lease book, reported separately from lending — a finance lease is a distinct
          instrument, and the institution owns the assets behind it.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Vehicles Owned"
          value={book.vehiclesOwned}
          hint={`${lkr(book.assetValue)} at purchase price`}
          icon={KeyRound}
          tone="brand"
        />
        <Stat
          label="Rentals Outstanding"
          value={lkr(book.rentalsOutstanding)}
          hint={`of ${lkr(book.rentalsDue)} due on live leases`}
          icon={Wallet}
        />
        <Stat
          label="Collection Rate"
          value={book.collectionRate === null ? "—" : `${book.collectionRate}%`}
          hint={
            book.collectionRate === null
              ? "No live leases to collect on"
              : `${lkr(book.rentalsReceived)} received`
          }
          icon={TrendingUp}
          tone={book.collectionRate !== null && book.collectionRate >= 90 ? "emerald" : "amber"}
        />
        <Stat
          label="Awaiting Review"
          value={applications.awaitingReview}
          hint={`${applications.total} applications in total`}
          icon={ClipboardList}
          tone={applications.awaitingReview > 0 ? "amber" : "slate"}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Active Leases"
          value={agreements.active}
          hint={`${agreements.completed} completed`}
          icon={Car}
          tone="emerald"
        />
        <Stat
          label="Total Financed"
          value={lkr(book.financedTotal)}
          hint="Across the whole book, live and closed"
          icon={Wallet}
        />
        <Stat
          label="Awaiting Registration"
          value={title.awaitingRegistration}
          hint="Bought but not yet titled to us"
          icon={KeyRound}
          tone={title.awaitingRegistration > 0 ? "amber" : "slate"}
        />
        <Stat
          label="Terminated / Repossessed"
          value={`${agreements.terminated} / ${agreements.repossessed}`}
          hint="Leases that did not run their course"
          icon={AlertTriangle}
          tone={agreements.repossessed > 0 ? "amber" : "slate"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Breakdown
          title="Applications by status"
          entries={applications.byStatus}
          empty="No lease applications yet."
        />
        <Breakdown
          title="Vehicle title by stage"
          entries={title.byStatus}
          empty="No vehicles registered yet."
        />
      </div>
    </div>
  );
}

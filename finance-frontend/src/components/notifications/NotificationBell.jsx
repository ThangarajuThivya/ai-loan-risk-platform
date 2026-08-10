import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Car, Banknote, Coins, Info, Check, Loader2 } from "lucide-react";
import api from "../../api/axios";

/**
 * The notification bell, shared by every portal.
 *
 * Written once because there were previously three different answers to
 * "how does this user find out something happened?": the customer had a
 * static panel on their overview page, the admin had a dropdown that could
 * only mark everything read, and STAFF HAD NOTHING AT ALL — which mattered
 * the moment leasing started sending work to the desk.
 *
 * THREE THINGS THE OLD SURFACES COULD NOT DO, all of which leasing needs:
 *
 *   1. GO SOMEWHERE. A notice said "your quotation is ready" and left the
 *      reader to find the lease. Every notification now carries a `link`
 *      and clicking one navigates, marking just that notice read.
 *   2. SEPARATE PRODUCTS. Someone with eleven unread FX notices should not
 *      have their leasing tab flagged. Counts come per category and the
 *      list can be filtered to one.
 *   3. STOP AT A PAGE. The old endpoint returned every notification a user
 *      had ever received — 4,000+ rows on this database — on every
 *      dashboard load. This asks for one page.
 *
 * Polling rather than websockets: the backend has no realtime channel, and
 * a 60-second poll of a COUNT query is the honest version of "reasonably
 * fresh" without pretending to be live.
 */

const POLL_MS = 60000;

/** Icon and accent per category. Unknown categories fall back to general. */
const CATEGORY_STYLE = {
  lease: { Icon: Car, dot: "bg-brand-primary", label: "Leasing" },
  loan: { Icon: Banknote, dot: "bg-indigo-500", label: "Loans" },
  fx: { Icon: Coins, dot: "bg-amber-500", label: "Currency" },
  general: { Icon: Info, dot: "bg-slate-400", label: "General" },
};
const styleFor = (c) => CATEGORY_STYLE[c] || CATEGORY_STYLE.general;

function timeAgo(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-LK", { day: "numeric", month: "short" });
}

export default function NotificationBell({ align = "right", tone = "light" }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ total: 0, byCategory: {} });
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const mounted = useRef(true);

  const loadCounts = useCallback(async () => {
    try {
      const res = await api.get("/notifications/unread-count");
      if (mounted.current) setCounts(res.data || { total: 0, byCategory: {} });
    } catch {
      // A failing badge must never break the page it sits on.
    }
  }, []);

  const loadItems = useCallback(async (category) => {
    setLoading(true);
    try {
      const qs = category ? `?limit=25&category=${encodeURIComponent(category)}` : "?limit=25";
      const res = await api.get(`/notifications/my-notifications${qs}`);
      if (mounted.current) setItems(Array.isArray(res.data) ? res.data : []);
    } catch {
      if (mounted.current) setItems([]);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Wrapped rather than called directly: `loadCounts` sets state, and a
    // synchronous setState in an effect body trips react-hooks'
    // cascading-render rule. The await defers it past the render pass.
    (async () => {
      await loadCounts();
    })();
    // Only the COUNT is polled. Fetching the whole list every minute for a
    // dropdown nobody has opened would be the expensive version of this.
    const t = setInterval(loadCounts, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [loadCounts]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await loadItems(filter);
  };

  const chooseFilter = async (category) => {
    setFilter(category);
    await loadItems(category);
  };

  /**
   * Clicking a notification does the obvious thing: takes you to what it is
   * about, and stops shouting about it. Marking read is optimistic — the
   * navigation should not wait on a PATCH, and a failed mark is a badge
   * that stays up, not a broken click.
   */
  const openItem = async (n) => {
    setOpen(false);
    if (!n.is_read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
      setCounts((prev) => ({
        total: Math.max(0, prev.total - 1),
        byCategory: {
          ...prev.byCategory,
          [n.category || "general"]: Math.max(0, (prev.byCategory[n.category || "general"] || 1) - 1),
        },
      }));
      api.patch(`/notifications/${n.id}/read`).catch(() => {});
    }
    if (n.link) navigate(n.link);
  };

  const markAllRead = async () => {
    if (marking) return;
    setMarking(true);
    try {
      // Scoped to the open filter: clearing "all" while looking at leasing
      // would silently wipe FX notices the reader has not seen.
      const qs = filter ? `?category=${encodeURIComponent(filter)}` : "";
      await api.patch(`/notifications/read-all${qs}`);
      setItems((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
      await loadCounts();
    } catch {
      // Leave the badge alone — it is still accurate.
    } finally {
      setMarking(false);
    }
  };

  const unread = counts.total || 0;
  const categories = Object.keys(counts.byCategory || {});

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className={`p-1.5 rounded-lg transition-all relative cursor-pointer ${
          tone === "dark"
            ? "text-white/80 hover:text-white hover:bg-white/10"
            : "text-slate-500 hover:text-brand-primary hover:bg-slate-50"
        }`}
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-[#00A86B] text-white text-[9px] font-black min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shadow-sm">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className={`absolute ${align === "right" ? "right-0" : "left-0"} mt-2 w-[22rem] max-w-[92vw] bg-white rounded-2xl border border-slate-100 shadow-2xl z-50 overflow-hidden`}
            >
              <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/60">
                <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  Notifications
                </span>
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={marking || unread === 0}
                  className="text-[10px] text-brand-primary hover:underline font-bold disabled:opacity-40 flex items-center gap-1"
                >
                  {marking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Mark {filter ? styleFor(filter).label.toLowerCase() : "all"} read
                </button>
              </div>

              {/* Only shown when there is more than one product to separate —
                  a filter row with one chip is decoration. */}
              {categories.length > 1 && (
                <div className="flex gap-1 px-3 py-2 border-b border-slate-100 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => chooseFilter(null)}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                      filter === null
                        ? "bg-brand-primary text-white border-brand-primary"
                        : "text-slate-500 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    All {unread > 0 && `(${unread})`}
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => chooseFilter(c)}
                      className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        filter === c
                          ? "bg-brand-primary text-white border-brand-primary"
                          : "text-slate-500 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {styleFor(c).label} ({counts.byCategory[c]})
                    </button>
                  ))}
                </div>
              )}

              <div className="max-h-[24rem] overflow-y-auto divide-y divide-slate-100">
                {loading && (
                  <div className="flex items-center justify-center py-10 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                )}

                {!loading && items.length === 0 && (
                  <div className="text-center py-10 px-4">
                    <Bell className="w-7 h-7 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Nothing to catch up on.</p>
                  </div>
                )}

                {!loading &&
                  items.map((n) => {
                    const { Icon, dot } = styleFor(n.category);
                    const clickable = Boolean(n.link);
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => openItem(n)}
                        disabled={!clickable && Boolean(n.is_read)}
                        className={`w-full text-left px-4 py-3 flex gap-3 transition-colors ${
                          clickable ? "hover:bg-slate-50 cursor-pointer" : "cursor-default"
                        } ${n.is_read ? "" : "bg-brand-primary/[0.04]"}`}
                      >
                        <span className="shrink-0 mt-0.5 relative">
                          <Icon className="w-4 h-4 text-slate-400" />
                          {!n.is_read && (
                            <span
                              className={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full ${dot}`}
                            />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          {n.title && (
                            <span
                              className={`block text-[11px] mb-0.5 ${
                                n.is_read ? "font-semibold text-slate-600" : "font-bold text-slate-900"
                              }`}
                            >
                              {n.title}
                            </span>
                          )}
                          <span className="block text-[11px] text-slate-500 leading-relaxed">
                            {n.message}
                          </span>
                          <span className="block text-[10px] text-slate-400 mt-1">
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

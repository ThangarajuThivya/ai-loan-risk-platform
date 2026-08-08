import { useState } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  FileStack,
  FilePlus2,
  UserCircle,
  Coins,
  MessageSquare,
  LogOut,
  Menu,
  ChevronDown,
  X,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";

// Defined at module scope (outside SidebarNav), so labels are translation
// keys resolved via t() at render time rather than literal strings.
const NAV_GROUPS = [
  {
    labelKey: "customer.layout.navOverview",
    items: [
      { to: "/dashboard", end: true, labelKey: "customer.layout.navDashboard", icon: LayoutDashboard },
    ],
  },
  {
    labelKey: "customer.layout.navLoans",
    items: [
      { to: "/dashboard/applications", end: false, labelKey: "customer.layout.navMyApplications", icon: FileStack },
      { to: "/dashboard/apply", end: false, labelKey: "customer.layout.navApplyForLoan", icon: FilePlus2 },
    ],
  },
  {
    labelKey: "customer.layout.navCurrency",
    items: [
      { to: "/dashboard/currency", end: false, labelKey: "customer.layout.navExchangeRates", icon: Coins },
    ],
  },
  {
    labelKey: "customer.layout.navSupport",
    items: [
      { to: "/dashboard/messages", end: false, labelKey: "customer.layout.navContactSupport", icon: MessageSquare },
    ],
  },
  {
    labelKey: "customer.layout.navAccount",
    items: [
      { to: "/dashboard/profile", end: false, labelKey: "customer.layout.navProfile", icon: UserCircle },
    ],
  },
];

function SidebarNav({ user, onNavigate, onLogout }) {
  const { t } = useTranslation();
  const location = useLocation();

  const findActiveGroup = () =>
    NAV_GROUPS.find((group) =>
      group.items.some((item) =>
        item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
      )
    )?.labelKey;

  // Sidebar groups behave as a single-open accordion: clicking a group's
  // header expands it and collapses whichever other group was open.
  // Defaults to (and re-syncs to) whichever group contains the current
  // route. Synced during render (not an effect) per React's "adjusting
  // state when a prop changes" pattern — avoids the extra render an
  // effect-based sync would cause.
  const [expandedGroup, setExpandedGroup] = useState(findActiveGroup);
  const [syncedPath, setSyncedPath] = useState(location.pathname);
  if (location.pathname !== syncedPath) {
    setSyncedPath(location.pathname);
    const label = findActiveGroup();
    if (label) setExpandedGroup(label);
  }

  const toggleGroup = (label) => {
    setExpandedGroup((prev) => (prev === label ? null : label));
  };

  return (
    <>
      <div className="flex items-center space-x-3 px-5 py-5 border-b border-slate-100 shrink-0">
        <div className="bg-brand-primary/10 text-brand-primary p-2 rounded-xl shrink-0">
          <UserCircle className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
            {t("customer.layout.roleLabel")}
          </p>
          <p className="text-xs font-bold text-slate-800 truncate">
            {user?.email || t("customer.layout.welcomeBack")}
          </p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-3 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const isExpanded = expandedGroup === group.labelKey;

          return (
            <div key={group.labelKey} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.labelKey)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <span>{t(group.labelKey)}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </button>
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden space-y-1"
                  >
                    {group.items.map(({ to, end, labelKey, icon: Icon }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                            isActive
                              ? "bg-brand-primary text-white shadow-sm"
                              : "text-slate-600 hover:bg-slate-50"
                          }`
                        }
                      >
                        <Icon className="w-4 h-4" />
                        <span>{t(labelKey)}</span>
                      </NavLink>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      <div className="p-3 pb-5 border-t border-slate-100 shrink-0">
        <button
          onClick={onLogout}
          type="button"
          className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>{t("customer.layout.logout")}</span>
        </button>
      </div>
    </>
  );
}

export default function CustomerLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Desktop sidebar — offset below the public site's fixed Navbar
          (h-16 + py-4 ≈ 6rem), which stays visible on the customer portal. */}
      <aside className="hidden lg:flex flex-col fixed top-24 left-0 bottom-0 w-60 bg-white border-r border-slate-100 z-30">
        <SidebarNav user={user} onLogout={handleLogout} />
      </aside>

      {/* Everything below clears the fixed Navbar via pt-24, in one place —
          individual pages don't each need to remember to pad for it. */}
      <div className="pt-24">
        {/* Mobile portal-nav bar — sticks just under the Navbar. The Navbar's
            own mobile menu only links to /dashboard; this is for switching
            between My Applications / Apply / Profile once inside it. */}
        <header className="lg:hidden sticky top-24 z-20 bg-white border-b border-slate-100 flex items-center justify-between px-4 h-14">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="bg-brand-primary/10 text-brand-primary p-1.5 rounded-lg shrink-0">
              <UserCircle className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-800 truncate">
              {user?.email || t("customer.layout.customerPortal")}
            </span>
          </div>
          <button
            onClick={() => setMobileNavOpen(true)}
            type="button"
            className="p-2 text-slate-500 hover:text-brand-primary transition-colors shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <div className="lg:pl-60 min-h-[calc(100vh-6rem)] flex flex-col">
          <div className="flex-1">
            <Outlet />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 z-50 lg:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.2 }}
              className="fixed top-0 left-0 bottom-0 w-64 bg-white z-[60] lg:hidden flex flex-col"
            >
              <div className="flex justify-end p-2 shrink-0">
                <button
                  onClick={() => setMobileNavOpen(false)}
                  type="button"
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <SidebarNav
                user={user}
                onLogout={handleLogout}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

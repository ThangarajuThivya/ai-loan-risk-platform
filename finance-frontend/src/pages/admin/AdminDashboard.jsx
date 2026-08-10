import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  Layers,
  ShieldAlert,
  MessageSquare,
  HelpCircle,
  Settings,
  UserCircle,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Grid,
  UserCog,
  Coins,
  Car,
  ArrowLeftRight,
  FileBarChart,
  BarChart3,
  Store,
  Gavel,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
// Modular view imports
import AdminDashboardHome from "../../components/admin/AdminDashboardHome";
import AdminCustomers from "../../components/admin/AdminCustomers";
import AdminStaff from "../../components/admin/AdminStaff";
import AdminApplications from "../../components/admin/AdminApplications";
import AdminProducts from "../../components/admin/AdminProducts";
import AdminRiskAnalysis from "../../components/admin/AdminRiskAnalysis";
import LeaseReviewQueue from "../../components/leasing/LeaseReviewQueue";
import LeasePortfolio from "../../components/leasing/LeasePortfolio";
import LeaseRegister from "../../components/leasing/LeaseRegister";
import AdminMessages from "../../components/admin/AdminMessages";
import AdminFaqManagement from "../../components/admin/AdminFaqManagement";
import AdminSettings from "../../components/admin/AdminSettings";
import AdminProfile from "../../components/admin/AdminProfile";
import AdminCurrency from "../../components/admin/AdminCurrency";
import AdminFxExchange from "../../components/admin/AdminFxExchange";
import AdminReports from "../../components/admin/AdminReports";
import AdminPortfolioDashboard from "../../components/admin/AdminPortfolioDashboard";
import api from "../../api/axios";
import NotificationBell from "../../components/notifications/NotificationBell";

export default function AdminDashboard() {
  const navigate = useNavigate();
  // Honours ?tab= on first render so a notification can deep-link
  // straight to the section it is about. Admin and staff have no
  // sub-routes — the whole dashboard is one component with tab state —
  // so without this a staff notification has nowhere to send anyone.
  // Read once, as the initial value: re-syncing on every location
  // change would fight the user the moment they clicked another tab.
  const [activeTab, setActiveTab] = useState(
    () => new URLSearchParams(window.location.search).get("tab") || "dashboard"
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { user, logout } = useAuth();

  const [customers, setCustomers] = useState([]);

  // K2 — the id of an application to auto-open once the Applications tab
  // mounts, so "view" from the dashboard home actually lands somewhere
  // instead of just switching tabs. AdminApplications clears this itself
  // (via onFocusHandled) once it has opened the matching row.
  const [focusApplicationId, setFocusApplicationId] = useState(null);

  // Notification dropdown state
  const [openMsgCount, setOpenMsgCount] = useState(0);

  // Profile dropdown state
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  useEffect(() => {
    const getAllCustomers = async () => {
      try {
        const res = await api.get("/admin/getAllCustomer");

        setCustomers(res.data?.customers);
      } catch (error) {
        console.log(error);
        console.log(error.response?.status);
      }
    };

    getAllCustomers();
  }, []);

  useEffect(() => {
    const getOpenMsgCount = async () => {
      try {
        const res = await api.get("/contact-messages/open-count");
        setOpenMsgCount(res.data?.count || 0);
      } catch (err) {
        console.error("GET OPEN MESSAGE COUNT ERROR:", err);
      }
    };
    getOpenMsgCount();
  }, [activeTab]);
  console.log(customers);
  const handleLogout = async () => {
    await logout();
    navigate("/");
  };


  const handleNavigate = (tab) => {
    setActiveTab(tab);
    setFocusApplicationId(null); // Clear focused entity on tab change
  };

  const handleViewApplicationFromHome = (applicationId) => {
    setFocusApplicationId(applicationId);
    setActiveTab("applications");
  };

  // Sidebar menu config, grouped into labeled sections (same pattern as the
  // customer/staff portals) instead of a flat list with one-off expandable
  // group — easier to scan, and adding/removing a section only touches this
  // array.
  const menuGroups = [
    {
      label: "Overview",
      items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      label: "People",
      items: [
        { id: "customers", label: "Customers", icon: Users },
        { id: "staff", label: "Staff", icon: UserCog },
      ],
    },
    {
      label: "Loan Management",
      items: [
        { id: "applications", label: "Applications", icon: FileSpreadsheet },
        { id: "products", label: "Products", icon: Layers },
        { id: "risk-analysis", label: "AI Risk Analysis", icon: ShieldAlert },
        { id: "portfolio-dashboard", label: "Portfolio Dashboard", icon: BarChart3 },
      ],
    },
    {
      // Peer to Loan Management, not inside it — a finance lease is a
      // distinct instrument. See ARCHITECTURE.md §9.19.
      label: "Leasing",
      items: [
        { id: "lease-applications", label: "Lease Applications", icon: Car },
        { id: "lease-portfolio", label: "Leasing Portfolio", icon: BarChart3 },
        // The two counterparty registers (L17). Kept as siblings of the
        // queue rather than buried in Settings: who we buy from and who
        // values the vehicle are operational leasing decisions, and both
        // registers were empty for as long as they had no screen.
        { id: "lease-dealers", label: "Dealers", icon: Store },
        { id: "lease-valuers", label: "Valuers", icon: Gavel },
      ],
    },
    {
      label: "Currency",
      items: [
        { id: "currency", label: "Currency Analytics", icon: Coins },
        { id: "fx-exchange", label: "FX Exchange", icon: ArrowLeftRight },
        { id: "fx-reports", label: "FX Reports", icon: FileBarChart },
      ],
    },
    {
      label: "Engagement",
      items: [
        { id: "messages", label: "Contact Messages", icon: MessageSquare },
        { id: "faq-management", label: "FAQ Management", icon: HelpCircle },
      ],
    },
    {
      label: "Account",
      items: [
        { id: "settings", label: "Settings", icon: Settings },
        { id: "profile", label: "Profile", icon: UserCircle },
      ],
    },
  ];

  // Flattened lookup — used for the breadcrumb label and the view-component
  // lookup below, so both stay in sync with menuGroups automatically instead
  // of duplicating ids.
  const flatMenuItems = menuGroups.flatMap((group) => group.items);
  const activeMenuItem = flatMenuItems.find((item) => item.id === activeTab);

  // Sidebar groups behave as a single-open accordion: clicking a group's
  // header expands it and collapses whichever other group was open.
  // Defaults to (and re-syncs to) whichever group contains the active tab,
  // so switching tabs programmatically (e.g. from the dashboard home) keeps
  // the current view's group visible. Synced during render (not an effect)
  // per React's "adjusting state when a prop changes" pattern — avoids the
  // extra render an effect-based sync would cause.
  const [expandedGroup, setExpandedGroup] = useState(
    () => menuGroups.find((group) => group.items.some((item) => item.id === activeTab))?.label
  );
  const [syncedTab, setSyncedTab] = useState(activeTab);
  if (activeTab !== syncedTab) {
    setSyncedTab(activeTab);
    const group = menuGroups.find((g) => g.items.some((item) => item.id === activeTab));
    if (group) setExpandedGroup(group.label);
  }

  const toggleGroup = (label) => {
    setExpandedGroup((prev) => (prev === label ? null : label));
  };

  // Tab id → view lookup, so adding/removing a section only means editing
  // menuItems above and this map — no new conditional branch to wire in.
  const views = {
    dashboard: () => (
      <AdminDashboardHome
        onNavigate={handleNavigate}
        onViewApplication={handleViewApplicationFromHome}
      />
    ),
    customers: () => (
      <AdminCustomers customers={customers} onUpdateCustomers={setCustomers} />
    ),
    staff: () => <AdminStaff />,
    applications: () => (
      <AdminApplications
        focusApplicationId={focusApplicationId}
        onFocusHandled={() => setFocusApplicationId(null)}
      />
    ),
    products: () => <AdminProducts />,
    "risk-analysis": () => (
      <AdminRiskAnalysis onViewApplication={handleViewApplicationFromHome} />
    ),
    "portfolio-dashboard": () => <AdminPortfolioDashboard />,
    "lease-applications": () => <LeaseReviewQueue />,
    "lease-portfolio": () => <LeasePortfolio />,
    "lease-dealers": () => <LeaseRegister kind="dealers" role="admin" />,
    "lease-valuers": () => <LeaseRegister kind="valuers" role="admin" />,
    currency: () => <AdminCurrency />,
    "fx-exchange": () => <AdminFxExchange customers={customers} />,
    "fx-reports": () => <AdminReports />,
    messages: () => <AdminMessages />,
    "faq-management": () => <AdminFaqManagement />,
    settings: () => <AdminSettings />,
    profile: () => <AdminProfile />,
  };
console.log(user)
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#1E293B] font-sans antialiased">
      {/* LEFT SIDEBAR NAVIGATION */}
      <motion.aside
        animate={{ width: isSidebarCollapsed ? "72px" : "260px" }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="h-full bg-[#0F4C81] text-white flex flex-col justify-between shrink-0 z-30 shadow-xl select-none relative"
      >
        <div>
          {/* Logo Brand Segment */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 overflow-hidden">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0 shadow">
                <Grid className="w-4.5 h-4.5 text-white" />
              </div>
              {!isSidebarCollapsed && (
                <span className="text-lg font-black tracking-tight italic text-white flex items-center">
                  Digital
                  <span className="text-emerald-400 font-extrabold not-italic ml-0.5">
                    AI
                  </span>
                </span>
              )}
            </div>

            {/* Collapse toggle arrow */}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1 hover:bg-white/15 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              {isSidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Sidebar Menu Item Scroll Area */}
          <div className="py-4 space-y-2 overflow-y-auto max-h-[calc(100vh-140px)] px-2">
            {menuGroups.map((group) => {
              // In the collapsed icon rail there's no room for a group
              // header, so every group's items stay flat/visible there —
              // the accordion only applies to the expanded sidebar.
              const isGroupExpanded = isSidebarCollapsed || expandedGroup === group.label;

              return (
                <div key={group.label} className="space-y-1">
                  {!isSidebarCollapsed && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.label)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300/70 hover:text-white transition-colors cursor-pointer"
                    >
                      <span>{group.label}</span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          isGroupExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  )}
                  <AnimatePresence initial={false}>
                    {isGroupExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden space-y-1"
                      >
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = activeTab === item.id;

                          return (
                            <button
                              key={item.id}
                              onClick={() => handleNavigate(item.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all relative group cursor-pointer ${isActive ? "bg-[#00A86B] text-white shadow-md shadow-emerald-800/20" : "text-indigo-100 hover:bg-white/10 hover:text-white"}`}
                            >
                              <Icon className="w-4.5 h-4.5 shrink-0" />
                              {!isSidebarCollapsed && <span className="flex-1 text-left">{item.label}</span>}
                              {item.id === "messages" && openMsgCount > 0 && (
                                <span
                                  className={`shrink-0 bg-[#00A86B] text-white text-[9px] font-black rounded-full flex items-center justify-center ${
                                    isSidebarCollapsed
                                      ? "absolute -top-0.5 -right-0.5 w-4.5 h-4.5"
                                      : "min-w-4.5 h-4.5 px-1"
                                  }`}
                                >
                                  {openMsgCount}
                                </span>
                              )}

                              {/* Left-side subtle border active indicator */}
                              {isActive && (
                                <span className="absolute left-1 top-2 bottom-2 w-1 bg-white rounded-full"></span>
                              )}

                              {/* Collapsed Tooltip */}
                              {isSidebarCollapsed && (
                                <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-bold tracking-wider opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-md uppercase">
                                  {item.label}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* Logout bottom boundary */}
        <div className="p-2 border-t border-white/10 bg-indigo-950/20">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 transition-all cursor-pointer"
          >
            <LogOut className="w-4.5 h-4.5 shrink-0" />
            {!isSidebarCollapsed && <span>Logout Session</span>}
            {isSidebarCollapsed && (
              <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-slate-900 text-rose-400 rounded-lg text-[10px] font-bold tracking-wider opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-md">
                LOGOUT
              </div>
            )}
          </button>
        </div>
      </motion.aside>

      {/* RIGHT CONTENT WRAPPER */}
      <div className="flex-grow flex flex-col overflow-hidden relative">
        {/* TOP NAVIGATION BAR (STICKY HEADER) */}
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0 shadow-xs z-20">
          {/* Section Breadcrumb title */}
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-mono tracking-widest text-[#0F4C81] font-bold">
              Digital Bank Admin Portal
            </span>
            <span className="text-slate-300 text-xs font-mono">/</span>
            <span className="text-xs font-bold font-mono text-slate-500 capitalize">
              {activeMenuItem?.label || activeTab.replace("-", " ")}
            </span>
          </div>

          {/* Search bar & alerts */}
          <div className="flex items-center gap-6 relative">
            {/* Real-time search */}
            <div className="relative hidden sm:block w-64">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Global telemetry query..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-850 focus:border-indigo-800 text-xs"
              />
            </div>

            {/* Replaced a bespoke dropdown that could not deep-link, could
                not separate products, and fetched every notification the
                admin had ever received on each load. See NotificationBell. */}
            <NotificationBell />

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                className="flex items-center gap-2 hover:opacity-85 transition-opacity cursor-pointer text-left"
              >
                <div className="w-8 h-8 rounded-full bg-[#0F4C81] text-white flex items-center justify-center font-bold text-xs">
                  DA
                </div>
                <div className="hidden md:block">
                  <p className="text-xs font-bold text-slate-800">
                    Admin
                  </p>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    L5 Admin
                  </p>
                </div>
              </button>

              {/* Profile dropdown overlay */}
              <AnimatePresence>
                {showProfileDropdown && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowProfileDropdown(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 mt-2 w-52 bg-white rounded-2xl border border-slate-100 shadow-xl z-50 p-2 space-y-1"
                    >
                      <button
                        onClick={() => {
                          handleNavigate("profile");
                          setShowProfileDropdown(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0F4C81] transition-all cursor-pointer"
                      >
                        <UserCircle className="w-4 h-4" /> Admin Profile
                      </button>
                      <button
                        onClick={() => {
                          handleNavigate("settings");
                          setShowProfileDropdown(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-[#0F4C81] transition-all cursor-pointer"
                      >
                        <Settings className="w-4 h-4" /> General Settings
                      </button>
                      <div className="border-t border-slate-100 my-1"></div>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-500 hover:bg-rose-50 transition-all cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" /> Terminate Session
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* MAIN VIEW CONTROLLER CANVAS STAGE */}
        <main className="flex-1 overflow-y-auto p-8 relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="h-full"
            >
              {views[activeTab]?.()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  FileSpreadsheet,
  Users,
  Layers,
  Calculator,
  Coins,
  ArrowLeftRight,
  MessageSquare,
  HelpCircle,
  UserCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Grid,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import AdminApplications from "../../components/admin/AdminApplications";
import AdminCustomers from "../../components/admin/AdminCustomers";
import AdminProducts from "../../components/admin/AdminProducts";
import AdminMessages from "../../components/admin/AdminMessages";
import AdminFaqManagement from "../../components/admin/AdminFaqManagement";
import RiskCalculator from "../../components/RiskCalculator";
import StaffCurrency from "../../components/staff/StaffCurrency";
import StaffFxExchange from "../../components/staff/StaffFxExchange";
import StaffProfile from "./StaffProfile";
import api from "../../api/axios";

// Staff scope: review + decide applications, read-only customers/products,
// the manual risk calculator, currency decision aids, and the FX exchange
// review queue — no product management, no settings.
const menuGroups = [
  {
    label: "Loan Operations",
    items: [
      { id: "applications", label: "Loan Applications", icon: FileSpreadsheet },
      { id: "risk-calculator", label: "Risk Calculator", icon: Calculator },
    ],
  },
  {
    label: "Directory",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "products", label: "Loan Products", icon: Layers },
    ],
  },
  {
    label: "Currency",
    items: [
      { id: "currency", label: "Currency", icon: Coins },
      { id: "fx-exchange", label: "FX Exchange", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Support",
    items: [
      { id: "messages", label: "Messages", icon: MessageSquare },
      { id: "faq-management", label: "FAQ Management", icon: HelpCircle },
    ],
  },
  {
    label: "Account",
    items: [{ id: "profile", label: "Profile", icon: UserCircle }],
  },
];

const menuItems = menuGroups.flatMap((group) => group.items);

export default function StaffDashboard() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [activeTab, setActiveTab] = useState("applications");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [openMsgCount, setOpenMsgCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/admin/getAllCustomer");
        if (!cancelled) setCustomers(res.data?.customers || []);
      } catch (err) {
        console.error("GET CUSTOMERS ERROR:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/contact-messages/open-count");
        if (!cancelled) setOpenMsgCount(res.data?.count || 0);
      } catch (err) {
        console.error("GET OPEN MESSAGE COUNT ERROR:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const activeLabel = menuItems.find((item) => item.id === activeTab)?.label || activeTab;

  // Sidebar groups behave as a single-open accordion: clicking a group's
  // header expands it and collapses whichever other group was open.
  // Defaults to (and re-syncs to) whichever group contains the active tab.
  // Synced during render (not an effect) per React's "adjusting state when
  // a prop changes" pattern — avoids the extra render an effect would cause.
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

  const views = {
    applications: () => <AdminApplications />,
    customers: () => (
      <AdminCustomers customers={customers} onUpdateCustomers={setCustomers} />
    ),
    products: () => <AdminProducts readOnly />,
    "risk-calculator": () => <RiskCalculator />,
    currency: () => <StaffCurrency />,
    "fx-exchange": () => <StaffFxExchange customers={customers} />,
    messages: () => <AdminMessages />,
    "faq-management": () => <AdminFaqManagement />,
    profile: () => <StaffProfile />,
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-[#1E293B] font-sans antialiased">
      {/* LEFT SIDEBAR NAVIGATION */}
      <motion.aside
        animate={{ width: isSidebarCollapsed ? "72px" : "260px" }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="h-full bg-[#0F4C81] text-white flex flex-col justify-between shrink-0 z-30 shadow-xl select-none relative"
      >
        <div>
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
                              onClick={() => setActiveTab(item.id)}
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

                              {isActive && (
                                <span className="absolute left-1 top-2 bottom-2 w-1 bg-white rounded-full"></span>
                              )}

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

        <div className="p-2 border-t border-white/10 bg-indigo-950/20">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 transition-all cursor-pointer"
          >
            <LogOut className="w-4.5 h-4.5 shrink-0" />
            {!isSidebarCollapsed && <span>Logout Session</span>}
          </button>
        </div>
      </motion.aside>

      {/* RIGHT CONTENT WRAPPER */}
      <div className="flex-grow flex flex-col overflow-hidden relative">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0 shadow-xs z-20">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-mono tracking-widest text-[#0F4C81] font-bold">
              Digital Bank Staff Portal
            </span>
            <span className="text-slate-300 text-xs font-mono">/</span>
            <span className="text-xs font-bold font-mono text-slate-500 capitalize">
              {activeLabel}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#0F4C81] text-white flex items-center justify-center font-bold text-xs">
              {(user?.email || "S").slice(0, 1).toUpperCase()}
            </div>
            <div className="hidden md:block">
              <p className="text-xs font-bold text-slate-800">{user?.email || "Staff"}</p>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                Staff
              </p>
            </div>
          </div>
        </header>

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

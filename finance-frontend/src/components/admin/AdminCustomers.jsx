import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  UserMinus,
  UserCheck,
  Edit3,
  Eye,
  X,
  CreditCard,
  Briefcase,
  Calendar,
  Phone,
  Mail,
  TrendingUp,
  User,
} from "lucide-react";
import api from "../../api/axios";

export default function AdminCustomers({ customers, onUpdateCustomers }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Selected customer for modal
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // Local edit states
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editIncome, setEditIncome] = useState(0);
  const [editCreditScore, setEditCreditScore] = useState(650);

  // Search and filter logic
  const filteredCustomers = customers.filter((cust) => {
    const matchesSearch =
      cust.first_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cust.user_id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || cust.status === statusFilter;
    const matchesEmployment =
      employmentFilter === "all" || cust.employment_type === employmentFilter;

    return matchesSearch && matchesStatus && matchesEmployment;
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredCustomers.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(
    startIndex,
    startIndex + itemsPerPage,
  );

  const handlePageChange = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handleToggleStatus = (id) => {
    const updated = customers.map((c) => {
      if (c.id === id) {
        return {
          ...c,
          status: c.status === "active" ? "inactive" : "active" | "inactive",
        };
      }
      return c;
    });
    onUpdateCustomers(updated);

    // Also update modal details if open
    if (selectedCustomer && selectedCustomer.id === id) {
      setSelectedCustomer((prev) =>
        prev
          ? {
              ...prev,
              status: prev.status === "active" ? "inactive" : "active",
            }
          : null,
      );
    }
  };

  const handleOpenView = (customer) => {
    setSelectedCustomer(customer);
    setIsEditing(false);
  };

  const handleOpenEdit = (customer) => {
    setSelectedCustomer(customer);
    setIsEditing(true);
    setEditName(customer.name);
    setEditEmail(customer.email);
    setEditPhone(customer.phone);
    setEditIncome(customer.income);
    setEditCreditScore(customer.creditScore);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    const updated = customers.map((c) => {
      if (c.id === selectedCustomer.id) {
        return {
          ...c,
          name: editName,
          email: editEmail,
          phone: editPhone,
          income: Number(editIncome),
          creditScore: Number(editCreditScore),
        };
      }
      return c;
    });

    onUpdateCustomers(updated);
    setSelectedCustomer(null);
    setIsEditing(false);
  };

  const employmentTypes = [
    "all",
    "Salaried Employee",
    "Self-Employed",
    "Business Owner",
    "Contractor",
  ];

  return (
    <div className="space-y-6">
      {/* Search and Filters Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
        <div className="relative flex-1 max-w-md">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-5 h-5" />
          </span>
          <input
            type="text"
            placeholder="Search customer name, email, or ID..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1); // Reset page on query change
            }}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800 transition-all text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-transparent text-xs text-slate-600 font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Members</option>
              <option value="inactive">Suspended</option>
            </select>
          </div>

          {/* Employment Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
            <Briefcase className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={employmentFilter}
              onChange={(e) => {
                setEmploymentFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-transparent text-xs text-slate-600 font-semibold focus:outline-none cursor-pointer"
            >
              {employmentTypes.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All Roles" : t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Customer Listing */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                <th className="px-6 py-3.5">Member Details</th>
                <th className="px-6 py-3.5">Contact Email</th>
                <th className="px-6 py-3.5">Monthly Income</th>
                <th className="px-6 py-3.5 text-center">FICO Score</th>
                <th className="px-6 py-3.5">Role Type</th>
                <th className="px-6 py-3.5 text-center">Status</th>
                <th className="px-6 py-3.5 text-right">
                  Administrative Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {paginatedCustomers.length > 0 ? (
                paginatedCustomers.map((cust) => {
                  const isActive = cust.status === "active";

                  // Score color mapping
                  let scoreColor = "text-red-600 bg-red-50";
                  if (cust.creditScore >= 740)
                    scoreColor = "text-emerald-600 bg-emerald-50";
                  else if (cust.creditScore >= 640)
                    scoreColor = "text-amber-600 bg-amber-50";

                  return (
                    <tr
                      key={cust.user_id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full overflow-hidden bg-indigo-50 shadow-inner">
                            <img
                              src={`http://localhost:5000${cust.profile_image}`}
                              alt={cust.first_name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-800">{`${cust.first_name} ${cust.last_name} `}</div>
                            <div className="text-[11px] font-mono text-indigo-900">
                              {cust.user_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {cust.email}
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-800">
                        ${cust.monthly_income}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-md ${scoreColor}`}
                        >
                          {cust.creditScore}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg border border-slate-200">
                          {cust.employment_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-50 text-slate-400 border-slate-200"}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-300"}`}
                          ></span>
                          {isActive ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenView(cust)}
                            className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
                            title="Quick View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(cust)}
                            className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-indigo-600 rounded-lg transition-colors"
                            title="Modify Customer Fields"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(cust.id)}
                            className={`p-1.5 rounded-lg transition-colors ${isActive ? "hover:bg-red-50 text-slate-400 hover:text-red-500" : "hover:bg-emerald-50 text-slate-400 hover:text-emerald-500"}`}
                            title={
                              isActive
                                ? "Deactivate Account"
                                : "Activate Account"
                            }
                          >
                            {isActive ? (
                              <UserMinus className="w-4 h-4" />
                            ) : (
                              <UserCheck className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-12 text-center text-slate-400"
                  >
                    No customers found matching the filtered telemetry criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Section */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3 bg-slate-50/20 text-xs">
            <span className="text-slate-500 font-medium">
              Showing{" "}
              <span className="text-slate-800 font-bold">{startIndex + 1}</span>{" "}
              to{" "}
              <span className="text-slate-800 font-bold">
                {Math.min(startIndex + itemsPerPage, filteredCustomers.length)}
              </span>{" "}
              of{" "}
              <span className="text-slate-800 font-bold">
                {filteredCustomers.length}
              </span>{" "}
              profiles
            </span>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => handlePageChange(i + 1)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all border ${currentPage === i + 1 ? "bg-indigo-900 text-white border-indigo-900 shadow-sm shadow-indigo-950/10" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details or Edit Modal overlay */}
      <AnimatePresence>
        {selectedCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-xl border border-slate-100 w-full max-w-xl overflow-hidden relative"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/60">
                <h3 className="font-bold text-lg text-slate-900">
                  {isEditing
                    ? "Modify Customer Profile"
                    : "Customer Audit Profile"}
                </h3>
                <button
                  onClick={() => setSelectedCustomer(null)}
                  className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content body */}
              {isEditing ? (
                <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Customer Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        FICO Credit Score
                      </label>
                      <input
                        type="number"
                        min="300"
                        max="850"
                        required
                        value={editCreditScore}
                        onChange={(e) =>
                          setEditCreditScore(Number(e.target.value))
                        }
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Phone Line
                      </label>
                      <input
                        type="text"
                        required
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Monthly Income ($)
                      </label>
                      <input
                        type="number"
                        required
                        value={editIncome}
                        onChange={(e) => setEditIncome(Number(e.target.value))}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-indigo-900 text-white rounded-xl text-sm font-semibold hover:bg-indigo-950 shadow-md cursor-pointer"
                    >
                      Save Modifications
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-6 space-y-6">
                  {/* Top Header Card */}
                  <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-900 text-white flex items-center justify-center font-black text-xl">
                      <img
                        src={`http://localhost:5000${selectedCustomer.profile_image}`}
                        alt={selectedCustomer.first_name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-slate-900">
                        {`${selectedCustomer.first_name} ${selectedCustomer.last_name}`}
                      </h4>
                      <span className="text-xs font-mono text-indigo-900 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md font-bold">
                        ID: {selectedCustomer.user_id}
                      </span>
                    </div>
                    <div className="ml-auto">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full border ${selectedCustomer.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100"}`}
                      >
                        {selectedCustomer.status === "active"
                          ? "ACTIVE MEMBER"
                          : "DEACTIVATED"}
                      </span>
                    </div>
                  </div>

                  {/* Profile properties */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-start gap-3">
                      <Mail className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Email Address
                        </p>
                        <p className="font-semibold text-slate-700 text-sm font-mono truncate max-w-[200px]">
                          {selectedCustomer.email}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-start gap-3">
                      <Phone className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Phone Line
                        </p>
                        <p className="font-semibold text-slate-700 text-sm font-mono">
                          {selectedCustomer.phone}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-start gap-3">
                      <CreditCard className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Estimated Monthly Income
                        </p>
                        <p className="font-bold text-emerald-700 text-base">
                          ${selectedCustomer.monthly_income}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-start gap-3">
                      <TrendingUp className="w-5 h-5 text-indigo-900 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          FICO Credit Score
                        </p>
                        <p className="font-bold text-slate-700 text-base flex items-center gap-1.5">
                          {selectedCustomer.creditScore}
                          <span className="text-xs font-medium text-slate-400">
                            (
                            {selectedCustomer.creditScore >= 740
                              ? "Excellent"
                              : selectedCustomer.creditScore >= 640
                                ? "Fair"
                                : "Subprime"}
                            )
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-start gap-3">
                      <Briefcase className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Employment Sector
                        </p>
                        <p className="font-semibold text-slate-700 text-sm">
                          {selectedCustomer.employment_type}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-start gap-3">
                      <Calendar className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          Membership Joined
                        </p>
                        <p className="font-semibold text-slate-700 text-sm font-mono">
                          {selectedCustomer.created_at}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex gap-3 justify-end">
                    <button
                      onClick={() => handleToggleStatus(selectedCustomer.id)}
                      className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all cursor-pointer ${selectedCustomer.status === "active" ? "border-red-200 text-red-600 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
                    >
                      {selectedCustomer.status === "active"
                        ? "Suspend Profile"
                        : "Unsuspend Profile"}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(selectedCustomer)}
                      className="px-5 py-2 bg-indigo-900 text-white rounded-xl text-sm font-bold hover:bg-indigo-950 shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" /> Edit Profile
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

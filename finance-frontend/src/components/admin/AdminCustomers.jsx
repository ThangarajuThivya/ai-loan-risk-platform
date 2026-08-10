import { useState } from "react";
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
  Check,
  CreditCard,
  Briefcase,
  Calendar,
  Phone,
  Mail,
  IdCard,
  Trash2,
  Loader2,
} from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../toast/useToast";

const KYC_BADGE = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-100",
  rejected: "bg-rose-50 text-rose-700 border-rose-100",
};
const KYC_LABEL = { pending: "Pending review", verified: "Verified", rejected: "Rejected" };

export default function AdminCustomers({ customers, onUpdateCustomers }) {
  const { showToast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Selected customer for modal
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // KYC verify/reject (E2)
  const [kycBusy, setKycBusy] = useState(false);
  const [kycRejecting, setKycRejecting] = useState(false);
  const [kycNote, setKycNote] = useState("");
  const [kycError, setKycError] = useState("");

  const submitKyc = async (kycStatus, notes) => {
    if (!selectedCustomer) return;
    setKycBusy(true);
    setKycError("");
    try {
      const res = await api.patch(`/admin/customers/${selectedCustomer.user_id}/kyc/verify`, {
        kyc_status: kycStatus,
        kyc_notes: notes || undefined,
      });
      const updated = { ...selectedCustomer, ...res.data };
      setSelectedCustomer(updated);
      setKycRejecting(false);
      setKycNote("");
      onUpdateCustomers(
        customers.map((c) => (c.user_id === updated.user_id ? { ...c, ...res.data } : c))
      );
    } catch (err) {
      setKycError(err.response?.data?.message || "Couldn't update this customer's KYC status.");
    } finally {
      setKycBusy(false);
    }
  };

  // Bank accounts held with this bank (039). Loaded lazily when a customer's
  // drawer is opened, since the customers list itself doesn't carry them.
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountForm, setAccountForm] = useState({ branch: "", number: "", holder: "" });

  const loadAccounts = async (userId) => {
    setAddingAccount(false);
    setAccountsError("");
    setAccounts([]);
    setAccountForm({ branch: "", number: "", holder: "" });
    if (!userId) return;
    setAccountsLoading(true);
    try {
      const res = await api.get(`/admin/customers/${userId}/bank-accounts`);
      setAccounts(res.data?.accounts || []);
    } catch (err) {
      setAccountsError(err.response?.data?.message || "Couldn't load this customer's accounts.");
    } finally {
      setAccountsLoading(false);
    }
  };

  // Register an account the customer already holds at a branch. Staff-only:
  // they can check the number against core banking first, which is the only
  // thing that makes a hand-typed account number trustworthy. Without this,
  // a long-standing walk-in customer applying online has a duplicate account
  // issued to them the moment they accept an offer.
  const submitAccount = async (e) => {
    e.preventDefault();
    if (!selectedCustomer || accountBusy) return;
    setAccountBusy(true);
    setAccountsError("");
    try {
      const res = await api.post(`/admin/customers/${selectedCustomer.user_id}/bank-accounts`, {
        branch: accountForm.branch.trim(),
        account_number: accountForm.number.trim(),
        account_holder: accountForm.holder.trim(),
      });
      setAccounts((prev) => [res.data, ...prev]);
      setAccountForm({ branch: "", number: "", holder: "" });
      setAddingAccount(false);
    } catch (err) {
      setAccountsError(err.response?.data?.message || "Couldn't register that account.");
    } finally {
      setAccountBusy(false);
    }
  };

  // Local edit states
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editIncome, setEditIncome] = useState(0);
  const [editBusy, setEditBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  // Permanent delete — separate from status, and a lot more careful about
  // it. Confirmed via a modal like AdminStaff's, and the server itself
  // refuses (409) any account with a loan or lease application on file, so
  // the error path here is a real, expected outcome, not just a network
  // failure.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  // Search and filter logic. user_id is a number, not a string — String()
  // it before searching rather than calling .toLowerCase() directly on it
  // (that used to throw the moment any customer had a non-empty list,
  // since numbers have no .toLowerCase method).
  const filteredCustomers = customers.filter((cust) => {
    const query = searchTerm.toLowerCase();
    const matchesSearch =
      (cust.first_name || "").toLowerCase().includes(query) ||
      (cust.last_name || "").toLowerCase().includes(query) ||
      (cust.email || "").toLowerCase().includes(query) ||
      String(cust.user_id).includes(query);

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

  // Real activate/suspend (K3) — this used to only rewrite local React
  // state (and even that was broken: it matched on `c.id`, a field that
  // does not exist on a customer row, so the click did nothing at all,
  // not even locally). Mirrors submitKyc's pattern: call the endpoint,
  // then fold the server's own response back into state so the UI never
  // shows an optimistic value the database didn't actually accept.
  const handleToggleStatus = async (userId, currentStatus) => {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      const nextStatus = currentStatus === "active" ? "inactive" : "active";
      const res = await api.patch(`/admin/customers/${userId}/status`, {
        status: nextStatus,
      });
      onUpdateCustomers(
        customers.map((c) => (c.user_id === userId ? { ...c, ...res.data } : c))
      );
      if (selectedCustomer && selectedCustomer.user_id === userId) {
        setSelectedCustomer((prev) => (prev ? { ...prev, ...res.data } : null));
      }
      showToast({
        type: "success",
        title: nextStatus === "active" ? "Account Reactivated" : "Account Suspended",
        message: `${res.data.email} is now ${nextStatus}.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Status Update Failed",
        message: err.response?.data?.message || "Couldn't update this customer's status.",
      });
    } finally {
      setStatusBusy(false);
    }
  };

  const confirmDeleteCustomer = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.user_id);
    setDeleteError("");
    try {
      await api.delete(`/admin/customers/${pendingDelete.user_id}`);
      onUpdateCustomers(customers.filter((c) => c.user_id !== pendingDelete.user_id));
      if (selectedCustomer && selectedCustomer.user_id === pendingDelete.user_id) {
        setSelectedCustomer(null);
      }
      showToast({
        type: "success",
        title: "Customer Deleted",
        message: `${pendingDelete.email} was permanently removed.`,
      });
      setPendingDelete(null);
    } catch (err) {
      // A 409 here is the server's financial-history guard, not a bug — it
      // is shown inline in the confirmation dialog rather than as a toast,
      // since it's the answer to the exact question this dialog is asking.
      setDeleteError(
        err.response?.data?.message || "Couldn't delete this customer account."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenView = (customer) => {
    setSelectedCustomer(customer);
    setIsEditing(false);
    setKycRejecting(false);
    setKycNote("");
    setKycError("");
    loadAccounts(customer?.user_id);
  };

  const handleOpenEdit = (customer) => {
    setSelectedCustomer(customer);
    setIsEditing(true);
    setEditFirstName(customer.first_name || "");
    setEditLastName(customer.last_name || "");
    setEditEmail(customer.email || "");
    setEditPhone(customer.phone || "");
    setEditIncome(customer.monthly_income ?? 0);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer || editBusy) return;
    setEditBusy(true);
    try {
      const res = await api.patch(`/admin/customers/${selectedCustomer.user_id}`, {
        firstName: editFirstName.trim(),
        lastName: editLastName.trim() || undefined,
        email: editEmail.trim(),
        phone: editPhone.trim() || undefined,
        monthlyIncome: editIncome !== "" ? Number(editIncome) : undefined,
      });
      onUpdateCustomers(
        customers.map((c) =>
          c.user_id === selectedCustomer.user_id ? { ...c, ...res.data } : c
        )
      );
      showToast({
        type: "success",
        title: "Customer Updated",
        message: `${res.data.email} was updated.`,
      });
      setSelectedCustomer(null);
      setIsEditing(false);
    } catch (err) {
      showToast({
        type: "error",
        title: "Update Failed",
        message: err.response?.data?.message || "Couldn't save these changes.",
      });
    } finally {
      setEditBusy(false);
    }
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
                <th className="px-6 py-3.5">Role Type</th>
                <th className="px-6 py-3.5 text-center">KYC</th>
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
                      <td className="px-6 py-4">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg border border-slate-200">
                          {cust.employment_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {cust.kyc_status ? (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${KYC_BADGE[cust.kyc_status]}`}
                          >
                            {KYC_LABEL[cust.kyc_status]}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
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
                            onClick={() => handleToggleStatus(cust.user_id, cust.status)}
                            disabled={statusBusy}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${isActive ? "hover:bg-red-50 text-slate-400 hover:text-red-500" : "hover:bg-emerald-50 text-slate-400 hover:text-emerald-500"}`}
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
                          <button
                            onClick={() => {
                              setDeleteError("");
                              setPendingDelete(cust);
                            }}
                            disabled={deletingId === cust.user_id}
                            className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors disabled:opacity-40"
                            title="Delete Permanently"
                          >
                            {deletingId === cust.user_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
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
                        First Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-800/10 focus:border-indigo-800"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-500 uppercase">
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
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
                      disabled={editBusy}
                      className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editBusy}
                      className="px-5 py-2 bg-indigo-900 text-white rounded-xl text-sm font-semibold hover:bg-indigo-950 shadow-md cursor-pointer disabled:opacity-50"
                    >
                      {editBusy ? "Saving…" : "Save Modifications"}
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

                  {/* National ID + KYC verification (E2) — advisory only,
                      doesn't touch loan_applications or the credit policy
                      engine. */}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <IdCard className="w-5 h-5 text-slate-500 shrink-0" />
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                            National ID
                          </p>
                          <p className="font-mono font-semibold text-slate-700 text-sm">
                            {selectedCustomer.national_id || "Not provided"}
                          </p>
                        </div>
                      </div>
                      {selectedCustomer.kyc_status ? (
                        <span
                          className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${KYC_BADGE[selectedCustomer.kyc_status]}`}
                        >
                          {KYC_LABEL[selectedCustomer.kyc_status]}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">No NIC submitted yet</span>
                      )}
                    </div>

                    {selectedCustomer.kyc_notes && (
                      <p className="text-[11px] text-slate-500 italic">"{selectedCustomer.kyc_notes}"</p>
                    )}

                    {kycError && <p className="text-[11px] text-rose-600">{kycError}</p>}

                    {selectedCustomer.kyc_status === "pending" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => submitKyc("verified")}
                          disabled={kycBusy}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" /> Verify Identity
                        </button>
                        <button
                          type="button"
                          onClick={() => setKycRejecting((v) => !v)}
                          disabled={kycBusy}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    )}

                    {kycRejecting && (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={kycNote}
                          onChange={(e) => setKycNote(e.target.value)}
                          placeholder="Reason for rejection…"
                          maxLength={500}
                          className="flex-1 px-2.5 py-1.5 text-xs border border-rose-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-rose-400"
                        />
                        <button
                          type="button"
                          onClick={() => submitKyc("rejected", kycNote.trim())}
                          disabled={kycBusy || !kycNote.trim()}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50"
                        >
                          Confirm
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Accounts held with this bank (039). An account is opened
                      automatically when the customer accepts a loan offer, so
                      an empty list here is normal for someone who has never
                      borrowed — it is not a task waiting on staff.

                      "Add existing account" exists for one case only: a
                      customer who already banks here but whose account this
                      platform never issued. Without it they look brand-new to
                      the find-or-open step and get a SECOND account opened at
                      their next offer acceptance. Staff-only because staff can
                      check the number against core banking first. */}
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3">
                        <CreditCard className="w-5 h-5 text-slate-500 shrink-0" />
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                            Accounts with this bank
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Where this customer's loans are disbursed
                          </p>
                        </div>
                      </div>
                      {!addingAccount && (
                        <button
                          type="button"
                          onClick={() => setAddingAccount(true)}
                          className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                        >
                          + Add existing account
                        </button>
                      )}
                    </div>

                    {accountsLoading ? (
                      <p className="text-[11px] text-slate-400">Loading accounts…</p>
                    ) : accounts.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        No accounts on file. One will be opened automatically when this customer
                        accepts a loan offer.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {accounts.map((acc) => (
                          <li
                            key={acc.id}
                            className="bg-white border border-slate-100 rounded-xl px-3 py-2 flex items-center justify-between gap-3 flex-wrap"
                          >
                            <div>
                              <p className="font-mono text-sm font-bold text-slate-800">
                                {acc.account_number}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {acc.branch} · {acc.account_holder} ·{" "}
                                {acc.opened_via === "staff_registered"
                                  ? "Registered by staff"
                                  : "Opened on offer acceptance"}
                              </p>
                            </div>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                acc.status === "active"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                  : "bg-slate-100 text-slate-500 border-slate-200"
                              }`}
                            >
                              {acc.status === "active" ? "Active" : "Closed"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {accountsError && (
                      <p className="text-[11px] text-rose-600">{accountsError}</p>
                    )}

                    {addingAccount && (
                      <form onSubmit={submitAccount} className="space-y-2 pt-1">
                        <p className="text-[11px] text-slate-500">
                          Only for an account this customer already holds at a branch. Confirm the
                          number in core banking before saving.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={accountForm.branch}
                            onChange={(e) =>
                              setAccountForm((p) => ({ ...p, branch: e.target.value }))
                            }
                            placeholder="Branch"
                            maxLength={100}
                            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            value={accountForm.number}
                            onChange={(e) =>
                              setAccountForm((p) => ({
                                ...p,
                                // Digits only client-side; the server is the
                                // real authority (validateRegistration).
                                number: e.target.value.replace(/\D/g, "").slice(0, 20),
                              }))
                            }
                            placeholder="Account number"
                            className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                          <input
                            type="text"
                            value={accountForm.holder}
                            onChange={(e) =>
                              setAccountForm((p) => ({ ...p, holder: e.target.value }))
                            }
                            placeholder="Account holder"
                            maxLength={150}
                            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={
                              accountBusy ||
                              !accountForm.branch.trim() ||
                              !accountForm.holder.trim() ||
                              !/^[0-9]{6,20}$/.test(accountForm.number)
                            }
                            className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-900 hover:bg-indigo-950 rounded-lg disabled:opacity-50"
                          >
                            Save account
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingAccount(false);
                              setAccountsError("");
                            }}
                            disabled={accountBusy}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex gap-3 justify-end">
                    <button
                      onClick={() => {
                        setDeleteError("");
                        setPendingDelete(selectedCustomer);
                      }}
                      disabled={deletingId === selectedCustomer.user_id}
                      className="px-4 py-2 text-sm font-semibold rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" /> Delete Permanently
                    </button>
                    <button
                      onClick={() =>
                        handleToggleStatus(selectedCustomer.user_id, selectedCustomer.status)
                      }
                      disabled={statusBusy}
                      className={`px-4 py-2 text-sm font-semibold rounded-xl border transition-all cursor-pointer disabled:opacity-50 ${selectedCustomer.status === "active" ? "border-red-200 text-red-600 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
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

      {/* Permanent delete confirmation. The server enforces the real rule
          (an account with any loan/lease application is refused, 409) —
          this dialog exists so a genuine mistake needs a second click, not
          to duplicate that check client-side. */}
      <AnimatePresence>
        {pendingDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900">Delete Customer Account</h3>
              </div>

              <p className="text-sm text-slate-600 mb-4">
                Permanently delete{" "}
                <span className="font-semibold text-slate-800">
                  {pendingDelete.first_name} {pendingDelete.last_name}
                </span>{" "}
                ({pendingDelete.email})? This erases the account and cannot be undone. If
                they've ever applied for a loan or lease, this will be refused — deactivate
                the account instead so that history is kept.
              </p>

              {deleteError && (
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 mb-4">
                  {deleteError}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setPendingDelete(null)}
                  disabled={deletingId === pendingDelete.user_id}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteCustomer}
                  disabled={deletingId === pendingDelete.user_id}
                  className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                >
                  {deletingId === pendingDelete.user_id && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { Routes, Route } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

import AdminDashboard from "../pages/admin/AdminDashboard";
import StaffDashboard from "../pages/staff/StaffDashboard";
import CustomerLayout from "../pages/customer/CustomerLayout";
import CustomerOverview from "../pages/customer/CustomerOverview";
import MyApplications from "../pages/customer/MyApplications";
import LoanApplication from "../pages/customer/LoanApplication";
import CustomerProfile from "../pages/customer/CustomerProfile";
import CustomerCurrency from "../pages/customer/CustomerCurrency";
import CurrencyExchange from "../pages/customer/CurrencyExchange";
import MyExchangeRequests from "../pages/customer/MyExchangeRequests";
import ExchangeRequestDetail from "../pages/customer/ExchangeRequestDetail";
import CustomerMessages from "../pages/customer/CustomerMessages";
import MessageThreadDetail from "../pages/customer/MessageThreadDetail";

export default function DashboardRouter() {
  const { user } = useAuth();

  if (!user) return null;

  switch (user.role) {
    case "admin":
      return <AdminDashboard />;

    case "staff":
      return <StaffDashboard />;

    case "customer":
      return (
        <Routes>
          <Route element={<CustomerLayout />}>
            <Route index element={<CustomerOverview />} />
            <Route path="applications" element={<MyApplications />} />
            <Route path="apply" element={<LoanApplication />} />
            <Route path="currency" element={<CustomerCurrency />} />
            <Route path="currency/exchange" element={<CurrencyExchange />} />
            <Route path="currency/exchange/requests" element={<MyExchangeRequests />} />
            <Route path="currency/exchange/requests/:ref" element={<ExchangeRequestDetail />} />
            <Route path="messages" element={<CustomerMessages />} />
            <Route path="messages/:id" element={<MessageThreadDetail />} />
            <Route path="profile" element={<CustomerProfile />} />
          </Route>
        </Routes>
      );

    default:
      return <h1>Unauthorized</h1>;
  }
}

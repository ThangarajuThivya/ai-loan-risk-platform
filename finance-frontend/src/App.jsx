import { useState } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Navbar from "./components/Navbar";
import About from "./pages/About";
import Loans from "./pages/Loans";
import Eligibility from "./pages/Eligibility";
import EmiCalculator from "./pages/EmiCalculator";
import AiFeatures from "./pages/AiFeatures";
import Faq from "./pages/Faq";
import Contact from "./pages/Contact";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import AdminDashboard from "./pages/admin/AdminDashboard";
import DashboardRouter from "./auth/DashboardRouter";
import ProtectedRoute from "./auth/ProtectedRoute";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import AuthRedirect from "./auth/AuthRedirect";

function AppContent() {
  const location = useLocation();
  const { user } = useAuth();
  // Admin and staff render their own full app shell (sidebar + header), with
  // no room for the public marketing Navbar/Footer. The customer portal is
  // lighter-weight by design and keeps the public header — it's still the
  // main site, just with an authenticated section added to it, so customers
  // can still reach Home/Loans/Contact/etc. without leaving their dashboard.
  const isFullShellPortal =
    location.pathname.startsWith("/admin") ||
    (location.pathname.startsWith("/dashboard") && user?.role === "staff");
  // The customer portal keeps the public Navbar but owns its own Footer
  // placement (inside CustomerLayout's padded content column) so it isn't
  // rendered under the fixed sidebar — see CustomerLayout.jsx.
  const hideGlobalFooter =
    isFullShellPortal || location.pathname.startsWith("/dashboard");
  return (
    <div className="flex flex-col min-h-screen bg-brand-bg font-sans selection:bg-brand-accent selection:text-white">
      {/* Navigation Head (hidden on admin/staff portals) */}
      {!isFullShellPortal && <Navbar />}
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/eligibility" element={<Eligibility />} />
          <Route path="/emi-calculator" element={<EmiCalculator />} />
          <Route path="/ai-features" element={<AiFeatures />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route
            path="/dashboard/*"
            element={
              <ProtectedRoute>
                <DashboardRouter />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={["admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      {/* Footer info panel (hidden on admin/staff/customer portals — customer
          renders its own inside CustomerLayout) */}
      {!hideGlobalFooter && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthRedirect>
        <AppContent />
        </AuthRedirect>
      </AuthProvider>
    </BrowserRouter>
  );
}

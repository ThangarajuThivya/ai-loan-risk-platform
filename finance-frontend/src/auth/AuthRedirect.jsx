import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

// Only bounce an already-authenticated user away from the auth-only pages.
// This must NOT fire on every route change, or it hijacks in-app navigation
// (e.g. to marketing pages or /apply) and redirects the user back to /dashboard
// mid-navigation.
const AUTH_ONLY_PATHS = ["/login", "/register"];

export default function AuthRedirect({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    if (!AUTH_ONLY_PATHS.includes(location.pathname)) return;

    switch (user.role) {
      case "admin":
        navigate("/admin", { replace: true });
        break;

      case "staff":
      case "customer":
        navigate("/dashboard", { replace: true });
        break;
    }
  }, [user, location.pathname, navigate]);

  return children;
}
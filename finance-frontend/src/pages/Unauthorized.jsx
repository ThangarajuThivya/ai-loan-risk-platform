import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

// Reached only when a logged-in user's role doesn't match a route's
// required roles (see ProtectedRoute) — a logged-out visitor is sent to
// /login instead, never here. Previously ProtectedRoute redirected here on
// a permission mismatch but no route rendered anything for this path, so
// the visitor just saw a blank page instead of an explanation.
const HOME_BY_ROLE = {
  admin: "/admin",
  staff: "/staff",
  customer: "/dashboard",
};

export default function Unauthorized() {
  const { user } = useAuth();
  const homePath = HOME_BY_ROLE[user?.role] || "/";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-brand-bg text-center">
      <div className="w-16 h-16 rounded-2xl bg-rose-100 flex items-center justify-center mb-6">
        <ShieldAlert className="w-8 h-8 text-rose-500" />
      </div>
      <h1 className="font-display font-bold text-2xl text-slate-900">
        You don't have access to this page
      </h1>
      <p className="text-sm text-slate-500 mt-2 max-w-md">
        Your account doesn't have permission to view that section. If you
        think this is a mistake, contact your administrator.
      </p>
      <Link
        to={homePath}
        className="mt-6 px-6 py-3 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary/95 transition-colors"
      >
        Go to my dashboard
      </Link>
    </div>
  );
}

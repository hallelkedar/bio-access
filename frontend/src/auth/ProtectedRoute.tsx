import { Navigate, Outlet, useLocation } from "react-router";

import type { Role } from "../api/types";
import { Spinner } from "../components/Spinner";
import { useAuth } from "./AuthContext";
import { HOME_BY_ROLE } from "./roles";

/**
 * Shows child routes only to logged-in users with one of the given roles. Logged-out users
 * go to /login (and come back afterwards); a wrong role goes to that role's own home.
 * Convenience only: the backend enforces every role on every request.
 */
export function ProtectedRoute({ roles }: { roles: Role[] }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <Spinner />;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!roles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  }
  return <Outlet />;
}

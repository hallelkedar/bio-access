import { Navigate, Outlet, useLocation } from "react-router";

import type { Role } from "../api/types";
import { Spinner } from "../components/Spinner";
import { useAuth } from "./AuthContext";

/**
 * Shows child routes only to logged-in users with one of the given roles.
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
    return (
      <section>
        <h1 className="text-2xl font-bold">Not allowed</h1>
        <p className="mt-2 text-slate-600">Your account can't open this page.</p>
      </section>
    );
  }
  return <Outlet />;
}

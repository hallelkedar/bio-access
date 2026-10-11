import { Outlet } from "react-router";

/** Admin pages share the header nav; this wrapper keeps a spot for admin-only chrome. */
export function AdminLayout() {
  return <Outlet />;
}

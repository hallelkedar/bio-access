import { NavLink, Outlet } from "react-router";

const SECTIONS = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/events", label: "Events" },
  { to: "/admin/logs", label: "Logs" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/settings", label: "Settings" },
];

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav aria-label="Admin" className="flex gap-2 overflow-x-auto md:w-44 md:flex-col md:gap-1">
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`
            }
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

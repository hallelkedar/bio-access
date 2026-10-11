import { Link, NavLink, Outlet, type RouteObject } from "react-router";

import type { Role } from "./api/types";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { HOME_BY_ROLE } from "./auth/roles";
import { LanguageProvider } from "./i18n/LanguageProvider";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { EventsAdminPage } from "./pages/admin/EventsAdminPage";
import { LogsPage } from "./pages/admin/LogsPage";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { GatePage } from "./pages/gate/GatePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { CheckoutCancelPage, CheckoutSuccessPage } from "./pages/user/CheckoutResultPages";
import { EnrollPage } from "./pages/user/EnrollPage";
import { EventsPage } from "./pages/user/EventsPage";
import { MyTicketsPage } from "./pages/user/MyTicketsPage";

const NAV_BY_ROLE: Record<Role, { to: string; label: string }[]> = {
  USER: [
    { to: "/events", label: "Events" },
    { to: "/tickets", label: "My tickets" },
  ],
  GATEKEEPER: [],
  ADMIN: [],
};

function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link to={user ? HOME_BY_ROLE[user.role] : "/"} className="text-lg font-semibold">
          BioAccess
        </Link>
        {user &&
          NAV_BY_ROLE[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `text-sm ${isActive ? "font-semibold text-slate-900" : "text-slate-600"}`}
            >
              {item.label}
            </NavLink>
          ))}
        <div className="ml-auto flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="text-slate-600">
                {user.full_name} <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{user.role}</span>
              </span>
              <button type="button" onClick={logout} className="text-blue-700 underline">
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-blue-700 underline">Log in</Link>
              <Link to="/register" className="text-blue-700 underline">Register</Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

function RootLayout() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <Header />
          <main className="mx-auto max-w-5xl px-4 py-8">
            <Outlet />
          </main>
        </div>
      </AuthProvider>
    </LanguageProvider>
  );
}

function Home() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Welcome to BioAccess</h1>
      <p className="mt-2 text-slate-600">Face-recognition entry for your events.</p>
    </section>
  );
}

function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2">
        <Link to="/" className="text-blue-700 underline">Back home</Link>
      </p>
    </section>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      {
        element: <ProtectedRoute roles={["USER"]} />,
        children: [
          { path: "events", element: <EventsPage /> },
          { path: "checkout/success", element: <CheckoutSuccessPage /> },
          { path: "checkout/cancel", element: <CheckoutCancelPage /> },
          { path: "tickets", element: <MyTicketsPage /> },
          { path: "enroll/:ticketId", element: <EnrollPage /> },
        ],
      },
      {
        element: <ProtectedRoute roles={["GATEKEEPER"]} />,
        children: [{ path: "gate", element: <GatePage /> }],
      },
      {
        element: <ProtectedRoute roles={["ADMIN"]} />,
        children: [
          {
            path: "admin",
            element: <AdminLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "events", element: <EventsAdminPage /> },
              { path: "logs", element: <LogsPage /> },
              { path: "users", element: <UsersPage /> },
              { path: "settings", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];

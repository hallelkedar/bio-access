import { Link, NavLink, Outlet, type RouteObject } from "react-router";

import type { Role } from "./api/types";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { HOME_BY_ROLE } from "./auth/roles";
import { LanguageToggle } from "./components/LanguageToggle";
import { LogoMark } from "./components/LogoMark";
import type { TranslationKey } from "./i18n/en";
import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";
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

const NAV_BY_ROLE: Record<Role, { to: string; labelKey: TranslationKey }[]> = {
  USER: [
    { to: "/events", labelKey: "nav.events" },
    { to: "/tickets", labelKey: "nav.myTickets" },
  ],
  GATEKEEPER: [],
  ADMIN: [],
};

function Header() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <nav aria-label={t("nav.main")} className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link to={user ? HOME_BY_ROLE[user.role] : "/"} className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
          <LogoMark />
          {t("app.name")}
        </Link>
        {user &&
          NAV_BY_ROLE[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-1 text-sm transition-colors ${isActive ? "font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"}`
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        <div className="ms-auto flex items-center gap-3 text-sm">
          <LanguageToggle />
          {user ? (
            <>
              <span className="hidden items-center gap-2 text-slate-700 sm:flex">
                <span>{user.full_name}</span>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {t(`role.${user.role}`)}
                </span>
              </span>
              <button type="button" onClick={logout}
                className="rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500">
                {t("header.logOut")}
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100">
                {t("header.logIn")}
              </Link>
              <Link to="/register" className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700">
                {t("header.register")}
              </Link>
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

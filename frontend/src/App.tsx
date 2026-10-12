import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, type RouteObject } from "react-router";

import type { Role } from "./api/types";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { LanguageToggle } from "./components/LanguageToggle";
import { LogoMark } from "./components/LogoMark";
import { RouteTransition, ToastProvider } from "./components/ui";
import type { TranslationKey } from "./i18n/en";
import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider";
import { ADMIN_NAV, AdminLayout } from "./pages/admin/AdminLayout";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { EventsAdminPage } from "./pages/admin/EventsAdminPage";
import { LogsPage } from "./pages/admin/LogsPage";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { GatePage } from "./pages/gate/GatePage";
import { LandingPage } from "./pages/landing/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { CheckoutCancelPage, CheckoutSuccessPage } from "./pages/user/CheckoutResultPages";
import { EnrollPage } from "./pages/user/EnrollPage";
import { EventsPage } from "./pages/user/EventsPage";
import { MyTicketsPage } from "./pages/user/MyTicketsPage";

type NavItem = { to: string; labelKey: TranslationKey; end?: boolean };

/** Every page a role can open; guests get the public ones. */
export const NAV_BY_ROLE: Record<Role | "GUEST", NavItem[]> = {
  GUEST: [{ to: "/", labelKey: "nav.home", end: true }],
  USER: [
    { to: "/events", labelKey: "nav.events" },
    { to: "/tickets", labelKey: "nav.myTickets" },
  ],
  GATEKEEPER: [{ to: "/gate", labelKey: "nav.gate" }],
  ADMIN: ADMIN_NAV,
};

/** Admins move between their pages with the sidebar (AdminLayout), so the header skips them. */
const HEADER_NAV_ROLES: ReadonlySet<Role | "GUEST"> = new Set(["GUEST", "USER", "GATEKEEPER"]);

/** The admin area runs edge to edge (sidebar + wide dashboard); other pages stay centred. */
const isAdminPath = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");

function Header() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const role = user?.role ?? "GUEST";
  const items = HEADER_NAV_ROLES.has(role) ? NAV_BY_ROLE[role] : [];

  useEffect(() => setMenuOpen(false), [pathname]); // close the mobile menu after navigating

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <nav aria-label={t("nav.main")} className={`mx-auto flex ${isAdminPath(pathname) ? "max-w-none" : "max-w-5xl"} flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3`}>
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
          <LogoMark />
          {t("app.name")}
        </Link>
        {items.length > 0 && (
          <>
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="main-nav-links"
              onClick={() => setMenuOpen((open) => !open)}
              className="order-last ms-auto rounded-md p-2 text-slate-700 hover:bg-slate-100 md:hidden"
            >
              <span className="sr-only">{t("nav.menu")}</span>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
              </svg>
            </button>
            <div
              id="main-nav-links"
              className={`${menuOpen ? "flex" : "hidden"} w-full flex-col gap-1 border-t border-slate-200/70 pt-2 md:flex md:w-auto md:flex-row md:items-center md:gap-5 md:border-0 md:pt-0`}
            >
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `rounded-md px-2 py-1.5 text-sm transition-colors md:px-1 md:py-0 ${
                      isActive ? "font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"
                    }`
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </div>
          </>
        )}
        <div className="ms-auto flex items-center gap-3 text-sm">
          <LanguageToggle className="[view-transition-name:lang-toggle]" />
          {user ? (
            <>
              <span className="hidden items-center gap-2 text-slate-700 lg:flex">
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
  const { pathname } = useLocation();
  return (
    <LanguageProvider>
      <ToastProvider>
        <AuthProvider>
          <div className="min-h-screen bg-slate-50 text-slate-900">
            <Header />
            <main className={isAdminPath(pathname) ? "" : "mx-auto max-w-5xl px-4 py-8"}>
              <RouteTransition>
                <Outlet />
              </RouteTransition>
            </main>
          </div>
        </AuthProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}

function NotFound() {
  const { t } = useLanguage();
  return (
    <section>
      <h1 className="text-2xl font-bold">{t("notFound.title")}</h1>
      <p className="mt-2">
        <Link to="/" className="text-blue-700 underline">{t("common.backHome")}</Link>
      </p>
    </section>
  );
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <LandingPage /> },
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

import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";

import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";

type AdminNavItem = { to: string; labelKey: TranslationKey; end?: boolean; icon: ReactNode };

/** 20×20 outline icons, drawn with currentColor. */
const ICONS = {
  dashboard: <path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z" />,
  events: <path d="M3 5h14v12H3zM3 9h14M7 3v4M13 3v4" />,
  logs: <path d="M4 4h12M4 8h12M4 12h8M4 16h5" />,
  users: <path d="M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5M13 3.5a3 3 0 0 1 0 5.5M15 12c1.8.6 3 2.4 3 5" />,
  settings: <path d="M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8" />,
};

/** The admin pages, in nav order (also listed as the admin's pages in App's NAV_BY_ROLE). */
export const ADMIN_NAV: AdminNavItem[] = [
  { to: "/admin", labelKey: "admin.nav.dashboard", end: true, icon: ICONS.dashboard },
  { to: "/admin/events", labelKey: "admin.nav.events", icon: ICONS.events },
  { to: "/admin/logs", labelKey: "admin.nav.logs", icon: ICONS.logs },
  { to: "/admin/users", labelKey: "admin.nav.users", icon: ICONS.users },
  { to: "/admin/settings", labelKey: "admin.nav.settings", icon: ICONS.settings },
];

/**
 * Admin chrome: a dark sidebar with icons on wide screens, a scrollable dark bar of the
 * same links under the header on phones. The page content sits beside / below it.
 */
export function AdminLayout() {
  const { t } = useLanguage();
  return (
    <div className="lg:flex lg:min-h-[calc(100vh-3.6rem)]">
      <nav aria-label={t("admin.nav.label")} className="theme-dark border-b border-border lg:w-56 lg:shrink-0 lg:border-e lg:border-b-0">
        <ul className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] lg:sticky lg:top-[3.6rem] lg:flex-col lg:overflow-visible lg:py-6">
          {ADMIN_NAV.map((item) => (
            <li key={item.to} className="shrink-0">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `relative flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-300 ${
                    isActive
                      ? "bg-brand-500/20 text-white before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:rounded-full before:bg-accent-400 lg:before:inset-x-auto lg:before:inset-y-2 lg:before:start-0 lg:before:h-auto lg:before:w-0.5"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                  }`
                }
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {item.icon}
                </svg>
                {t(item.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

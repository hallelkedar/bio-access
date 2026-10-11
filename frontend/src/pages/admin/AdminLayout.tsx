import { NavLink, Outlet } from "react-router";

import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";

const SECTIONS: { to: string; labelKey: TranslationKey; end?: boolean }[] = [
  { to: "/admin", labelKey: "admin.nav.dashboard", end: true },
  { to: "/admin/events", labelKey: "admin.nav.events" },
  { to: "/admin/logs", labelKey: "admin.nav.logs" },
  { to: "/admin/users", labelKey: "admin.nav.users" },
  { to: "/admin/settings", labelKey: "admin.nav.settings" },
];

export function AdminLayout() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav aria-label={t("admin.nav.label")} className="flex gap-2 overflow-x-auto md:w-44 md:flex-col md:gap-1">
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`
            }
          >
            {t(section.labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

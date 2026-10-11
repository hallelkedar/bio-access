import { useEffect, useState } from "react";

import { changeUserRole, listUsers, type Page } from "../../api/admin";
import { apiErrorMessage } from "../../api/errors";
import type { Role, User } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { useLanguage } from "../../i18n/LanguageProvider";
import { ErrorBox } from "../../components/ErrorBox";
import { Pagination } from "../../components/Pagination";
import { Spinner } from "../../components/Spinner";
import { formatDateTime } from "../../format";

const PAGE_SIZE = 50;
const ROLES: Role[] = ["USER", "GATEKEEPER", "ADMIN"];

export function UsersPage({ searchDelayMs = 300 }: { searchDelayMs?: number }) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<User> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useLanguage();

  // Search once typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setOffset(0);
    }, searchDelayMs);
    return () => clearTimeout(timer);
  }, [typed, searchDelayMs]);

  useEffect(() => {
    let active = true;
    setPage(null);
    setError(null);
    listUsers({ q: query || undefined, role: role || undefined, limit: PAGE_SIZE, offset })
      .then((result) => active && setPage(result))
      .catch((err) => active && setError(apiErrorMessage(err, {}, lang)));
    return () => {
      active = false;
    };
  }, [query, role, offset]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("users.title")}</h1>
      <div className="flex flex-wrap gap-3">
        <input type="search" aria-label={t("users.search")} placeholder={t("users.searchPlaceholder")} maxLength={100}
          value={typed} onChange={(e) => setTyped(e.target.value)}
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <select aria-label={t("users.role")} value={role} onChange={(e) => { setRole(e.target.value as Role | ""); setOffset(0); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">{t("users.allRoles")}</option>
          {ROLES.map((r) => <option key={r} value={r}>{t(`users.role.${r}`)}</option>)}
        </select>
      </div>
      <ErrorBox message={error} />
      {!error && !page && <Spinner label={t("users.loading")} />}
      {page && page.items.length === 0 && <p className="text-slate-600">{t("users.empty")}</p>}
      {page && page.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-start text-slate-600">
                <tr><th className="px-3 py-2 text-start">{t("users.col.name")}</th><th className="px-3 py-2 text-start">{t("users.col.email")}</th><th className="px-3 py-2 text-start">{t("users.col.phone")}</th>
                  <th className="px-3 py-2 text-start">{t("users.col.role")}</th><th className="px-3 py-2 text-start">{t("users.col.joined")}</th></tr>
              </thead>
              <tbody>
                {page.items.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{user.full_name}</td>
                    <td className="px-3 py-2">{user.email}</td>
                    <td className="px-3 py-2">{user.phone ?? "—"}</td>
                    <td className="px-3 py-2">
                      <RoleSelect user={user} onChanged={(updated) =>
                        setPage((current) => current && { ...current, items: current.items.map((u) => (u.id === updated.id ? updated : u)) })} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(user.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={page.total} offset={page.offset} limit={page.limit} onChange={setOffset} />
        </>
      )}
    </section>
  );
}

function RoleSelect({ user, onChanged }: { user: User; onChanged: (user: User) => void }) {
  const { user: me } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMe = me?.id === user.id;
  const { t, lang } = useLanguage();

  async function change(role: Role) {
    if (role === user.role) return;
    if (!window.confirm(t(`users.confirm.${role}`, { name: user.full_name }))) return;
    setSaving(true);
    setError(null);
    try {
      onChanged(await changeUserRole(user.id, role));
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <select aria-label={t("users.roleOf", { name: user.full_name })} value={user.role} disabled={isMe || saving}
        title={isMe ? t("users.ownRole") : undefined}
        onChange={(e) => void change(e.target.value as Role)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">
        {ROLES.map((r) => <option key={r} value={r}>{t(`users.role.${r}`)}</option>)}
      </select>
      <ErrorBox message={error} />
    </div>
  );
}

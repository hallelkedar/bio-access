import { useEffect, useState } from "react";

import { changeUserRole, listUsers, type Page } from "../../api/admin";
import { apiErrorMessage } from "../../api/errors";
import type { Role, User } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { ErrorBox } from "../../components/ErrorBox";
import { Pagination } from "../../components/Pagination";
import { Spinner } from "../../components/Spinner";
import { formatDateTime } from "../../format";

const PAGE_SIZE = 50;
const ROLE_LABEL: Record<Role, string> = { USER: "User", GATEKEEPER: "Gatekeeper", ADMIN: "Admin" };

export function UsersPage({ searchDelayMs = 300 }: { searchDelayMs?: number }) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<User> | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      .catch((err) => active && setError(apiErrorMessage(err)));
    return () => {
      active = false;
    };
  }, [query, role, offset]);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Users</h1>
      <div className="flex flex-wrap gap-3">
        <input type="search" aria-label="Search users" placeholder="Search email or name" maxLength={100}
          value={typed} onChange={(e) => setTyped(e.target.value)}
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value as Role | ""); setOffset(0); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">All roles</option>
          <option value="USER">User</option><option value="GATEKEEPER">Gatekeeper</option><option value="ADMIN">Admin</option>
        </select>
      </div>
      <ErrorBox message={error} />
      {!error && !page && <Spinner label="Loading users…" />}
      {page && page.items.length === 0 && <p className="text-slate-600">No users match.</p>}
      {page && page.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Role</th><th className="px-3 py-2">Joined</th></tr>
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
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(user.created_at)}</td>
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

  async function change(role: Role) {
    if (role === user.role) return;
    if (!window.confirm(`Make ${user.full_name} ${role === "ADMIN" ? "an" : "a"} ${ROLE_LABEL[role]}?`)) return;
    setSaving(true);
    setError(null);
    try {
      onChanged(await changeUserRole(user.id, role));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <select aria-label={`Role of ${user.full_name}`} value={user.role} disabled={isMe || saving}
        title={isMe ? "You can't change your own role" : undefined}
        onChange={(e) => void change(e.target.value as Role)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">
        {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
      </select>
      <ErrorBox message={error} />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";

import { changeUserRole, listUsers, type Page } from "../../api/admin";
import { apiErrorMessage } from "../../api/errors";
import type { Role, User } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Lang } from "../../i18n/translate";
import { ErrorBox } from "../../components/ErrorBox";
import { Pagination } from "../../components/Pagination";
import { Badge, ConfirmDialog, EmptyState, SkeletonTable, useToast, type BadgeTone } from "../../components/ui";
import { formatDateTime, localeFor } from "../../format";
import { CARD_CELL } from "./cardCells";

const PAGE_SIZE = 50;
const ROLES: Role[] = ["USER", "GATEKEEPER", "ADMIN"];

const ROLE_TONE: Record<Role, BadgeTone> = {
  USER: "neutral",
  GATEKEEPER: "warn",
  ADMIN: "brand",
};

export type SortKey = "name" | "email" | "joined";
export type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

/** A role change waiting for the admin's OK. */
type Pending = { user: User; role: Role } | null;

/** FSI…PDI isolate a (often Latin) name inside a Hebrew sentence, like <bdi> in a string. */
const isolate = (text: string) => `⁨${text}⁩`;

/**
 * Sorts the loaded page only (the API has no sort parameter); `null` keeps the server's order.
 * Names and emails compare the way the current language reads them.
 */
export function sortUsers(users: User[], sort: Sort, lang: Lang): User[] {
  if (!sort) return users;
  const collator = new Intl.Collator(localeFor(lang), { sensitivity: "base" });
  const compare: Record<SortKey, (a: User, b: User) => number> = {
    name: (a, b) => collator.compare(a.full_name, b.full_name),
    email: (a, b) => collator.compare(a.email, b.email),
    joined: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...users].sort((a, b) => sign * compare[sort.key](a, b));
}

/** Clicking a column: first ascending, then descending, then back to ascending. */
export function nextSort(current: Sort, key: SortKey): Sort {
  return current?.key === key && current.dir === "asc" ? { key, dir: "desc" } : { key, dir: "asc" };
}

export function UsersPage({ searchDelayMs = 300 }: { searchDelayMs?: number }) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page<User> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const { user: me } = useAuth();
  const { t, lang } = useLanguage();
  const toast = useToast();

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

  const rows = useMemo(() => (page ? sortUsers(page.items, sort, lang) : []), [page, sort, lang]);

  const replaceUser = (updated: User) =>
    setPage((current) => current && { ...current, items: current.items.map((u) => (u.id === updated.id ? updated : u)) });

  const markBusy = (id: number, on: boolean) =>
    setBusy((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Optimistic: the row shows the new role at once; a refusal puts the old one back and explains why. */
  async function confirmRoleChange() {
    if (!pending) return;
    const { user, role: next } = pending;
    setPending(null);
    setRowErrors(({ [user.id]: _, ...rest }) => rest);
    markBusy(user.id, true);
    replaceUser({ ...user, role: next });
    try {
      replaceUser(await changeUserRole(user.id, next));
      toast.success(t("users.toast.changed", { name: isolate(user.full_name), role: t(`users.role.${next}`) }));
    } catch (err) {
      replaceUser(user);
      setRowErrors((all) => ({ ...all, [user.id]: apiErrorMessage(err, {}, lang) }));
    } finally {
      markBusy(user.id, false);
    }
  }

  const filtered = query !== "" || role !== "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("users.title")}</h1>
        {page && page.total > 0 && (
          <p className="text-sm text-slate-500 tabular-nums">{t("users.total", { count: new Intl.NumberFormat(localeFor(lang)).format(page.total) })}</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:justify-start">
        <div className="relative">
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13 13l4 4" />
          </svg>
          <input type="search" aria-label={t("users.search")} placeholder={t("users.searchPlaceholder")} maxLength={100}
            value={typed} onChange={(e) => setTyped(e.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-300 bg-white ps-9 pe-9 text-sm focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500 sm:min-h-9 [&::-webkit-search-cancel-button]:hidden" />
          {typed && (
            <button type="button" onClick={() => setTyped("")} aria-label={t("users.clearSearch")}
              className="absolute end-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-brand-500 sm:h-7 sm:w-7">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l8 8M14 6l-8 8" />
              </svg>
            </button>
          )}
        </div>
        <select aria-label={t("users.role")} value={role} onChange={(e) => { setRole(e.target.value as Role | ""); setOffset(0); }}
          className="min-h-11 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500 sm:min-h-9">
          <option value="">{t("users.allRoles")}</option>
          {ROLES.map((r) => <option key={r} value={r}>{t(`users.role.${r}`)}</option>)}
        </select>
      </div>
      <ErrorBox message={error} />
      {!error && !page && <SkeletonTable rows={5} columns={5} />}
      {page && page.items.length === 0 && (
        <EmptyState title={t("users.empty")} hint={filtered ? t("users.emptyHint") : undefined} />
      )}
      {page && page.items.length > 0 && (
        <>
          {/* Under `sm` the rows lay out as stacked cards (CSS only), so nothing scrolls sideways. */}
          <div className="rounded-lg border border-slate-200 bg-white max-sm:border-0 max-sm:bg-transparent">
            <table className="w-full text-start text-sm max-sm:block">
              <thead className="bg-slate-50 text-slate-600 max-sm:hidden">
                <tr>
                  <SortHeader label={t("users.col.name")} sortKey="name" sort={sort} onSort={setSort} />
                  <SortHeader label={t("users.col.email")} sortKey="email" sort={sort} onSort={setSort} />
                  <th className="px-3 py-2 text-start">{t("users.col.phone")}</th>
                  <th className="px-3 py-2 text-start">{t("users.col.role")}</th>
                  <SortHeader label={t("users.col.joined")} sortKey="joined" sort={sort} onSort={setSort} />
                </tr>
              </thead>
              <tbody className="max-sm:block max-sm:space-y-3">
                {rows.map((user) => {
                  const isMe = me?.id === user.id;
                  return (
                    <tr key={user.id}
                      className="border-t border-slate-100 align-top transition-colors hover:bg-slate-50/70 max-sm:block max-sm:rounded-card max-sm:border max-sm:border-slate-200 max-sm:bg-white max-sm:p-2 max-sm:shadow-card">
                      <td className="px-3 py-2 max-sm:block">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium"><bdi>{user.full_name}</bdi></span>
                          <Badge tone={ROLE_TONE[user.role]}>{t(`users.role.${user.role}`)}</Badge>
                          {isMe && <Badge tone="ok">{t("users.you")}</Badge>}
                        </div>
                        <ErrorBox message={rowErrors[user.id] ?? null} />
                      </td>
                      <td className={`${CARD_CELL} break-all`} data-label={t("users.col.email")}><bdi>{user.email}</bdi></td>
                      <td className={`${CARD_CELL} whitespace-nowrap tabular-nums`} data-label={t("users.col.phone")}><bdi>{user.phone ?? "—"}</bdi></td>
                      <td className={CARD_CELL} data-label={t("users.col.role")}>
                        <select aria-label={t("users.roleOf", { name: user.full_name })} value={user.role} disabled={isMe || busy.has(user.id)}
                          title={isMe ? t("users.ownRole") : undefined}
                          onChange={(e) => {
                            const next = e.target.value as Role;
                            if (next !== user.role) setPending({ user, role: next });
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:border-slate-400 focus-visible:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60 max-sm:min-h-11 max-sm:text-sm">
                          {ROLES.map((r) => <option key={r} value={r}>{t(`users.role.${r}`)}</option>)}
                        </select>
                      </td>
                      <td className={`${CARD_CELL} whitespace-nowrap`} data-label={t("users.col.joined")}>{formatDateTime(user.created_at, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination total={page.total} offset={page.offset} limit={page.limit} onChange={setOffset} />
        </>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? t(`users.confirm.${pending.role}`, { name: isolate(pending.user.full_name) }) : ""}
        message={pending && t(`users.confirm.effect.${pending.role}`)}
        confirmLabel={t("users.confirm.yes")}
        cancelLabel={t("users.confirm.keep")}
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (sort: Sort) => void;
}

/** A column header that sorts on click; `aria-sort` tells screen readers the current order. */
function SortHeader({ label, sortKey, sort, onSort }: SortHeaderProps) {
  const active = sort?.key === sortKey;
  const dir = active ? sort.dir : null;
  return (
    <th className="px-1 py-1 text-start" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button type="button" onClick={() => onSort(nextSort(sort, sortKey))}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500 ${active ? "font-semibold text-slate-900" : ""}`}>
        {label}
        <svg viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${active ? "opacity-100" : "opacity-30"} ${dir === "desc" ? "rotate-180" : ""}`} fill="currentColor" aria-hidden="true">
          <path d="M6 2.5l3.5 4.5h-7z" />
        </svg>
      </button>
    </th>
  );
}

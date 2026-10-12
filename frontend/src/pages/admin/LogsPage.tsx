import { useEffect, useMemo, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { listLogs, type AccessLogRow, type LogFilters, type Page } from "../../api/admin";
import { listAllEvents } from "../../api/adminEvents";
import { apiErrorMessage } from "../../api/errors";
import type { AccessReason } from "../../api/gate";
import type { Event } from "../../api/types";
import { REASON_LABEL, reasonLabel } from "../../components/charts/chartMath";
import { ErrorBox } from "../../components/ErrorBox";
import { Pagination } from "../../components/Pagination";
import { Button, DateTimeField, Drawer, EmptyState, SkeletonTable, Tooltip } from "../../components/ui";
import { formatDateTime, formatDateTimeSeconds, formatRelative, fromLocalInput, localeFor, toLocalInput } from "../../format";
import { useClock } from "../../hooks/useClock";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";
import { translate, type Lang } from "../../i18n/translate";
import { downloadCsv, toCsv } from "../../utils/csv";

export const PAGE_SIZE = 50;
const REASONS = (Object.keys(REASON_LABEL) as AccessReason[]).filter((r) => r !== "NONE");
const FILTER_KEYS = ["event_id", "result", "reason", "method", "gate_id", "from", "to"] as const;

/** URL query (local datetimes, page number) → API filters (UTC, offset). */
export function filtersFromParams(params: URLSearchParams): { filters: LogFilters; error: string | null } {
  const get = (key: string) => params.get(key) || undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const from = get("from");
  const to = get("to");
  const filters: LogFilters = {
    event_id: get("event_id") ? Number(get("event_id")) : undefined,
    result: get("result") as LogFilters["result"],
    reason: get("reason") as LogFilters["reason"],
    method: get("method") as LogFilters["method"],
    gate_id: get("gate_id"),
    from: (from && fromLocalInput(from)) || undefined,
    to: (to && fromLocalInput(to)) || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const error = filters.from && filters.to && filters.from >= filters.to ? "'From' must be before 'To'." : null;
  return { filters, error };
}

const PRESETS: { key: TranslationKey; from: (now: Date) => Date }[] = [
  { key: "logs.preset.today", from: (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
  { key: "logs.preset.24h", from: (now) => new Date(now.getTime() - 24 * 60 * 60_000) },
  { key: "logs.preset.7d", from: (now) => new Date(now.getTime() - 7 * 24 * 60 * 60_000) },
];

export function LogsPage() {
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<Event[]>([]);
  const [page, setPage] = useState<Page<AccessLogRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useLanguage();
  const { filters, error: rangeError } = useMemo(() => filtersFromParams(params), [params]);

  useEffect(() => {
    listAllEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    if (rangeError) return;
    let active = true;
    setPage(null);
    setError(null);
    listLogs(filters)
      .then((result) => active && setPage(result))
      .catch((err) => active && setError(apiErrorMessage(err, {}, lang)));
    return () => {
      active = false;
    };
  }, [filters, rangeError]);

  /** Any filter change goes back to page 1; the URL is the single source of truth. */
  function setFilter(key: (typeof FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  }

  /** Quick ranges: set From (and clear To) in one URL update. */
  function applyPreset(from: Date) {
    const next = new URLSearchParams(params);
    next.set("from", toLocalInput(from.toISOString()));
    next.delete("to");
    next.delete("page");
    setParams(next);
  }

  function goTo(offset: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(offset / PAGE_SIZE + 1));
    setParams(next);
  }

  const eventName = (id: number) => events.find((e) => e.id === id)?.name ?? `#${id}`;
  const control = "mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  const now = useClock(30_000); // keeps "3 min ago" honest
  const [selected, setSelected] = useState<AccessLogRow | null>(null);
  const open = (row: AccessLogRow) => ({
    tabIndex: 0,
    "aria-haspopup": "dialog" as const,
    onClick: () => setSelected(row),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setSelected(row);
      }
    },
  });

  function exportCsv() {
    if (!page) return;
    downloadCsv(`access-logs-${localStamp(new Date().toISOString()).replace(/[: ]/g, "-")}.csv`, logsCsv(page.items, eventName, lang));
  }
  const narrow = useMediaQuery("(max-width: 639px)");

  // Active filters as removable chips (the page number isn't a filter).
  const chips = FILTER_KEYS.filter((key) => params.get(key)).map((key) => {
    const value = params.get(key)!;
    const label =
      key === "event_id" ? eventName(Number(value))
      : key === "result" ? t(value === "APPROVED" ? "logs.approved" : "logs.denied")
      : key === "reason" ? reasonLabel(lang, value as AccessReason)
      : key === "method" ? t(`method.${value as "FACE" | "QR"}`)
      : key === "from" || key === "to" ? formatDateTime(fromLocalInput(value) ?? value, lang)
      : value;
    return { key, text: `${t(CHIP_LABEL[key])}: ${label}` };
  });

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("logs.title")}</h1>
      <div role="group" aria-label={t("logs.filters")} className="space-y-3 rounded-card border border-slate-200 bg-white p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">{t("logs.event")}
            <select className={control} value={params.get("event_id") ?? ""} onChange={(e) => setFilter("event_id", e.target.value)}>
              <option value="">{t("logs.allEvents")}</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">{t("logs.result")}
            <select className={control} value={params.get("result") ?? ""} onChange={(e) => setFilter("result", e.target.value)}>
              <option value="">{t("logs.all")}</option><option value="APPROVED">{t("logs.approved")}</option><option value="DENIED">{t("logs.denied")}</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">{t("logs.reason")}
            <select className={control} value={params.get("reason") ?? ""} onChange={(e) => setFilter("reason", e.target.value)}>
              <option value="">{t("logs.any")}</option>
              {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(lang, r)}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">{t("logs.method")}
              <select className={control} value={params.get("method") ?? ""} onChange={(e) => setFilter("method", e.target.value)}>
                <option value="">{t("logs.any")}</option><option value="FACE">{t("logs.face")}</option><option value="QR">QR</option>
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">{t("logs.gate")}
              <input className={`${control} font-mono`} value={params.get("gate_id") ?? ""} maxLength={64} placeholder="north-1"
                onChange={(e) => setFilter("gate_id", e.target.value)} />
            </label>
          </div>
          {/* The URL keeps local "YYYY-MM-DDTHH:mm" (bookmarks keep working); the field speaks UTC ISO. */}
          <DateTimeField label={t("logs.from")} id="logs-from" value={fromLocalInput(params.get("from") ?? "")}
            onChange={(iso) => setFilter("from", iso ? toLocalInput(iso) : "")} />
          <DateTimeField label={t("logs.to")} id="logs-to" defaultTime="23:59" value={fromLocalInput(params.get("to") ?? "")}
            onChange={(iso) => setFilter("to", iso ? toLocalInput(iso) : "")} />
          <div className="flex flex-wrap items-end gap-1.5 sm:col-span-2" role="group" aria-label={t("logs.presets")}>
            <span className="w-full text-sm font-medium text-slate-700">{t("logs.presets")}</span>
            {PRESETS.map(({ key, from }) => (
              <button key={key} type="button" onClick={() => applyPreset(from(new Date()))}
                className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50">
                {t(key)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          <span className="font-medium text-slate-800" aria-live="polite">
            {page ? entriesLabel(page.total, lang, t) : "\u00a0"}
          </span>
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => setFilter(chip.key, "")}
              aria-label={t("logs.removeFilter", { filter: chip.text })}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800 hover:bg-brand-100">
              <bdi className="truncate">{chip.text}</bdi>
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <div className="ms-auto flex items-center gap-2">
            {chips.length > 0 && (
              <button type="button" onClick={() => setParams(new URLSearchParams())}
                className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                {t("logs.clear")}
              </button>
            )}
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!page || page.items.length === 0}>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 14v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
              </svg>
              {t("logs.exportCsv")}
            </Button>
          </div>
        </div>
      </div>
      <ErrorBox message={rangeError ? t("logs.rangeError") : error} />
      {!rangeError && !error && !page && <SkeletonTable rows={8} columns={narrow ? 2 : 8} />}
      {page && page.items.length === 0 && (
        <EmptyState title={t("logs.empty")}
          action={chips.length > 0 ? <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>{t("logs.clear")}</Button> : undefined} />
      )}
      {page && page.items.length > 0 && (
        <>
          {narrow ? (
            <ul className="space-y-3">
              {page.items.map((row) => <LogCard key={row.id} row={row} event={eventName(row.event_id)} now={now} {...open(row)} />)}
            </ul>
          ) : (
            // overflow-clip, not -hidden: the sticky header needs no scroll container in between.
            <div className="overflow-clip rounded-lg border border-slate-200 bg-white">
              <table className="w-full table-fixed text-start text-sm">
                <colgroup>
                  <col className="w-[14%]" /><col className="w-[18%]" /><col className="w-[10%]" /><col className="w-[9%]" />
                  <col className="w-[12%]" /><col className="w-[15%]" /><col className="w-[12%]" /><col className="w-[10%]" />
                </colgroup>
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {(["time", "event", "gate", "method", "result", "reason", "holder"] as const).map((col) => (
                      <th key={col} className={HEAD}>{t(`logs.col.${col}`)}</th>
                    ))}
                    <th className={`${HEAD} text-end`}>{t("logs.col.similarity")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {page.items.map((row) => (
                    <tr key={row.id} {...open(row)}
                      className="cursor-pointer hover:bg-slate-50 focus-visible:bg-brand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
                      <td className={CELL}><LogTime iso={row.timestamp} now={now} /></td>
                      <td className={CELL}><Truncated text={eventName(row.event_id)} /></td>
                      <td className={`${CELL} font-mono text-xs`}><Truncated text={row.gate_id} /></td>
                      <td className={CELL}><MethodPill method={row.method} /></td>
                      <td className={CELL}><ResultBadge result={row.result} /></td>
                      <td className={`${CELL} text-slate-500`}><Truncated text={row.reason === "NONE" ? "" : reasonLabel(lang, row.reason)} /></td>
                      <td className={CELL}><Truncated text={row.user_name ?? "—"} /></td>
                      <td className={`${CELL} text-end`}><Similarity value={row.similarity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination total={page.total} offset={page.offset} limit={page.limit} onChange={goTo} />
        </>
      )}
      <Drawer open={selected !== null} title={t("logs.details")} onClose={() => setSelected(null)}>
        {selected && <LogDetails row={selected} event={eventName(selected.event_id)} now={now} />}
      </Drawer>
    </section>
  );
}

/** "2026-12-01 20:05:07" in local time: Excel reads it as a date. */
function localStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The current page of logs as CSV, with headers and values in the page language. */
export function logsCsv(rows: AccessLogRow[], eventName: (id: number) => string, lang: Lang): string {
  const tr = (key: TranslationKey) => translate(lang, key);
  return toCsv([
    [tr("logs.col.time"), tr("logs.col.event"), tr("logs.col.gate"), tr("logs.col.method"), tr("logs.col.result"),
      tr("logs.col.reason"), tr("logs.col.holder"), tr("logs.ticket"), tr("logs.col.similarity")],
    ...rows.map((row) => [
      localStamp(row.timestamp),
      eventName(row.event_id),
      row.gate_id,
      tr(`method.${row.method}`),
      tr(row.result === "APPROVED" ? "logs.approved" : "logs.denied"),
      row.reason === "NONE" ? "" : reasonLabel(lang, row.reason),
      row.user_name ?? "",
      row.ticket_id ?? "",
      row.similarity === null ? "" : row.similarity.toFixed(1),
    ]),
  ]);
}

function LogDetails({ row, event, now }: { row: AccessLogRow; event: string; now: Date }) {
  const { t, lang } = useLanguage();
  const items: [TranslationKey, ReactNode][] = [
    ["logs.col.time", <><span className="block">{formatDateTimeSeconds(row.timestamp, lang)}</span><span className="text-xs text-slate-500">{formatRelative(row.timestamp, now, lang)}</span></>],
    ["logs.col.event", <bdi>{event}</bdi>],
    ["logs.col.gate", <span className="font-mono">{row.gate_id}</span>],
    ["logs.col.method", <MethodPill method={row.method} />],
    ["logs.col.result", <ResultBadge result={row.result} />],
    ["logs.col.reason", row.reason === "NONE" ? "—" : reasonLabel(lang, row.reason)],
    ["logs.col.holder", <bdi>{row.user_name ?? "—"}</bdi>],
    ["logs.ticket", row.ticket_id === null ? "—" : `#${row.ticket_id}`],
    ["logs.col.similarity", <Similarity value={row.similarity} align="start" />],
  ];
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {items.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[8rem_1fr] items-center gap-3 py-2.5">
          <dt className="text-slate-500">{t(key)}</dt>
          <dd className="min-w-0 text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const HEAD = "sticky top-14 z-10 border-b border-slate-200 bg-slate-50/95 px-3 py-2.5 text-start font-semibold backdrop-blur";
const CELL = "px-3 py-2.5 align-middle";

const CHIP_LABEL: Record<(typeof FILTER_KEYS)[number], TranslationKey> = {
  event_id: "logs.event",
  result: "logs.result",
  reason: "logs.reason",
  method: "logs.method",
  gate_id: "logs.gate",
  from: "logs.from",
  to: "logs.to",
};

function entriesLabel(total: number, lang: Lang, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const one = new Intl.PluralRules(localeFor(lang)).select(total) === "one";
  return t(one ? "logs.count.one" : "logs.count.other", { count: new Intl.NumberFormat(localeFor(lang)).format(total) });
}

/** "3 min ago", with the exact time (seconds included) on hover and focus. */
function LogTime({ iso, now }: { iso: string; now: Date }) {
  const { lang } = useLanguage();
  return (
    <Tooltip content={formatDateTimeSeconds(iso, lang)}>
      <time dateTime={iso} tabIndex={0} className="whitespace-nowrap rounded tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500">
        {formatRelative(iso, now, lang)}
      </time>
    </Tooltip>
  );
}

/**
 * One line, cut with "…"; the full text is in a native title for mouse users. dir="auto":
 * an English name in the Hebrew page (or the reverse) keeps its own direction, so the "…"
 * lands at its end instead of eating its beginning.
 */
function Truncated({ text }: { text: string }) {
  return <span dir="auto" title={text || undefined} className="block truncate text-start">{text}</span>;
}

function ResultBadge({ result }: { result: AccessLogRow["result"] }) {
  const { t } = useLanguage();
  const approved = result === "APPROVED";
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${approved ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
      {approved ? t("logs.approvedMark") : t("logs.deniedMark")}
    </span>
  );
}

function MethodPill({ method }: { method: AccessLogRow["method"] }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        {method === "FACE" ? (
          <path d="M4 7V5a1 1 0 0 1 1-1h2M13 4h2a1 1 0 0 1 1 1v2M16 13v2a1 1 0 0 1-1 1h-2M7 16H5a1 1 0 0 1-1-1v-2M10 7.5a2.5 3 0 1 0 0 6a2.5 3 0 1 0 0-6" />
        ) : (
          <path d="M4 4h4v4H4zM12 4h4v4h-4zM4 12h4v4H4zM12 12h1.5M16 12v1.5M12 16h4" />
        )}
      </svg>
      {t(`method.${method}`)}
    </span>
  );
}

/** A thin bar plus the number (or a dash when there was no face match). End-aligned in table cells. */
function Similarity({ value, align = "end" }: { value: number | null; align?: "start" | "end" }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-2 ${align === "end" ? "w-full justify-end" : ""}`}>
      <span aria-hidden="true" className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-slate-100 lg:block">
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </span>
      <span className="tabular-nums">{value.toFixed(1)}%</span>
    </span>
  );
}

/** Phones: one card per entry instead of an 8-column table. */
function LogCard({ row, event, now, ...open }: { row: AccessLogRow; event: string; now: Date } & HTMLAttributes<HTMLLIElement>) {
  const { lang } = useLanguage();
  return (
    <li {...open} className="cursor-pointer space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 text-sm hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-brand-500">
      <div className="flex items-center justify-between gap-2">
        <LogTime iso={row.timestamp} now={now} />
        <ResultBadge result={row.result} />
      </div>
      <p dir="auto" className="truncate text-start font-medium text-slate-900">{event}</p>
      <div className="flex flex-wrap items-center gap-2 text-slate-600">
        <span className="font-mono text-xs">{row.gate_id}</span>
        <MethodPill method={row.method} />
        {row.reason !== "NONE" && <span className="text-slate-500">{reasonLabel(lang, row.reason)}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 text-slate-700">
        <span dir="auto" className="min-w-0 truncate">{row.user_name ?? "—"}</span>
        <Similarity value={row.similarity} />
      </div>
    </li>
  );
}

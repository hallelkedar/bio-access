import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { listLogs, type AccessLogRow, type LogFilters, type Page } from "../../api/admin";
import { listAllEvents } from "../../api/adminEvents";
import { apiErrorMessage } from "../../api/errors";
import type { AccessReason } from "../../api/gate";
import type { Event } from "../../api/types";
import { REASON_LABEL, reasonLabel } from "../../components/charts/chartMath";
import { ErrorBox } from "../../components/ErrorBox";
import { Pagination } from "../../components/Pagination";
import { Spinner } from "../../components/Spinner";
import { DateTimeField } from "../../components/ui";
import { formatDateTime, fromLocalInput, toLocalInput } from "../../format";
import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";

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
  const select = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t("logs.title")}</h1>
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t("logs.filters")}>
        <label className="text-sm">{t("logs.event")}<br />
          <select className={select} value={params.get("event_id") ?? ""} onChange={(e) => setFilter("event_id", e.target.value)}>
            <option value="">{t("logs.allEvents")}</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="text-sm">{t("logs.result")}<br />
          <select className={select} value={params.get("result") ?? ""} onChange={(e) => setFilter("result", e.target.value)}>
            <option value="">{t("logs.all")}</option><option value="APPROVED">{t("logs.approved")}</option><option value="DENIED">{t("logs.denied")}</option>
          </select>
        </label>
        <label className="text-sm">{t("logs.reason")}<br />
          <select className={select} value={params.get("reason") ?? ""} onChange={(e) => setFilter("reason", e.target.value)}>
            <option value="">{t("logs.any")}</option>
            {REASONS.map((r) => <option key={r} value={r}>{reasonLabel(lang, r)}</option>)}
          </select>
        </label>
        <label className="text-sm">{t("logs.method")}<br />
          <select className={select} value={params.get("method") ?? ""} onChange={(e) => setFilter("method", e.target.value)}>
            <option value="">{t("logs.any")}</option><option value="FACE">{t("logs.face")}</option><option value="QR">QR</option>
          </select>
        </label>
        <label className="text-sm">{t("logs.gate")}<br />
          <input className={select} value={params.get("gate_id") ?? ""} maxLength={64} placeholder="north-1"
            onChange={(e) => setFilter("gate_id", e.target.value)} />
        </label>
        {/* The URL keeps local "YYYY-MM-DDTHH:mm" (bookmarks keep working); the field speaks UTC ISO. */}
        <div className="w-60">
          <DateTimeField label={t("logs.from")} id="logs-from" value={fromLocalInput(params.get("from") ?? "")}
            onChange={(iso) => setFilter("from", iso ? toLocalInput(iso) : "")} />
        </div>
        <div className="w-60">
          <DateTimeField label={t("logs.to")} id="logs-to" defaultTime="23:59" value={fromLocalInput(params.get("to") ?? "")}
            onChange={(iso) => setFilter("to", iso ? toLocalInput(iso) : "")} />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-1" role="group" aria-label={t("logs.presets")}>
          {PRESETS.map(({ key, from }) => (
            <button key={key} type="button" onClick={() => applyPreset(from(new Date()))}
              className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-400 hover:bg-brand-50">
              {t(key)}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setParams(new URLSearchParams())} className="rounded-md border px-3 py-1.5 text-sm">
          {t("logs.clear")}
        </button>
      </div>
      <ErrorBox message={rangeError ? t("logs.rangeError") : error} />
      {!rangeError && !error && !page && <Spinner label={t("logs.loading")} />}
      {page && page.items.length === 0 && <p className="text-slate-600">{t("logs.empty")}</p>}
      {page && page.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-start text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start">{t("logs.col.time")}</th><th className="px-3 py-2 text-start">{t("logs.col.event")}</th><th className="px-3 py-2 text-start">{t("logs.col.gate")}</th>
                  <th className="px-3 py-2 text-start">{t("logs.col.method")}</th><th className="px-3 py-2 text-start">{t("logs.col.result")}</th><th className="px-3 py-2 text-start">{t("logs.col.reason")}</th>
                  <th className="px-3 py-2 text-start">{t("logs.col.holder")}</th><th className="px-3 py-2 text-end">{t("logs.col.similarity")}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.timestamp, lang)}</td>
                    <td className="px-3 py-2">{eventName(row.event_id)}</td>
                    <td className="px-3 py-2">{row.gate_id}</td>
                    <td className="px-3 py-2">{t(`method.${row.method}`)}</td>
                    <td className={`px-3 py-2 ${row.result === "APPROVED" ? "text-emerald-700" : "text-red-700"}`}>
                      {row.result === "APPROVED" ? t("logs.approvedMark") : t("logs.deniedMark")}
                    </td>
                    <td className="px-3 py-2">{row.reason === "NONE" ? "" : reasonLabel(lang, row.reason)}</td>
                    <td className="px-3 py-2">{row.user_name ?? "—"}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{row.similarity === null ? "—" : row.similarity.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={page.total} offset={page.offset} limit={page.limit} onChange={goTo} />
        </>
      )}
    </section>
  );
}

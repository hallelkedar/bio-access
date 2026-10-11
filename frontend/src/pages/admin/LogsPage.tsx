import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { listLogs, type AccessLogRow, type LogFilters, type Page } from "../../api/admin";
import { listAllEvents } from "../../api/adminEvents";
import { apiErrorMessage } from "../../api/errors";
import type { AccessReason } from "../../api/gate";
import type { Event } from "../../api/types";
import { REASON_LABEL } from "../../components/charts/chartMath";
import { ErrorBox } from "../../components/ErrorBox";
import { Pagination } from "../../components/Pagination";
import { Spinner } from "../../components/Spinner";
import { formatDateTime, fromLocalInput } from "../../format";

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
    from: from ? fromLocalInput(from) : undefined,
    to: to ? fromLocalInput(to) : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const error = filters.from && filters.to && filters.from >= filters.to ? "'From' must be before 'To'." : null;
  return { filters, error };
}

export function LogsPage() {
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<Event[]>([]);
  const [page, setPage] = useState<Page<AccessLogRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      .catch((err) => active && setError(apiErrorMessage(err)));
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

  function goTo(offset: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(offset / PAGE_SIZE + 1));
    setParams(next);
  }

  const eventName = (id: number) => events.find((e) => e.id === id)?.name ?? `#${id}`;
  const select = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">Access logs</h1>
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
        <label className="text-sm">Event<br />
          <select className={select} value={params.get("event_id") ?? ""} onChange={(e) => setFilter("event_id", e.target.value)}>
            <option value="">All events</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Result<br />
          <select className={select} value={params.get("result") ?? ""} onChange={(e) => setFilter("result", e.target.value)}>
            <option value="">All</option><option value="APPROVED">Approved</option><option value="DENIED">Denied</option>
          </select>
        </label>
        <label className="text-sm">Reason<br />
          <select className={select} value={params.get("reason") ?? ""} onChange={(e) => setFilter("reason", e.target.value)}>
            <option value="">Any</option>
            {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="text-sm">Method<br />
          <select className={select} value={params.get("method") ?? ""} onChange={(e) => setFilter("method", e.target.value)}>
            <option value="">Any</option><option value="FACE">Face</option><option value="QR">QR</option>
          </select>
        </label>
        <label className="text-sm">Gate<br />
          <input className={select} value={params.get("gate_id") ?? ""} maxLength={64} placeholder="north-1"
            onChange={(e) => setFilter("gate_id", e.target.value)} />
        </label>
        <label className="text-sm">From<br />
          <input type="datetime-local" className={select} value={params.get("from") ?? ""} onChange={(e) => setFilter("from", e.target.value)} />
        </label>
        <label className="text-sm">To<br />
          <input type="datetime-local" className={select} value={params.get("to") ?? ""} onChange={(e) => setFilter("to", e.target.value)} />
        </label>
        <button type="button" onClick={() => setParams(new URLSearchParams())} className="rounded-md border px-3 py-1.5 text-sm">
          Clear filters
        </button>
      </div>
      <ErrorBox message={rangeError ?? error} />
      {!rangeError && !error && !page && <Spinner label="Loading logs…" />}
      {page && page.items.length === 0 && <p className="text-slate-600">No log entries match these filters.</p>}
      {page && page.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2">Time</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Gate</th>
                  <th className="px-3 py-2">Method</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Holder</th><th className="px-3 py-2 text-right">Similarity</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.timestamp)}</td>
                    <td className="px-3 py-2">{eventName(row.event_id)}</td>
                    <td className="px-3 py-2">{row.gate_id}</td>
                    <td className="px-3 py-2">{row.method}</td>
                    <td className={`px-3 py-2 ${row.result === "APPROVED" ? "text-emerald-700" : "text-red-700"}`}>
                      {row.result === "APPROVED" ? "✓ Approved" : "✕ Denied"}
                    </td>
                    <td className="px-3 py-2">{row.reason === "NONE" ? "" : REASON_LABEL[row.reason]}</td>
                    <td className="px-3 py-2">{row.user_name ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.similarity === null ? "—" : row.similarity.toFixed(1)}</td>
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

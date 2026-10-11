import { useCallback, useEffect, useRef, useState } from "react";

import { listAllEvents } from "../../api/adminEvents";
import { getEventStats, type AccessEvent, type EventStats } from "../../api/adminStats";
import { apiErrorMessage } from "../../api/errors";
import type { Event } from "../../api/types";
import { BarList } from "../../components/charts/BarList";
import { REASON_LABEL, reasonRows } from "../../components/charts/chartMath";
import { ColumnChart, type Column } from "../../components/charts/ColumnChart";
import { Meter } from "../../components/charts/Meter";
import { StatTile } from "../../components/charts/StatTile";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { useAdminFeed, type FeedStatus } from "../../hooks/useAdminFeed";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function bucketColumns(stats: EventStats): Column[] {
  return stats.entries_per_30_min.map((bucket) => {
    const start = new Date(bucket.bucket_start);
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
      key: bucket.bucket_start,
      label: timeFormat.format(start),
      description: `${timeFormat.format(start)}–${timeFormat.format(end)}`,
      value: bucket.approved,
    };
  });
}

export function DashboardPage({ refreshDelayMs = 1000 }: { refreshDelayMs?: number }) {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllReasons, setShowAllReasons] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    listAllEvents()
      .then((all) => {
        setEvents(all);
        setEventId((all.find((e) => e.status === "ACTIVE") ?? all[0])?.id ?? null);
      })
      .catch((err) => setError(apiErrorMessage(err)));
  }, []);

  const loadStats = useCallback(async (id: number) => {
    try {
      setStats(await getEventStats(id));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    setStats(null);
    if (eventId !== null) void loadStats(eventId);
  }, [eventId, loadStats]);

  // While events stream in, refresh the numbers at most once per refreshDelayMs.
  const onEvent = useCallback(
    (event: AccessEvent) => {
      if (event.event_id !== eventId || refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void loadStats(event.event_id);
      }, refreshDelayMs);
    },
    [eventId, loadStats, refreshDelayMs],
  );
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const feed = useAdminFeed({ onEvent });
  const feedForEvent = feed.events.filter((e) => e.event_id === eventId);

  if (error && !events) return <ErrorBox message={error} />;
  if (!events) return <Spinner label="Loading dashboard…" />;
  if (events.length === 0) {
    return (
      <section>
        <h1 className="text-2xl font-bold">Admin dashboard</h1>
        <p className="mt-2 text-slate-600">No events yet. Create one under Events.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">Admin dashboard</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">Event</span>
          <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1">
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status.toLowerCase()})</option>)}
          </select>
        </label>
        <FeedPill status={feed.status} />
      </div>
      <ErrorBox message={error} />
      {!stats ? (
        <Spinner label="Loading numbers…" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Inside" value={String(stats.occupancy.entered)} />
            <StatTile label="Approved scans" value={String(stats.decisions.approved)} />
            <StatTile label="Denied scans" value={String(stats.decisions.denied)} />
            <StatTile label="Occupancy" value={`${stats.occupancy.percent}%`} />
          </div>
          <Meter entered={stats.occupancy.entered} sold={stats.occupancy.sold} capacity={stats.occupancy.capacity} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ColumnChart title="Entries per 30 minutes" columns={bucketColumns(stats)} unit="entries" />
            <div className="space-y-2">
              <BarList title="Denials by reason" rows={reasonRows(stats.decisions.denied_by_reason, showAllReasons)
                .map((r) => ({ key: r.reason, label: r.label, value: r.value }))} empty="No denials yet." />
              <button type="button" onClick={() => setShowAllReasons((s) => !s)} className="text-sm text-blue-700 underline">
                {showAllReasons ? "Hide empty reasons" : "Show all reasons"}
              </button>
            </div>
          </div>
        </>
      )}
      <LiveFeed events={feedForEvent} />
    </section>
  );
}

const PILL: Record<FeedStatus, { text: string; style: string }> = {
  connecting: { text: "Connecting…", style: "bg-slate-100 text-slate-700" },
  live: { text: "● Live", style: "bg-emerald-100 text-emerald-800" },
  reconnecting: { text: "Reconnecting…", style: "bg-amber-100 text-amber-900" },
  unauthorized: { text: "Session expired — log in again", style: "bg-red-100 text-red-800" },
};

function FeedPill({ status }: { status: FeedStatus }) {
  return <span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${PILL[status].style}`}>{PILL[status].text}</span>;
}

function LiveFeed({ events }: { events: AccessEvent[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Live entries</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Waiting for the first scan…</p>
      ) : (
        <ul aria-label="Live entries" className="mt-3 divide-y divide-slate-100 text-sm">
          {events.map((e) => (
            <li key={`${e.timestamp}-${e.gate_id}-${e.ticket_id ?? "x"}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="tabular-nums text-slate-500">{timeFormat.format(new Date(e.timestamp))}</span>
              <span className={e.result === "APPROVED" ? "text-emerald-700" : "text-red-700"}>
                {e.result === "APPROVED" ? "✓ Approved" : "✕ Denied"}
              </span>
              <span className="font-medium text-slate-900">{e.user_name ?? "Unknown"}</span>
              {e.result === "DENIED" && <span className="text-slate-600">{REASON_LABEL[e.reason]}</span>}
              <span className="ml-auto text-xs text-slate-500">{e.gate_id} · {e.method}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

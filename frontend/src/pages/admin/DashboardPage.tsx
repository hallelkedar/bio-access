import { useCallback, useEffect, useRef, useState } from "react";

import { listAllEvents } from "../../api/adminEvents";
import { getEventStats, type AccessEvent, type EventStats } from "../../api/adminStats";
import { apiErrorMessage } from "../../api/errors";
import type { Event } from "../../api/types";
import { BarList } from "../../components/charts/BarList";
import { reasonLabel, reasonRows } from "../../components/charts/chartMath";
import { ColumnChart, type Column } from "../../components/charts/ColumnChart";
import { OccupancyGauge } from "../../components/charts/OccupancyGauge";
import { StatTile } from "../../components/charts/StatTile";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { SkeletonText, SkeletonTiles } from "../../components/ui";
import { localeFor } from "../../format";
import { useAdminFeed, type FeedStatus } from "../../hooks/useAdminFeed";
import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { Lang } from "../../i18n/translate";

function timeFormat(lang: Lang): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(localeFor(lang), { hour: "2-digit", minute: "2-digit" });
}

export function bucketColumns(stats: EventStats, lang: Lang = "en"): Column[] {
  const format = timeFormat(lang);
  return stats.entries_per_30_min.map((bucket) => {
    const start = new Date(bucket.bucket_start);
    const end = new Date(start.getTime() + 30 * 60_000);
    return {
      key: bucket.bucket_start,
      label: format.format(start),
      description: `${format.format(start)}–${format.format(end)}`,
      value: bucket.approved,
    };
  });
}

/**
 * The event to open the dashboard on: one that is running now, else the next one to start,
 * else any active one, else the first. (The list is newest-first, so "first ACTIVE" used to
 * pick an event months away while today's was live.)
 */
export function pickDefaultEvent(events: Event[], now: Date = new Date()): Event | null {
  const active = events.filter((e) => e.status === "ACTIVE");
  const t = now.getTime();
  const running = active.find((e) => new Date(e.starts_at).getTime() <= t && t < new Date(e.ends_at).getTime());
  const next = active
    .filter((e) => new Date(e.starts_at).getTime() > t)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
  return running ?? next ?? active[0] ?? events[0] ?? null;
}

function percentFormat(lang: Lang): Intl.NumberFormat {
  return new Intl.NumberFormat(localeFor(lang), { style: "percent", maximumFractionDigits: 1 });
}

/** "15%" / "12.5%"; "—" when there is no capacity to divide by. */
export function occupancyPercent(entered: number, capacity: number, lang: Lang): string {
  if (capacity <= 0) return "—";
  return percentFormat(lang).format(entered / capacity);
}

export function DashboardPage({ refreshDelayMs = 1000 }: { refreshDelayMs?: number }) {
  const { t, lang } = useLanguage();
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
        setEventId(pickDefaultEvent(all)?.id ?? null);
      })
      .catch((err) => setError(apiErrorMessage(err, {}, lang)));
  }, []);

  const loadStats = useCallback(async (id: number) => {
    try {
      setStats(await getEventStats(id));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    }
  }, [lang]);

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
  if (!events) return <Spinner label={t("dash.loading")} />;
  if (events.length === 0) {
    return (
      <section className={PANEL}>
        <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
        <p className="mt-2 text-muted">{t("dash.noEvents")}</p>
      </section>
    );
  }

  return (
    <section className={`${PANEL} space-y-6`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("dash.title")}</h1>
        <label className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto sm:max-w-md sm:flex-1">
          <span className="shrink-0 text-muted">{t("dash.event")}</span>
          <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}
            className="w-full min-w-0 truncate rounded-md border border-border bg-surface-2 px-2 py-1 text-text focus-visible:outline-2 focus-visible:outline-brand-300">
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({t(`eventStatus.${e.status}`)})</option>)}
          </select>
        </label>
        <FeedPill status={feed.status} />
      </div>
      <ErrorBox message={error} />
      {!stats ? (
        <div className="space-y-6">
          <SkeletonTiles count={4} />
          <SkeletonText lines={3} className="rounded-xl border border-border bg-surface-2 p-4" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={t("dash.inside")} value={stats.occupancy.entered} />
            <StatTile label={t("dash.approved")} value={stats.decisions.approved} />
            <StatTile label={t("dash.denied")} value={stats.decisions.denied} />
            <StatTile label={t("dash.occupancy")}
              value={stats.occupancy.capacity > 0 ? stats.occupancy.entered / stats.occupancy.capacity : occupancyPercent(0, 0, lang)}
              format={(ratio) => percentFormat(lang).format(ratio)} />
          </div>
          <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <OccupancyGauge entered={stats.occupancy.entered} sold={stats.occupancy.sold} capacity={stats.occupancy.capacity} />
            <ColumnChart title={t("dash.entriesTitle")} columns={bucketColumns(stats, lang)} unit={t("dash.entriesUnit")} empty={t("dash.noEntries")} />
          </div>
          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <BarList title={t("dash.denialsTitle")} rows={reasonRows(stats.decisions.denied_by_reason, showAllReasons, lang)
              .map((r) => ({ key: r.reason, label: r.label, value: r.value }))} empty={t("dash.noDenials")}
              footer={
                <button type="button" onClick={() => setShowAllReasons((v) => !v)} className="text-sm text-brand-700 underline dark:text-brand-300">
                  {showAllReasons ? t("dash.hideEmptyReasons") : t("dash.showAllReasons")}
                </button>
              } />
            <LiveFeed events={feedForEvent} />
          </div>
        </>
      )}
      {!stats && <LiveFeed events={feedForEvent} />}
    </section>
  );
}

/** The control-room look: a dark panel that bleeds to the edges on phones. */
const PANEL = "theme-dark -mx-4 -mt-6 rounded-none px-4 py-6 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:p-6";

const PILL: Record<FeedStatus, { textKey: TranslationKey; chip: string; dot: string }> = {
  connecting: { textKey: "dash.pill.connecting", chip: "bg-slate-400/10 text-slate-300 ring-slate-400/30", dot: "bg-slate-400" },
  live: { textKey: "dash.pill.live", chip: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30", dot: "animate-live-dot bg-emerald-400" },
  reconnecting: { textKey: "dash.pill.reconnecting", chip: "bg-amber-400/10 text-amber-300 ring-amber-400/30", dot: "bg-amber-400" },
  unauthorized: { textKey: "dash.pill.unauthorized", chip: "bg-rose-400/10 text-rose-300 ring-rose-400/30", dot: "bg-rose-500" },
};

/** LIVE indicator: the dot pulses only while connected (the pulse stops under reduced motion). */
function FeedPill({ status }: { status: FeedStatus }) {
  const { t } = useLanguage();
  return (
    <span role="status" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${PILL[status].chip}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${PILL[status].dot}`} />
      {t(PILL[status].textKey)}
    </span>
  );
}

/** Newest first, scrolls inside its own box; "Pause" freezes the list while you read it. */
function LiveFeed({ events }: { events: AccessEvent[] }) {
  const { t, lang } = useLanguage();
  const [frozen, setFrozen] = useState<AccessEvent[] | null>(null);
  const shown = frozen ?? events;
  const waiting = frozen ? events.length - frozen.length : 0;
  return (
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("dash.liveTitle")}</h2>
        <div className="flex items-center gap-3 text-sm">
          {frozen && waiting > 0 && <span className="text-muted">{t("dash.newWhilePaused", { count: waiting })}</span>}
          <button type="button" aria-pressed={frozen !== null} onClick={() => setFrozen((f) => (f ? null : events))}
            className="rounded-md border border-border px-2.5 py-1 font-medium text-text hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-brand-300 aria-pressed:border-amber-400/50 aria-pressed:text-amber-300">
            {frozen ? t("dash.resume") : t("dash.pause")}
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("dash.waiting")}</p>
      ) : (
        <ul aria-label={t("dash.liveTitle")} className="mt-3 max-h-80 space-y-1.5 overflow-y-auto overflow-x-hidden text-sm">
          {/* Each row animates once, when it first mounts: new scans slide in at the top. */}
          {shown.map((e) => {
            const ok = e.result === "APPROVED";
            return (
              <li key={`${e.timestamp}-${e.gate_id}-${e.ticket_id ?? "x"}`}
                className={`flex animate-feed-in flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-s-4 bg-white/[0.03] px-3 py-2 ${
                  ok ? "border-emerald-400 [--feed-flash:rgb(52_211_153/0.22)]" : "border-rose-400 [--feed-flash:rgb(251_113_133/0.22)]"
                }`}>
                <span className="tabular-nums text-muted">{timeFormat(lang).format(new Date(e.timestamp))}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ok ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
                  {ok ? t("dash.approvedMark") : t("dash.deniedMark")}
                </span>
                <span className="font-medium text-text">{e.user_name ?? t("dash.unknownPerson")}</span>
                {!ok && <span className="text-muted">{reasonLabel(lang, e.reason)}</span>}
                <span className="ms-auto text-xs text-muted">{e.gate_id} · {t(`method.${e.method}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

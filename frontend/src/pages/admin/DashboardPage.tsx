import { useCallback, useEffect, useRef, useState } from "react";

import { listAllEvents } from "../../api/adminEvents";
import { getEventStats, type AccessEvent, type EventStats } from "../../api/adminStats";
import { apiErrorMessage } from "../../api/errors";
import type { Event } from "../../api/types";
import { BarList } from "../../components/charts/BarList";
import { reasonLabel, reasonRows } from "../../components/charts/chartMath";
import { ColumnChart, type Column } from "../../components/charts/ColumnChart";
import { Meter } from "../../components/charts/Meter";
import { StatTile } from "../../components/charts/StatTile";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
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
        setEventId((all.find((e) => e.status === "ACTIVE") ?? all[0])?.id ?? null);
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
      <section>
        <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
        <p className="mt-2 text-slate-600">{t("dash.noEvents")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold">{t("dash.title")}</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-600">{t("dash.event")}</span>
          <select value={eventId ?? ""} onChange={(e) => setEventId(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1">
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({t(`eventStatus.${e.status}`)})</option>)}
          </select>
        </label>
        <FeedPill status={feed.status} />
      </div>
      <ErrorBox message={error} />
      {!stats ? (
        <Spinner label={t("dash.loadingNumbers")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label={t("dash.inside")} value={String(stats.occupancy.entered)} />
            <StatTile label={t("dash.approved")} value={String(stats.decisions.approved)} />
            <StatTile label={t("dash.denied")} value={String(stats.decisions.denied)} />
            <StatTile label={t("dash.occupancy")} value={`${stats.occupancy.percent}%`} />
          </div>
          <Meter entered={stats.occupancy.entered} sold={stats.occupancy.sold} capacity={stats.occupancy.capacity} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ColumnChart title={t("dash.entriesTitle")} columns={bucketColumns(stats, lang)} unit={t("dash.entriesUnit")} />
            <div className="space-y-2">
              <BarList title={t("dash.denialsTitle")} rows={reasonRows(stats.decisions.denied_by_reason, showAllReasons, lang)
                .map((r) => ({ key: r.reason, label: r.label, value: r.value }))} empty={t("dash.noDenials")} />
              <button type="button" onClick={() => setShowAllReasons((s) => !s)} className="text-sm text-blue-700 underline">
                {showAllReasons ? t("dash.hideEmptyReasons") : t("dash.showAllReasons")}
              </button>
            </div>
          </div>
        </>
      )}
      <LiveFeed events={feedForEvent} />
    </section>
  );
}

const PILL: Record<FeedStatus, { textKey: TranslationKey; style: string }> = {
  connecting: { textKey: "dash.pill.connecting", style: "bg-slate-100 text-slate-700" },
  live: { textKey: "dash.pill.live", style: "bg-emerald-100 text-emerald-800" },
  reconnecting: { textKey: "dash.pill.reconnecting", style: "bg-amber-100 text-amber-900" },
  unauthorized: { textKey: "dash.pill.unauthorized", style: "bg-red-100 text-red-800" },
};

function FeedPill({ status }: { status: FeedStatus }) {
  const { t } = useLanguage();
  return <span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${PILL[status].style}`}>{t(PILL[status].textKey)}</span>;
}

function LiveFeed({ events }: { events: AccessEvent[] }) {
  const { t, lang } = useLanguage();
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{t("dash.liveTitle")}</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{t("dash.waiting")}</p>
      ) : (
        <ul aria-label={t("dash.liveTitle")} className="mt-3 divide-y divide-slate-100 text-sm">
          {events.map((e) => (
            <li key={`${e.timestamp}-${e.gate_id}-${e.ticket_id ?? "x"}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="tabular-nums text-slate-500">{timeFormat(lang).format(new Date(e.timestamp))}</span>
              <span className={e.result === "APPROVED" ? "text-emerald-700" : "text-red-700"}>
                {e.result === "APPROVED" ? t("dash.approvedMark") : t("dash.deniedMark")}
              </span>
              <span className="font-medium text-slate-900">{e.user_name ?? t("dash.unknownPerson")}</span>
              {e.result === "DENIED" && <span className="text-slate-600">{reasonLabel(lang, e.reason)}</span>}
              <span className="ms-auto text-xs text-slate-500">{e.gate_id} · {t(`method.${e.method}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

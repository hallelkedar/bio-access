import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { listEvents } from "../../api/events";
import { buyTicket, myTickets, startCheckout } from "../../api/tickets";
import type { Event, MyTicket } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Place } from "../../components/Place";
import { Badge, Button, Card, EmptyState, Skeleton, useToast } from "../../components/ui";
import { formatDateTime, formatPrice, localeFor } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import { redirectTo } from "../../navigation";
import { CancelTicketButton } from "./CancelTicketButton";
import { EVENT_FILTERS, eventTiming, matchesFilter, type EventFilter } from "./eventTiming";

type Loaded = { events: Event[]; tickets: Map<number, MyTicket> };

export function EventsPage() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventFilter>("all");

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const [events, tickets] = await Promise.all([listEvents(), myTickets()]);
      setData({ events, tickets: new Map(tickets.map((t) => [t.event_id, t])) });
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    }
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Reload after a change (e.g. a cancel) without blanking the page. */
  const refresh = useCallback(async () => {
    try {
      const [events, tickets] = await Promise.all([listEvents(), myTickets()]);
      setData({ events, tickets: new Map(tickets.map((t) => [t.event_id, t])) });
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    }
  }, [lang]);

  if (error) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{t("events.title")}</h1>
        <div className="mt-4 space-y-3">
          <ErrorBox message={error} />
          <Button variant="secondary" onClick={() => void load()} className="min-h-11 sm:min-h-0">
            {t("common.retry")}
          </Button>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{t("events.title")}</h1>
        <EventGridSkeleton />
      </section>
    );
  }

  const now = new Date();
  const shown = data.events.filter((event) => matchesFilter(event, filter, now));
  return (
    <section>
      <h1 className="text-2xl font-bold">{t("events.title")}</h1>
      {data.events.length === 0 ? (
        <EmptyState title={t("events.empty")} className="mt-6" />
      ) : (
        <>
          <div role="group" aria-label={t("events.filter.label")} className="mt-4 flex flex-wrap gap-2">
            {EVENT_FILTERS.map((option) => (
              <button key={option} type="button" aria-pressed={filter === option} onClick={() => setFilter(option)}
                className={`min-h-11 rounded-full px-4 text-sm font-medium ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:scale-[0.97] sm:min-h-9 ${
                  filter === option
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-surface text-text ring-border hover:bg-surface-2"
                }`}>
                {t(`events.filter.${option}`)}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState title={t("events.noMatch")} className="mt-6"
              action={<Button variant="secondary" onClick={() => setFilter("all")}>{t("events.showAll")}</Button>} />
          ) : (
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((event) => (
                <EventCard key={event.id} event={event} now={now} ticket={data.tickets.get(event.id)} onChanged={() => void refresh()} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Card-shaped placeholders while the catalog loads. */
function EventGridSkeleton() {
  const { t } = useLanguage();
  return (
    <div role="status" aria-busy="true" aria-label={t("events.loading")} className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-border bg-surface">
          <Skeleton className="h-40 w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-4 h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Month / day / weekday, as on the My tickets stubs. */
function DateBlock({ iso }: { iso: string }) {
  const { lang } = useLanguage();
  const locale = localeFor(lang);
  const starts = new Date(iso);
  return (
    <div className="flex w-14 flex-col items-center rounded-lg bg-white/95 py-1.5 text-slate-900 shadow-card" aria-hidden="true">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
        {new Intl.DateTimeFormat(locale, { month: "short" }).format(starts)}
      </span>
      <span className="text-2xl font-bold leading-none tabular-nums">{starts.getDate()}</span>
      <span className="text-[11px] text-slate-500">{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(starts)}</span>
    </div>
  );
}

function TimingBadge({ event, now }: { event: Event; now: Date }) {
  const { t } = useLanguage();
  const timing = eventTiming(event, now);
  if (timing === "LATER") return null;
  if (timing === "LIVE_NOW") {
    return (
      <Badge tone="ok" className="shadow-card">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
        </span>
        {t("events.timing.LIVE_NOW")}
      </Badge>
    );
  }
  const tone = timing === "TODAY" ? "warn" : timing === "THIS_WEEK" ? "brand" : "neutral";
  return <Badge tone={tone} className="shadow-card">{t(`events.timing.${timing}`)}</Badge>;
}

function EventCard({ event, now, ticket, onChanged }: { event: Event; now: Date; ticket: MyTicket | undefined; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  return (
    <li>
      <Card interactive className="flex h-full flex-col overflow-hidden">
        <div className="relative h-40">
          {event.cover_image_url ? (
            <img src={event.cover_image_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-brand-600 to-accent-500" aria-hidden />
          )}
          <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <DateBlock iso={event.starts_at} />
            <TimingBadge event={event} now={now} />
          </div>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <h2 className="text-lg font-semibold">{event.name}</h2>
          <p className="text-sm text-muted"><Place location={event.location} /></p>
          <p className="mt-1 text-sm text-muted"><bdi>{formatDateTime(event.starts_at, lang)}</bdi></p>
          <p className="mt-2 text-lg font-semibold tabular-nums">
            {event.price_cents === 0 ? t("events.free") : formatPrice(event.price_cents, event.currency, lang)}
          </p>
          <div className="mt-auto pt-4">
            <TicketAction event={event} ticket={ticket} onChanged={onChanged} />
          </div>
        </div>
      </Card>
    </li>
  );
}

function TicketAction({ event, ticket, onChanged }: { event: Event; ticket: MyTicket | undefined; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ticket && (ticket.status === "VALID" || ticket.status === "ENTERED")) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="ok" className="px-3 py-1 text-sm">{t(ticket.status === "VALID" ? "events.haveTicket" : "events.entered")}</Badge>
        <Link to={`/tickets#ticket-${ticket.id}`}
          className="inline-flex min-h-11 items-center rounded-md px-1 text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 sm:min-h-0">
          {t("events.viewTicket")}
        </Link>
      </div>
    );
  }
  const pending = ticket?.status === "PENDING_PAYMENT";

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      // A pending ticket already holds a seat: just open a new checkout for it.
      const ticketId = pending && ticket ? ticket.id : (await buyTicket(event.id)).id;
      redirectTo(await startCheckout(ticketId));
    } catch (err) {
      const message = apiErrorMessage(err, {}, lang);
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => void pay()} loading={busy} className="min-h-11 w-full">
        {busy ? t("common.redirecting") : pending ? t("events.completePayment") : t("events.buy")}
      </Button>
      {pending && ticket && (
        <div className="text-center">
          <CancelTicketButton ticketId={ticket.id} eventName={event.name} onDone={onChanged} />
        </div>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { listEvents } from "../../api/events";
import { buyTicket, myTickets, startCheckout } from "../../api/tickets";
import type { Event, MyTicket } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { formatDateTime, formatPrice } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import { redirectTo } from "../../navigation";
import { CancelTicketButton } from "./CancelTicketButton";

type Loaded = { events: Event[]; tickets: Map<number, MyTicket> };

export function EventsPage() {
  const { t, lang } = useLanguage();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <button type="button" onClick={() => void load()} className="rounded-md border px-3 py-1.5 text-sm">
            {t("common.retry")}
          </button>
        </div>
      </section>
    );
  }
  if (!data) {
    return <Spinner label={t("events.loading")} />;
  }
  return (
    <section>
      <h1 className="text-2xl font-bold">{t("events.title")}</h1>
      {data.events.length === 0 ? (
        <p className="mt-4 text-slate-600">{t("events.empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.events.map((event) => (
            <EventCard key={event.id} event={event} ticket={data.tickets.get(event.id)} onChanged={() => void refresh()} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EventCard({ event, ticket, onChanged }: { event: Event; ticket: MyTicket | undefined; onChanged: () => void }) {
  const { lang } = useLanguage();
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {event.cover_image_url ? (
        <img src={event.cover_image_url} alt="" className="h-40 w-full object-cover" />
      ) : (
        <div className="h-40 w-full bg-gradient-to-br from-slate-200 to-slate-300" aria-hidden />
      )}
      <div className="flex flex-1 flex-col p-4">
        <h2 className="text-lg font-semibold">{event.name}</h2>
        <p className="text-sm text-slate-600">{event.location}</p>
        <p className="mt-1 text-sm text-slate-600">{formatDateTime(event.starts_at, lang)}</p>
        <p className="mt-2 font-medium">{formatPrice(event.price_cents, event.currency, lang)}</p>
        <div className="mt-auto pt-4">
          <TicketAction event={event} ticket={ticket} onChanged={onChanged} />
        </div>
      </div>
    </li>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800">{children}</span>;
}

function TicketAction({ event, ticket, onChanged }: { event: Event; ticket: MyTicket | undefined; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ticket && (ticket.status === "VALID" || ticket.status === "ENTERED")) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge>{t(ticket.status === "VALID" ? "events.haveTicket" : "events.entered")}</Badge>
        <Link to={`/tickets#ticket-${ticket.id}`}
          className="rounded-md px-1 text-sm font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
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
      setError(apiErrorMessage(err, {}, lang));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? t("common.redirecting") : pending ? t("events.completePayment") : t("events.buy")}
      </button>
      {pending && ticket && (
        <div className="text-center">
          <CancelTicketButton ticketId={ticket.id} eventName={event.name} onDone={onChanged} />
        </div>
      )}
      <ErrorBox message={error} />
    </div>
  );
}

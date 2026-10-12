import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { fetchQrImage, myTickets, startCheckout } from "../../api/tickets";
import type { MyTicket, TicketStatus } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { Modal } from "../../components/ui";
import { formatDateTime, localeFor } from "../../format";
import { useClock } from "../../hooks/useClock";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useLanguage } from "../../i18n/LanguageProvider";
import { redirectTo } from "../../navigation";
import { effectiveState, formatCountdown, isPast, isUsable, type TicketState } from "./ticketState";

const STATUS_STYLE: Record<TicketStatus, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-800",
  VALID: "bg-emerald-100 text-emerald-800",
  ENTERED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

/** How often the page re-checks the time, so a card flips to "Event ended" without a reload. */
const CLOCK_MS = 30_000;

type Item = { ticket: MyTicket; state: TicketState };

/** Upcoming events first (soonest on top), then past ones (most recent on top). */
export function sortTickets(tickets: MyTicket[], now: Date = new Date()): MyTicket[] {
  const ends = (t: MyTicket) => new Date(t.event.ends_at).getTime();
  const starts = (t: MyTicket) => new Date(t.event.starts_at).getTime();
  const upcoming = tickets.filter((t) => ends(t) > now.getTime()).sort((a, b) => starts(a) - starts(b));
  const past = tickets.filter((t) => ends(t) <= now.getTime()).sort((a, b) => starts(b) - starts(a));
  return [...upcoming, ...past];
}

export function MyTicketsPage() {
  const { t, lang } = useLanguage();
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const now = useClock(CLOCK_MS);

  const load = useCallback(async () => {
    setError(null);
    setTickets(null);
    try {
      setTickets(await myTickets());
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    }
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    if (!tickets) return null;
    const items: Item[] = sortTickets(tickets, now).map((ticket) => ({ ticket, state: effectiveState(ticket, now) }));
    const upcoming = items.filter((i) => !isPast(i.ticket, i.state, now));
    return {
      upcoming,
      past: items.filter((i) => isPast(i.ticket, i.state, now)),
      next: upcoming.find((i) => isUsable(i.state)) ?? null,
    };
  }, [tickets, now]);

  // /tickets#ticket-42 (the "View ticket" link on Events): bring that card into view once loaded.
  const { hash } = useLocation();
  const reducedMotion = usePrefersReducedMotion();
  const targetId = Number(/^#ticket-(\d+)$/.exec(hash)?.[1] ?? NaN);
  const targetIsPast = groups?.past.some((i) => i.ticket.id === targetId) ?? false;
  useEffect(() => {
    if (targetIsPast) setPastOpen(true);
  }, [targetIsPast]);
  useEffect(() => {
    if (!tickets || Number.isNaN(targetId)) return;
    const card = document.getElementById(`ticket-${targetId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    card.focus({ preventScroll: true });
  }, [tickets, targetId, reducedMotion, pastOpen]);

  const renderList = (items: Item[]) => (
    <ul className="mt-3 space-y-4">
      {items.map(({ ticket, state }) => (
        <TicketCard key={ticket.id} ticket={ticket} state={state} now={now} highlighted={ticket.id === targetId} />
      ))}
    </ul>
  );

  return (
    <section>
      <h1 className="text-2xl font-bold">{t("tickets.title")}</h1>
      {error ? (
        <div className="mt-4 space-y-3">
          <ErrorBox message={error} />
          <button type="button" onClick={() => void load()} className="rounded-md border px-3 py-1.5 text-sm">
            {t("common.retry")}
          </button>
        </div>
      ) : !groups ? (
        <Spinner label={t("tickets.loading")} />
      ) : groups.upcoming.length + groups.past.length === 0 ? (
        <p className="mt-4 text-slate-600">
          {t("tickets.empty")} <Link to="/events" className="text-blue-700 underline">{t("tickets.browse")}</Link>
        </p>
      ) : (
        // Desktop: tickets ¾, the next-event panel ¼ (sticky). Mobile: the panel comes first, compact.
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <aside aria-label={t("next.title")} className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
            <NextUp item={groups.next} now={now} />
          </aside>
          <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-1">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t("tickets.upcoming")}</h2>
              {groups.upcoming.length > 0 ? renderList(groups.upcoming) : <p className="mt-3 text-sm text-slate-500">{t("tickets.noUpcoming")}</p>}
            </section>
            {groups.past.length > 0 && (
              <section>
                <button type="button" aria-expanded={pastOpen} onClick={() => setPastOpen((open) => !open)}
                  className="flex items-center gap-1.5 rounded-md text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-brand-500">
                  <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${pastOpen ? "rotate-90" : "rtl:rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7.5 4.5L13 10l-5.5 5.5" />
                  </svg>
                  {t("tickets.past", { count: groups.past.length })}
                </button>
                {pastOpen && renderList(groups.past)}
              </section>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Cover picture with a dark wash, or the brand gradient when the event has none. */
function CoverBackdrop({ url }: { url: string | null }) {
  return url ? (
    <>
      <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <span className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/45 to-slate-950/20" aria-hidden="true" />
    </>
  ) : (
    <span className="absolute inset-0 bg-gradient-to-br from-brand-600 to-accent-500" aria-hidden="true" />
  );
}

function LiveBadge() {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
      </span>
      {t("tickets.state.LIVE_NOW")}
    </span>
  );
}

function TicketCard({ ticket, state, now, highlighted = false }: { ticket: MyTicket; state: TicketState; now: Date; highlighted?: boolean }) {
  const { t, lang } = useLanguage();
  const locale = localeFor(lang);
  const starts = new Date(ticket.event.starts_at);
  const usable = isUsable(state);
  const muted = state === "CANCELLED" || state === "ENDED" || state === "EVENT_CLOSED";
  const gone = state === "ENDED" || state === "EVENT_CLOSED";
  const goneLabel = ticket.status === "PENDING_PAYMENT" ? t("tickets.state.unavailable") : t(state === "ENDED" ? "tickets.state.ENDED" : "tickets.state.EVENT_CLOSED");

  return (
    <li id={`ticket-${ticket.id}`} tabIndex={-1} data-highlighted={highlighted || undefined} data-state={state}
      className={`scroll-mt-24 overflow-hidden rounded-card border border-slate-200 bg-white shadow-card focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-500 ${highlighted ? "animate-ticket-flash" : ""}`}>
      <div className={`flex flex-col sm:flex-row ${muted ? "opacity-70" : ""}`}>
        {/* Date block (start side), over the event's cover */}
        <div className={`relative flex h-24 shrink-0 items-end p-3 text-white sm:h-auto sm:w-28 sm:flex-col sm:items-center sm:justify-center ${muted ? "grayscale" : ""}`}>
          <CoverBackdrop url={ticket.event.cover_image_url} />
          <div className="relative flex items-baseline gap-2 sm:flex-col sm:items-center sm:gap-0">
            <span className="text-xs font-semibold uppercase tracking-wider">{new Intl.DateTimeFormat(locale, { month: "short" }).format(starts)}</span>
            <span className="text-3xl font-bold leading-none tabular-nums">{starts.getDate()}</span>
            <span className="text-xs opacity-90">{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(starts)}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 p-4">
          <h3 className="text-lg font-semibold">{ticket.event.name}</h3>
          <p className="text-sm text-slate-600">
            <bdi>{ticket.event.location}</bdi> · <bdi>{formatDateTime(ticket.event.starts_at, lang)}</bdi>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {gone ? (
              <span className="inline-block rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">{goneLabel}</span>
            ) : (
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}>
                {t(`tickets.status.${ticket.status}`)}
              </span>
            )}
            {state === "LIVE_NOW" && <LiveBadge />}
            {state === "UPCOMING" && (
              <span className="text-xs font-medium text-slate-500">
                {t("tickets.countdown", { time: formatCountdown(starts.getTime() - now.getTime(), lang) })}
              </span>
            )}
          </div>
          {ticket.status === "ENTERED" && ticket.entered_at && (
            <p className="mt-2 text-sm text-slate-600">{t("tickets.enteredAt", { time: formatDateTime(ticket.entered_at, lang) })}</p>
          )}
          {usable && (
            <p className="mt-3 text-sm">
              {ticket.enrolled ? (
                <span className="text-emerald-700">{t("tickets.faceReady")}</span>
              ) : (
                <Link to={`/enroll/${ticket.id}`} className="text-blue-700 underline">
                  {t("tickets.setUpFace")}
                </Link>
              )}
            </p>
          )}
          {state === "AWAITING_PAYMENT" && <CompletePayment ticketId={ticket.id} />}
        </div>

        {usable && ticket.status === "VALID" && (
          // The stub: a dashed tear line with two notches, then the QR.
          <div className="relative flex items-center justify-center border-t-2 border-dashed border-slate-200 p-4 sm:border-s-2 sm:border-t-0">
            <span aria-hidden="true" className="absolute -top-3 -start-3 h-6 w-6 rounded-full border border-slate-200 bg-slate-50" />
            <span aria-hidden="true" className="absolute -end-3 -top-3 h-6 w-6 rounded-full border border-slate-200 bg-slate-50 sm:end-auto sm:top-auto sm:-bottom-3 sm:-start-3" />
            <QrCode ticketId={ticket.id} eventName={ticket.event.name} />
          </div>
        )}
      </div>
    </li>
  );
}

/** The side panel: the next usable ticket, what's left to do for it, and how the gate works. */
function NextUp({ item, now }: { item: Item | null; now: Date }) {
  const { t, lang } = useLanguage();
  if (!item) {
    return (
      <div className="rounded-card border border-dashed border-slate-300 bg-white p-4 text-sm">
        <p className="font-semibold text-slate-800">{t("next.title")}</p>
        <p className="mt-1 text-slate-500">{t("next.empty")}</p>
        <Link to="/events" className="mt-3 inline-block font-medium text-blue-700 underline-offset-2 hover:underline">{t("tickets.browse")}</Link>
      </div>
    );
  }
  const { ticket, state } = item;
  const starts = new Date(ticket.event.starts_at);
  const Check = () => (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 10.5l3.2 3.2L15 7" />
    </svg>
  );

  return (
    <div className="overflow-hidden rounded-card border border-slate-200 bg-white shadow-card">
      <div className="relative h-24 lg:h-28">
        <CoverBackdrop url={ticket.event.cover_image_url} />
        <p className="absolute bottom-2 start-3 text-xs font-semibold uppercase tracking-wider text-white/90">{t("next.title")}</p>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <p className="font-semibold leading-snug text-slate-900">{ticket.event.name}</p>
          <p className="mt-0.5 text-sm text-slate-600"><bdi>{formatDateTime(ticket.event.starts_at, lang)}</bdi></p>
          <div className="mt-2">
            {state === "LIVE_NOW" ? (
              <LiveBadge />
            ) : (
              <p className="whitespace-nowrap text-xl font-bold tabular-nums text-brand-700">
                {t("tickets.countdown", { time: formatCountdown(starts.getTime() - now.getTime(), lang) })}
              </p>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("next.checklist")}</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="flex items-center gap-2"><Check />{t("next.paid")}</li>
            <li className="flex items-center gap-2">
              {ticket.enrolled ? (
                <><Check />{t("next.face")} · {t("next.faceReady")}</>
              ) : (
                <>
                  <span className="h-4 w-4 shrink-0 rounded-full border-2 border-amber-400" aria-hidden="true" />
                  {t("next.face")} ·{" "}
                  <Link to={`/enroll/${ticket.id}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">{t("next.faceSetUp")}</Link>
                </>
              )}
            </li>
            <li className="flex items-center gap-2"><Check />{t("next.qr")} · {t("next.qrReady")}</li>
          </ul>
        </div>

        <div className="hidden border-t border-slate-100 pt-4 lg:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("next.howTitle")}</p>
          <ol className="mt-2 space-y-2 text-sm text-slate-700">
            {(["next.how1", "next.how2", "next.how3"] as const).map((key, i) => (
              <li key={key} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{i + 1}</span>
                {t(key)}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-slate-500">{t("next.howQr")}</p>
        </div>
      </div>
    </div>
  );
}

function QrCode({ ticketId, eventName }: { ticketId: number; eventName: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [large, setLarge] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    setFailed(false);
    fetchQrImage(ticketId)
      .then((created) => {
        objectUrl = created;
        if (active) setUrl(created);
        else URL.revokeObjectURL(created);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl); // free the image memory
    };
  }, [ticketId, attempt]);

  if (failed) {
    return (
      <div className="text-sm text-slate-600">
        {t("tickets.qrFailed")}{" "}
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-blue-700 underline">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  // The box keeps the QR's size while it loads, so cards below don't jump (and #ticket-N scrolling stays put).
  return (
    <figure className="text-center">
      {url ? (
        <img src={url} alt={t("tickets.qrAlt", { event: eventName })} onClick={() => setLarge(true)}
          className="h-36 w-36 cursor-zoom-in rounded border border-slate-200" />
      ) : (
        <div className="flex h-36 w-36 items-center justify-center rounded border border-slate-200 px-2 text-xs">
          <Spinner label={t("tickets.qrLoading")} />
        </div>
      )}
      <figcaption className="mt-1 max-w-36 text-xs text-slate-500">
        {t("tickets.qrCaption")}
        {url && (
          <button type="button" onClick={() => setLarge(true)} className="mt-1 block w-full font-medium text-blue-700 underline-offset-2 hover:underline">
            {t("tickets.qrLarger")}
          </button>
        )}
      </figcaption>
      {url && (
        <Modal open={large} title={t("tickets.qrDialogTitle", { event: eventName })} onClose={() => setLarge(false)}>
          <img src={url} alt={t("tickets.qrAlt", { event: eventName })} className="mx-auto aspect-square w-full max-w-xs rounded-lg border border-slate-200 [image-rendering:pixelated]" />
        </Modal>
      )}
    </figure>
  );
}

function CompletePayment({ ticketId }: { ticketId: number }) {
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      redirectTo(await startCheckout(ticketId));
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button type="button" onClick={() => void pay()} disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
        {busy ? t("common.redirecting") : t("tickets.completePayment")}
      </button>
      <ErrorBox message={error} />
    </div>
  );
}

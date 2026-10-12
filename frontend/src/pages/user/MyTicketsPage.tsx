import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { fetchQrImage, myTickets, startCheckout } from "../../api/tickets";
import type { MyTicket, TicketStatus } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { formatDateTime } from "../../format";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useLanguage } from "../../i18n/LanguageProvider";
import { redirectTo } from "../../navigation";

const STATUS_STYLE: Record<TicketStatus, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-800",
  VALID: "bg-emerald-100 text-emerald-800",
  ENTERED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

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

  const load = useCallback(async () => {
    setError(null);
    setTickets(null);
    try {
      setTickets(sortTickets(await myTickets()));
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    }
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  // /tickets#ticket-42 (the "View ticket" link on Events): bring that card into view once loaded.
  const { hash } = useLocation();
  const reducedMotion = usePrefersReducedMotion();
  const targetId = Number(/^#ticket-(\d+)$/.exec(hash)?.[1] ?? NaN);
  useEffect(() => {
    if (!tickets || Number.isNaN(targetId)) return;
    const card = document.getElementById(`ticket-${targetId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    card.focus({ preventScroll: true });
  }, [tickets, targetId, reducedMotion]);

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
      ) : !tickets ? (
        <Spinner label={t("tickets.loading")} />
      ) : tickets.length === 0 ? (
        <p className="mt-4 text-slate-600">
          {t("tickets.empty")} <Link to="/events" className="text-blue-700 underline">{t("tickets.browse")}</Link>
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} highlighted={ticket.id === targetId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TicketCard({ ticket, highlighted = false }: { ticket: MyTicket; highlighted?: boolean }) {
  const { t, lang } = useLanguage();
  const muted = ticket.status === "CANCELLED";
  return (
    <li id={`ticket-${ticket.id}`} tabIndex={-1} data-highlighted={highlighted || undefined}
      className={`scroll-mt-24 rounded-lg border border-slate-200 bg-white p-4 shadow-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-500 ${muted ? "opacity-60" : ""} ${highlighted ? "animate-ticket-flash" : ""}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{ticket.event.name}</h2>
          <p className="text-sm text-slate-600">
            {ticket.event.location} · {formatDateTime(ticket.event.starts_at, lang)}
          </p>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}>
            {t(`tickets.status.${ticket.status}`)}
          </span>
          {ticket.status === "ENTERED" && ticket.entered_at && (
            <p className="mt-2 text-sm text-slate-600">{t("tickets.enteredAt", { time: formatDateTime(ticket.entered_at, lang) })}</p>
          )}
          {ticket.status === "VALID" && (
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
          {ticket.status === "PENDING_PAYMENT" && <CompletePayment ticketId={ticket.id} />}
        </div>
        {ticket.status === "VALID" && <QrCode ticketId={ticket.id} eventName={ticket.event.name} />}
      </div>
    </li>
  );
}

function QrCode({ ticketId, eventName }: { ticketId: number; eventName: string }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
        <img src={url} alt={t("tickets.qrAlt", { event: eventName })} className="h-40 w-40 rounded border border-slate-200" />
      ) : (
        <div className="flex h-40 w-40 items-center justify-center rounded border border-slate-200 px-2 text-xs">
          <Spinner label={t("tickets.qrLoading")} />
        </div>
      )}
      <figcaption className="mt-1 max-w-40 text-xs text-slate-500">
        {t("tickets.qrCaption")}
      </figcaption>
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

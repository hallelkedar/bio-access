import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { fetchQrImage, myTickets, startCheckout } from "../../api/tickets";
import type { MyTicket, TicketStatus } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { formatDateTime } from "../../format";
import { redirectTo } from "../../navigation";

const STATUS_LABEL: Record<TicketStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  VALID: "Valid",
  ENTERED: "Used",
  CANCELLED: "Cancelled",
};

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
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setTickets(null);
    try {
      setTickets(sortTickets(await myTickets()));
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h1 className="text-2xl font-bold">My tickets</h1>
      {error ? (
        <div className="mt-4 space-y-3">
          <ErrorBox message={error} />
          <button type="button" onClick={() => void load()} className="rounded-md border px-3 py-1.5 text-sm">
            Retry
          </button>
        </div>
      ) : !tickets ? (
        <Spinner label="Loading tickets…" />
      ) : tickets.length === 0 ? (
        <p className="mt-4 text-slate-600">
          No tickets yet. <Link to="/events" className="text-blue-700 underline">Browse events</Link>
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TicketCard({ ticket }: { ticket: MyTicket }) {
  const muted = ticket.status === "CANCELLED";
  return (
    <li className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${muted ? "opacity-60" : ""}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{ticket.event.name}</h2>
          <p className="text-sm text-slate-600">
            {ticket.event.location} · {formatDateTime(ticket.event.starts_at)}
          </p>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}>
            {STATUS_LABEL[ticket.status]}
          </span>
          {ticket.status === "ENTERED" && ticket.entered_at && (
            <p className="mt-2 text-sm text-slate-600">Entered at {formatDateTime(ticket.entered_at)}</p>
          )}
          {ticket.status === "VALID" && (
            <p className="mt-3 text-sm">
              {ticket.enrolled ? (
                <span className="text-emerald-700">Face entry ready ✓</span>
              ) : (
                <Link to={`/enroll/${ticket.id}`} className="text-blue-700 underline">
                  Set up face entry
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
        Couldn't load the QR code.{" "}
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-blue-700 underline">
          Retry
        </button>
      </div>
    );
  }
  if (!url) return <Spinner label="Loading QR…" />;
  return (
    <figure className="text-center">
      <img src={url} alt={`Entry QR code for ${eventName}`} className="h-40 w-40 rounded border border-slate-200" />
      <figcaption className="mt-1 max-w-40 text-xs text-slate-500">
        Show this at the gate if face recognition isn't available.
      </figcaption>
    </figure>
  );
}

function CompletePayment({ ticketId }: { ticketId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      redirectTo(await startCheckout(ticketId));
    } catch (err) {
      setError(apiErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button type="button" onClick={() => void pay()} disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
        {busy ? "Redirecting…" : "Complete payment"}
      </button>
      <ErrorBox message={error} />
    </div>
  );
}

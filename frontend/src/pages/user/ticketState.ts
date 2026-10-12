// What a ticket means right now: the ticket's own status combined with the event's status
// and dates. A VALID ticket of a closed or finished event must not look usable.
import type { MyTicket } from "../../api/types";
import type { Lang } from "../../i18n/translate";

export type TicketState =
  | "UPCOMING"
  | "LIVE_NOW"
  | "ENDED"
  | "EVENT_CLOSED"
  | "USED"
  | "CANCELLED"
  | "AWAITING_PAYMENT";

export function effectiveState(ticket: MyTicket, now: Date): TicketState {
  if (ticket.status === "CANCELLED") return "CANCELLED";
  if (ticket.status === "ENTERED") return "USED";
  if (ticket.event.status === "CLOSED") return "EVENT_CLOSED";
  const t = now.getTime();
  if (t >= new Date(ticket.event.ends_at).getTime()) return "ENDED";
  if (ticket.status === "PENDING_PAYMENT") return "AWAITING_PAYMENT";
  return t >= new Date(ticket.event.starts_at).getTime() ? "LIVE_NOW" : "UPCOMING";
}

/** States in which the ticket can still get you in: QR and face entry are offered. */
export function isUsable(state: TicketState): boolean {
  return state === "UPCOMING" || state === "LIVE_NOW";
}

/** Goes to the collapsed "Past" section: nothing left to do with it (a used ticket right away). */
export function isPast(state: TicketState): boolean {
  return state === "ENDED" || state === "EVENT_CLOSED" || state === "CANCELLED" || state === "USED";
}

const UNITS: Record<Lang, { d: string; h: string; m: string }> = {
  en: { d: "d", h: "h", m: "m" },
  he: { d: " ימ׳", h: " שע׳", m: " דק׳" },
};

/** "2d 4h", "3h 12m", "8m" (two largest units; under a minute counts as 1m). */
export function formatCountdown(ms: number, lang: Lang): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const u = UNITS[lang];
  const parts = days > 0 ? [`${days}${u.d}`, hours > 0 ? `${hours}${u.h}` : ""] : hours > 0 ? [`${hours}${u.h}`, minutes > 0 ? `${minutes}${u.m}` : ""] : [`${minutes}${u.m}`];
  return parts.filter(Boolean).join(" ");
}

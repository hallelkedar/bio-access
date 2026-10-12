// When an event happens, relative to now: drives the badge on each event card and the
// filter chips. Dates only: the user API has no "tickets left", so no sold-out badge here.
import type { Event } from "../../api/types";

export type EventTiming = "LIVE_NOW" | "TODAY" | "THIS_WEEK" | "LATER" | "ENDED";
export type EventFilter = "all" | "week" | "free";

export const EVENT_FILTERS: EventFilter[] = ["all", "week", "free"];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function eventTiming(event: Pick<Event, "starts_at" | "ends_at">, now: Date): EventTiming {
  const starts = new Date(event.starts_at);
  const t = now.getTime();
  if (t >= new Date(event.ends_at).getTime()) return "ENDED";
  if (t >= starts.getTime()) return "LIVE_NOW";
  if (sameDay(starts, now)) return "TODAY";
  return starts.getTime() - t <= WEEK_MS ? "THIS_WEEK" : "LATER";
}

/** "This week" = live now or starting within the next 7 days; "Free" = price 0. */
export function matchesFilter(event: Event, filter: EventFilter, now: Date): boolean {
  if (filter === "free") return event.price_cents === 0;
  if (filter === "week") {
    const timing = eventTiming(event, now);
    return timing === "LIVE_NOW" || timing === "TODAY" || timing === "THIS_WEEK";
  }
  return true;
}

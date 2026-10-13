import type { Event, MyTicket, TicketStatus } from "../api/types";

const HOUR = 3_600_000;

export function makeEvent(overrides: Partial<Event> = {}): Event {
  const startsAt = overrides.starts_at ?? "2026-12-01T18:00:00Z";
  return {
    id: 7,
    name: "Summer Concert",
    location: "Tel Aviv",
    cover_image_url: null,
    starts_at: startsAt,
    ends_at: "2026-12-01T22:00:00Z",
    capacity: 100,
    price_cents: 5000,
    currency: "ILS",
    status: "ACTIVE",
    gate_opens_at: new Date(new Date(startsAt).getTime() - HOUR).toISOString(), // the server's default hour
    ...overrides,
  };
}

/** An event whose gates are open right now (started an hour ago, ends in three). */
export function liveEvent(overrides: Partial<Event> = {}): Event {
  const now = Date.now();
  return makeEvent({ starts_at: new Date(now - HOUR).toISOString(), ends_at: new Date(now + 3 * HOUR).toISOString(), ...overrides });
}

export function makeTicket(status: TicketStatus, overrides: Partial<MyTicket> = {}): MyTicket {
  const event = makeEvent();
  return {
    id: 42,
    event_id: event.id,
    status,
    purchased_at: "2026-10-01T10:00:00Z",
    entered_at: null,
    event: {
      id: event.id, name: event.name, location: event.location, starts_at: event.starts_at, ends_at: event.ends_at,
      status: event.status, cover_image_url: event.cover_image_url,
    },
    qr_token: status === "VALID" ? "qr-token" : null,
    enrolled: false,
    ...overrides,
  };
}

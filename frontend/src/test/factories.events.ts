import type { Event, MyTicket, TicketStatus } from "../api/types";

export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 7,
    name: "Summer Concert",
    location: "Tel Aviv",
    cover_image_url: null,
    starts_at: "2026-12-01T18:00:00Z",
    ends_at: "2026-12-01T22:00:00Z",
    capacity: 100,
    price_cents: 5000,
    currency: "ILS",
    status: "ACTIVE",
    ...overrides,
  };
}

export function makeTicket(status: TicketStatus, overrides: Partial<MyTicket> = {}): MyTicket {
  const event = makeEvent();
  return {
    id: 42,
    event_id: event.id,
    status,
    purchased_at: "2026-10-01T10:00:00Z",
    entered_at: null,
    event: { id: event.id, name: event.name, location: event.location, starts_at: event.starts_at, ends_at: event.ends_at },
    qr_token: status === "VALID" ? "qr-token" : null,
    ...overrides,
  };
}

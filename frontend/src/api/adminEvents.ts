import { api } from "./client";
import type { Event } from "./types";

export interface EventInput {
  name: string;
  location: string;
  starts_at: string; // ISO 8601 with time zone
  ends_at: string;
  capacity: number;
  price_cents: number;
  currency: string;
}

/** All events, any status (admin only), latest start first. */
export async function listAllEvents(): Promise<Event[]> {
  const { data } = await api.get<Event[]>("/api/admin/events");
  return data;
}

export async function createEvent(input: EventInput): Promise<Event> {
  const { data } = await api.post<Event>("/api/events", input);
  return data;
}

export async function updateEvent(id: number, changes: Partial<EventInput> & { status?: Event["status"] }): Promise<Event> {
  const { data } = await api.put<Event>(`/api/events/${id}`, changes);
  return data;
}

export async function deleteEvent(id: number): Promise<void> {
  await api.delete(`/api/events/${id}`);
}

export async function uploadCover(id: number, file: File): Promise<Event> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<Event>(`/api/events/${id}/cover`, form);
  return data;
}

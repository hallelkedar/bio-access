import { api } from "./client";
import type { Event } from "./types";

/** ACTIVE events that haven't ended, soonest first. */
export async function listEvents(): Promise<Event[]> {
  const { data } = await api.get<Event[]>("/api/events");
  return data;
}

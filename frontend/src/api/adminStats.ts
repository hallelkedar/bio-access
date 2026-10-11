import { api } from "./client";
import type { AccessReason, GateDecision } from "./gate";

export type AccessMethod = "FACE" | "QR";

export interface EventStats {
  event_id: number;
  entries_per_30_min: { bucket_start: string; approved: number }[];
  decisions: {
    approved: number;
    denied: number;
    denied_by_reason: Partial<Record<AccessReason, number>>;
    approved_by_method: Partial<Record<AccessMethod, number>>;
  };
  occupancy: { entered: number; sold: number; capacity: number; percent: number };
}

/** One gate decision pushed live over /ws/admin. */
export interface AccessEvent extends GateDecision {
  event_id: number;
  gate_id: string;
  method: AccessMethod;
  timestamp: string;
}

export async function getEventStats(eventId: number): Promise<EventStats> {
  const { data } = await api.get<EventStats>(`/api/admin/stats/${eventId}`);
  return data;
}

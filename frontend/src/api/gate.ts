import { api } from "./client";

export type AccessReason =
  | "NONE"
  | "NOT_RECOGNIZED"
  | "ALREADY_ENTERED"
  | "EVENT_NOT_ACTIVE"
  | "LIVENESS_FAILED"
  | "CANCELLED"
  | "LOW_QUALITY"
  | "PROVIDER_ERROR";

export interface GateDecision {
  result: "APPROVED" | "DENIED";
  reason: AccessReason;
  ticket_id: number | null;
  user_name: string | null;
  similarity: number | null;
}

/** One camera frame as a raw JPEG body (in memory only). */
export async function verifyFace(eventId: number, gateId: string, frame: Blob): Promise<GateDecision> {
  const { data } = await api.post<GateDecision>("/api/gate/verify", frame, {
    params: { event_id: eventId, gate_id: gateId },
    headers: { "Content-Type": "image/jpeg" },
  });
  return data;
}

export async function verifyQr(eventId: number, gateId: string, qrToken: string): Promise<GateDecision> {
  const { data } = await api.post<GateDecision>("/api/gate/verify-qr", {
    event_id: eventId,
    gate_id: gateId,
    qr_token: qrToken,
  });
  return data;
}

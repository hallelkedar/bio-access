import { api } from "./client";

export type QualityIssue =
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "LOW_CONFIDENCE"
  | "TOO_DARK"
  | "BLURRY"
  | "BAD_POSE"
  | "TOO_SMALL";

export interface EnrollmentResult {
  ticket_id: number;
  enrolled_at: string;
}

/** Send the photo as the raw request body (kept in memory end to end, never a file). */
export async function enrollFace(ticketId: number, photo: Blob): Promise<EnrollmentResult> {
  const { data } = await api.post<EnrollmentResult>("/api/enrollment", photo, {
    params: { ticket_id: ticketId, consent: true },
    headers: { "Content-Type": "image/jpeg" },
  });
  return data;
}

/** Change the face photo of an already enrolled ticket; the old face is deleted once the new one is saved. */
export async function replaceFace(ticketId: number, photo: Blob): Promise<EnrollmentResult> {
  const { data } = await api.put<EnrollmentResult>("/api/enrollment", photo, {
    params: { ticket_id: ticketId, consent: true },
    headers: { "Content-Type": "image/jpeg" },
  });
  return data;
}

import { api } from "./client";
import type { MyTicket, Ticket, TicketStatus } from "./types";

export async function buyTicket(eventId: number): Promise<Ticket> {
  const { data } = await api.post<Ticket>("/api/tickets", { event_id: eventId });
  return data;
}

/** Returns the payment provider's hosted checkout URL. */
export async function startCheckout(ticketId: number): Promise<string> {
  const { data } = await api.post<{ checkout_url: string }>(`/api/tickets/${ticketId}/checkout`);
  return data.checkout_url;
}

export async function myTickets(): Promise<MyTicket[]> {
  const { data } = await api.get<MyTicket[]>("/api/tickets/me");
  return data;
}

/**
 * The QR PNG needs the JWT, which an <img src> can't send: download it as a blob instead.
 * Returns an object URL; the caller must URL.revokeObjectURL() it when done.
 */
export async function fetchQrImage(ticketId: number): Promise<string> {
  const { data } = await api.get<Blob>(`/api/tickets/${ticketId}/qr.png`, { responseType: "blob" });
  return URL.createObjectURL(data);
}

/** Back-up for a missing webhook: the backend asks the payment provider directly. */
export async function refreshPayment(ticketId: number): Promise<TicketStatus> {
  const { data } = await api.post<{ status: TicketStatus }>(`/api/tickets/${ticketId}/payment/refresh`);
  return data.status;
}

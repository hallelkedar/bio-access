// Mirrors of the backend's Pydantic schemas (app/schemas/*).

export type Role = "USER" | "GATEKEEPER" | "ADMIN";

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface RegisterInput {
  email: string;
  full_name: string;
  phone?: string;
  password: string;
}

export type TicketStatus = "PENDING_PAYMENT" | "VALID" | "ENTERED" | "CANCELLED";

export interface Event {
  id: number;
  name: string;
  location: string;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  price_cents: number;
  currency: string;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
}

export interface Ticket {
  id: number;
  event_id: number;
  status: TicketStatus;
  purchased_at: string;
  entered_at: string | null;
}

export interface MyTicket extends Ticket {
  event: Pick<Event, "id" | "name" | "location" | "starts_at" | "ends_at">;
  /** Only present while the ticket is VALID (paid, not used yet). */
  qr_token: string | null;
  /** A face is already bound to this ticket. */
  enrolled: boolean;
}

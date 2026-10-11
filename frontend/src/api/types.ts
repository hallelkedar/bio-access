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

import { api } from "./client";
import type { RegisterInput, TokenResponse, User } from "./types";

export async function login(email: string, password: string): Promise<string> {
  const { data } = await api.post<TokenResponse>("/api/auth/login", { email, password });
  return data.access_token;
}

export async function register(input: RegisterInput): Promise<User> {
  const body = { ...input, phone: input.phone?.trim() || undefined };
  const { data } = await api.post<User>("/api/auth/register", body);
  return data;
}

export async function fetchMe(): Promise<User> {
  const { data } = await api.get<User>("/api/auth/me");
  return data;
}

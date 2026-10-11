import type { AccessMethod } from "./adminStats";
import { api } from "./client";
import type { AccessReason } from "./gate";
import type { Role, User } from "./types";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AccessLogRow {
  id: number;
  timestamp: string;
  event_id: number;
  gate_id: string;
  method: AccessMethod;
  result: "APPROVED" | "DENIED";
  reason: AccessReason;
  similarity: number | null;
  ticket_id: number | null;
  user_name: string | null;
}

export interface LogFilters {
  event_id?: number;
  result?: "APPROVED" | "DENIED";
  reason?: AccessReason;
  method?: AccessMethod;
  gate_id?: string;
  from?: string; // ISO, inclusive
  to?: string; // ISO, exclusive
  limit?: number;
  offset?: number;
}

export interface UserFilters {
  role?: Role;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ThresholdSettings {
  face_match_threshold: number;
  default_face_match_threshold: number;
  source: "database" | "default";
}

export async function listLogs(filters: LogFilters): Promise<Page<AccessLogRow>> {
  const { data } = await api.get<Page<AccessLogRow>>("/api/admin/logs", { params: filters });
  return data;
}

export async function listUsers(filters: UserFilters): Promise<Page<User>> {
  const { data } = await api.get<Page<User>>("/api/admin/users", { params: filters });
  return data;
}

export async function getSettings(): Promise<ThresholdSettings> {
  const { data } = await api.get<ThresholdSettings>("/api/admin/settings");
  return data;
}

export async function updateThreshold(value: number): Promise<ThresholdSettings> {
  const { data } = await api.put<ThresholdSettings>("/api/admin/settings", { face_match_threshold: value });
  return data;
}

/** Promote or demote a user (admin only). Admins can't change their own role (409). */
export async function changeUserRole(userId: number, role: Role): Promise<User> {
  const { data } = await api.patch<User>(`/api/admin/users/${userId}/role`, { role });
  return data;
}

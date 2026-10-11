import { AxiosError, type InternalAxiosRequestConfig } from "axios";

import type { Role, User } from "../api/types";

export function makeUser(role: Role = "USER", overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: "dana@example.com",
    full_name: "Dana Levi",
    phone: null,
    role,
    created_at: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

/** An AxiosError as the backend would produce it, for mocked API calls. */
export function httpError(status: number, detail: unknown = "error"): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError("failed", String(status), config, null, {
    data: { detail },
    status,
    statusText: "",
    headers: {},
    config,
  });
}

import type { Role } from "../api/types";

/** Where each role lands after logging in. */
export const HOME_BY_ROLE: Record<Role, string> = {
  USER: "/events",
  GATEKEEPER: "/gate",
  ADMIN: "/admin",
};

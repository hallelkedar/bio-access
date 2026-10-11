import type { AccessReason } from "../api/gate";

export const DENIAL_TEXT: Record<AccessReason, string> = {
  NONE: "",
  NOT_RECOGNIZED: "Not recognized — use QR",
  ALREADY_ENTERED: "Already entered",
  EVENT_NOT_ACTIVE: "Event is not open",
  LIVENESS_FAILED: "Liveness check failed",
  CANCELLED: "Ticket cancelled",
  LOW_QUALITY: "Look at the camera",
  PROVIDER_ERROR: "Face service is down — use QR",
};

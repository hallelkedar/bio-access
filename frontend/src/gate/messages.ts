import type { AccessReason } from "../api/gate";
import { translate, type Lang, type TranslationVars } from "../i18n/translate";

/** English texts (kept for compatibility); the UI uses denialText() in the current language. */
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

export function denialText(lang: Lang, reason: AccessReason): string {
  return translate(lang, `denial.${reason}`);
}

/** Small, non-alarming gate messages, as codes so the page can show them in any language. */
export type HintCode = "look_at_camera" | "provider_down" | "rate_limited" | "connection_problem";

export function hintText(lang: Lang, code: HintCode, vars?: TranslationVars): string {
  return translate(lang, `hint.${code}`, vars);
}

import { AxiosError } from "axios";

import type { TranslationKey } from "../i18n/en";
import { translate, type Lang } from "../i18n/translate";

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

/** Backend `detail` texts we know, so Hebrew users get a Hebrew sentence (status alone is ambiguous). */
const KNOWN_DETAILS: Record<string, TranslationKey> = {
  "event is sold out": "errors.soldOut",
  "event has ended": "errors.eventEnded",
  "you already have a ticket for this event": "errors.alreadyHaveTicket",
  "event not found": "errors.eventNotFound",
  "ticket not found": "errors.ticketNotFound",
  "ticket is not awaiting payment": "errors.ticketNotAwaitingPayment",
  "ticket is not valid": "errors.ticketNotValid",
  "ticket is already enrolled": "errors.alreadyEnrolled",
  "event is not open for enrollment": "errors.eventNotOpenForEnrollment",
  "consent is required": "errors.consentRequired",
  "face service unavailable, try again": "errors.faceServiceDown",
  "payment provider unavailable": "errors.paymentProviderDown",
  "image is too large": "errors.imageTooLarge",
};

const FIELD_KEYS: Record<string, TranslationKey> = {
  email: "field.email",
  password: "field.password",
  phone: "field.phone",
  full_name: "field.full_name",
};

/**
 * Turn a failed API call into one sentence for the user.
 * `byStatus` holds page-specific messages (already translated). In English the output is
 * exactly the server's wording; in Hebrew known server texts are translated, unknown ones
 * fall back to the server's English.
 */
export function apiErrorMessage(error: unknown, byStatus: Record<number, string> = {}, lang: Lang = "en"): string {
  if (!(error instanceof AxiosError)) {
    return translate(lang, "errors.generic");
  }
  const status = error.response?.status;
  if (status === undefined) {
    return translate(lang, "errors.offline");
  }
  if (byStatus[status]) {
    return byStatus[status];
  }
  if (status === 429) {
    return translate(lang, "errors.tooMany");
  }
  const detail: unknown = error.response?.data?.detail;
  if (status === 422 && Array.isArray(detail) && detail.length > 0) {
    const issue = detail[0] as ValidationIssue;
    const field = issue.loc?.at(-1);
    if (lang !== "en" && field !== undefined) {
      const fieldKey = FIELD_KEYS[String(field)];
      return translate(lang, "errors.invalidField", { field: fieldKey ? translate(lang, fieldKey) : String(field) });
    }
    const message = (issue.msg ?? "is invalid").replace(/^Value error, /, "");
    return field ? `${String(field).replace(/_/g, " ")}: ${message}` : message;
  }
  if (typeof detail === "string") {
    const known = KNOWN_DETAILS[detail];
    if (lang !== "en" && known) return translate(lang, known);
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  return translate(lang, "errors.generic");
}

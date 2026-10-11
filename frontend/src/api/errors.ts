import { AxiosError } from "axios";

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

/** Turn a failed API call into one sentence for the user. */
export function apiErrorMessage(error: unknown, byStatus: Record<number, string> = {}): string {
  if (!(error instanceof AxiosError)) {
    return "Something went wrong. Please try again.";
  }
  const status = error.response?.status;
  if (status === undefined) {
    return "Can't reach the server. Check your connection.";
  }
  if (byStatus[status]) {
    return byStatus[status];
  }
  if (status === 429) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  const detail: unknown = error.response?.data?.detail;
  if (status === 422 && Array.isArray(detail) && detail.length > 0) {
    const issue = detail[0] as ValidationIssue;
    const field = issue.loc?.at(-1);
    const message = (issue.msg ?? "is invalid").replace(/^Value error, /, "");
    return field ? `${String(field).replace(/_/g, " ")}: ${message}` : message;
  }
  if (typeof detail === "string") {
    return detail.charAt(0).toUpperCase() + detail.slice(1);
  }
  return "Something went wrong. Please try again.";
}

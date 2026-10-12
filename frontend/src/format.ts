import type { Lang } from "./i18n/translate";

/** Hebrew uses Israeli formatting; English keeps the browser's own locale. */
export function localeFor(lang: Lang = "en"): string | undefined {
  return lang === "he" ? "he-IL" : undefined;
}

/** Shown in the viewer's own time zone. */
export function formatDateTime(iso: string, lang: Lang = "en"): string {
  return new Intl.DateTimeFormat(localeFor(lang), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatPrice(cents: number, currency: string, lang: Lang = "en"): string {
  return new Intl.NumberFormat(localeFor(lang), { style: "currency", currency }).format(cents / 100);
}

/** ISO timestamp → value for <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "YYYY-MM-DDTHH:mm" (local time) → ISO timestamp in UTC; null for empty, partial or
 * impossible input (new Date() would throw on toISOString, or roll Feb 31 into March).
 */
export function fromLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(year, month - 1, day, hours, minutes);
  const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hours && date.getMinutes() === minutes;
  return exact ? date.toISOString() : null;
}

/** "50", "50.5" or "50.00" → 5000 cents; null if not a valid non-negative amount. */
export function parsePriceToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

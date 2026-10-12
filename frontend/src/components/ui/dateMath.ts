// Calendar and parsing helpers for DateTimeField. All dates are local time; the field
// converts to UTC ISO only at its edge.
import type { Lang } from "../../i18n/translate";

/** First column of the calendar: 0 = Sunday (Israel and en-US). Use 1 for Monday. */
export const WEEK_STARTS_ON = 0;

/** Step for the time field's arrow keys, in minutes. */
export const TIME_STEP_MINUTES = 5;

const pad = (n: number) => String(n).padStart(2, "0");

/** A real calendar date and time, or null (rejects Feb 31, 24:30 and friends). */
export function makeDate(year: number, month: number, day: number, hours: number, minutes: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || hours > 23 || minutes > 59) return null;
  const date = new Date(year, month - 1, day, hours, minutes);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

const ISO_TEXT = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T,]+(\d{1,2}):(\d{2})$/;
const LOCAL_TEXT = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ ,]+(\d{1,2}):(\d{2})$/;

/**
 * Typed text → Date. Accepts the language's own order (en: MM/DD/YYYY HH:mm, he:
 * DD/MM/YYYY HH:mm, with / . or -) and YYYY-MM-DD HH:mm in both. Anything partial → null.
 */
export function parseFieldText(text: string, lang: Lang): Date | null {
  const s = text.trim();
  const iso = ISO_TEXT.exec(s);
  if (iso) {
    const [, y, m, d, h, min] = iso.map(Number) as [number, number, number, number, number, number];
    return makeDate(y, m, d, h, min);
  }
  const local = LOCAL_TEXT.exec(s);
  if (!local) return null;
  const [, a, b, y, h, min] = local.map(Number) as [number, number, number, number, number, number];
  return lang === "he" ? makeDate(y, b, a, h, min) : makeDate(y, a, b, h, min);
}

/** Date → the text the field shows (the same format parseFieldText reads back). */
export function formatFieldText(date: Date, lang: Lang): string {
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const dmy = lang === "he" ? `${day}/${month}` : `${month}/${day}`;
  return `${dmy}/${date.getFullYear()} ${formatTime(date)}`;
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "19:05" → [19, 5]; null if not a real time. */
export function parseTime(text: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? [hours, minutes] : null;
}

/** Move to the next (or previous) multiple of `step` minutes, wrapping within the day. */
export function stepTime([hours, minutes]: [number, number], direction: 1 | -1, step = TIME_STEP_MINUTES): [number, number] {
  const total = hours * 60 + minutes;
  const next = direction > 0 ? Math.floor(total / step) * step + step : Math.ceil(total / step) * step - step;
  const wrapped = (next + 24 * 60) % (24 * 60);
  return [Math.floor(wrapped / 60), wrapped % 60];
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** Same day of month in another month, clamped (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1, date.getHours(), date.getMinutes());
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), lastDay), date.getHours(), date.getMinutes());
}

/** First and last day of the week that contains `date`. */
export function weekBounds(date: Date, weekStartsOn = WEEK_STARTS_ON): [Date, Date] {
  const start = addDays(date, -((date.getDay() - weekStartsOn + 7) % 7));
  return [start, addDays(start, 6)];
}

/** The 6×7 days shown for a month: starts on the week start on or before the 1st. */
export function monthGrid(year: number, month: number, weekStartsOn = WEEK_STARTS_ON): Date[] {
  const [start] = weekBounds(new Date(year, month, 1), weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** False when the whole day lies outside [min, max]. */
export function dayInRange(day: Date, min: Date | null, max: Date | null): boolean {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return !(min && end <= min) && !(max && start > max);
}

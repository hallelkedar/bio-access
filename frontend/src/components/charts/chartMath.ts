import type { AccessReason } from "../../api/gate";
import { translate, type Lang } from "../../i18n/translate";

/** Validated sequential blue (dataviz reference palette, light mode). */
export const CHART_COLORS = {
  bar: "#2a78d6",
  barMuted: "#86b6ef",
  track: "#cde2fb",
  grid: "#e2e8f0",
} as const;

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10^n so ticks are readable. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** Evenly spaced tick values from 0 to max (inclusive). */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/**
 * Y axis for counts: a whole-number top and whole, unique ticks that divide it evenly
 * (1 → 0,1 · 3 → 0..3 · 5 → 0..5 · 10 → 0,2,…,10 · 20 → 0,5,…,20 · 12,000 → steps of 2,500…).
 */
export function countAxis(value: number): { max: number; ticks: number[] } {
  const max = Math.max(1, Math.ceil(niceMax(value)));
  const count = max <= 4 ? max : [4, 5, 2].find((n) => max % n === 0) ?? 1;
  return { max, ticks: Array.from({ length: count + 1 }, (_, i) => (max / count) * i) };
}

/** Which x-axis labels to show so at most `maxLabels` appear (first one always). */
export function labelIndices(total: number, maxLabels: number): Set<number> {
  const step = Math.max(1, Math.ceil(total / Math.max(1, maxLabels)));
  const shown = new Set<number>();
  for (let i = 0; i < total; i += step) shown.add(i);
  return shown;
}

/** English labels (kept for compatibility); the UI uses reasonLabel() in the current language. */
export const REASON_LABEL: Record<AccessReason, string> = {
  NONE: "Approved",
  NOT_RECOGNIZED: "Not recognized",
  ALREADY_ENTERED: "Already entered",
  EVENT_NOT_ACTIVE: "Event not open",
  LIVENESS_FAILED: "Liveness failed",
  CANCELLED: "Ticket cancelled",
  LOW_QUALITY: "Bad frame",
  PROVIDER_ERROR: "Face service down",
};

export function reasonLabel(lang: Lang, reason: AccessReason): string {
  return translate(lang, `reason.${reason}`);
}

/** Denial reasons as sorted rows (largest first); zero rows only when asked. */
export function reasonRows(byReason: Partial<Record<AccessReason, number>>, includeZero = false, lang: Lang = "en") {
  return (Object.keys(REASON_LABEL) as AccessReason[])
    .filter((reason) => reason !== "NONE")
    .map((reason) => ({ reason, label: reasonLabel(lang, reason), value: byReason[reason] ?? 0 }))
    .filter((row) => includeZero || row.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, lang));
}

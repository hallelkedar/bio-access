import type { AccessReason } from "../../api/gate";

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

/** Which x-axis labels to show so at most `maxLabels` appear (first one always). */
export function labelIndices(total: number, maxLabels: number): Set<number> {
  const step = Math.max(1, Math.ceil(total / Math.max(1, maxLabels)));
  const shown = new Set<number>();
  for (let i = 0; i < total; i += step) shown.add(i);
  return shown;
}

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

/** Denial reasons as sorted rows (largest first); zero rows only when asked. */
export function reasonRows(byReason: Partial<Record<AccessReason, number>>, includeZero = false) {
  return (Object.keys(REASON_LABEL) as AccessReason[])
    .filter((reason) => reason !== "NONE")
    .map((reason) => ({ reason, label: REASON_LABEL[reason], value: byReason[reason] ?? 0 }))
    .filter((row) => includeZero || row.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

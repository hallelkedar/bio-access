import type { Event } from "../api/types";

export type GateWindow = "before" | "open" | "ended";

/** Is the gate admitting people now? The same rule as the server: [gate_opens_at, ends_at). */
export function gateWindow(event: Pick<Event, "gate_opens_at" | "ends_at">, now: Date): GateWindow {
  const t = now.getTime();
  if (t < new Date(event.gate_opens_at).getTime()) return "before";
  return t < new Date(event.ends_at).getTime() ? "open" : "ended";
}

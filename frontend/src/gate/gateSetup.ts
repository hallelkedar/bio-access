// Per-device convenience: a gate laptop reopens on the same event and gate name.
// localStorage may be unavailable (private mode), so every access is guarded.
const KEY = "bioaccess.gate";

export interface GateSetup {
  eventId: number;
  gateId: string;
}

export function loadGateSetup(): GateSetup | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GateSetup>;
    return typeof parsed.eventId === "number" && typeof parsed.gateId === "string"
      ? { eventId: parsed.eventId, gateId: parsed.gateId }
      : null;
  } catch {
    return null;
  }
}

export function saveGateSetup(setup: GateSetup): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(setup));
  } catch {
    // not fatal: the gatekeeper just picks again next time
  }
}

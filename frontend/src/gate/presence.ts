import type { ScannerPhase } from "../hooks/useGateScanner";

// When the gate shows its live camera: only while someone is there. An empty or paused gate
// shows a standby panel instead (the video keeps running underneath for the motion check).

/** Mean brightness change that counts as "someone is there": lower than MOTION_THRESHOLD,
 *  so a person standing fairly still keeps the feed on, but sensor noise does not. */
export const PRESENCE_THRESHOLD = 4;
/** How long the feed stays on after the last movement. */
export const PRESENCE_MS = 6000;

export type FeedView = "live" | "idle" | "paused";

export function feedView(input: {
  paused: boolean;
  phase: ScannerPhase;
  lastMotionAt: number;
  now: number;
  keepMs?: number;
}): FeedView {
  const { paused, phase, lastMotionAt, now, keepMs = PRESENCE_MS } = input;
  if (paused || phase === "paused") return "paused";
  if (phase === "verifying" || phase === "result") return "live";
  return now - lastMotionAt < keepMs ? "live" : "idle";
}

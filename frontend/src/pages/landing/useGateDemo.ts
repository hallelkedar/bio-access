import { useEffect, useState } from "react";

export type DemoPhase = "watching" | "scanning" | "verifying" | "approved" | "denied";

/** One loop of the simulated gate: a visitor who gets in, then one who already did. */
export const DEMO_SCRIPT: readonly { phase: DemoPhase; ms: number }[] = [
  { phase: "watching", ms: 1500 },
  { phase: "scanning", ms: 1800 },
  { phase: "verifying", ms: 900 },
  { phase: "approved", ms: 2400 },
  { phase: "watching", ms: 1500 },
  { phase: "scanning", ms: 1800 },
  { phase: "verifying", ms: 900 },
  { phase: "denied", ms: 2400 },
];

/**
 * Plays DEMO_SCRIPT on timers (no camera, no backend). While `running` is false the loop
 * holds where it is; with `still` it shows a fixed approved state instead (reduced motion).
 * Only one timer is ever pending, and it is cleared on pause and on unmount.
 */
export function useGateDemo({ running, still = false }: { running: boolean; still?: boolean }): DemoPhase {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!running || still) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % DEMO_SCRIPT.length), DEMO_SCRIPT[index]!.ms);
    return () => clearTimeout(timer);
  }, [running, still, index]);

  return still ? "approved" : DEMO_SCRIPT[index]!.phase;
}

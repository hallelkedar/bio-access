import { AxiosError } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";

import { verifyFace, type GateDecision } from "../api/gate";
import { DENIAL_TEXT } from "../gate/messages";
import { hasMotion } from "../gate/motion";
import { playApproved, playDenied } from "../gate/sounds";
import type { CameraController } from "./useCamera";

export type ScannerPhase = "watching" | "verifying" | "result" | "paused";

export interface ScannerState {
  phase: ScannerPhase;
  /** The decision on screen while phase is "result". */
  decision: GateDecision | null;
  /** A small, non-alarming message (bad frame, connection hiccup, rate limit). */
  hint: string | null;
  providerDown: boolean;
}

export interface ScannerOptions {
  /** How often the camera is sampled for motion. */
  sampleMs?: number;
  /** Minimum time between two requests to the backend. */
  minGapMs?: number;
  /** How long a green/red result stays on screen. */
  holdMs?: number;
  /** Extra attempts after a bad frame (LOW_QUALITY) while the person is still there. */
  lowQualityRetries?: number;
}

interface ScannerInput {
  camera: CameraController;
  eventId: number;
  gateId: string;
  enabled: boolean;
  /** A small grayscale copy of the current frame, used only to detect motion. */
  sampleFrame: () => Uint8Array | null;
  verify?: typeof verifyFace;
  options?: ScannerOptions;
}

const IDLE: ScannerState = { phase: "watching", decision: null, hint: null, providerDown: false };

function retryAfterSeconds(error: AxiosError): number {
  const header = Number(error.response?.headers?.["retry-after"]);
  return Number.isFinite(header) && header > 0 ? header : 60;
}

/**
 * The gate's scan loop. Sends a frame only when someone moves in front of the camera,
 * never more than one request at a time and at most one per minGapMs, so an empty gate
 * doesn't flood the access log or hit the rate limit.
 */
export function useGateScanner({ camera, eventId, gateId, enabled, sampleFrame, verify = verifyFace, options = {} }: ScannerInput) {
  const { sampleMs = 300, minGapMs = 1500, holdMs = 3000, lowQualityRetries = 2 } = options;
  const [state, setState] = useState<ScannerState>(IDLE);

  const phase = useRef<ScannerPhase>("watching");
  const busy = useRef(false);
  const previous = useRef<Uint8Array | null>(null);
  const lastRequestAt = useRef(-Infinity);
  const retriesLeft = useRef(0);
  const pausedUntil = useRef(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const update = useCallback((next: Partial<ScannerState>) => {
    if (next.phase) phase.current = next.phase;
    setState((current) => ({ ...current, ...next }));
  }, []);

  /** Show a green/red result with a sound, then go back to watching. Also used by the QR fallback. */
  const showDecision = useCallback(
    (decision: GateDecision) => {
      clearTimeout(holdTimer.current);
      if (decision.result === "APPROVED") playApproved();
      else playDenied();
      update({ phase: "result", decision, hint: null });
      holdTimer.current = setTimeout(() => {
        previous.current = null; // start motion detection fresh after the result
        update({ phase: "watching", decision: null });
      }, holdMs);
    },
    [holdMs, update],
  );

  const tick = useCallback(async () => {
    if (!enabled || camera.status !== "ready" || busy.current) return;
    if (phase.current === "paused") {
      if (Date.now() < pausedUntil.current) return;
      update({ phase: "watching", hint: null });
    }
    if (phase.current !== "watching") return;

    const thumbnail = sampleFrame();
    if (!thumbnail) return;
    const moved = hasMotion(previous.current, thumbnail);
    previous.current = thumbnail;
    if (!moved && retriesLeft.current <= 0) return;
    if (Date.now() - lastRequestAt.current < minGapMs) return;
    if (moved) retriesLeft.current = lowQualityRetries;
    const isRetry = !moved;

    busy.current = true;
    lastRequestAt.current = Date.now();
    update({ phase: "verifying" });
    try {
      const decision = await verify(eventId, gateId, await camera.capture());
      if (decision.reason === "LOW_QUALITY") {
        if (isRetry) retriesLeft.current -= 1; // the person may still be adjusting: try again shortly
        update({ phase: "watching", hint: DENIAL_TEXT.LOW_QUALITY });
      } else if (decision.reason === "PROVIDER_ERROR") {
        retriesLeft.current = 0;
        update({ phase: "watching", hint: DENIAL_TEXT.PROVIDER_ERROR, providerDown: true });
      } else {
        retriesLeft.current = 0;
        update({ providerDown: false });
        showDecision(decision);
      }
    } catch (error) {
      retriesLeft.current = 0;
      if (error instanceof AxiosError && error.response?.status === 429) {
        const seconds = retryAfterSeconds(error);
        pausedUntil.current = Date.now() + seconds * 1000;
        update({ phase: "paused", hint: `Too many scans — resuming in ${seconds} s` });
      } else {
        update({ phase: "watching", hint: "Connection problem — retrying" });
      }
    } finally {
      busy.current = false;
    }
  }, [enabled, camera, sampleFrame, minGapMs, lowQualityRetries, verify, eventId, gateId, update, showDecision]);

  // One steady timer; it always calls the latest tick.
  const latestTick = useRef(tick);
  latestTick.current = tick;
  useEffect(() => {
    const id = setInterval(() => {
      latestTick.current().catch(() => {
        busy.current = false; // an unexpected error must not stop the gate
      });
    }, sampleMs);
    return () => {
      clearInterval(id);
      clearTimeout(holdTimer.current);
    };
  }, [sampleMs]);

  return { state, showDecision };
}

import { act, renderHook } from "@testing-library/react";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GateDecision } from "../api/gate";
import * as sounds from "../gate/sounds";
import type { CameraController } from "./useCamera";
import { useGateScanner } from "./useGateScanner";

vi.mock("../gate/sounds");

const OPTIONS = { sampleMs: 100, minGapMs: 500, holdMs: 1000, lowQualityRetries: 2 };
const STILL = new Uint8Array(576).fill(50);
const MOVED = new Uint8Array(576).fill(200);

function decision(result: GateDecision["result"], reason: GateDecision["reason"], name: string | null = null): GateDecision {
  return { result, reason, ticket_id: name ? 42 : null, user_name: name, similarity: name ? 99 : null };
}

function fakeCamera(): CameraController {
  return {
    videoRef: { current: null },
    status: "ready",
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    capture: vi.fn().mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" })),
  };
}

type Verify = (eventId: number, gateId: string, frame: Blob) => Promise<GateDecision>;

function setup(frames: Uint8Array[], verify: Verify | ReturnType<typeof vi.fn<Verify>>, enabled = true) {
  let index = 0;
  const sampleFrame = () => frames[Math.min(index++, frames.length - 1)] ?? null;
  const camera = fakeCamera();
  const hook = renderHook(
    (props: { enabled: boolean }) =>
      useGateScanner({ camera, eventId: 7, gateId: "north-1", enabled: props.enabled, sampleFrame, verify: verify as Verify, options: OPTIONS }),
    { initialProps: { enabled } },
  );
  return { ...hook, camera };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGateScanner", () => {
  it("sends nothing while the gate is empty", async () => {
    const verify = vi.fn();
    setup([STILL], verify);

    await advance(5000);

    expect(verify).not.toHaveBeenCalled();
  });

  it("motion triggers one scan; approval shows, beeps, then resumes", async () => {
    const verify = vi.fn().mockResolvedValue(decision("APPROVED", "NONE", "Dana Levi"));
    const { result } = setup([STILL, MOVED, MOVED], verify);

    await advance(200);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(7, "north-1", expect.any(Blob));
    expect(result.current.state.phase).toBe("result");
    expect(result.current.state.decision?.user_name).toBe("Dana Levi");
    expect(sounds.playApproved).toHaveBeenCalled();

    await advance(1000);
    expect(result.current.state.phase).toBe("watching");
  });

  it("a denial shows red with a buzz", async () => {
    const verify = vi.fn().mockResolvedValue(decision("DENIED", "ALREADY_ENTERED", "Dana Levi"));
    const { result } = setup([STILL, MOVED], verify);

    await advance(200);

    expect(result.current.state.decision?.reason).toBe("ALREADY_ENTERED");
    expect(sounds.playDenied).toHaveBeenCalled();
  });

  it("never sends two requests at once", async () => {
    let finish: (d: GateDecision) => void = () => {};
    const verify = vi.fn().mockImplementation(() => new Promise<GateDecision>((resolve) => (finish = resolve)));
    const frames = Array.from({ length: 50 }, (_, i) => (i % 2 ? MOVED : STILL)); // constant motion
    setup(frames, verify);

    await advance(3000);
    expect(verify).toHaveBeenCalledTimes(1);

    await act(async () => finish(decision("DENIED", "NOT_RECOGNIZED")));
  });

  it("a bad frame only hints and retries a limited number of times, spaced out", async () => {
    const verify = vi.fn().mockResolvedValue(decision("DENIED", "LOW_QUALITY"));
    const { result } = setup([STILL, MOVED], verify); // one movement, then the person stands still

    await advance(200);
    expect(result.current.state.hint).toBe("Look at the camera");
    expect(result.current.state.phase).toBe("watching");
    expect(sounds.playDenied).not.toHaveBeenCalled();

    await advance(400);
    expect(verify).toHaveBeenCalledTimes(1); // min gap not reached yet
    await advance(5000);
    expect(verify).toHaveBeenCalledTimes(3); // first try + 2 retries, then waits for new motion
  });

  it("face service down: flags it for the QR fallback", async () => {
    const verify = vi.fn().mockResolvedValue(decision("DENIED", "PROVIDER_ERROR"));
    const { result } = setup([STILL, MOVED], verify);

    await advance(200);

    expect(result.current.state.providerDown).toBe(true);
    expect(result.current.state.hint).toContain("use QR");
  });

  it("rate limited: pauses for Retry-After, then resumes", async () => {
    const config = { headers: {} } as InternalAxiosRequestConfig;
    const tooMany = new AxiosError("429", "429", config, null, {
      data: {}, status: 429, statusText: "", headers: { "retry-after": "3" }, config,
    });
    const verify = vi.fn().mockRejectedValue(tooMany);
    const { result } = setup([STILL, MOVED], verify);

    await advance(200);
    expect(result.current.state.phase).toBe("paused");
    expect(result.current.state.hint).toContain("3 s");

    await advance(3100);
    expect(result.current.state.phase).toBe("watching");
  });

  it("paused by the gatekeeper: no scans", async () => {
    const verify = vi.fn();
    setup([STILL, MOVED, STILL, MOVED], verify, false);

    await advance(2000);

    expect(verify).not.toHaveBeenCalled();
  });

  it("showDecision (QR) uses the same overlay", async () => {
    const { result } = setup([STILL], vi.fn());

    act(() => result.current.showDecision(decision("APPROVED", "NONE", "Dana Levi")));

    expect(result.current.state.phase).toBe("result");
    expect(sounds.playApproved).toHaveBeenCalled();
  });
});

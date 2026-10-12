import { describe, expect, it } from "vitest";

import { feedView, PRESENCE_MS } from "./presence";

const NOW = 100_000;

describe("feedView", () => {
  it("is idle when nobody moved recently", () => {
    expect(feedView({ paused: false, phase: "watching", lastMotionAt: 0, now: NOW })).toBe("idle");
    expect(feedView({ paused: false, phase: "watching", lastMotionAt: NOW - PRESENCE_MS, now: NOW })).toBe("idle");
  });

  it("is live for a while after movement", () => {
    expect(feedView({ paused: false, phase: "watching", lastMotionAt: NOW - 1000, now: NOW })).toBe("live");
  });

  it("stays live while verifying or showing a result, even without movement", () => {
    expect(feedView({ paused: false, phase: "verifying", lastMotionAt: 0, now: NOW })).toBe("live");
    expect(feedView({ paused: false, phase: "result", lastMotionAt: 0, now: NOW })).toBe("live");
  });

  it("is paused by the operator or a rate limit, even with movement", () => {
    expect(feedView({ paused: true, phase: "watching", lastMotionAt: NOW, now: NOW })).toBe("paused");
    expect(feedView({ paused: false, phase: "paused", lastMotionAt: NOW, now: NOW })).toBe("paused");
  });
});

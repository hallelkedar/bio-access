import { describe, expect, it } from "vitest";

import { frameDifference, hasMotion, MOTION_THRESHOLD } from "./motion";

const flat = (value: number, size = 576) => new Uint8Array(size).fill(value);

describe("motion detection", () => {
  it("measures the average brightness change", () => {
    expect(frameDifference(flat(100), flat(100))).toBe(0);
    expect(frameDifference(flat(100), flat(130))).toBe(30);
    expect(frameDifference(flat(130), flat(100))).toBe(30);
  });

  it("ignores sensor noise but catches a person stepping in", () => {
    const empty = flat(80);
    const noisy = empty.map((v, i) => v + (i % 3) - 1); // ±1 flicker
    const person = empty.map((v, i) => (i % 32 > 10 && i % 32 < 22 ? 200 : v)); // a bright shape in the middle

    expect(hasMotion(empty, noisy)).toBe(false);
    expect(hasMotion(empty, person)).toBe(true);
  });

  it("needs a previous frame and matching sizes", () => {
    expect(hasMotion(null, flat(255))).toBe(false);
    expect(frameDifference(flat(0, 10), flat(255, 20))).toBe(0);
  });

  it("threshold is inclusive", () => {
    expect(hasMotion(flat(0), flat(MOTION_THRESHOLD))).toBe(true);
    expect(hasMotion(flat(0), flat(MOTION_THRESHOLD - 1))).toBe(false);
  });
});

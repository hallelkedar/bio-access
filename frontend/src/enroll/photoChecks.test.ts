import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkPhoto, detectFaces, edgeDetail, faceFindings, grayscale, hasHardFailure, meanBrightness, resetFaceDetector,
  SAMPLE_HEIGHT, SAMPLE_WIDTH,
} from "./photoChecks";

const W = SAMPLE_WIDTH;
const H = SAMPLE_HEIGHT;
const FULL = { width: 1280, height: 720 };

/** A 160×120 gray image from a function of (x, y) → 0-255. */
function image(gray: (x: number, y: number) => number): ImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = gray(x, y);
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { data, width: W, height: H, colorSpace: "srgb" } as ImageData;
}

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = (base: number, spread: number, seed = 1) => { const r = rng(seed); return () => base + (r() - 0.5) * spread; };
const sharp = image((x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 190 : 70)); // checkerboard, mean 130
const issues = (check: ReturnType<typeof checkPhoto>) => check.findings.map((f) => `${f.issue}${f.hard ? "!" : ""}`);

describe("measurements", () => {
  it("brightness uses the same luma weights as the server", () => {
    const red = { data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 };
    expect(grayscale(red)[0]).toBeCloseTo(76.245);
    expect(meanBrightness(grayscale(image(() => 0)))).toBe(0);
    expect(meanBrightness(grayscale(image(() => 200)))).toBe(200);
  });

  it("edge detail: flat ≈ 0, a smooth gradient is low, texture is high", () => {
    const gray = (img: ImageData) => edgeDetail(grayscale(img), W, H);
    expect(gray(image(() => 128))).toBe(0);
    expect(gray(image((x) => x))).toBeLessThan(3);
    expect(gray(sharp)).toBeGreaterThan(20);
    expect(gray(image(noise(128, 120)))).toBeGreaterThan(20);
  });
});

describe("checkPhoto", () => {
  it("a well-lit, detailed photo passes", () => {
    expect(checkPhoto(sharp, FULL).findings).toEqual([]);
  });

  it("black is too dark (hard) and blurry (hard): what the server rejects", () => {
    const check = checkPhoto(image(() => 0), FULL);
    expect(issues(check)).toEqual(["TOO_DARK!", "BLURRY!"]);
    expect(hasHardFailure(check)).toBe(true);
  });

  it("dim but not rejected is only a warning", () => {
    const dim = image((x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 90 : 30)); // mean 60
    expect(issues(checkPhoto(dim, FULL))).toEqual(["TOO_DARK"]);
  });

  it("washed out is a warning (the server doesn't check it)", () => {
    const bright = image((x, y) => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 255 : 215));
    expect(issues(checkPhoto(bright, FULL))).toEqual(["TOO_BRIGHT"]);
  });

  it("a soft blur warns; a smooth gradient is rejected", () => {
    const soft = image(noise(128, 3, 7)); // faint texture: detail ≈ 3.9
    const softDetail = edgeDetail(grayscale(soft), W, H);
    expect(softDetail).toBeGreaterThanOrEqual(3);
    expect(softDetail).toBeLessThan(6);
    expect(issues(checkPhoto(soft, FULL))).toEqual(["BLURRY"]);
    expect(issues(checkPhoto(image((x) => 60 + x), FULL))).toEqual(["BLURRY!"]);
  });

  it("a camera picture under 120 px is too small (hard)", () => {
    expect(issues(checkPhoto(sharp, { width: 160, height: 100 }))).toEqual(["TOO_SMALL!"]);
  });

  it("face results are warnings, and 'not checked' without a detector", () => {
    expect(checkPhoto(sharp, FULL).faceChecked).toBe(false);
    expect(issues(checkPhoto(sharp, FULL, []))).toEqual(["NO_FACE"]);
    const centered = { x: 50, y: 25, width: 60, height: 70 };
    expect(checkPhoto(sharp, FULL, [centered])).toEqual({ findings: [], faceChecked: true });
  });
});

describe("faceFindings", () => {
  it.each([
    [[{ x: 0, y: 0, width: 10, height: 10 }, { x: 80, y: 40, width: 30, height: 40 }], ["MULTIPLE_FACES"]],
    [[{ x: 70, y: 50, width: 20, height: 20 }], ["FACE_TOO_SMALL"]], // 20/120 < 25%
    [[{ x: 0, y: 25, width: 50, height: 70 }], ["OFF_CENTER"]],
  ] as const)("%j → %j", (faces, expected) => {
    expect(faceFindings([...faces], W, H).map((f) => f.issue)).toEqual(expected);
  });
});

describe("detectFaces", () => {
  afterEach(() => {
    delete (globalThis as { FaceDetector?: unknown }).FaceDetector;
    resetFaceDetector();
  });

  it("returns null without a FaceDetector (most browsers, incl. Chrome on Linux)", async () => {
    expect(await detectFaces(document.createElement("canvas"))).toBeNull();
  });

  it("uses a working FaceDetector", async () => {
    (globalThis as { FaceDetector?: unknown }).FaceDetector = class {
      detect = vi.fn().mockResolvedValue([{ boundingBox: { x: 1, y: 2, width: 3, height: 4 } }]);
    };
    expect(await detectFaces(document.createElement("canvas"))).toEqual([{ x: 1, y: 2, width: 3, height: 4 }]);
  });

  it("treats 'not implemented' as no detector, and stops asking", async () => {
    const detect = vi.fn().mockRejectedValue(new DOMException("Face Detection not implemented.", "NotSupportedError"));
    (globalThis as { FaceDetector?: unknown }).FaceDetector = class { detect = detect; };

    expect(await detectFaces(document.createElement("canvas"))).toBeNull();
    expect(await detectFaces(document.createElement("canvas"))).toBeNull();
    expect(detect).toHaveBeenCalledOnce();
  });
});

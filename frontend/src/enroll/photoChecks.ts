// Photo checks before upload. They copy the demo face provider's own measurements
// (backend/app/providers/face/demo.py: 160×120 grayscale, mean brightness, stddev of
// Pillow's FIND_EDGES), so a *hard* failure here is a photo the server would reject anyway.
// Softer warnings are advice only: the server stays the authority. Pixels stay in memory.

/** The size the server shrinks a photo to before measuring it. */
export const SAMPLE_WIDTH = 160;
export const SAMPLE_HEIGHT = 120;

/** Server limits (demo.py): below these the upload is rejected. */
export const MIN_SIDE_PX = 120; // shortest side of the full photo
export const MIN_BRIGHTNESS = 50; // mean gray level, 0-255
export const MIN_EDGE_DETAIL = 3; // stddev of edge strength; flat or very blurry ≈ 0-2

/** Our own, stricter advice: worth a warning, not a block. */
export const WARN_BRIGHTNESS = 70;
export const MAX_BRIGHTNESS = 225; // washed out (client-only: the server doesn't check this)
export const WARN_EDGE_DETAIL = 6;
/** With a face detector: the face should fill at least this much of the frame height… */
export const MIN_FACE_HEIGHT = 0.25;
/** …and its center should be within this fraction of the frame from the center. */
export const MAX_FACE_OFFSET = 0.2;

export type PhotoIssue =
  | "TOO_DARK"
  | "TOO_BRIGHT"
  | "BLURRY"
  | "TOO_SMALL"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "FACE_TOO_SMALL"
  | "OFF_CENTER";

export interface Finding {
  issue: PhotoIssue;
  /** The server would reject it: block the upload. Otherwise just a warning. */
  hard: boolean;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoCheck {
  findings: Finding[];
  /** False when the browser has no face detector (the face row says "not checked"). */
  faceChecked: boolean;
}

/** ITU-R 601 luma, like Pillow's convert("L"). */
export function grayscale({ data, width, height }: Pick<ImageData, "data" | "width" | "height">): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
  }
  return gray;
}

export function meanBrightness(gray: Float32Array): number {
  let sum = 0;
  for (const value of gray) sum += value;
  return gray.length ? sum / gray.length : 0;
}

/**
 * Pillow's FIND_EDGES (3×3 kernel, 8 in the middle, -1 around, clipped to 0-255), then the
 * standard deviation, skipping a 2 px border like the server does.
 */
export function edgeDetail(gray: Float32Array, width: number, height: number): number {
  const values: number[] = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      let sum = 8 * gray[i]!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) sum -= gray[i + dy * width + dx]!;
        }
      }
      values.push(Math.min(255, Math.max(0, sum)));
    }
  }
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

/** Face findings from a detector's boxes (in sample pixels). All of them are warnings. */
export function faceFindings(faces: FaceBox[], width: number, height: number): Finding[] {
  if (faces.length === 0) return [{ issue: "NO_FACE", hard: false }];
  if (faces.length > 1) return [{ issue: "MULTIPLE_FACES", hard: false }];
  const face = faces[0]!;
  const findings: Finding[] = [];
  if (face.height / height < MIN_FACE_HEIGHT) findings.push({ issue: "FACE_TOO_SMALL", hard: false });
  const dx = (face.x + face.width / 2) / width - 0.5;
  const dy = (face.y + face.height / 2) / height - 0.5;
  if (Math.abs(dx) > MAX_FACE_OFFSET || Math.abs(dy) > MAX_FACE_OFFSET) findings.push({ issue: "OFF_CENTER", hard: false });
  return findings;
}

/**
 * Check a 160×120 sample of the photo. `fullSize` is the real photo size (the sample is
 * shrunk); `faces` is null when no face detector is available.
 */
export function checkPhoto(sample: ImageData, fullSize: { width: number; height: number }, faces: FaceBox[] | null = null): PhotoCheck {
  const findings: Finding[] = [];
  if (Math.min(fullSize.width, fullSize.height) < MIN_SIDE_PX) findings.push({ issue: "TOO_SMALL", hard: true });

  const gray = grayscale(sample);
  const brightness = meanBrightness(gray);
  if (brightness < WARN_BRIGHTNESS) findings.push({ issue: "TOO_DARK", hard: brightness < MIN_BRIGHTNESS });
  else if (brightness > MAX_BRIGHTNESS) findings.push({ issue: "TOO_BRIGHT", hard: false });

  const detail = edgeDetail(gray, sample.width, sample.height);
  if (detail < WARN_EDGE_DETAIL) findings.push({ issue: "BLURRY", hard: detail < MIN_EDGE_DETAIL });

  if (faces) findings.push(...faceFindings(faces, sample.width, sample.height));
  return { findings, faceChecked: faces !== null };
}

export function hasHardFailure(check: PhotoCheck): boolean {
  return check.findings.some((f) => f.hard);
}

// --- Browser glue (kept thin so the logic above stays testable) ---------------------------

interface FaceDetectorLike {
  detect(image: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]>;
}

let detector: FaceDetectorLike | null | undefined;

/**
 * The Shape Detection API's FaceDetector, if this browser really has one. Verified
 * 2026-10-12: absent in Chrome 154 on Linux; with the experimental-features flag it exists
 * but detect() throws NotSupportedError ("not implemented"). So a failed call also means
 * "no detector", and we stop trying.
 */
function faceDetector(): FaceDetectorLike | null {
  if (detector !== undefined) return detector;
  const Ctor = (globalThis as { FaceDetector?: new (options?: object) => FaceDetectorLike }).FaceDetector;
  detector = Ctor ? new Ctor({ fastMode: true, maxDetectedFaces: 3 }) : null;
  return detector;
}

/** Faces in the canvas, or null when there's no working detector. */
export async function detectFaces(canvas: HTMLCanvasElement): Promise<FaceBox[] | null> {
  const active = faceDetector();
  if (!active) return null;
  try {
    const faces = await active.detect(canvas);
    return faces.map(({ boundingBox: b }) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
  } catch {
    detector = null;
    return null;
  }
}

/** For tests: forget the cached detector. */
export function resetFaceDetector(): void {
  detector = undefined;
}

/** Draw the current video frame into a 160×120 canvas (in memory only) and check it. */
export async function checkVideoFrame(video: HTMLVideoElement): Promise<PhotoCheck | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const sample = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const faces = await detectFaces(canvas);
  return checkPhoto(
    { data: sample.data, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT, colorSpace: "srgb" } as ImageData,
    { width: video.videoWidth, height: video.videoHeight },
    faces,
  );
}

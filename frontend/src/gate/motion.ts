// Cheap "did someone step in front of the camera?" check, so an empty gate doesn't
// send frames (each one would be logged as a LOW_QUALITY denial and burn the rate limit).

export const THUMB_WIDTH = 32;
export const THUMB_HEIGHT = 18;
/** Mean brightness change (0-255) between two thumbnails that counts as motion. */
export const MOTION_THRESHOLD = 12;

/** Average absolute difference between two grayscale thumbnails of the same size. */
export function frameDifference(previous: Uint8Array, current: Uint8Array): number {
  if (previous.length !== current.length || current.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    total += Math.abs(current[i]! - previous[i]!);
  }
  return total / current.length;
}

export function hasMotion(previous: Uint8Array | null, current: Uint8Array, threshold = MOTION_THRESHOLD): boolean {
  return previous !== null && frameDifference(previous, current) >= threshold;
}

let canvas: HTMLCanvasElement | null = null;

/** A 32x18 grayscale copy of the current video frame (in memory, never sent anywhere). */
export function grayThumbnail(video: HTMLVideoElement): Uint8Array | null {
  if (video.videoWidth === 0) return null;
  canvas ??= document.createElement("canvas");
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  const { data } = context.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  const gray = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
  }
  return gray;
}

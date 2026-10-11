import { vi } from "vitest";

/** Install a fake camera: getUserMedia, video playback/size and canvas JPEG encoding. */
export function installFakeCamera({ width = 1280, height = 720 } = {}) {
  const track = { stop: vi.fn(), kind: "video" };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });

  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(height);
  // jsdom can't assign a MediaStream to srcObject: keep it as a plain property.
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { value: null, writable: true, configurable: true });

  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      callback(new Blob(["jpeg-bytes"], { type: type ?? "image/png" }));
    });

  return { track, stream, getUserMedia, drawImage, toBlob };
}

export function removeCamera() {
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
}

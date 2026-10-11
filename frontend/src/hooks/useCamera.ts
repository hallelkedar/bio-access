import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type CameraStatus = "idle" | "requesting" | "ready" | "error";

export interface CameraController {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** The current frame as an in-memory JPEG (never stored anywhere). */
  capture: (options?: { quality?: number }) => Promise<Blob>;
}

const INSECURE_CONTEXT = "The camera needs a secure page (https or localhost).";

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow it in your browser's site settings, then retry.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found. Connect a camera and retry.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is in use by another app. Close it and retry.";
    default:
      return "Couldn't start the camera. Please retry.";
  }
}

export function useCamera({ facingMode = "user" }: { facingMode?: "user" | "environment" } = {}): CameraController {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0); // bumping it cancels a start() still waiting for permission
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop()); // camera light goes off
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    releaseStream();
    setStatus("idle");
  }, [releaseStream]);

  const start = useCallback(async () => {
    const request = ++requestRef.current;
    releaseStream();
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError(INSECURE_CONTEXT);
      return;
    }
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop()); // stopped or restarted meanwhile
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined); // autoplay is allowed for muted video
      }
      setStatus("ready");
    } catch (err) {
      if (request !== requestRef.current) return;
      setStatus("error");
      setError(cameraErrorMessage(err));
    }
  }, [facingMode, releaseStream]);

  // Never leave the camera on after the page is gone.
  useEffect(() => () => stop(), [stop]);

  const capture = useCallback(async ({ quality = 0.9 }: { quality?: number } = {}) => {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.videoWidth === 0) {
      throw new Error("camera is not ready");
    }
    // An off-screen canvas: the frame exists only in memory. Not mirrored (the preview is, via CSS).
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas is not available");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the frame"))),
        "image/jpeg",
        quality,
      );
    });
  }, []);

  return { videoRef, status, error, start, stop, capture };
}

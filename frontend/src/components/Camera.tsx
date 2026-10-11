import { useEffect, type ReactNode } from "react";

import type { CameraController } from "../hooks/useCamera";

interface CameraProps {
  camera: CameraController;
  autoStart?: boolean;
  /** Drawn on top of the live video once it's running (face guide, gate result…). */
  children?: ReactNode;
}

export function Camera({ camera, autoStart = true, children }: CameraProps) {
  const { start, stop, status, error, videoRef } = camera;

  useEffect(() => {
    if (!autoStart) return;
    void start();
    return () => stop();
  }, [autoStart, start, stop]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
      {/* Mirrored like a mirror for the person in front of it; captured frames are not. */}
      <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview"
        className="h-full w-full -scale-x-100 object-cover" />
      {status === "requesting" && (
        <Overlay>Waiting for camera permission…</Overlay>
      )}
      {status === "error" && (
        <Overlay>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => void start()} className="mt-3 rounded-md bg-white px-3 py-1.5 text-sm text-slate-900">
            Retry
          </button>
        </Overlay>
      )}
      {status === "ready" && children}
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 p-6 text-center text-white">
      {children}
    </div>
  );
}

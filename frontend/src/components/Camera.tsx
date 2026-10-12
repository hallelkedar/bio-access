import { useEffect, type ReactNode } from "react";

import type { CameraController } from "../hooks/useCamera";
import { useLanguage } from "../i18n/LanguageProvider";

interface CameraProps {
  camera: CameraController;
  autoStart?: boolean;
  /** Drawn on top of the live video once it's running (face guide, gate result…). */
  children?: ReactNode;
  /** Shown over the video instead of it while `hidden` (the camera keeps running underneath). */
  standby?: ReactNode;
  hidden?: boolean;
}

export function Camera({ camera, autoStart = true, children, standby, hidden = false }: CameraProps) {
  const { start, stop, status, error, errorKey, videoRef } = camera;
  const { t } = useLanguage();

  useEffect(() => {
    if (!autoStart) return;
    void start();
    return () => stop();
  }, [autoStart, start, stop]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
      {/* Mirrored like a mirror for the person in front of it; captured frames are not. */}
      <video ref={videoRef} autoPlay playsInline muted aria-label={t("camera.preview")}
        className="h-full w-full -scale-x-100 object-cover" />
      {status === "requesting" && (
        <Overlay>{t("camera.waiting")}</Overlay>
      )}
      {status === "error" && (
        <Overlay>
          <p role="alert">{errorKey ? t(errorKey) : error}</p>
          <button type="button" onClick={() => void start()} className="mt-3 rounded-md bg-white px-3 py-1.5 text-sm text-slate-900">
            {t("common.retry")}
          </button>
        </Overlay>
      )}
      {status === "ready" && children}
      {status === "ready" && standby !== undefined && (
        <div aria-hidden={!hidden} data-testid="camera-standby" data-shown={hidden}
          className={`absolute inset-0 flex flex-col items-center justify-center bg-slate-900 p-6 text-center text-slate-300 transition-opacity duration-300 motion-reduce:transition-none ${
            hidden ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          {standby}
        </div>
      )}
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

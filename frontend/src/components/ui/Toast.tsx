import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "../../i18n/LanguageProvider";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  success: (message: string) => number;
  error: (message: string) => number;
  info: (message: string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLE: Record<ToastKind, { box: string; icon: string; path: string }> = {
  success: { box: "border-ok-500/40", icon: "text-ok-600", path: "M5 10.5l3.2 3.2L15 7" },
  error: { box: "border-deny-500/40", icon: "text-deny-600", path: "M6 6l8 8M14 6l-8 8" },
  info: { box: "border-brand-500/40", icon: "text-brand-600", path: "M10 9v5M10 6.2v.1" },
};

/** Toasts stack at the bottom-end corner (flips in RTL), dismiss themselves, and pause on hover or focus. */
export function ToastProvider({ children, durationMs = 4000 }: { children: ReactNode; durationMs?: number }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const show = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, kind, message }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: (message) => show("success", message),
    error: (message) => show("error", message),
    info: (message) => show("info", message),
    dismiss,
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        // The live region is always in the DOM, so screen readers announce toasts added to it.
        <div aria-live="polite" aria-label={t("ui.toast.region")}
          className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
          {toasts.map((toast) => (
            <ToastView key={toast.id} toast={toast} durationMs={durationMs} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, durationMs, onDismiss }: { toast: ToastItem; durationMs: number; onDismiss: () => void }) {
  const { t } = useLanguage();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs);
  const dismissRef = useRef(onDismiss); // a new function each render; the timer must not restart
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused]);

  const style = STYLE[toast.kind];
  return (
    <div data-kind={toast.kind}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex animate-pop-in items-start gap-3 rounded-card border bg-surface p-3 text-sm text-text shadow-raised ${style.box}`}>
      <svg viewBox="0 0 20 20" className={`mt-0.5 h-5 w-5 shrink-0 ${style.icon}`} fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" strokeWidth="1.5" opacity="0.35" />
        <path d={style.path} />
      </svg>
      <p className="flex-1">{toast.message}</p>
      <button type="button" onClick={onDismiss} aria-label={t("ui.toast.dismiss")}
        className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-brand-500">
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l8 8M14 6l-8 8" />
        </svg>
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

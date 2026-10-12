import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "../../i18n/LanguageProvider";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A side panel for details, sliding in from the end side (the left in Hebrew). Same rules as
 * Modal: focus starts on Close, Tab stays inside, Esc or a backdrop click closes it, and
 * focus goes back to whatever opened it.
 */
export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 animate-fade-in bg-slate-950/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}
        className="absolute inset-y-0 end-0 flex w-full max-w-md animate-drawer-in flex-col border-s border-border bg-surface text-text shadow-raised [--drawer-from:2rem] rtl:[--drawer-from:-2rem]">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button ref={closeButton} type="button" onClick={onClose} aria-label={t("ui.modal.close")}
            className="-m-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-brand-500">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

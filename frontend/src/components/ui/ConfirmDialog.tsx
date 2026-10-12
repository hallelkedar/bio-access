import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useLanguage } from "../../i18n/LanguageProvider";
import { Button } from "./Button";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button red: use it for deletes and other one-way actions. */
  tone?: "default" | "danger";
  /** Shows a spinner on the confirm button and blocks closing while the action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible modal: focus starts on Cancel (the safe choice), Tab stays inside, Esc or a
 * backdrop click cancels, and focus goes back to whatever opened it.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, tone = "default", busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useLanguage();
  const titleId = useId();
  const messageId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open) return null;

  const cancel = () => {
    if (!busy) onCancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
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
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={message ? messageId : undefined}
        onKeyDown={onKeyDown}
        className="w-full max-w-md animate-pop-in rounded-card border border-border bg-surface p-6 text-text shadow-raised">
        <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        {message && <div id={messageId} className="mt-2 text-sm text-muted">{message}</div>}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button ref={cancelButton} variant="secondary" onClick={cancel} disabled={busy}>
            {cancelLabel ?? t("ui.confirm.cancel")}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel ?? t("ui.confirm.confirm")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

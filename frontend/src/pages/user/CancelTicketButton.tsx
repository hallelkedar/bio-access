import { AxiosError } from "axios";
import { useState } from "react";

import { apiErrorMessage } from "../../api/errors";
import { cancelTicket } from "../../api/tickets";
import { ConfirmDialog, useToast } from "../../components/ui";
import { useLanguage } from "../../i18n/LanguageProvider";

/**
 * "Cancel ticket" for a ticket awaiting payment: asks first, then reports with a toast.
 * `onDone` reloads the caller's data in both outcomes, since an "already paid" answer
 * means the ticket just became valid.
 */
export function CancelTicketButton({ ticketId, eventName, onDone, className = "" }: { ticketId: number; eventName: string; onDone: () => void; className?: string }) {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await cancelTicket(ticketId);
      toast.success(t("cancel.done"));
      onDone();
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 409 && err.response.data?.detail === "ticket already paid") {
        toast.info(t("cancel.alreadyPaid"));
        onDone();
      } else {
        toast.error(apiErrorMessage(err, {}, lang));
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`rounded-md px-1 text-sm font-medium text-slate-600 underline-offset-2 hover:text-deny-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500 ${className}`}>
        {t("cancel.button")}
      </button>
      <ConfirmDialog
        open={open}
        tone="danger"
        busy={busy}
        title={t("cancel.title")}
        // FSI…PDI isolate the (often Latin) name inside a Hebrew sentence, like <bdi> in a string.
        message={t("cancel.message", { event: `\u2068${eventName}\u2069` })}
        confirmLabel={t("cancel.confirm")}
        cancelLabel={t("cancel.keep")}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

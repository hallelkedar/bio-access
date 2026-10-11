import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { myTickets, refreshPayment, startCheckout } from "../../api/tickets";
import type { TicketStatus } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { useLanguage } from "../../i18n/LanguageProvider";
import { redirectTo } from "../../navigation";

type Outcome = "waiting" | "confirming" | "ready" | "slow" | "missing";

const isPaid = (status: TicketStatus | undefined) => status === "VALID" || status === "ENTERED";

/**
 * Stripe may send the user here before its webhook reaches our backend, so poll the ticket.
 * If it's still pending after a few seconds, ask the backend to check with the payment
 * provider directly (covers a webhook that never arrives).
 */
export function CheckoutSuccessPage({
  pollMs = 2000,
  maxWaitMs = 30_000,
  refreshAtMs = [5000, 15_000],
}: {
  pollMs?: number;
  maxWaitMs?: number;
  refreshAtMs?: number[];
}) {
  const ticketId = Number(useSearchParams()[0].get("ticket_id"));
  const { t } = useLanguage();
  const [outcome, setOutcome] = useState<Outcome>("waiting");
  const [round, setRound] = useState(0); // "Check again" starts a new round
  // A string key: an array prop is a new object on every render and would restart the loop.
  const refreshKey = refreshAtMs.join(",");

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const schedule = refreshKey ? refreshKey.split(",").map(Number) : [];
    const pendingRefreshes = round === 0 ? schedule : [0]; // a manual retry checks the provider at once
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      try {
        const ticket = (await myTickets()).find((t) => t.id === ticketId);
        if (stopped) return;
        if (!ticket) return setOutcome("missing");
        if (isPaid(ticket.status)) return setOutcome("ready");
        const elapsed = Date.now() - started;
        if (pendingRefreshes.length > 0 && elapsed >= pendingRefreshes[0]!) {
          pendingRefreshes.shift();
          setOutcome("confirming");
          if (isPaid(await refreshPayment(ticketId).catch(() => undefined))) {
            if (!stopped) setOutcome("ready");
            return;
          }
        }
      } catch {
        // network hiccup: keep trying until the deadline
      }
      if (stopped) return;
      if (Date.now() - started >= maxWaitMs) return setOutcome("slow");
      timer = setTimeout(() => void check(), pollMs);
    }

    setOutcome("waiting");
    timer = setTimeout(() => void check(), 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ticketId, pollMs, maxWaitMs, refreshKey, round]);

  return (
    <section className="mx-auto max-w-md text-center">
      {outcome === "waiting" && <Spinner label={t("checkout.confirming")} />}
      {outcome === "confirming" && <Spinner label={t("checkout.confirmingProvider")} />}
      {outcome === "ready" && (
        <>
          <h1 className="text-2xl font-bold text-emerald-700">{t("checkout.receivedTitle")}</h1>
          <p className="mt-2 text-slate-600">{t("checkout.receivedBody")}</p>
          <Link to="/tickets" className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-white">
            {t("checkout.myTickets")}
          </Link>
        </>
      )}
      {outcome === "slow" && (
        <>
          <h1 className="text-2xl font-bold">{t("checkout.slowTitle")}</h1>
          <p className="mt-2 text-slate-600">{t("checkout.slowBody")}</p>
          <button type="button" onClick={() => setRound((r) => r + 1)}
            className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-white">
            {t("checkout.checkAgain")}
          </button>
        </>
      )}
      {outcome === "missing" && (
        <>
          <h1 className="text-2xl font-bold">{t("checkout.missingTitle")}</h1>
          <Link to="/events" className="mt-4 inline-block text-blue-700 underline">{t("checkout.backToEvents")}</Link>
        </>
      )}
    </section>
  );
}

export function CheckoutCancelPage() {
  const ticketId = Number(useSearchParams()[0].get("ticket_id"));
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      redirectTo(await startCheckout(ticketId));
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-bold">{t("checkout.cancelledTitle")}</h1>
      <p className="mt-2 text-slate-600">{t("checkout.cancelledBody")}</p>
      <div className="mt-6 flex justify-center gap-4">
        <button type="button" onClick={() => void retry()} disabled={busy || !ticketId}
          className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          {busy ? t("common.redirecting") : t("checkout.tryAgain")}
        </button>
        <Link to="/events" className="rounded-md border px-4 py-2">{t("checkout.backToEvents")}</Link>
      </div>
      <div className="mt-4"><ErrorBox message={error} /></div>
    </section>
  );
}

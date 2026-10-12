import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { apiErrorMessage } from "../../api/errors";
import { myTickets, refreshPayment, startCheckout } from "../../api/tickets";
import type { TicketStatus } from "../../api/types";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { Button, ButtonLink, Card, Confetti, ResultIcon } from "../../components/ui";
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
    <ResultCard>
      {outcome === "waiting" && <Spinner label={t("checkout.confirming")} />}
      {outcome === "confirming" && <Spinner label={t("checkout.confirmingProvider")} />}
      {outcome === "ready" && (
        <>
          <Confetti />
          <ResultIcon tone="ok" path="M15 27l7 7 15-16" />
          <h1 className="mt-5 text-2xl font-bold text-ok-700">{t("checkout.receivedTitle")}</h1>
          <p className="mt-2 text-muted">{t("checkout.receivedBody")}</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink to="/tickets" className="min-h-11">{t("checkout.myTickets")}</ButtonLink>
            <ButtonLink to="/events" variant="secondary" className="min-h-11">{t("checkout.browseEvents")}</ButtonLink>
          </div>
        </>
      )}
      {outcome === "slow" && (
        <>
          <ResultIcon tone="warn" path="M26 16v11l7 4" circle />
          <h1 className="mt-5 text-2xl font-bold">{t("checkout.slowTitle")}</h1>
          <p className="mt-2 text-muted">{t("checkout.slowBody")}</p>
          <Button onClick={() => setRound((r) => r + 1)} className="mt-6 min-h-11">{t("checkout.checkAgain")}</Button>
        </>
      )}
      {outcome === "missing" && (
        <>
          <ResultIcon tone="neutral" path="M26 17v11M26 35v.5" circle />
          <h1 className="mt-5 text-2xl font-bold">{t("checkout.missingTitle")}</h1>
          <ButtonLink to="/events" variant="secondary" className="mt-6 min-h-11">{t("checkout.backToEvents")}</ButtonLink>
        </>
      )}
    </ResultCard>
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
    <ResultCard>
      <ResultIcon tone="neutral" path="M19 19l14 14M33 19 19 33" circle />
      <h1 className="mt-5 text-2xl font-bold">{t("checkout.cancelledTitle")}</h1>
      <p className="mt-2 text-muted">{t("checkout.cancelledBody")}</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Button onClick={() => void retry()} loading={busy} disabled={!ticketId} className="min-h-11">
          {busy ? t("common.redirecting") : t("checkout.tryAgain")}
        </Button>
        <ButtonLink to="/events" variant="secondary" className="min-h-11">{t("checkout.backToEvents")}</ButtonLink>
      </div>
      <div className="mt-4 text-start"><ErrorBox message={error} /></div>
    </ResultCard>
  );
}

function ResultCard({ children }: { children: ReactNode }) {
  return (
    <section className="flex justify-center py-6 sm:py-10">
      <Card className="relative flex w-full max-w-md flex-col items-center px-6 py-10 text-center">{children}</Card>
    </section>
  );
}

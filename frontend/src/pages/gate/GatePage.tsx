import { useCallback, useEffect, useState, type FormEvent } from "react";

import { apiErrorMessage } from "../../api/errors";
import { listEvents } from "../../api/events";
import { verifyQr, type GateDecision } from "../../api/gate";
import type { Event } from "../../api/types";
import { Camera } from "../../components/Camera";
import { ErrorBox } from "../../components/ErrorBox";
import { FormField } from "../../components/FormField";
import { Spinner } from "../../components/Spinner";
import { loadGateSetup, saveGateSetup, type GateSetup } from "../../gate/gateSetup";
import { denialText, hintText } from "../../gate/messages";
import { grayThumbnail } from "../../gate/motion";
import { useCamera } from "../../hooks/useCamera";
import { useGateScanner, type ScannerOptions } from "../../hooks/useGateScanner";
import { useLanguage } from "../../i18n/LanguageProvider";

export function GatePage({ scannerOptions }: { scannerOptions?: ScannerOptions }) {
  const { t, lang } = useLanguage();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<GateSetup | null>(null);

  useEffect(() => {
    listEvents()
      .then(setEvents)
      .catch((err) => setError(apiErrorMessage(err, {}, lang)));
  }, []); // load once

  if (error) return <ErrorBox message={error} />;
  if (!events) return <Spinner label={t("gate.loadingEvents")} />;
  const event = setup && events.find((e) => e.id === setup.eventId);
  if (!setup || !event) {
    return <SetupForm events={events} onStart={(chosen) => { saveGateSetup(chosen); setSetup(chosen); }} />;
  }
  return <Terminal event={event} gateId={setup.gateId} onStop={() => setSetup(null)} scannerOptions={scannerOptions} />;
}

function SetupForm({ events, onStart }: { events: Event[]; onStart: (setup: GateSetup) => void }) {
  const remembered = loadGateSetup();
  const initialEvent = events.some((e) => e.id === remembered?.eventId) ? remembered!.eventId : events[0]?.id;
  const [eventId, setEventId] = useState<number | undefined>(initialEvent);
  const { t } = useLanguage();
  const [gateId, setGateId] = useState(remembered?.gateId ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (eventId !== undefined && gateId.trim()) onStart({ eventId, gateId: gateId.trim() });
  }

  if (events.length === 0) {
    return (
      <section>
        <h1 className="text-2xl font-bold">{t("gate.title")}</h1>
        <p className="mt-2 text-slate-600">{t("gate.noEvents")}</p>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">{t("gate.title")}</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="event" className="block text-sm font-medium text-slate-700">{t("gate.event")}</label>
          <select id="event" value={eventId} onChange={(e) => setEventId(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2">
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <FormField label={t("gate.gateName")} name="gate" required maxLength={64} placeholder="north-1" value={gateId}
          onChange={(e) => setGateId(e.target.value)} />
        <button type="submit" disabled={!gateId.trim()}
          className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {t("gate.start")}
        </button>
      </form>
    </section>
  );
}

function Terminal({ event, gateId, onStop, scannerOptions }: {
  event: Event; gateId: string; onStop: () => void; scannerOptions?: ScannerOptions;
}) {
  const camera = useCamera();
  const { t, lang } = useLanguage();
  const [paused, setPaused] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const sampleFrame = useCallback(
    () => (camera.videoRef.current ? grayThumbnail(camera.videoRef.current) : null),
    [camera.videoRef],
  );
  const { state, showDecision } = useGateScanner({
    camera, eventId: event.id, gateId, enabled: !paused, sampleFrame, options: scannerOptions,
  });

  useEffect(() => {
    if (state.providerDown) setQrOpen(true); // face service down: switch to QR
  }, [state.providerDown]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{event.name}</h1>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-sm">{t("gate.gateLabel", { gate: gateId })}</span>
        <span className="text-sm text-slate-600" aria-live="polite">
          {paused ? t("gate.paused") : state.phase === "verifying" ? t("gate.checking") : t("gate.scanning")}
        </span>
        <div className="ms-auto flex gap-2">
          <button type="button" onClick={() => setPaused((p) => !p)} className="rounded-md border px-3 py-1.5 text-sm">
            {paused ? t("gate.resume") : t("gate.pause")}
          </button>
          <button type="button" onClick={() => setQrOpen((o) => !o)} className="rounded-md border px-3 py-1.5 text-sm">
            {t("gate.qrFallback")}
          </button>
          <button type="button" onClick={onStop} className="rounded-md border px-3 py-1.5 text-sm">{t("gate.changeGate")}</button>
        </div>
      </div>
      {state.hint && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
          {state.hintCode ? hintText(lang, state.hintCode, state.hintVars) : state.hint}
        </p>
      )}
      <Camera camera={camera} />
      {qrOpen && <QrPanel eventId={event.id} gateId={gateId} onDecision={showDecision} />}
      {state.phase === "result" && state.decision && <ResultOverlay decision={state.decision} />}
    </section>
  );
}

function ResultOverlay({ decision }: { decision: GateDecision }) {
  const approved = decision.result === "APPROVED";
  const { t, lang } = useLanguage();
  return (
    <div role="alert" className={`fixed inset-0 z-50 flex flex-col items-center justify-center text-white ${approved ? "bg-emerald-600" : "bg-red-600"}`}>
      <p className="text-7xl font-black">{approved ? "✓" : "✕"}</p>
      <p className="mt-4 text-5xl font-bold">{approved ? t("gate.welcome") : denialText(lang, decision.reason)}</p>
      {decision.user_name && <p className="mt-3 text-3xl">{decision.user_name}</p>}
    </div>
  );
}

function QrPanel({ eventId, gateId, onDecision }: { eventId: number; gateId: string; onDecision: (d: GateDecision) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useLanguage();

  // USB/Bluetooth QR scanners type the code and press Enter, which submits this form.
  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      onDecision(await verifyQr(eventId, gateId, value));
      setToken("");
    } catch (err) {
      setError(apiErrorMessage(err, {}, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <label htmlFor="qr" className="block text-sm font-medium">{t("gate.qrLabel")}</label>
      <div className="flex gap-2">
        <input id="qr" autoFocus value={token} maxLength={64} onChange={(e) => setToken(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono" />
        <button type="submit" disabled={busy || !token.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          {t("gate.verify")}
        </button>
      </div>
      <ErrorBox message={error} />
    </form>
  );
}

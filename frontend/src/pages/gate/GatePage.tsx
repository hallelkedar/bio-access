import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { apiErrorMessage } from "../../api/errors";
import { listEvents } from "../../api/events";
import { verifyQr, type GateDecision } from "../../api/gate";
import type { Event } from "../../api/types";
import type { Lang } from "../../i18n/translate";
import { Camera } from "../../components/Camera";
import { ErrorBox } from "../../components/ErrorBox";
import { FormField } from "../../components/FormField";
import { Spinner } from "../../components/Spinner";
import { formatRelative, localeFor } from "../../format";
import { GateResult } from "../../gate/GateResult";
import { loadGateSetup, saveGateSetup, type GateSetup } from "../../gate/gateSetup";
import { gateWindow, type GateWindow } from "../../gate/gateWindow";
import { denialText, hintText } from "../../gate/messages";
import { grayThumbnail, hasMotion } from "../../gate/motion";
import { feedView, PRESENCE_THRESHOLD } from "../../gate/presence";
import { ScanFrame } from "../../gate/ScanFrame";
import { STATUS_STYLE, terminalStatus } from "../../gate/terminalStatus";
import { useCamera } from "../../hooks/useCamera";
import { useClock } from "../../hooks/useClock";
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
  const { t, lang } = useLanguage();
  const [gateId, setGateId] = useState(remembered?.gateId ?? "");
  const now = new Date();

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
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {gateWindow(e, now) === "before" ? `${e.name} · ${t("gate.opensAt", { time: openingTime(e, lang) })}` : e.name}
              </option>
            ))}
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
  const now = useClock();
  const [paused, setPaused] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [tally, setTally] = useState({ approved: 0, denied: 0 });
  // Last movement in front of the camera: decides whether the live feed is shown at all.
  const [lastMotionAt, setLastMotionAt] = useState(0);
  const presence = useRef({ previous: null as Uint8Array | null, motionAt: 0 });
  const sampleFrame = useCallback(() => {
    const thumbnail = camera.videoRef.current ? grayThumbnail(camera.videoRef.current) : null;
    if (thumbnail) {
      const seen = presence.current;
      if (hasMotion(seen.previous, thumbnail, PRESENCE_THRESHOLD)) {
        const now = Date.now();
        if (now - seen.motionAt > 1000) setLastMotionAt(now); // re-render at most once a second
        seen.motionAt = now;
      }
      seen.previous = thumbnail;
    }
    return thumbnail;
  }, [camera.videoRef]);
  // Outside the event's gate hours the camera isn't even started: the server would refuse every scan.
  const hours = gateWindow(event, now);
  const open = hours === "open";
  const { state, showDecision } = useGateScanner({
    camera, eventId: event.id, gateId, enabled: open && !paused, sampleFrame, options: scannerOptions,
  });
  const status = open ? STATUS_STYLE[terminalStatus(state, paused)] : CLOSED_STYLE[hours];
  // The clock re-renders every second, which is what turns the feed off after the last movement.
  const view = feedView({ paused, phase: state.phase, lastMotionAt: Math.max(lastMotionAt, presence.current.motionAt), now: now.getTime() });

  useEffect(() => {
    if (state.providerDown) setQrOpen(true); // face service down: switch to QR
  }, [state.providerDown]);

  useEffect(() => {
    // Each decision is a new object, so this counts every result once (face and QR alike).
    if (!state.decision) return;
    const key = state.decision.result === "APPROVED" ? "approved" : "denied";
    setTally((counts) => ({ ...counts, [key]: counts[key] + 1 }));
  }, [state.decision]);

  return (
    <section className="theme-dark mx-[calc(50%-50vw)] -my-8 min-h-[calc(100vh-4rem)] px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">{event.name}</h1>
          <span className="rounded bg-white/10 px-2 py-0.5 text-sm">{t("gate.gateLabel", { gate: gateId })}</span>
          <span role="status" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ${status.chip}`}>
            <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
            {t(status.key)}
          </span>
          <time dateTime={now.toISOString()} aria-label={t("gate.clock")} data-testid="gate-clock"
            className="font-mono text-lg text-muted tabular-nums">
            {new Intl.DateTimeFormat(localeFor(lang), { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now)}
          </time>
          <div className="ms-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => setPaused((p) => !p)} className={darkButton} disabled={!open}>
              {paused ? t("gate.resume") : t("gate.pause")}
            </button>
            <button type="button" onClick={() => setQrOpen((o) => !o)} className={darkButton} disabled={!open}>
              {t("gate.qrFallback")}
            </button>
            <button type="button" onClick={onStop} className={darkButton}>{t("gate.changeGate")}</button>
          </div>
        </div>
        {state.hint && (
          <p role="status" className="rounded-md bg-amber-400/10 px-3 py-2 text-amber-200 ring-1 ring-amber-400/30">
            {state.hintCode ? hintText(lang, state.hintCode, state.hintVars) : state.hint}
          </p>
        )}
        <div className="overflow-hidden rounded-2xl shadow-raised ring-1 ring-white/10">
          {open ? (
            <Camera camera={camera} hidden={view !== "live"} standby={<Standby paused={view === "paused"} />}>
              <ScanFrame phase={paused ? "paused" : state.phase} />
            </Camera>
          ) : (
            <GateClosed event={event} hours={hours} now={now} />
          )}
        </div>
        {open && qrOpen && <QrPanel eventId={event.id} gateId={gateId} onDecision={showDecision} />}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-3 text-sm text-muted">
          <span className="inline-flex items-center gap-2" data-testid="tally-approved">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            {t("gate.session.approved", { n: tally.approved })}
          </span>
          <span className="inline-flex items-center gap-2" data-testid="tally-denied">
            <span className="h-2 w-2 rounded-full bg-rose-400" aria-hidden="true" />
            {t("gate.session.denied", { n: tally.denied })}
          </span>
          <span>{t("gate.session.since")}</span>
        </div>
      </div>
      {state.phase === "result" && state.decision && <ResultOverlay decision={state.decision} />}
    </section>
  );
}

/** What an empty or paused gate shows instead of the live camera. */
function Standby({ paused }: { paused: boolean }) {
  const { t } = useLanguage();
  return (
    <>
      <svg viewBox="0 0 48 48" className="h-14 w-14 text-accent-300/70" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        {paused
          ? <path d="M19 16v16M29 16v16" />
          : <path d="M6 16V10a4 4 0 0 1 4-4h6M32 6h6a4 4 0 0 1 4 4v6M42 32v6a4 4 0 0 1-4 4h-6M16 42h-6a4 4 0 0 1-4-4v-6M18 30c1.6 1.6 3.6 2.4 6 2.4s4.4-.8 6-2.4M18 19v2M30 19v2" />}
      </svg>
      <p className="mt-3 text-lg font-medium">{t(paused ? "gate.standby.paused" : "gate.standby.idle")}</p>
    </>
  );
}

const CLOSED_STYLE: Record<Exclude<GateWindow, "open">, (typeof STATUS_STYLE)[keyof typeof STATUS_STYLE]> = {
  before: { key: "gate.status.notOpen", dot: "bg-slate-400", chip: "bg-slate-500/15 text-slate-200 ring-slate-400/30" },
  ended: { key: "gate.status.ended", dot: "bg-slate-400", chip: "bg-slate-500/15 text-slate-200 ring-slate-400/30" },
};

/** "Wed, Oct 14, 07:00" in the operator's language: the date too, since it can be weeks away. */
function openingTime(event: Event, lang: Lang): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(event.gate_opens_at));
}

const WEEK_MS = 7 * 86_400_000;

/** Instead of the camera before the doors open or after the event: the camera stays off. */
function GateClosed({ event, hours, now }: { event: Event; hours: Exclude<GateWindow, "open">; now: Date }) {
  const { t, lang } = useLanguage();
  return (
    <div data-testid="gate-closed" className="flex aspect-video w-full flex-col items-center justify-center bg-slate-900 px-6 text-center">
      <svg viewBox="0 0 48 48" className="h-14 w-14 text-accent-300/70" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="24" cy="24" r="17" />
        <path d={hours === "before" ? "M24 14v10l7 4" : "M17 17l14 14M31 17L17 31"} />
      </svg>
      {hours === "before" ? (
        <>
          <p className="mt-3 text-lg font-medium">{t("gate.closed.opensAt", { time: openingTime(event, lang) })}</p>
          <p className="mt-1 text-muted">
            {/* "in 14 hr." helps on the day; weeks away, the date above says it all. */}
            {new Date(event.gate_opens_at).getTime() - now.getTime() < WEEK_MS && `${formatRelative(event.gate_opens_at, now, lang)} · `}
            {t("gate.closed.cameraOff")}
          </p>
        </>
      ) : (
        <p className="mt-3 text-lg font-medium">{t("gate.closed.ended")}</p>
      )}
    </div>
  );
}

const darkButton = "rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-white/10 active:bg-white/15 disabled:pointer-events-none disabled:opacity-40";

function ResultOverlay({ decision }: { decision: GateDecision }) {
  const approved = decision.result === "APPROVED";
  const { t, lang } = useLanguage();
  return (
    <div role="alert" className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden px-6 text-center text-white ${
      approved ? "bg-emerald-600" : "bg-rose-600"}`}>
      {approved && (
        <div aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto h-[150vmax] w-[150vmax] animate-burst rounded-full bg-[radial-gradient(circle,rgb(255_255_255_/_0.55),rgb(52_211_153_/_0.35)_35%,transparent_65%)]" />
      )}
      <div className={`relative ${approved ? "" : "animate-shake"}`}>
        <GateResult approved={approved} message={approved ? t("gate.welcome") : denialText(lang, decision.reason)} name={decision.user_name} />
      </div>
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
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-border bg-surface-2 p-4">
      <label htmlFor="qr" className="block text-sm font-medium">{t("gate.qrLabel")}</label>
      <div className="flex gap-2">
        <input id="qr" autoFocus value={token} maxLength={64} onChange={(e) => setToken(e.target.value)}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-text" />
        <button type="submit" disabled={busy || !token.trim()}
          className="rounded-md bg-accent-400 px-4 py-2 font-medium text-slate-950 disabled:opacity-50">
          {t("gate.verify")}
        </button>
      </div>
      <ErrorBox message={error} />
    </form>
  );
}

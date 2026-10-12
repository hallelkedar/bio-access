import { AxiosError } from "axios";
import { useEffect, useState } from "react";

import { checkVideoFrame, hasHardFailure, type PhotoCheck, type PhotoIssue } from "../../enroll/photoChecks";
import { useParams, useSearchParams } from "react-router";

import { enrollFace, replaceFace, type QualityIssue } from "../../api/enrollment";
import { apiErrorMessage } from "../../api/errors";
import { myTickets } from "../../api/tickets";
import type { MyTicket } from "../../api/types";
import { Camera } from "../../components/Camera";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { Button, ButtonLink, Card, Confetti, ConfirmDialog, ResultIcon } from "../../components/ui";
import { useCamera } from "../../hooks/useCamera";
import { useLanguage } from "../../i18n/LanguageProvider";
import type { TranslationKey } from "../../i18n/en";
import { translate, type Lang } from "../../i18n/translate";

/** English tips (kept for compatibility); the page shows qualityTip() in the current language. */
export const QUALITY_TIPS: Record<QualityIssue, string> = {
  NO_FACE: "We couldn't see a face. Center your face in the oval.",
  MULTIPLE_FACES: "Only one person should be in the picture.",
  LOW_CONFIDENCE: "Try again with your face clearly visible (no sunglasses or mask).",
  TOO_DARK: "It's too dark. Find better light, facing a window or lamp.",
  BLURRY: "The photo is blurry. Hold still for a moment.",
  BAD_POSE: "Look straight at the camera.",
  TOO_SMALL: "Move a bit closer to the camera.",
};

type Step =
  | { name: "checking" }
  | { name: "blocked"; message: string; canReplace?: boolean }
  | { name: "consent" }
  | { name: "camera"; tips: string[]; error: string | null }
  | { name: "review"; photo: Blob; check: PhotoCheck | null }
  | { name: "uploading"; photo: Blob; check: PhotoCheck | null }
  | { name: "done" };

function qualityIssues(error: unknown): QualityIssue[] | null {
  if (!(error instanceof AxiosError) || error.response?.status !== 422) return null;
  const issues: unknown = error.response.data?.detail?.issues;
  return Array.isArray(issues) ? (issues as QualityIssue[]) : null;
}

export function qualityTip(lang: Lang, issue: QualityIssue): string {
  return translate(lang, `quality.${issue}`);
}

/** Tips for the browser's own photo checks (photoChecks.ts), reusing the server's wording. */
const CLIENT_TIP: Record<PhotoIssue, TranslationKey> = {
  TOO_DARK: "quality.TOO_DARK",
  TOO_BRIGHT: "quality.TOO_BRIGHT",
  BLURRY: "quality.BLURRY",
  TOO_SMALL: "quality.TOO_SMALL",
  NO_FACE: "quality.NO_FACE",
  MULTIPLE_FACES: "quality.MULTIPLE_FACES",
  FACE_TOO_SMALL: "quality.TOO_SMALL",
  OFF_CENTER: "quality.OFF_CENTER",
};

/** How often the live preview is checked. */
const LIVE_CHECK_MS = 400;

const STEPS: TranslationKey[] = ["enroll.step.consent", "enroll.step.photo", "enroll.step.review", "enroll.step.done"];

/** Which stepper step a page step belongs to (null: no stepper while loading or blocked). */
function stepIndex(step: Step): number | null {
  switch (step.name) {
    case "consent": return 0;
    case "camera": return 1;
    case "review":
    case "uploading": return 2;
    case "done": return 3;
    default: return null;
  }
}

export function EnrollPage() {
  const { t, lang } = useLanguage();
  const ticketId = Number(useParams().ticketId);
  const wantsReplace = useSearchParams()[0].get("replace") === "1";
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [step, setStep] = useState<Step>({ name: "checking" });
  // Replacing only makes sense for an enrolled ticket; otherwise ?replace=1 is a normal setup.
  const replacing = wantsReplace && ticket?.enrolled === true;

  useEffect(() => {
    let active = true;
    myTickets()
      .then((tickets) => {
        if (!active) return;
        const found = tickets.find((t) => t.id === ticketId);
        setTicket(found ?? null);
        if (!found) setStep({ name: "blocked", message: t("enroll.ticketNotFound") });
        else if (found.status !== "VALID") setStep({ name: "blocked", message: t("enroll.onlyValid") });
        else if (found.enrolled && !wantsReplace) setStep({ name: "blocked", message: t("enroll.alreadySetUp"), canReplace: true });
        else setStep({ name: "consent" });
      })
      .catch((err) => active && setStep({ name: "blocked", message: apiErrorMessage(err, {}, lang) }));
    return () => {
      active = false;
    };
  }, [ticketId, wantsReplace]); // loaded once per ticket; messages use the language of that moment

  async function upload(photo: Blob, check: PhotoCheck | null) {
    setStep({ name: "uploading", photo, check });
    try {
      await (replacing ? replaceFace : enrollFace)(ticketId, photo);
      setStep({ name: "done" }); // the photo is no longer referenced anywhere
    } catch (err) {
      const issues = qualityIssues(err);
      if (issues) {
        setStep({ name: "camera", tips: issues.map((issue) => (issue in QUALITY_TIPS ? qualityTip(lang, issue) : t("enroll.anotherPhoto"))), error: null });
      } else if (err instanceof AxiosError && err.response?.status === 409) {
        setStep({ name: "blocked", message: apiErrorMessage(err, {}, lang) });
      } else {
        const message = apiErrorMessage(err, { 503: t("enroll.faceServiceDown") }, lang);
        setStep({ name: "camera", tips: [], error: message });
      }
    }
  }

  const current = stepIndex(step);
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">{t(replacing ? "enroll.replaceTitle" : "enroll.title")}</h1>
      {ticket && <p className="mt-1 text-muted">{ticket.event.name}</p>}
      {current !== null && <EnrollStepper current={current} />}
      <div className="mt-6">
        {step.name === "checking" && <Spinner />}
        {step.name === "blocked" && <Blocked message={step.message} replaceTo={step.canReplace ? `/enroll/${ticketId}?replace=1` : null} />}
        {step.name === "consent" && <Consent onAccept={() => setStep({ name: "camera", tips: [], error: null })} />}
        {step.name === "camera" && (
          <CaptureStep tips={step.tips} error={step.error} onCaptured={(photo, check) => setStep({ name: "review", photo, check })} />
        )}
        {(step.name === "review" || step.name === "uploading") && (
          <Review
            photo={step.photo}
            check={step.check}
            uploading={step.name === "uploading"}
            onRetake={() => setStep({ name: "camera", tips: [], error: null })}
            onUse={() => void upload(step.photo, step.check)}
          />
        )}
        {step.name === "done" && <Done replaced={replacing} />}
      </div>
    </section>
  );
}

/** Consent -> Photo -> Review -> Done, with a progress bar. Finished steps get a ✓. */
function EnrollStepper({ current }: { current: number }) {
  const { t } = useLanguage();
  const last = STEPS.length - 1;
  return (
    <nav aria-label={t("enroll.step.label")} className="mt-5">
      <p className="sr-only">{t("enroll.step.counter", { n: current + 1, total: STEPS.length })}</p>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full origin-left rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-transform duration-500 ease-out motion-reduce:transition-none rtl:origin-right"
          style={{ transform: `scaleX(${current / last})` }} />
      </div>
      <ol className="mt-3 grid grid-cols-4 gap-2">
        {STEPS.map((key, i) => {
          const state = i < current || current === last ? "done" : i === current ? "current" : "todo";
          return (
            <li key={key} data-step={key} data-state={state} aria-current={i === current ? "step" : undefined}
              className="flex flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-start">
              <span aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 motion-reduce:transition-none ${
                  state === "done" ? "bg-ok-500 text-white" : state === "current" ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-surface-2 text-muted"
                }`}>
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={`text-xs sm:text-sm ${state === "current" ? "font-semibold text-text" : "text-muted"}`}>{t(key)}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Blocked({ message, replaceTo }: { message: string; replaceTo: string | null }) {
  const { t } = useLanguage();
  return (
    <Card className="space-y-4 p-5">
      <p>{message}</p>
      <div className="flex flex-wrap items-center gap-3">
        {replaceTo && <ButtonLink to={replaceTo} className="min-h-11">{t("enroll.changePhoto")}</ButtonLink>}
        <ButtonLink to="/tickets" variant="secondary" className="min-h-11">{t("enroll.backToTickets")}</ButtonLink>
      </div>
    </Card>
  );
}

function Consent({ onAccept }: { onAccept: () => void }) {
  const { t } = useLanguage();
  const [agreed, setAgreed] = useState(false);
  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-lg font-semibold">{t("enroll.consentTitle")}</h2>
      <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
        <li>{t("enroll.consentSent")}</li>
        <li>{t("enroll.consentNotStored")}</li>
        <li>{t("enroll.consentDeleted")}</li>
        <li>{t("enroll.consentQr")}</li>
      </ul>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-1 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" />
        {t("enroll.consentAgree")}
      </label>
      <Button disabled={!agreed} onClick={onAccept} className="min-h-11">{t("enroll.continue")}</Button>
    </Card>
  );
}

function CaptureStep({ tips, error, onCaptured }: { tips: string[]; error: string | null; onCaptured: (photo: Blob, check: PhotoCheck | null) => void }) {
  const { t } = useLanguage();
  const camera = useCamera();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [live, setLive] = useState<PhotoCheck | null>(null);
  const [warning, setWarning] = useState<PhotoCheck | null>(null); // asks "take it anyway?"
  const { status, videoRef } = camera;

  // Check the preview a few times a second (in memory only). Advice: the server decides.
  useEffect(() => {
    if (status !== "ready") return;
    let alive = true;
    let busy = false;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video || busy) return;
      busy = true;
      void checkVideoFrame(video)
        .then((check) => {
          if (alive && check) setLive((prev) => (prev && sameFindings(prev, check) ? prev : check));
        })
        .finally(() => {
          busy = false;
        });
    }, LIVE_CHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [status, videoRef]);

  async function takePhoto(anyway = false) {
    setWarning(null);
    setCaptureError(null);
    const video = videoRef.current;
    const check = video ? await checkVideoFrame(video) : null; // the frame we're about to take
    if (!anyway && check && check.findings.length > 0) return setWarning(check);
    setCapturing(true);
    try {
      onCaptured(await camera.capture(), check);
    } catch {
      setCaptureError(t("enroll.captureFailed"));
      setCapturing(false);
    }
  }

  const ok = live !== null && live.findings.length === 0;
  const oval = live === null ? "border-white/80" : ok ? "border-emerald-400" : "border-amber-400";
  const corner = live === null ? "border-white/60" : ok ? "border-emerald-400" : "border-amber-400";
  return (
    <div className="space-y-4">
      {tips.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{t("enroll.tryAgainTitle")}</p>
          <ul className="mt-1 list-disc ps-5">
            {tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </div>
      )}
      <ErrorBox message={error ?? captureError} />
      <Camera camera={camera}>
        {/* Face guide: turns green when the live checks pass */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative h-[85%] aspect-[5/6]">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`h-[88%] aspect-[3/4] rounded-[50%] border-4 transition-colors duration-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] ${oval}`} />
            </div>
            {/* Viewfinder corners around the oval */}
            {["start-0 top-0 border-s-4 border-t-4 rounded-ss-xl", "end-0 top-0 border-e-4 border-t-4 rounded-se-xl",
              "start-0 bottom-0 border-s-4 border-b-4 rounded-es-xl", "end-0 bottom-0 border-e-4 border-b-4 rounded-ee-xl"].map((pos) => (
              <span key={pos} className={`absolute h-6 w-6 transition-colors duration-300 ${pos} ${corner}`} />
            ))}
          </div>
        </div>
        {live && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
            <LiveChip check={live} />
          </div>
        )}
      </Camera>
      <p className="text-sm text-muted">{t("enroll.captureHint")}</p>
      <Button onClick={() => void takePhoto()} disabled={camera.status !== "ready"} loading={capturing} size="lg" className="min-h-11 w-full sm:w-auto">
        {t("enroll.takePhoto")}
      </Button>
      <ConfirmDialog
        open={warning !== null}
        title={t("enroll.warnTitle")}
        message={warning && <TipList check={warning} />}
        confirmLabel={t("enroll.warnTake")}
        cancelLabel={t("enroll.warnAdjust")}
        onConfirm={() => void takePhoto(true)}
        onCancel={() => setWarning(null)}
      />
    </div>
  );
}

function sameFindings(a: PhotoCheck, b: PhotoCheck): boolean {
  const key = (c: PhotoCheck) => c.findings.map((f) => `${f.issue}:${f.hard}`).join(",");
  return key(a) === key(b) && a.faceChecked === b.faceChecked;
}

function LiveChip({ check }: { check: PhotoCheck }) {
  const { t } = useLanguage();
  const first = check.findings[0];
  return (
    <p role="status" aria-live="polite"
      className={`rounded-full px-3 py-1.5 text-sm font-medium shadow-lg backdrop-blur ${first ? "bg-amber-50/95 text-amber-900" : "bg-emerald-50/95 text-emerald-800"}`}>
      {first ? t(CLIENT_TIP[first.issue]) : t(check.faceChecked ? "enroll.looksGood" : "enroll.lightFocusGood")}
    </p>
  );
}

function TipList({ check }: { check: PhotoCheck }) {
  const { t } = useLanguage();
  const tips = [...new Set(check.findings.map((f) => t(CLIENT_TIP[f.issue])))];
  return (
    <ul className="list-disc space-y-1 ps-5">
      {tips.map((tip) => <li key={tip}>{tip}</li>)}
    </ul>
  );
}

type Row = { key: TranslationKey; issues: PhotoIssue[] };
const ROWS: Row[] = [
  { key: "enroll.check.lighting", issues: ["TOO_DARK", "TOO_BRIGHT"] },
  { key: "enroll.check.sharpness", issues: ["BLURRY"] },
  { key: "enroll.check.size", issues: ["TOO_SMALL"] },
  { key: "enroll.check.face", issues: ["NO_FACE", "MULTIPLE_FACES", "FACE_TOO_SMALL", "OFF_CENTER"] },
];

/** The photo check after capture: ✓ / ! (may be rejected) / ✕ (would be rejected) per row. */
function Checklist({ check }: { check: PhotoCheck }) {
  const { t } = useLanguage();
  return (
    <ul aria-label={t("enroll.check.title")} className="divide-y divide-border rounded-card border border-border bg-surface text-sm shadow-card">
      {ROWS.map(({ key, issues }) => {
        const found = check.findings.filter((f) => issues.includes(f.issue));
        const notChecked = key === "enroll.check.face" && !check.faceChecked;
        const hard = found.some((f) => f.hard);
        const mark = notChecked ? "–" : found.length === 0 ? "✓" : hard ? "✕" : "!";
        const tone = notChecked ? "text-slate-400" : found.length === 0 ? "text-emerald-600" : hard ? "text-deny-600" : "text-amber-600";
        return (
          <li key={key} data-row={key} data-mark={mark} className="flex items-start gap-3 px-3 py-2">
            <span aria-hidden="true" className={`w-4 shrink-0 text-center font-bold ${tone}`}>{mark}</span>
            <span className="font-medium text-slate-800">{t(key)}</span>
            <span className="ms-auto text-end text-slate-600">
              {notChecked ? t("enroll.check.notChecked") : found.length === 0 ? t("enroll.check.ok") : t(CLIENT_TIP[found[0]!.issue])}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Review({ photo, check, uploading, onRetake, onUse }: { photo: Blob; check: PhotoCheck | null; uploading: boolean; onRetake: () => void; onUse: () => void }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const blocked = check !== null && hasHardFailure(check);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl); // the preview lives only while on this step
  }, [photo]);

  return (
    <div className="space-y-4">
      {url && <img src={url} alt={t("enroll.photoAlt")} className="w-full -scale-x-100 rounded-card shadow-card" />}
      {check && <Checklist check={check} />}
      {blocked && <p role="alert" className="text-sm font-medium text-deny-700">{t("enroll.check.blocked")}</p>}
      {uploading ? (
        <Spinner label={t("enroll.checking")} />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={onUse} disabled={blocked} className="min-h-11">{t("enroll.usePhoto")}</Button>
          <Button onClick={onRetake} variant={blocked ? "primary" : "secondary"} className="min-h-11">{t("enroll.retake")}</Button>
        </div>
      )}
    </div>
  );
}

function Done({ replaced }: { replaced: boolean }) {
  const { t } = useLanguage();
  return (
    <Card className="relative flex flex-col items-center px-6 py-10 text-center">
      {!replaced && <Confetti />}
      <ResultIcon tone="ok" path="M15 27l7 7 15-16" />
      <p className="mt-5 text-2xl font-bold text-ok-700">{t(replaced ? "enroll.replaceDoneTitle" : "enroll.doneTitle")}</p>
      <p className="mt-2 text-muted">{t(replaced ? "enroll.replaceDoneBody" : "enroll.doneBody")}</p>
      <ButtonLink to="/tickets" className="mt-6 min-h-11">{t("enroll.myTickets")}</ButtonLink>
    </Card>
  );
}

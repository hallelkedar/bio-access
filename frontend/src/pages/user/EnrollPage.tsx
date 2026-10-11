import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { enrollFace, type QualityIssue } from "../../api/enrollment";
import { apiErrorMessage } from "../../api/errors";
import { myTickets } from "../../api/tickets";
import type { MyTicket } from "../../api/types";
import { Camera } from "../../components/Camera";
import { ErrorBox } from "../../components/ErrorBox";
import { Spinner } from "../../components/Spinner";
import { useCamera } from "../../hooks/useCamera";
import { useLanguage } from "../../i18n/LanguageProvider";
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
  | { name: "blocked"; message: string }
  | { name: "consent" }
  | { name: "camera"; tips: string[]; error: string | null }
  | { name: "review"; photo: Blob }
  | { name: "uploading"; photo: Blob }
  | { name: "done" };

function qualityIssues(error: unknown): QualityIssue[] | null {
  if (!(error instanceof AxiosError) || error.response?.status !== 422) return null;
  const issues: unknown = error.response.data?.detail?.issues;
  return Array.isArray(issues) ? (issues as QualityIssue[]) : null;
}

export function qualityTip(lang: Lang, issue: QualityIssue): string {
  return translate(lang, `quality.${issue}`);
}

export function EnrollPage() {
  const { t, lang } = useLanguage();
  const ticketId = Number(useParams().ticketId);
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [step, setStep] = useState<Step>({ name: "checking" });

  useEffect(() => {
    let active = true;
    myTickets()
      .then((tickets) => {
        if (!active) return;
        const found = tickets.find((t) => t.id === ticketId);
        setTicket(found ?? null);
        if (!found) setStep({ name: "blocked", message: t("enroll.ticketNotFound") });
        else if (found.enrolled) setStep({ name: "blocked", message: t("enroll.alreadySetUp") });
        else if (found.status !== "VALID") setStep({ name: "blocked", message: t("enroll.onlyValid") });
        else setStep({ name: "consent" });
      })
      .catch((err) => active && setStep({ name: "blocked", message: apiErrorMessage(err, {}, lang) }));
    return () => {
      active = false;
    };
  }, [ticketId]); // loaded once per ticket; messages use the language of that moment

  async function upload(photo: Blob) {
    setStep({ name: "uploading", photo });
    try {
      await enrollFace(ticketId, photo);
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

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">{t("enroll.title")}</h1>
      {ticket && <p className="mt-1 text-slate-600">{ticket.event.name}</p>}
      <div className="mt-6">
        {step.name === "checking" && <Spinner />}
        {step.name === "blocked" && <Blocked message={step.message} />}
        {step.name === "consent" && <Consent onAccept={() => setStep({ name: "camera", tips: [], error: null })} />}
        {step.name === "camera" && (
          <CaptureStep tips={step.tips} error={step.error} onCaptured={(photo) => setStep({ name: "review", photo })} />
        )}
        {(step.name === "review" || step.name === "uploading") && (
          <Review
            photo={step.photo}
            uploading={step.name === "uploading"}
            onRetake={() => setStep({ name: "camera", tips: [], error: null })}
            onUse={() => void upload(step.photo)}
          />
        )}
        {step.name === "done" && <Done />}
      </div>
    </section>
  );
}

function Blocked({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <p>{message}</p>
      <Link to="/tickets" className="text-blue-700 underline">{t("enroll.backToTickets")}</Link>
    </div>
  );
}

function Consent({ onAccept }: { onAccept: () => void }) {
  const { t } = useLanguage();
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">{t("enroll.consentTitle")}</h2>
      <ul className="list-disc space-y-1 ps-5 text-sm text-slate-700">
        <li>{t("enroll.consentSent")}</li>
        <li>{t("enroll.consentNotStored")}</li>
        <li>{t("enroll.consentDeleted")}</li>
        <li>{t("enroll.consentQr")}</li>
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        {t("enroll.consentAgree")}
      </label>
      <button type="button" disabled={!agreed} onClick={onAccept}
        className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {t("enroll.continue")}
      </button>
    </div>
  );
}

function CaptureStep({ tips, error, onCaptured }: { tips: string[]; error: string | null; onCaptured: (photo: Blob) => void }) {
  const { t } = useLanguage();
  const camera = useCamera();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  async function takePhoto() {
    setCapturing(true);
    setCaptureError(null);
    try {
      onCaptured(await camera.capture());
    } catch {
      setCaptureError(t("enroll.captureFailed"));
      setCapturing(false);
    }
  }

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
        {/* Face guide */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-3/4 aspect-[3/4] rounded-[50%] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
        </div>
      </Camera>
      <p className="text-sm text-slate-600">{t("enroll.captureHint")}</p>
      <button type="button" onClick={() => void takePhoto()} disabled={camera.status !== "ready" || capturing}
        className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        {t("enroll.takePhoto")}
      </button>
    </div>
  );
}

function Review({ photo, uploading, onRetake, onUse }: { photo: Blob; uploading: boolean; onRetake: () => void; onUse: () => void }) {
  const { t } = useLanguage();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl); // the preview lives only while on this step
  }, [photo]);

  return (
    <div className="space-y-4">
      {url && <img src={url} alt={t("enroll.photoAlt")} className="w-full -scale-x-100 rounded-lg" />}
      {uploading ? (
        <Spinner label={t("enroll.checking")} />
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={onUse} className="rounded-md bg-slate-900 px-4 py-2 text-white">
            {t("enroll.usePhoto")}
          </button>
          <button type="button" onClick={onRetake} className="rounded-md border px-4 py-2">
            {t("enroll.retake")}
          </button>
        </div>
      )}
    </div>
  );
}

function Done() {
  const { t } = useLanguage();
  return (
    <div className="space-y-4 text-center">
      <p className="text-2xl font-bold text-emerald-700">{t("enroll.doneTitle")}</p>
      <p className="text-slate-600">{t("enroll.doneBody")}</p>
      <Link to="/tickets" className="inline-block rounded-md bg-slate-900 px-4 py-2 text-white">{t("enroll.myTickets")}</Link>
    </div>
  );
}

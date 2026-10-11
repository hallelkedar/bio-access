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

export function EnrollPage() {
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
        if (!found) setStep({ name: "blocked", message: "Ticket not found." });
        else if (found.enrolled) setStep({ name: "blocked", message: "Face entry is already set up for this ticket ✓" });
        else if (found.status !== "VALID") setStep({ name: "blocked", message: "Only paid, unused tickets can be enrolled." });
        else setStep({ name: "consent" });
      })
      .catch((err) => active && setStep({ name: "blocked", message: apiErrorMessage(err) }));
    return () => {
      active = false;
    };
  }, [ticketId]);

  async function upload(photo: Blob) {
    setStep({ name: "uploading", photo });
    try {
      await enrollFace(ticketId, photo);
      setStep({ name: "done" }); // the photo is no longer referenced anywhere
    } catch (err) {
      const issues = qualityIssues(err);
      if (issues) {
        setStep({ name: "camera", tips: issues.map((issue) => QUALITY_TIPS[issue] ?? "Please try another photo."), error: null });
      } else if (err instanceof AxiosError && err.response?.status === 409) {
        setStep({ name: "blocked", message: apiErrorMessage(err) });
      } else {
        const message = apiErrorMessage(err, {
          503: "The face service is unavailable. Try again in a few minutes (your QR code still works).",
        });
        setStep({ name: "camera", tips: [], error: message });
      }
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Face entry</h1>
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
  return (
    <div className="space-y-4">
      <p>{message}</p>
      <Link to="/tickets" className="text-blue-700 underline">Back to my tickets</Link>
    </div>
  );
}

function Consent({ onAccept }: { onAccept: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Before we start</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>Your photo is sent securely to our face-recognition provider (AWS) to create a face reference.</li>
        <li>We never store the photo itself.</li>
        <li>The face reference is linked only to this ticket and is deleted after the event.</li>
        <li>You can always enter with your QR code instead.</li>
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        I agree to biometric processing for entry to this event.
      </label>
      <button type="button" disabled={!agreed} onClick={onAccept}
        className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        Continue
      </button>
    </div>
  );
}

function CaptureStep({ tips, error, onCaptured }: { tips: string[]; error: string | null; onCaptured: (photo: Blob) => void }) {
  const camera = useCamera();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  async function takePhoto() {
    setCapturing(true);
    setCaptureError(null);
    try {
      onCaptured(await camera.capture());
    } catch {
      setCaptureError("Couldn't take the photo. Please try again.");
      setCapturing(false);
    }
  }

  return (
    <div className="space-y-4">
      {tips.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Let's try that again:</p>
          <ul className="mt-1 list-disc pl-5">
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
      <p className="text-sm text-slate-600">Good light, look straight at the camera, no sunglasses.</p>
      <button type="button" onClick={() => void takePhoto()} disabled={camera.status !== "ready" || capturing}
        className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
        Take photo
      </button>
    </div>
  );
}

function Review({ photo, uploading, onRetake, onUse }: { photo: Blob; uploading: boolean; onRetake: () => void; onUse: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl); // the preview lives only while on this step
  }, [photo]);

  return (
    <div className="space-y-4">
      {url && <img src={url} alt="Your photo" className="w-full -scale-x-100 rounded-lg" />}
      {uploading ? (
        <Spinner label="Checking your photo…" />
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={onUse} className="rounded-md bg-slate-900 px-4 py-2 text-white">
            Use this photo
          </button>
          <button type="button" onClick={onRetake} className="rounded-md border px-4 py-2">
            Retake
          </button>
        </div>
      )}
    </div>
  );
}

function Done() {
  return (
    <div className="space-y-4 text-center">
      <p className="text-2xl font-bold text-emerald-700">Face entry is ready!</p>
      <p className="text-slate-600">At the gate, just look at the camera. Your QR code still works as a backup.</p>
      <Link to="/tickets" className="inline-block rounded-md bg-slate-900 px-4 py-2 text-white">My tickets</Link>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../auth/AuthContext";
import { ButtonLink } from "../../components/ui";
import { GateResult } from "../../gate/GateResult";
import { denialText } from "../../gate/messages";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";
import { FaceScan } from "./FaceScan";
import { useGateDemo, type DemoPhase } from "./useGateDemo";

const STATUS: Record<DemoPhase, { key: TranslationKey; dot: string }> = {
  watching: { key: "landing.demo.watching", dot: "bg-slate-400" },
  scanning: { key: "landing.demo.scanning", dot: "bg-accent-300 animate-pulse" },
  verifying: { key: "landing.demo.verifying", dot: "bg-amber-400 animate-pulse" },
  approved: { key: "landing.demo.approved", dot: "bg-emerald-400" },
  denied: { key: "landing.demo.denied", dot: "bg-red-400" },
};

/** True while the element is on screen; always true where IntersectionObserver is missing. */
function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !ref.current) return;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, onScreen] as const;
}

/** A simulated "mini gate" for the landing page: timers only, no camera, no backend. */
export function GateDemo() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const reduced = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const phase = useGateDemo({ running: onScreen, still: reduced });
  const result = phase === "approved" || phase === "denied" ? phase : null;

  return (
    <section className="py-16" aria-labelledby="demo-title">
      <h2 id="demo-title" className="text-center text-3xl font-bold tracking-tight">{t("landing.demo.title")}</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-muted">{t("landing.demo.subtitle")}</p>

      <div ref={ref} data-testid="gate-demo" data-phase={phase}
        className="mx-auto mt-10 max-w-sm rounded-card bg-slate-950 p-5 text-white shadow-raised ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="rounded bg-white/10 px-2 py-0.5">{t("landing.demo.gate")}</span>
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-300 uppercase">
            {t("landing.demo.badge")}
          </span>
        </div>

        <div className="relative mt-4 overflow-hidden rounded-xl bg-slate-900 py-4">
          <FaceScan label={t("landing.scanAlt")} scanning={phase === "scanning"} />
          {result && (
            <div className={`absolute inset-0 flex animate-fade-up flex-col items-center justify-center px-4 text-center ${
              result === "approved" ? "bg-emerald-600/95" : "bg-red-600/95"}`}>
              <GateResult
                size="card"
                approved={result === "approved"}
                message={result === "approved" ? t("gate.welcome") : denialText(lang, "ALREADY_ENTERED")}
                name={result === "approved" ? t("landing.demo.name") : null}
              />
            </div>
          )}
        </div>

        <p className="mt-4 flex items-center gap-2 text-sm text-slate-300">
          <span className={`h-2 w-2 rounded-full ${STATUS[phase].dot}`} aria-hidden="true" />
          {t(STATUS[phase].key)}
        </p>
      </div>

      {user?.role === "GATEKEEPER" && (
        <div className="mt-6 text-center">
          <ButtonLink to="/gate">{t("landing.demo.tryReal")}</ButtonLink>
        </div>
      )}
    </section>
  );
}

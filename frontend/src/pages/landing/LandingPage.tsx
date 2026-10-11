import type { ReactNode } from "react";

import type { Role } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { LanguageToggle } from "../../components/LanguageToggle";
import { ButtonLink, CountUp, Reveal } from "../../components/ui";
import type { TranslationKey } from "../../i18n/en";
import { useLanguage } from "../../i18n/LanguageProvider";
import { FaceScan } from "./FaceScan";
import { GateDemo } from "./GateDemo";

type Cta = { to: string; labelKey: TranslationKey };

/** Where the two hero buttons lead, by who is looking. */
export const CTAS: Record<Role | "GUEST", [Cta, Cta?]> = {
  GUEST: [{ to: "/register", labelKey: "landing.cta.register" }, { to: "/login", labelKey: "landing.cta.login" }],
  USER: [{ to: "/tickets", labelKey: "landing.cta.myTickets" }, { to: "/events", labelKey: "landing.cta.events" }],
  GATEKEEPER: [{ to: "/gate", labelKey: "landing.cta.gate" }],
  ADMIN: [{ to: "/admin", labelKey: "landing.cta.dashboard" }, { to: "/admin/events", labelKey: "landing.cta.manageEvents" }],
};

const STEPS: { title: TranslationKey; body: TranslationKey; icon: ReactNode }[] = [
  {
    title: "landing.step1.title",
    body: "landing.step1.body",
    icon: <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Zm10-2v12" />,
  },
  {
    title: "landing.step2.title",
    body: "landing.step2.body",
    icon: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 7.5c-2 0-3.2 1.6-3.2 3.8 0 2.7 1.5 4.7 3.2 4.7s3.2-2 3.2-4.7c0-2.2-1.2-3.8-3.2-3.8Z" />,
  },
  {
    title: "landing.step3.title",
    body: "landing.step3.body",
    icon: <path d="M5 21V4a1 1 0 0 1 1-1h8l5 5v13M9 13l2 2 4-4M14 3v5h5" />,
  },
];

const STATS: { value: number; prefix?: string; label: TranslationKey }[] = [
  { value: 800, prefix: "<", label: "landing.stat.ms" },
  { value: 0, label: "landing.stat.photos" },
  { value: 1, label: "landing.stat.entries" },
  { value: 14, label: "landing.stat.cases" },
];

export function LandingPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [primary, secondary] = CTAS[user?.role ?? "GUEST"];

  return (
    <div className="-mt-8">
      {/* Dark hero band, full width (breaks out of the centered main column, symmetric for RTL) */}
      <section className="relative mx-[calc(50%-50vw)] overflow-hidden bg-slate-950 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(60%_80%_at_15%_20%,rgb(99_102_241_/_0.45),transparent_60%),radial-gradient(50%_70%_at_85%_80%,rgb(34_211_238_/_0.35),transparent_60%)]"
        />
        <div className="relative mx-auto grid max-w-5xl items-center gap-10 px-4 py-16 sm:py-24 md:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-sm font-semibold tracking-wide text-accent-300 uppercase">{t("landing.eyebrow")}</p>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {t("landing.title")}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">{t("landing.subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to={primary.to} size="lg">
                {t(primary.labelKey)}
                <svg viewBox="0 0 20 20" className="h-5 w-5 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 10h12m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </ButtonLink>
              {secondary && (
                <ButtonLink to={secondary.to} size="lg" variant="ghost" className="text-white ring-1 ring-white/25 hover:bg-white/10">
                  {t(secondary.labelKey)}
                </ButtonLink>
              )}
            </div>
          </div>
          <FaceScan label={t("landing.scanAlt")} />
        </div>
      </section>

      <section className="py-16" aria-labelledby="how-title">
        <h2 id="how-title" className="text-center text-3xl font-bold tracking-tight">{t("landing.howTitle")}</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Reveal delayMs={index * 120} className="h-full">
                <div className="h-full rounded-card border border-border bg-surface p-6 shadow-card">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-glow">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {step.icon}
                    </svg>
                  </span>
                  <p className="mt-4 text-sm font-medium text-brand-600">{t("landing.stepLabel", { n: index + 1 })}</p>
                  <h3 className="mt-1 text-lg font-semibold">{t(step.title)}</h3>
                  <p className="mt-2 text-muted">{t(step.body)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <GateDemo />

      <section className="rounded-card border border-border bg-surface px-6 py-10 shadow-card" aria-labelledby="stats-title">
        <h2 id="stats-title" className="text-center text-2xl font-bold tracking-tight">{t("landing.statsTitle")}</h2>
        <dl className="mt-8 grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <dt className="sr-only">{t(stat.label)}</dt>
              <dd className="text-4xl font-extrabold tracking-tight text-brand-600">
                {stat.prefix && <span aria-hidden="true">{stat.prefix}</span>}
                <CountUp value={stat.value} />
              </dd>
              <dd className="mt-1 text-sm text-muted" aria-hidden="true">{t(stat.label)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-center text-xs text-muted">{t("landing.statsNote")}</p>
      </section>

      <footer className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-border py-8 text-sm text-muted sm:flex-row">
        <span>{t("landing.footer")}</span>
        <LanguageToggle />
      </footer>
    </div>
  );
}

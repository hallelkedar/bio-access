import { useLanguage } from "../i18n/LanguageProvider";
import type { Lang } from "../i18n/translate";

const OPTIONS: { lang: Lang; short: string }[] = [
  { lang: "en", short: "EN" },
  { lang: "he", short: "עב" },
];

/** Segmented "EN | עב" switch. Each option is a real button with aria-pressed. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <div
      role="group"
      aria-label={t("lang.label")}
      className={`inline-flex rounded-full border border-slate-300/80 bg-white/60 p-0.5 text-xs font-semibold ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = option.lang === lang;
        return (
          <button
            key={option.lang}
            type="button"
            lang={option.lang}
            aria-pressed={active}
            aria-label={t(option.lang === "en" ? "lang.en" : "lang.he")}
            onClick={() => setLang(option.lang)}
            className={`rounded-full px-2.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}

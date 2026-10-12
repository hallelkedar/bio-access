import { useLanguage } from "../i18n/LanguageProvider";
import type { Lang } from "../i18n/translate";

const OPTIONS: { lang: Lang; short: string }[] = [
  { lang: "en", short: "EN" },
  { lang: "he", short: "עב" },
];

/**
 * Segmented "EN | עב" switch. Each option is a real button with aria-pressed. The order is
 * fixed (dir="ltr") in both languages, and a thumb slides under the active option.
 */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  return (
    <div
      role="group"
      dir="ltr"
      aria-label={t("lang.label")}
      className={`relative inline-flex rounded-full border border-slate-300/80 bg-white/60 p-0.5 text-xs font-semibold ${className}`}
    >
      <span
        aria-hidden="true"
        data-testid="lang-thumb"
        className={`absolute inset-y-0.5 left-0.5 w-9 rounded-full bg-slate-900 shadow-sm transition-transform duration-200 ease-out ${
          lang === "he" ? "translate-x-full" : "translate-x-0"
        }`}
      />
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
            className={`relative w-9 rounded-full py-1 text-center transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
              active ? "text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import type { TranslationKey } from "./en";
import { dirOf, isLang, translate, type Lang, type TranslationVars } from "./translate";

export const LANG_STORAGE_KEY = "bioaccess.lang";

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageState | null>(null);

// Storage can throw (private mode, blocked site data): the language is a convenience.
function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // keep working in memory
  }
}

/** View Transitions exist (not in older browsers or jsdom) and the user did not ask for less motion. */
function canAnimate(): boolean {
  if (typeof document.startViewTransition !== "function") return false;
  return !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang); // read once on startup
  const dir = dirOf(lang);

  // Layout effect: the page must already be mirrored when a view transition takes its snapshot.
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    storeLang(next);
    if (next === lang || !canAnimate()) {
      setLangState(next);
      return;
    }
    // Cross-fade the old layout into the mirrored one instead of jumping in one frame.
    document.startViewTransition(() => flushSync(() => setLangState(next)));
  }, [lang]);

  const t = useCallback((key: TranslationKey, vars?: TranslationVars) => translate(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, dir }), [lang, setLang, t, dir]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** English, fixed: what components get when rendered outside a provider (e.g. on their own). */
const FALLBACK: LanguageState = {
  lang: "en",
  setLang: () => {
    if (import.meta.env.DEV) console.warn("[i18n] setLang called outside <LanguageProvider>");
  },
  t: (key, vars) => translate("en", key, vars),
  dir: "ltr",
};

export function useLanguage(): LanguageState {
  return useContext(LanguageContext) ?? FALLBACK;
}

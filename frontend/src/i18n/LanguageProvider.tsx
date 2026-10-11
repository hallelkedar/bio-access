import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang); // read once on startup
  const dir = dirOf(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    storeLang(next);
  }, []);

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

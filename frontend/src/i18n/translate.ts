import { en, type TranslationKey } from "./en";
import { he } from "./he";

export type Lang = "en" | "he";
export type TranslationVars = Record<string, string | number>;

export const LANGS: readonly Lang[] = ["en", "he"];
export const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { en, he };

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "he";
}

export function dirOf(lang: Lang): "ltr" | "rtl" {
  return lang === "he" ? "rtl" : "ltr";
}

/**
 * Text for a key in a language, with {name} placeholders filled from vars.
 * Pure, so non-React code can use it. An unknown key returns the key itself (and warns
 * in development); a missing variable leaves its {placeholder} visible.
 */
export function translate(lang: Lang, key: TranslationKey | string, vars?: TranslationVars): string {
  const text = (DICTIONARIES[lang] as Record<string, string>)[key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key "${key}" for "${lang}"`);
    return key;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in vars ? String(vars[name]) : placeholder,
  );
}

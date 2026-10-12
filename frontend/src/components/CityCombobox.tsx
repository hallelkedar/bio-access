import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { City } from "../data/cities";
import { cityName, countryName, findCity, searchCities } from "../data/cityMatch";
import { useLanguage } from "../i18n/LanguageProvider";

interface CityComboboxProps {
  label: string;
  value: City | null;
  /** A listed city, or null when the field is empty or holds text that isn't one. */
  onChange: (city: City | null) => void;
  /** A message from the parent; the field's own "choose from the list" check wins. */
  error?: string | null;
  hint?: string | null;
  id?: string;
  required?: boolean;
}

/**
 * City picker (ARIA combobox): type in Hebrew or English, pick with the arrows and Enter
 * or a click. Only listed cities count: other text stays visible with a message, and the
 * parent gets null.
 */
export function CityCombobox({ label, value, onChange, error, hint, id, required }: CityComboboxProps) {
  const { t, lang } = useLanguage();
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const messageId = `${inputId}-message`;
  const [text, setText] = useState(() => (value ? cityName(value, lang) : ""));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const options = open ? searchCities(text) : [];

  // A new value from outside, or a new language: show its name.
  useEffect(() => {
    if (value) setText(cityName(value, lang));
  }, [value, lang]);

  function pick(city: City) {
    setText(cityName(city, lang));
    setOpen(false);
    setInvalid(false);
    if (city !== value) onChange(city);
  }

  /** Leaving the field: an exact name counts as a pick; anything else is not a city. */
  function settle() {
    setOpen(false);
    if (!text.trim()) {
      setInvalid(false);
      if (value) onChange(null);
      return;
    }
    const exact = findCity(text);
    if (exact) return pick(exact);
    setInvalid(true);
    if (value) onChange(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      const city = options[active];
      if (city) pick(city);
      else settle();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) settle();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  });

  const message = invalid ? t("city.notListed") : error ?? hint ?? null;
  const isError = invalid || Boolean(error);
  return (
    <div ref={wrapper} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative mt-1">
        <svg viewBox="0 0 20 20" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M10 17.5s5.5-5 5.5-9.25a5.5 5.5 0 1 0-11 0C4.5 12.5 10 17.5 10 17.5z" />
          <circle cx="10" cy="8.25" r="2" />
        </svg>
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          required={required}
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-invalid={isError || undefined}
          aria-describedby={message ? messageId : undefined}
          placeholder={t("city.placeholder")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
            setInvalid(false);
          }}
          onFocus={() => text && setOpen(true)}
          onBlur={(e) => {
            // A click on an option fires blur first: let the click pick instead.
            if (!wrapper.current?.contains(e.relatedTarget as Node | null)) settle();
          }}
          onKeyDown={onKeyDown}
          className={`w-full rounded-md border py-2 pe-3 ps-9 focus:outline-none ${isError ? "border-deny-500 focus:border-deny-600" : "border-slate-300 focus:border-slate-500"}`}
        />
      </div>
      {open && text.trim() && (
        <ul id={listId} role="listbox" aria-label={label}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 animate-pop-in overflow-auto rounded-card border border-slate-200 bg-white py-1 shadow-raised">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500" role="presentation">{t("city.noMatch")}</li>
          ) : (
            options.map((city, i) => (
              <li
                key={`${city.country}-${city.en}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => pick(city)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-brand-50 text-brand-800" : "text-slate-800"}`}
              >
                <span className="font-medium">{cityName(city, lang)}</span>
                <span className="shrink-0 text-xs text-slate-500">{countryName(city.country, lang)}</span>
              </li>
            ))
          )}
        </ul>
      )}
      {message && <p id={messageId} className={`mt-1 text-xs ${isError ? "text-deny-700" : "text-slate-500"}`}>{message}</p>}
    </div>
  );
}

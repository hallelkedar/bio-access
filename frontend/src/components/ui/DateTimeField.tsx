import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { localeFor } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import {
  addDays, addMonths, dayInRange, dayKey, formatFieldText, formatTime, monthGrid, parseFieldText, parseTime,
  sameDay, stepTime, weekBounds, WEEK_STARTS_ON,
} from "./dateMath";

interface DateTimeFieldProps {
  label: string;
  /** UTC ISO timestamp, or null when empty. */
  value: string | null;
  /** Called with a UTC ISO timestamp, or null when the field is empty or invalid. */
  onChange: (value: string | null) => void;
  min?: string | null;
  max?: string | null;
  /** A message from the parent (e.g. "End must be after start"); the field's own check wins. */
  error?: string | null;
  hint?: string;
  /** Time used when a day is picked before any time was set, "HH:mm". */
  defaultTime?: string;
  id?: string;
  name?: string;
  required?: boolean;
}

/**
 * Date and time input: type it (the language's own order, or YYYY-MM-DD HH:mm) or pick it
 * from a calendar popover. Only complete, valid values reach onChange; anything else shows
 * an inline message and reports null.
 */
export function DateTimeField({ label, value, onChange, min = null, max = null, error, hint, defaultTime = "00:00", id, name, required }: DateTimeFieldProps) {
  const { t, lang, dir } = useLanguage();
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const selected = useMemo(() => (value ? new Date(value) : null), [value]);
  const minDate = useMemo(() => (min ? new Date(min) : null), [min]);
  const maxDate = useMemo(() => (max ? new Date(max) : null), [max]);

  const [text, setText] = useState(() => (selected ? formatFieldText(selected, lang) : ""));
  const [localError, setLocalError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const lastEmitted = useRef(value);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // A new value from the parent (a preset, a duration chip) or a new language: show it.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setText(value ? formatFieldText(new Date(value), lang) : "");
    setLocalError(null);
  }, [value, lang]);
  useEffect(() => {
    if (lastEmitted.current) setText(formatFieldText(new Date(lastEmitted.current), lang));
  }, [lang]);

  function rangeError(date: Date): string | null {
    const show = (d: Date) => formatFieldText(d, lang);
    if (minDate && date < minDate) return t("dt.tooEarly", { date: show(minDate) });
    if (maxDate && date > maxDate) return t("dt.tooLate", { date: show(maxDate) });
    return null;
  }

  function emit(date: Date | null, problem: string | null = null) {
    const next = date && !problem ? date.toISOString() : null;
    setLocalError(problem);
    lastEmitted.current = next;
    if (next !== value) onChange(next);
  }

  /** The typed text → value (on blur and Enter, never on each keystroke). */
  function commitText() {
    if (!text.trim()) return emit(null);
    const date = parseFieldText(text, lang);
    if (!date) return emit(null, t("dt.invalid", { example: t("dt.placeholder") }));
    setText(formatFieldText(date, lang));
    emit(date, rangeError(date));
  }

  /** From the calendar or its time field. */
  function pick(date: Date) {
    setText(formatFieldText(date, lang));
    emit(date, rangeError(date));
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shownError = localError ?? error ?? null;
  return (
    <div ref={wrapper} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">{label}</label>
      <div className="mt-1 flex">
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          required={required}
          placeholder={t("dt.placeholder")}
          value={text}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError || hint ? messageId : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            } else if (e.key === "ArrowDown" && e.altKey) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={`w-full rounded-s-md border px-3 py-2 text-start tabular-nums focus:outline-none rtl:text-end ${
            shownError ? "border-deny-500 focus:border-deny-600" : "border-slate-300 focus:border-slate-500"
          }`}
        />
        <button
          ref={trigger}
          type="button"
          aria-label={t("dt.openCalendar")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="rounded-e-md border border-s-0 border-slate-300 px-3 text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
            <path d="M3 8.5h14M7 2.5v3.5M13 2.5v3.5" />
          </svg>
        </button>
      </div>
      {(shownError || hint) && (
        <p id={messageId} className={`mt-1 text-xs ${shownError ? "text-deny-700" : "text-slate-500"}`}>{shownError ?? hint}</p>
      )}
      {open && (
        <CalendarPopover
          selected={selected}
          min={minDate}
          max={maxDate}
          defaultTime={defaultTime}
          dir={dir}
          onPick={pick}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}

interface PopoverProps {
  selected: Date | null;
  min: Date | null;
  max: Date | null;
  defaultTime: string;
  dir: "ltr" | "rtl";
  onPick: (date: Date) => void;
  onClose: () => void;
}

function CalendarPopover({ selected, min, max, defaultTime, dir, onPick, onClose }: PopoverProps) {
  const { t, lang } = useLanguage();
  const locale = localeFor(lang);
  const headingId = useId();
  const today = new Date();
  const [focused, setFocused] = useState<Date>(() => selected ?? (min && today < min ? min : today));
  const [timeText, setTimeText] = useState(() => (selected ? formatTime(selected) : defaultTime));
  const grid = useRef<HTMLDivElement>(null);
  const focusGrid = useRef(true); // move DOM focus to the focused day (on open and on keyboard moves)

  const days = monthGrid(focused.getFullYear(), focused.getMonth());
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(focused);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: lang === "he" ? "narrow" : "short" });
  const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: "long" });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full" });
  const sunday = new Date(2026, 0, 4); // any Sunday: day names for the header row

  useEffect(() => {
    if (!focusGrid.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${dayKey(focused)}"]`)?.focus();
  }, [focused]);

  function timeOf(): [number, number] {
    return parseTime(timeText) ?? parseTime(defaultTime) ?? [0, 0];
  }

  function choose(day: Date) {
    if (!dayInRange(day, min, max)) return;
    const [hours, minutes] = timeOf();
    setFocused(day);
    onPick(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes));
  }

  function moveTo(day: Date) {
    focusGrid.current = true;
    setFocused(day);
  }

  function onGridKey(e: KeyboardEvent) {
    const forward = dir === "rtl" ? -1 : 1; // ArrowRight goes back in time in Hebrew
    const moves: Record<string, () => Date> = {
      ArrowRight: () => addDays(focused, forward),
      ArrowLeft: () => addDays(focused, -forward),
      ArrowDown: () => addDays(focused, 7),
      ArrowUp: () => addDays(focused, -7),
      PageDown: () => addMonths(focused, e.shiftKey ? 12 : 1),
      PageUp: () => addMonths(focused, e.shiftKey ? -12 : -1),
      Home: () => weekBounds(focused)[0],
      End: () => weekBounds(focused)[1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      moveTo(moves[e.key]!());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(focused);
    }
  }

  function onTimeChange(next: string) {
    setTimeText(next);
    const parsed = parseTime(next);
    if (parsed && selected) onPick(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), ...parsed));
  }

  return (
    <div
      role="dialog"
      aria-label={t("dt.calendar")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute start-0 top-full z-30 mt-2 w-[19rem] animate-pop-in rounded-card border border-slate-200 bg-white p-3 text-slate-900 shadow-raised"
    >
      <div className="flex items-center justify-between">
        <button type="button" aria-label={t("dt.prevMonth")} onClick={() => { focusGrid.current = false; setFocused(addMonths(focused, -1)); }}
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500">
          <Chevron />
        </button>
        <h2 id={headingId} aria-live="polite" className="text-sm font-semibold">{monthTitle}</h2>
        <button type="button" aria-label={t("dt.nextMonth")} onClick={() => { focusGrid.current = false; setFocused(addMonths(focused, 1)); }}
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-500">
          <Chevron flip />
        </button>
      </div>

      <div ref={grid} role="grid" aria-labelledby={headingId} onKeyDown={onGridKey} className="mt-2">
        <div role="row" className="grid grid-cols-7 text-center text-xs text-slate-500">
          {Array.from({ length: 7 }, (_, i) => {
            const day = addDays(sunday, (WEEK_STARTS_ON + i) % 7);
            return (
              <span key={i} role="columnheader" aria-label={weekdayLong.format(day)} className="py-1">
                {weekday.format(day)}
              </span>
            );
          })}
        </div>
        {Array.from({ length: 6 }, (_, week) => (
          <div key={week} role="row" className="grid grid-cols-7">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const inMonth = day.getMonth() === focused.getMonth();
              const isSelected = selected !== null && sameDay(day, selected);
              const isFocused = sameDay(day, focused);
              const enabled = dayInRange(day, min, max);
              return (
                <div key={dayKey(day)} role="gridcell" aria-selected={isSelected} className="p-0.5">
                  <button
                    type="button"
                    data-day={dayKey(day)}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={fullDate.format(day)}
                    aria-current={sameDay(day, today) ? "date" : undefined}
                    aria-disabled={enabled ? undefined : true}
                    onClick={() => choose(day)}
                    className={`h-9 w-full rounded-md text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500 ${
                      isSelected
                        ? "bg-brand-600 font-semibold text-white"
                        : !enabled
                          ? "cursor-not-allowed text-slate-300 line-through"
                          : inMonth
                            ? "text-slate-800 hover:bg-brand-50"
                            : "text-slate-400 hover:bg-slate-50"
                    } ${sameDay(day, today) && !isSelected ? "ring-1 ring-brand-400 ring-inset" : ""}`}
                  >
                    {day.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-end gap-2 border-t border-slate-100 pt-3">
        <label className="flex-1 text-xs font-medium text-slate-600">
          {t("dt.time")}
          <input
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={timeText}
            placeholder="hh:mm"
            onChange={(e) => onTimeChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              const [hours, minutes] = stepTime(timeOf(), e.key === "ArrowUp" ? 1 : -1);
              onTimeChange(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
            }}
            className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums focus:border-slate-500 focus:outline-none rtl:text-end"
          />
        </label>
        <button type="button" onClick={() => { focusGrid.current = true; choose(today); }} disabled={!dayInRange(today, min, max)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">
          {t("dt.today")}
        </button>
        <button type="button" onClick={onClose} className="rounded-md bg-slate-900 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
          {t("dt.done")}
        </button>
      </div>
    </div>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  // Points "back" by default; rtl:rotate-180 mirrors it for Hebrew.
  return (
    <svg viewBox="0 0 20 20" className={`h-4 w-4 ${flip ? "rotate-180 rtl:rotate-0" : "rtl:rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.5 4.5L7 10l5.5 5.5" />
    </svg>
  );
}

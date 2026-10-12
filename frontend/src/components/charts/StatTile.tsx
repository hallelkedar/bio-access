import { localeFor } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CountUp } from "../ui/CountUp";

interface StatTileProps {
  label: string;
  /** A number counts up to its new value; a string (e.g. "—") is shown as given. */
  value: string | number;
  /** How a numeric value is written; defaults to a whole number in the current language. */
  format?: (n: number) => string;
}

/** One KPI with a subtle gradient border. The value never wraps, and shrinks a little on narrow tiles. */
export function StatTile({ label, value, format }: StatTileProps) {
  const { lang } = useLanguage();
  const write = format ?? ((n: number) => new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 0 }).format(n));
  const shown = typeof value === "number" ? write(value) : value;
  return (
    <div className="h-full min-w-0 rounded-xl bg-gradient-to-br from-brand-400/60 via-border to-accent-400/40 p-px shadow-card">
      <div className="flex h-full min-w-0 flex-col justify-between rounded-[11px] bg-surface p-4 dark:bg-surface-2">
        <p className="truncate text-sm text-muted" title={label}>{label}</p>
        <p className="mt-1 truncate text-[clamp(1.75rem,5vw,2.25rem)] font-semibold leading-tight tracking-tight text-text" title={shown}>
          {typeof value === "number" ? <CountUp value={value} format={write} durationMs={900} /> : value}
        </p>
      </div>
    </div>
  );
}

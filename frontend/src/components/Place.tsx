import { displayLocation } from "../data/cityMatch";
import { useLanguage } from "../i18n/LanguageProvider";

/** "📍 Tel Aviv · Expo Tel Aviv": the city (in the reader's language when listed) with a pin, then the venue. */
export function Place({ location, className = "" }: { location: string; className?: string }) {
  const { lang } = useLanguage();
  const { venue, city } = displayLocation(location, lang);
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1 ${className}`}>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-brand-500" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M10 17.5s5.5-5 5.5-9.25a5.5 5.5 0 1 0-11 0C4.5 12.5 10 17.5 10 17.5z" />
        <circle cx="10" cy="8.25" r="2" />
      </svg>
      <span className="min-w-0">
        {city && <bdi className="font-medium text-slate-700">{city}</bdi>}
        {city && venue && " · "}
        {venue && <bdi>{venue}</bdi>}
      </span>
    </span>
  );
}

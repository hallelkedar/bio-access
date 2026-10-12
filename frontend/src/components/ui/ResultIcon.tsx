const TONES = {
  ok: "bg-ok-50 text-ok-600",
  warn: "bg-warn-50 text-warn-600",
  neutral: "bg-surface-2 text-muted",
} as const;

/** A round badge with a stroked symbol that draws itself in. */
export function ResultIcon({ tone, path, circle = false }: { tone: keyof typeof TONES; path: string; circle?: boolean }) {
  return (
    <span className={`flex h-16 w-16 animate-pop-in items-center justify-center rounded-full ${TONES[tone]}`}>
      <svg viewBox="0 0 52 52" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {circle && <circle cx="26" cy="26" r="17" strokeWidth="3" opacity="0.35" />}
        <path pathLength={1} className="animate-draw [stroke-dasharray:1]" d={path} />
      </svg>
    </span>
  );
}

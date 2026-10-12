/** Sizes: "full" for the real gate's full-screen overlay, "card" for small previews. */
const SIZES = {
  full: { icon: "h-28 w-28 sm:h-36 sm:w-36", message: "mt-6 text-5xl", name: "mt-4 text-4xl font-semibold" },
  card: { icon: "h-16 w-16", message: "mt-2 text-2xl", name: "mt-1 text-lg" },
} as const;

/**
 * The big check or cross (drawn in with a stroke animation), the message and the holder's
 * name. Presentational only; the caller picks the frame. The icon is decorative: the
 * message carries the meaning for screen readers.
 */
export function GateResult({ approved, message, name, size = "full" }: {
  approved: boolean;
  message: string;
  name?: string | null;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  return (
    <>
      <svg viewBox="0 0 52 52" className={`mx-auto ${s.icon}`} fill="none" stroke="currentColor" strokeWidth="4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="26" cy="26" r="23" strokeOpacity="0.35" />
        <path pathLength={1} className="animate-draw [stroke-dasharray:1]" d={approved ? "M15 27l7 7 15-16" : "M18 18l16 16M34 18 18 34"} />
      </svg>
      <p className={`${s.message} font-bold`}>{message}</p>
      {name && <p className={s.name}>{name}</p>}
    </>
  );
}

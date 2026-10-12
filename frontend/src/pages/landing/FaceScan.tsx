/**
 * Pure-CSS "face being scanned" visual: face outline, corner brackets, a moving scan line
 * and a soft pulse. Decorative; frozen by the global reduced-motion rule.
 * `scanning={false}` hides the scan line (e.g. while the gate demo is idle).
 */
export function FaceScan({ label, scanning = true }: { label: string; scanning?: boolean }) {
  return (
    <div role="img" aria-label={label} className="relative mx-auto aspect-[5/6] w-56 sm:w-64">
      <div className="absolute inset-6 animate-pulse-ring rounded-[45%] border-2 border-accent-400/40" aria-hidden="true" />
      <svg viewBox="0 0 200 240" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="text-accent-300">
          <path strokeWidth="5" d="M20 58V28a8 8 0 0 1 8-8h30M142 20h30a8 8 0 0 1 8 8v30M180 182v30a8 8 0 0 1-8 8h-30M58 220H28a8 8 0 0 1-8-8v-30" />
        </g>
        <g fill="none" stroke="white" strokeOpacity="0.9" strokeWidth="3" strokeLinecap="round">
          <path d="M100 52c-30 0-48 24-48 58 0 40 22 70 48 70s48-30 48-70c0-34-18-58-48-58Z" />
          <path d="M80 104h8M112 104h8" strokeWidth="5" />
          <path d="M100 112v18l-6 6M88 150c8 6 16 6 24 0" />
        </g>
      </svg>
      {scanning && <div className="pointer-events-none absolute inset-x-6 h-0.5 animate-scan-line rounded-full bg-gradient-to-r from-transparent via-accent-300 to-transparent shadow-[0_0_14px_3px_rgb(103_232_249_/_0.55)]" style={{ top: "50%" }} aria-hidden="true" />}
    </div>
  );
}

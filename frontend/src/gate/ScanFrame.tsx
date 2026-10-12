import type { ScannerPhase } from "../hooks/useGateScanner";

const CORNERS = [
  "top-4 start-4 border-t-4 border-s-4 rounded-ss-xl",
  "top-4 end-4 border-t-4 border-e-4 rounded-se-xl",
  "bottom-4 start-4 border-b-4 border-s-4 rounded-es-xl",
  "bottom-4 end-4 border-b-4 border-e-4 rounded-ee-xl",
];

/**
 * Drawn over the live gate camera: corner brackets always, a soft pulse ring while
 * watching, and a moving scan line while verifying. Decorative and click-through.
 */
export function ScanFrame({ phase }: { phase: ScannerPhase }) {
  const verifying = phase === "verifying";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="scan-frame" data-phase={phase}>
      {phase === "watching" && (
        <div className="absolute inset-y-[12%] left-1/2 aspect-4/5 -translate-x-1/2 animate-pulse-ring rounded-[45%] border-2 border-accent-400/50" />
      )}
      {CORNERS.map((corner) => (
        <div key={corner} className={`absolute h-10 w-10 transition-colors sm:h-14 sm:w-14 ${corner} ${
          verifying ? "animate-pulse border-amber-300" : "border-accent-300/80"}`} />
      ))}
      {verifying && (
        <div className="absolute inset-x-6 h-0.5 animate-scan-line rounded-full bg-gradient-to-r from-transparent via-amber-300 to-transparent shadow-[0_0_14px_3px_rgb(252_211_77_/_0.55)]"
          style={{ top: "50%" }} />
      )}
    </div>
  );
}

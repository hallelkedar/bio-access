import type { CSSProperties } from "react";

const COLORS = ["var(--color-brand-500)", "var(--color-accent-400)", "var(--color-ok-500)", "var(--color-warn-500)", "var(--color-deny-500)"];

// Fixed pieces (no Math.random) so every render and test sees the same burst.
const PIECES = Array.from({ length: 28 }, (_, i) => {
  const spread = (i * 0.618034) % 1; // golden-ratio steps spread the pieces evenly
  return {
    left: `${4 + spread * 92}%`,
    color: COLORS[i % COLORS.length],
    delay: `${(i % 7) * 70}ms`,
    duration: `${1400 + (i % 5) * 220}ms`,
    drift: `${((i % 9) - 4) * 9}px`,
    spin: `${(i % 2 ? 1 : -1) * (240 + (i % 4) * 90)}deg`,
    round: i % 3 === 0,
  };
});

/** A one-shot, CSS-only confetti burst over its (relative) parent. Hidden under reduced motion. */
export function Confetti() {
  return (
    <div data-testid="confetti" aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      {PIECES.map((p, i) => (
        <span key={i}
          className={`absolute -top-3 h-2.5 animate-confetti ${p.round ? "w-2.5 rounded-full" : "w-1.5 rounded-sm"}`}
          style={{
            left: p.left,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.duration,
            "--confetti-drift": p.drift,
            "--confetti-spin": p.spin,
          } as CSSProperties} />
      ))}
    </div>
  );
}

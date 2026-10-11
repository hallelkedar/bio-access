import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

interface CountUpProps {
  value: number;
  durationMs?: number;
  format?: (n: number) => string;
  className?: string;
}

/**
 * Animates from the previous value to `value`. Screen readers get only the final value;
 * with reduced motion the final value is shown at once.
 */
export function CountUp({ value, durationMs = 1200, format = (n) => Math.round(n).toLocaleString(), className = "" }: CountUpProps) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced || durationMs <= 0) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / durationMs);
      setShown(origin + (value - origin) * easeOutCubic(progress));
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    });
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, durationMs, reduced]);

  return (
    <span className={`tabular-nums ${className}`}>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

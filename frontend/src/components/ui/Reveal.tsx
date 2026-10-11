import { useEffect, useRef, useState, type ReactNode } from "react";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

/**
 * Fades and slides its children in when they scroll into view. Content is never hidden
 * for good: without IntersectionObserver, or with reduced motion, it shows immediately.
 */
export function Reveal({ children, delayMs = 0, className = "" }: { children: ReactNode; delayMs?: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const supported = typeof IntersectionObserver !== "undefined";
  const [visible, setVisible] = useState(reduced || !supported);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible || reduced || !supported || !ref.current) {
      if (reduced) setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible, reduced, supported]);

  return (
    <div
      ref={ref}
      data-visible={visible}
      style={visible && !reduced ? { animationDelay: `${delayMs}ms` } : undefined}
      className={`${visible ? (reduced ? "" : "animate-fade-up") : "opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}

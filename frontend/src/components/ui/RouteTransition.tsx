import type { ReactNode } from "react";
import { useLocation } from "react-router";

/**
 * Short fade-and-rise each time the path changes (CSS only). The key remounts the wrapper
 * so the animation replays; motion-safe skips it under prefers-reduced-motion.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} data-testid="route-transition" className="motion-safe:animate-route-in">
      {children}
    </div>
  );
}

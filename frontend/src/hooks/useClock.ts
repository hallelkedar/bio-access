import { useEffect, useState } from "react";

/** The current time, refreshed every `intervalMs`; the interval is cleared on unmount. */
export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

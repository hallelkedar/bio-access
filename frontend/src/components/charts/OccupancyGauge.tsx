import { useEffect, useState } from "react";

import { localeFor } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CHART_COLORS } from "./chartMath";

const RADIUS = 52;
const STROKE = 12;

/** Share of capacity as 0–100 for an arc; 0 when there is no capacity to divide by. */
export function arcPercent(count: number, capacity: number): number {
  if (capacity <= 0 || count <= 0) return 0;
  return Math.min(100, (count / capacity) * 100);
}

/**
 * Occupancy as a ring: entered (bright) over sold (darker) on a same-hue track. The arcs
 * grow from 0 on mount and glide to new values (a CSS transition, so reduced motion skips it).
 */
export function OccupancyGauge({ entered, sold, capacity }: { entered: number; sold: number; capacity: number }) {
  const { t, lang } = useLanguage();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const number = new Intl.NumberFormat(localeFor(lang));
  const summary = capacity > 0
    ? t("chart.inside", { entered: number.format(entered), capacity: number.format(capacity) })
    : t("chart.noCapacity", { entered: number.format(entered) });
  // The number big, the % sign small: split with formatToParts so Hebrew keeps its own order.
  const parts = capacity > 0
    ? new Intl.NumberFormat(localeFor(lang), { style: "percent", maximumFractionDigits: 1 }).formatToParts(entered / capacity)
    : [];
  const arc = (count: number) => ({
    strokeDasharray: `${ready ? arcPercent(count, capacity) : 0} 100`,
    transition: "stroke-dasharray 900ms cubic-bezier(0.2, 0.7, 0.2, 1)",
  });

  return (
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-border bg-surface p-4 dark:bg-surface-2">
      <span className="font-semibold text-text">{t("chart.occupancy")}</span>
      <div
        role="meter"
        aria-label={t("chart.occupancy")}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={entered}
        aria-valuetext={summary}
        className="relative mx-auto my-3 aspect-square w-full max-w-48"
      >
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth={STROKE} stroke={CHART_COLORS.track} />
          <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth={STROKE} stroke={CHART_COLORS.barMuted}
            pathLength={100} strokeLinecap="round" style={arc(sold)} />
          <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth={STROKE} stroke={CHART_COLORS.bar}
            pathLength={100} strokeLinecap="round" style={arc(entered)} />
        </svg>
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-4xl font-semibold tabular-nums tracking-tight text-text">
          {/* One inline run (not flex items), so the bidi algorithm orders it right in Hebrew too. */}
          <span>
            {parts.length === 0 ? "—" : parts.map((p, i) => (
              <span key={i} className={p.type === "percentSign" ? "text-lg font-medium text-muted" : undefined}>{p.value}</span>
            ))}
          </span>
        </span>
      </div>
      <p className="text-center text-sm tabular-nums text-muted">{summary}</p>
      <div className="mt-2 flex justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.bar }} />{t("chart.entered", { count: number.format(entered) })}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.barMuted }} />{t("chart.sold", { count: number.format(sold) })}</span>
      </div>
    </div>
  );
}

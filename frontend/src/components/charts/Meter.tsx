import { CHART_COLORS } from "./chartMath";

/** Occupancy against capacity: entered (dark) over sold (light) on a same-hue track. */
export function Meter({ entered, sold, capacity }: { entered: number; sold: number; capacity: number }) {
  const pct = (n: number) => `${Math.min(100, (n / Math.max(1, capacity)) * 100)}%`;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-slate-900">Occupancy</span>
        <span className="text-sm tabular-nums text-slate-700">{entered} / {capacity} inside</span>
      </div>
      <div
        role="meter"
        aria-label="Occupancy"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={entered}
        className="relative mt-3 h-4 overflow-hidden rounded-full"
        style={{ backgroundColor: CHART_COLORS.track }}
      >
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(sold), backgroundColor: CHART_COLORS.barMuted }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(entered), backgroundColor: CHART_COLORS.bar }} />
      </div>
      <div className="mt-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.bar }} />Entered {entered}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.barMuted }} />Sold {sold}</span>
      </div>
    </div>
  );
}

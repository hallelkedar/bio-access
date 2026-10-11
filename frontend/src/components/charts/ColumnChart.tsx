import { useState } from "react";

import { CHART_COLORS, labelIndices, niceMax, ticks } from "./chartMath";

export interface Column {
  key: string;
  /** Short axis label, e.g. "19:00". */
  label: string;
  /** Full description for the tooltip and screen readers. */
  description: string;
  value: number;
}

/** A single-series column chart: one hue, thin bars, hover/focus tooltip, table view. */
export function ColumnChart({ title, columns, unit }: { title: string; columns: Column[]; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(0, ...columns.map((c) => c.value)));
  const shownLabels = labelIndices(columns.length, 8);
  const hovered = active === null ? null : columns[active];

  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 flex items-center justify-between">
        <span className="font-semibold text-slate-900">{title}</span>
        <button type="button" onClick={() => setAsTable((t) => !t)} className="text-sm text-blue-700 underline">
          {asTable ? "View as chart" : "View as table"}
        </button>
      </figcaption>
      {asTable ? (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th>Time</th><th className="text-right">{unit}</th></tr></thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key} className="border-t border-slate-100"><td>{c.description}</td><td className="text-right">{c.value}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-2">
          <div className="flex h-48 flex-col-reverse justify-between text-right text-xs text-slate-500" aria-hidden>
            {ticks(max).map((t) => <span key={t} className="leading-none">{Math.round(t)}</span>)}
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-x-0 top-0 h-48" aria-hidden>
              {ticks(max).map((t) => (
                <div key={t} className="absolute inset-x-0 border-t" style={{ bottom: `${(t / max) * 100}%`, borderColor: CHART_COLORS.grid }} />
              ))}
            </div>
            <div className="relative flex h-48 items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
              {columns.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  aria-label={`${c.description}: ${c.value} ${unit}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="flex h-full min-w-0 flex-1 items-end focus:outline-2 focus:outline-blue-700"
                >
                  <span
                    className="block w-full rounded-t-[4px]"
                    style={{
                      height: `${(c.value / max) * 100}%`,
                      minHeight: c.value > 0 ? 2 : 0,
                      backgroundColor: active === i ? "#1c5cab" : CHART_COLORS.bar,
                    }}
                  />
                </button>
              ))}
            </div>
            {hovered && active !== null && (
              <div role="tooltip" className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white"
                style={{ left: `${((active + 0.5) / columns.length) * 100}%` }}>
                {hovered.description} · {hovered.value} {unit}
              </div>
            )}
            <div className="mt-1 flex gap-[2px] text-xs text-slate-500" aria-hidden>
              {columns.map((c, i) => (
                <span key={c.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">{shownLabels.has(i) ? c.label : ""}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}

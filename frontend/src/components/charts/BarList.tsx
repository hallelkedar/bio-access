import { CHART_COLORS, niceMax } from "./chartMath";

export interface BarRow {
  key: string;
  label: string;
  value: number;
}

/** Horizontal bars for categories (one hue), value written at the end of each bar. */
export function BarList({ title, rows, empty }: { title: string; rows: BarRow[]; empty: string }) {
  const max = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  return (
    <figure className="rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 font-semibold text-slate-900">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm" aria-label={`${row.label}: ${row.value}`}>
              <span className="truncate text-slate-700">{row.label}</span>
              <span className="h-4 rounded-e-[4px]" style={{ width: `${(row.value / max) * 100}%`, minWidth: row.value > 0 ? 2 : 0, backgroundColor: CHART_COLORS.bar }} />
              <span className="text-end tabular-nums text-slate-900">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

import type { ReactNode } from "react";

import { localeFor } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CHART_COLORS, niceMax } from "./chartMath";

export interface BarRow {
  key: string;
  label: string;
  value: number;
}

/** Horizontal bars for categories (one hue), value written at the end of each bar. */
export function BarList({ title, rows, empty, footer }: { title: string; rows: BarRow[]; empty: string; footer?: ReactNode }) {
  const { lang } = useLanguage();
  const number = new Intl.NumberFormat(localeFor(lang));
  const max = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  return (
    <figure className="flex h-full min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 font-semibold text-slate-900">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="flex-1 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="flex-1 space-y-2">
          {rows.map((row) => (
            <li key={row.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" aria-label={`${row.label}: ${row.value}`}>
              <span className="truncate text-slate-700" title={row.label}>{row.label}</span>
              <span className="h-4 rounded-e-[4px]" style={{ width: `${(row.value / max) * 100}%`, minWidth: row.value > 0 ? 2 : 0, backgroundColor: CHART_COLORS.bar }} />
              <span className="min-w-8 text-end tabular-nums text-slate-900">{number.format(row.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="mt-3 border-t border-slate-100 pt-2">{footer}</div>}
    </figure>
  );
}

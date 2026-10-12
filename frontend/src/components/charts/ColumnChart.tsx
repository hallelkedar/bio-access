import { useState } from "react";

import { localeFor } from "../../format";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CHART_COLORS, countAxis, labelIndices } from "./chartMath";

/** Room per x-axis label, in px: a 12-hour time label plus a gap. */
const LABEL_SLOT = 84;

export interface Column {
  key: string;
  /** Short axis label, e.g. "19:00". */
  label: string;
  /** Full description for the tooltip and screen readers. */
  description: string;
  value: number;
}

/**
 * A single-series column chart: one hue, thin bars, hover/focus tooltip, table view.
 * The time axis runs left to right in Hebrew too (dir="ltr"), like clocks and timelines in
 * Hebrew interfaces; the title row and table follow the page direction.
 */
export function ColumnChart({ title, columns, unit, empty }: { title: string; columns: Column[]; unit: string; empty?: string }) {
  const { t, lang } = useLanguage();
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const plot = useElementWidth<HTMLDivElement>(560);
  const number = new Intl.NumberFormat(localeFor(lang));
  const total = columns.reduce((sum, c) => sum + c.value, 0);
  const axis = countAxis(Math.max(0, ...columns.map((c) => c.value)));
  // As many x labels as fit: about LABEL_SLOT px each ("04:30 PM" is ~60 px wide).
  const shownLabels = labelIndices(columns.length, Math.max(2, Math.floor(plot.width / LABEL_SLOT)));
  const lastShown = Math.max(...shownLabels);
  const hovered = active === null ? null : columns[active];
  const busiest = columns.reduce<Column | null>((best, c) => (!best || c.value > best.value ? c : best), null);

  return (
    <figure className="flex h-full min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-3 flex items-center justify-between gap-3">
        <span className="font-semibold text-slate-900">{title}</span>
        {total > 0 && (
          <button type="button" onClick={() => setAsTable((v) => !v)} className="shrink-0 text-sm text-blue-700 underline">
            {asTable ? t("chart.viewChart") : t("chart.viewTable")}
          </button>
        )}
      </figcaption>
      {total === 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-sm text-slate-500">{empty ?? t("chart.noData")}</p>
      ) : asTable ? (
        <table className="w-full text-sm">
          <thead className="text-slate-500"><tr><th className="text-start">{t("chart.time")}</th><th className="text-end">{unit}</th></tr></thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key} className="border-t border-slate-100"><td>{c.description}</td><td className="text-end tabular-nums">{number.format(c.value)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <p className="sr-only">
            {t("chart.summary", { total: number.format(total), unit, busiest: busiest?.description ?? "", count: number.format(busiest?.value ?? 0) })}
          </p>
          <div dir="ltr" className="flex gap-2">
            <div className="relative h-48 w-8 shrink-0 text-end text-xs tabular-nums text-slate-500" aria-hidden>
              {axis.ticks.map((tick) => (
                <span key={tick} className="absolute end-0 translate-y-1/2 leading-none" style={{ bottom: `${(tick / axis.max) * 100}%` }}>
                  {number.format(tick)}
                </span>
              ))}
            </div>
            <div ref={plot.ref} className="relative min-w-0 flex-1">
              <div className="absolute inset-x-0 top-0 h-48" aria-hidden>
                {axis.ticks.map((tick) => (
                  <div key={tick} className="absolute inset-x-0 border-t" style={{ bottom: `${(tick / axis.max) * 100}%`, borderColor: CHART_COLORS.grid }} />
                ))}
              </div>
              <div className="relative flex h-48 items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
                {columns.map((c, i) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-label={`${c.description}: ${number.format(c.value)} ${unit}`}
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="flex h-full min-w-0 flex-1 items-end focus:outline-2 focus:outline-blue-700"
                  >
                    <span
                      className="block w-full rounded-t-[4px]"
                      style={{
                        height: `${(c.value / axis.max) * 100}%`,
                        minHeight: c.value > 0 ? 2 : 0,
                        backgroundColor: active === i ? "#1c5cab" : CHART_COLORS.bar,
                      }}
                    />
                  </button>
                ))}
              </div>
              {hovered && active !== null && (
                <div role="tooltip" className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white"
                  style={{ left: `${Math.min(85, Math.max(15, ((active + 0.5) / columns.length) * 100))}%` }}>
                  {hovered.description} · {number.format(hovered.value)} {unit}
                </div>
              )}
              {/* Labels sit under their column; the first and last are pinned inside the card. */}
              <div className="relative mt-1 h-4 text-xs text-slate-500" aria-hidden>
                {columns.map((c, i) => {
                  if (!shownLabels.has(i)) return null;
                  const center = ((i + 0.5) / columns.length) * 100;
                  const style = i === 0 ? { left: 0 } : i === lastShown && center > 80 ? { right: 0 } : { left: `${center}%`, transform: "translateX(-50%)" };
                  return <span key={c.key} className="absolute whitespace-nowrap" style={style}>{c.label}</span>;
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </figure>
  );
}

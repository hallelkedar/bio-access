import { localeFor } from "../../format";
import { useLanguage } from "../../i18n/LanguageProvider";
import { CHART_COLORS } from "./chartMath";

/** Occupancy against capacity: entered (dark) over sold (light) on a same-hue track. */
export function Meter({ entered, sold, capacity }: { entered: number; sold: number; capacity: number }) {
  const { t, lang } = useLanguage();
  const number = new Intl.NumberFormat(localeFor(lang));
  // No capacity (0) means nothing to fill: never divide by it.
  const pct = (n: number) => (capacity > 0 ? `${Math.min(100, (n / capacity) * 100)}%` : "0%");
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-slate-900">{t("chart.occupancy")}</span>
        <span className="text-sm tabular-nums text-slate-700">
          {capacity > 0 ? t("chart.inside", { entered: number.format(entered), capacity: number.format(capacity) }) : t("chart.noCapacity", { entered: number.format(entered) })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={t("chart.occupancy")}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={entered}
        className="relative mt-3 h-4 overflow-hidden rounded-full"
        style={{ backgroundColor: CHART_COLORS.track }}
      >
        <div className="absolute inset-y-0 start-0 rounded-full" style={{ width: pct(sold), backgroundColor: CHART_COLORS.barMuted }} />
        <div className="absolute inset-y-0 start-0 rounded-full" style={{ width: pct(entered), backgroundColor: CHART_COLORS.bar }} />
      </div>
      <div className="mt-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.bar }} />{t("chart.entered", { count: number.format(entered) })}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CHART_COLORS.barMuted }} />{t("chart.sold", { count: number.format(sold) })}</span>
      </div>
    </div>
  );
}

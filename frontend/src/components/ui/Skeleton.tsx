import type { ReactNode } from "react";

import { useLanguage } from "../../i18n/LanguageProvider";

const SHIMMER =
  "block animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--border)_25%,var(--surface-2)_50%,var(--border)_75%)] bg-[length:200%_100%]";

/** One grey shimmering block; size it with className. Hidden from screen readers. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span aria-hidden="true" className={`${SHIMMER} ${className}`} />;
}

/** Announces "Loading…" once for the whole placeholder, instead of once per block. */
function Loading({ className = "", children }: { className?: string; children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div role="status" aria-busy="true" aria-label={t("common.loading")} className={className}>
      {children}
    </div>
  );
}

const LINE_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-2/3"];

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <Loading className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-4 ${LINE_WIDTHS[i % LINE_WIDTHS.length]}`} />)}
    </Loading>
  );
}

export function SkeletonTable({ rows = 5, columns = 4, className = "" }: { rows?: number; columns?: number; className?: string }) {
  return (
    <Loading className={`overflow-hidden rounded-lg border border-border bg-surface ${className}`}>
      <div className="grid gap-4 border-b border-border bg-surface-2 px-3 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className="h-3 w-1/2" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} data-testid="skeleton-row" className="grid gap-4 border-b border-border px-3 py-3 last:border-0"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className={`h-4 ${LINE_WIDTHS[(r + c) % LINE_WIDTHS.length]}`} />)}
        </div>
      ))}
    </Loading>
  );
}

/** Placeholders shaped like StatTile, in the same grid as the dashboard KPIs. */
export function SkeletonTiles({ count = 4, className = "" }: { count?: number; className?: string }) {
  return (
    <Loading className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4 dark:bg-surface-2">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-3 h-7 w-1/3" />
        </div>
      ))}
    </Loading>
  );
}

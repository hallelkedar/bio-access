/** One KPI. The value is pre-formatted; it never wraps, and shrinks a little on narrow tiles. */
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-between rounded-lg border border-slate-200 bg-white p-4">
      <p className="truncate text-sm text-slate-600" title={label}>{label}</p>
      <p className="mt-1 truncate text-[clamp(1.5rem,5vw,1.875rem)] font-semibold leading-tight tabular-nums text-slate-900" title={value}>
        {value}
      </p>
    </div>
  );
}

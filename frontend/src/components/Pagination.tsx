export function Pagination({ total, offset, limit, onChange }: {
  total: number; offset: number; limit: number; onChange: (offset: number) => void;
}) {
  if (total === 0) return null;
  const first = offset + 1;
  const last = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <span>Showing {first}–{last} of {total}</span>
      <div className="flex gap-2">
        <button type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}
          className="rounded-md border px-3 py-1 disabled:opacity-40">Previous</button>
        <button type="button" disabled={last >= total} onClick={() => onChange(offset + limit)}
          className="rounded-md border px-3 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

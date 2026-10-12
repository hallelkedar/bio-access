import type { ReactNode } from "react";

/** "Nothing here yet": a small illustration, a title, a hint and an optional action (Button or ButtonLink). */
export function EmptyState({ title, hint, action, className = "" }: { title: string; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-10 text-center ${className}`}>
      <svg viewBox="0 0 96 72" className="h-16 w-24 text-brand-500" fill="none" aria-hidden="true">
        <rect x="14" y="14" width="68" height="46" rx="8" fill="currentColor" opacity="0.08" />
        <rect x="22" y="8" width="52" height="40" rx="7" fill="var(--surface)" stroke="currentColor" strokeWidth="2" opacity="0.9" />
        <path d="M32 21h20M32 29h32M32 37h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        <circle cx="70" cy="52" r="10" fill="var(--surface)" stroke="var(--color-accent-500)" strokeWidth="2" />
        <path d="M77 59l6 6" stroke="var(--color-accent-500)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <h3 className="mt-4 font-semibold text-text">{title}</h3>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

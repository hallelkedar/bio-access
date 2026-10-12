import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "ok" | "deny" | "warn";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted ring-border",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  ok: "bg-ok-50 text-ok-700 ring-ok-100",
  deny: "bg-deny-50 text-deny-700 ring-deny-100",
  warn: "bg-warn-50 text-warn-700 ring-warn-100",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

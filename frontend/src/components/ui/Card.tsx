import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts slightly on hover (for clickable cards). */
  interactive?: boolean;
}

export function Card({ interactive = false, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`rounded-card border border-border bg-surface shadow-card ${
        interactive ? "transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-raised" : ""
      } ${className}`}
      {...rest}
    />
  );
}

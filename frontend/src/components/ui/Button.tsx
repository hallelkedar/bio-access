import type { ComponentPropsWithRef, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-[background-color,box-shadow,translate,scale] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 " +
  "disabled:pointer-events-none disabled:opacity-50 active:translate-y-px active:scale-[0.98]";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-card hover:shadow-glow",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-deny-600 text-white hover:bg-deny-700",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`.trim();
}

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading = false, disabled, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)} {...rest}>
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A router link that looks like a Button. */
export function ButtonLink({ variant = "primary", size = "md", className = "", ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...rest} />;
}

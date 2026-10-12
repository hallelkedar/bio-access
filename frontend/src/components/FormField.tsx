import type { InputHTMLAttributes, ReactNode } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** Shown under the field in red; also marks the input aria-invalid. */
  error?: string;
  /** Something inside the input's end edge, e.g. a show-password button. */
  adornment?: ReactNode;
  /** Extra content under the input (e.g. a strength meter). */
  children?: ReactNode;
}

export function FormField({ label, hint, error, adornment, children, id, className = "", ...input }: FormFieldProps) {
  const fieldId = id ?? input.name;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-text">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`min-h-11 w-full rounded-control border bg-surface px-3 py-2 text-text transition-[border-color,box-shadow] placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 ${
            error
              ? "border-deny-500 focus-visible:ring-deny-500/30"
              : "border-border hover:border-slate-400 focus-visible:border-brand-500 focus-visible:ring-brand-500/30"
          } ${adornment ? "pe-11" : ""} ${className}`}
          {...input}
        />
        {adornment && <div className="absolute inset-y-0 end-0 flex items-center pe-1">{adornment}</div>}
      </div>
      {children}
      {error && <p id={errorId} className="mt-1 text-xs font-medium text-deny-700">{error}</p>}
      {hint && <p id={hintId} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

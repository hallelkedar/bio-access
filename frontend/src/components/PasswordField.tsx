import { useState, type ComponentProps } from "react";

import { passwordStrength } from "../auth/validation";
import type { TranslationKey } from "../i18n/en";
import { useLanguage } from "../i18n/LanguageProvider";
import { FormField } from "./FormField";

type PasswordFieldProps = Omit<ComponentProps<typeof FormField>, "type" | "adornment" | "children"> & {
  /** Show a live strength meter under the field (for new passwords). */
  showStrength?: boolean;
};

const STRENGTH: Record<1 | 2 | 3 | 4, { label: TranslationKey; color: string }> = {
  1: { label: "password.weak", color: "bg-deny-500" },
  2: { label: "password.fair", color: "bg-warn-500" },
  3: { label: "password.good", color: "bg-accent-500" },
  4: { label: "password.strong", color: "bg-ok-500" },
};

/** A password input with a show/hide toggle and an optional strength meter. */
export function PasswordField({ showStrength = false, value, ...field }: PasswordFieldProps) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const score = showStrength ? passwordStrength(String(value ?? "")) : 0;
  const level = score > 0 ? STRENGTH[score as keyof typeof STRENGTH] : undefined;

  const toggle = (
    <button type="button" onClick={() => setVisible((v) => !v)} aria-pressed={visible}
      aria-label={visible ? t("password.hide") : t("password.show")}
      className="flex h-9 w-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline-2 focus-visible:outline-brand-500">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {visible && <path d="M4 4l16 16" />}
      </svg>
    </button>
  );

  return (
    <FormField {...field} value={value} type={visible ? "text" : "password"} adornment={toggle}>
      {showStrength && (
        <div className="mt-2 flex items-center gap-3" data-testid="password-strength">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <span key={step}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${level && step <= score ? level.color : "bg-border"}`} />
            ))}
          </div>
          <span aria-live="polite" className="min-w-14 text-end text-xs font-medium text-muted">
            {level && t(level.label)}
          </span>
        </div>
      )}
    </FormField>
  );
}

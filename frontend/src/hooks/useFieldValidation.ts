import { useState, type FormEvent } from "react";

import type { FieldErrors } from "../auth/validation";
import type { TranslationKey } from "../i18n/en";

/**
 * Field errors that appear once a field was left (blur) and then follow the value live.
 * `validateAll` marks every field touched, focuses the first invalid one (in `order`)
 * and returns false so the caller can skip the request.
 */
export function useFieldValidation<F extends string>(errors: FieldErrors<F>, order: readonly F[]) {
  const [touched, setTouched] = useState<Partial<Record<F, boolean>>>({});

  return {
    errorFor: (field: F): TranslationKey | undefined => (touched[field] ? errors[field] : undefined),
    touch: (field: F) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true })),
    validateAll(event: FormEvent<HTMLFormElement>): boolean {
      setTouched(Object.fromEntries(order.map((f) => [f, true])) as Record<F, boolean>);
      const first = order.find((f) => errors[f]);
      if (!first) return true;
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return false;
    },
  };
}

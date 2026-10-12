import type { TranslationKey } from "../i18n/en";

/** Same limits the backend enforces (UserCreate / bcrypt), checked before we send anything. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors<F extends string> = Partial<Record<F, TranslationKey>>;

function emailError(email: string): TranslationKey | undefined {
  if (!email.trim()) return "validation.required";
  if (!EMAIL.test(email.trim())) return "validation.email";
  return undefined;
}

export function validateLogin(form: { email: string; password: string }): FieldErrors<"email" | "password"> {
  const errors: FieldErrors<"email" | "password"> = {};
  const email = emailError(form.email);
  if (email) errors.email = email;
  if (!form.password) errors.password = "validation.required";
  return errors;
}

export type RegisterField = "full_name" | "email" | "phone" | "password";

export function validateRegister(form: Record<RegisterField, string>): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  if (!form.full_name.trim()) errors.full_name = "validation.required";
  const email = emailError(form.email);
  if (email) errors.email = email;
  if (!form.password) errors.password = "validation.required";
  else if (form.password.length < MIN_PASSWORD_LENGTH) errors.password = "validation.passwordShort";
  else if (new TextEncoder().encode(form.password).length > MAX_PASSWORD_BYTES) errors.password = "validation.passwordLong";
  return errors;
}

/**
 * A rough 0–4 strength score for the meter: 0 = empty, 1 = too short or one kind of
 * character, up to 4 = long with a mix of cases, digits and symbols.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  if (password.length < MIN_PASSWORD_LENGTH) return 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = 1 + (kinds >= 2 ? 1 : 0) + (kinds >= 3 ? 1 : 0) + (password.length >= 12 ? 1 : 0);
  if (kinds === 1) score = Math.min(score, 2); // e.g. a long run of lowercase letters
  return Math.min(score, 4) as 1 | 2 | 3 | 4;
}

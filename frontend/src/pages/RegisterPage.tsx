import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { HOME_BY_ROLE } from "../auth/roles";
import { validateRegister, type RegisterField } from "../auth/validation";
import { useFieldValidation } from "../hooks/useFieldValidation";
import { useLanguage } from "../i18n/LanguageProvider";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { PasswordField } from "../components/PasswordField";
import { Button } from "../components/ui";
import { AUTH_LINK, AuthCard } from "./AuthCard";

const FIELDS: readonly RegisterField[] = ["full_name", "email", "phone", "password"];

export function RegisterPage() {
  const { register, user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { errorFor, touch, validateAll } = useFieldValidation(validateRegister(form), FIELDS);

  function field(name: RegisterField) {
    const key = errorFor(name);
    return {
      name,
      value: form[name],
      onChange: (event: { target: { value: string } }) => setForm({ ...form, [name]: event.target.value }),
      onBlur: touch(name),
      error: key && t(key),
    };
  }

  if (user && !sending) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />; // already signed in
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateAll(event)) return;
    setError(null);
    setSending(true);
    try {
      const user = await register(form);
      navigate(HOME_BY_ROLE[user.role], { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, { 409: t("register.emailTaken") }, lang));
      setSending(false);
    }
  }

  return (
    <AuthCard title={t("register.title")} subtitle={t("register.subtitle")}
      footer={<>{t("register.haveAccount")} <Link to="/login" className={AUTH_LINK}>{t("register.loginLink")}</Link></>}>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label={t("register.fullName")} autoComplete="name" required autoFocus {...field("full_name")} />
        <FormField label={t("field.email")} type="email" autoComplete="email" required {...field("email")} />
        <FormField label={t("register.phone")} type="tel" autoComplete="tel" hint={t("register.phoneHint")} {...field("phone")} />
        <PasswordField label={t("field.password")} autoComplete="new-password" required minLength={8}
          hint={t("register.passwordHint")} showStrength {...field("password")} />
        <ErrorBox message={error} />
        <Button type="submit" size="lg" loading={sending} className="min-h-11 w-full">
          {sending ? t("register.submitting") : t("register.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

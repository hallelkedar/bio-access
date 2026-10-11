import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { HOME_BY_ROLE } from "../auth/roles";
import { useLanguage } from "../i18n/LanguageProvider";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";

export function RegisterPage() {
  const { register, user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });
  }

  if (user && !sending) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />; // already signed in
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
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
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">{t("register.title")}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label={t("register.fullName")} name="full_name" autoComplete="name" required value={form.full_name}
          onChange={update("full_name")} />
        <FormField label={t("field.email")} name="email" type="email" autoComplete="email" required value={form.email}
          onChange={update("email")} />
        <FormField label={t("register.phone")} name="phone" type="tel" autoComplete="tel" value={form.phone}
          onChange={update("phone")} hint={t("register.phoneHint")} />
        <FormField label={t("field.password")} name="password" type="password" autoComplete="new-password" required
          minLength={8} value={form.password} onChange={update("password")} hint={t("register.passwordHint")} />
        <ErrorBox message={error} />
        <button type="submit" disabled={sending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {sending ? t("register.submitting") : t("register.submit")}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        {t("register.haveAccount")} <Link to="/login" className="text-blue-700 underline">{t("register.loginLink")}</Link>
      </p>
    </section>
  );
}

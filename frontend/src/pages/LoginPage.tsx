import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { HOME_BY_ROLE } from "../auth/roles";
import { useLanguage } from "../i18n/LanguageProvider";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LocationState;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const user = await login(email, password);
      navigate(state.from ?? HOME_BY_ROLE[user.role], { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, { 401: t("login.wrongPassword") }, lang));
      setSending(false);
    }
  }

  return (
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">{t("login.title")}</h1>
      {sessionExpired && <p className="mt-2 text-sm text-amber-700">{t("login.sessionExpired")}</p>}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label={t("field.email")} name="email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
        <FormField label={t("field.password")} name="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox message={error} />
        <button type="submit" disabled={sending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {sending ? t("login.submitting") : t("login.submit")}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        {t("login.noAccount")} <Link to="/register" className="text-blue-700 underline">{t("login.registerLink")}</Link>
      </p>
    </section>
  );
}

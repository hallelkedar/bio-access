import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { HOME_BY_ROLE } from "../auth/roles";
import { validateLogin } from "../auth/validation";
import { useFieldValidation } from "../hooks/useFieldValidation";
import { useLanguage } from "../i18n/LanguageProvider";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";
import { PasswordField } from "../components/PasswordField";
import { Button } from "../components/ui";
import { AUTH_LINK, AuthCard } from "./AuthCard";

interface LocationState {
  from?: string;
}

const FIELDS = ["email", "password"] as const;

export function LoginPage() {
  const { login, sessionExpired, user } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LocationState;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [shake, setShake] = useState(false);
  const { errorFor, touch, validateAll } = useFieldValidation(validateLogin({ email, password }), FIELDS);
  const fieldError = (field: (typeof FIELDS)[number]) => {
    const key = errorFor(field);
    return key && t(key);
  };

  if (user && !sending) {
    return <Navigate to={HOME_BY_ROLE[user.role]} replace />; // already signed in
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateAll(event)) return;
    setError(null);
    setSending(true);
    try {
      const user = await login(email, password);
      navigate(state.from ?? HOME_BY_ROLE[user.role], { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, { 401: t("login.wrongPassword") }, lang));
      setShake(true);
      setSending(false);
    }
  }

  return (
    <AuthCard title={t("login.title")} subtitle={t("login.subtitle")} shake={shake} onShakeEnd={() => setShake(false)}
      footer={<>{t("login.noAccount")} <Link to="/register" className={AUTH_LINK}>{t("login.registerLink")}</Link></>}>
      {sessionExpired && (
        <p className="mt-4 rounded-control border border-warn-100 bg-warn-50 px-3 py-2 text-sm text-warn-700">
          {t("login.sessionExpired")}
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label={t("field.email")} name="email" type="email" autoComplete="email" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} onBlur={touch("email")} error={fieldError("email")} />
        <PasswordField label={t("field.password")} name="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} onBlur={touch("password")} error={fieldError("password")} />
        <ErrorBox message={error} />
        <Button type="submit" size="lg" loading={sending} className="min-h-11 w-full">
          {sending ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

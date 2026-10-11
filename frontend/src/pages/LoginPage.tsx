import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { HOME_BY_ROLE } from "../auth/roles";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
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
      setError(apiErrorMessage(err, { 401: "Wrong email or password." }));
      setSending(false);
    }
  }

  return (
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">Log in</h1>
      {sessionExpired && <p className="mt-2 text-sm text-amber-700">Your session expired. Please log in again.</p>}
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label="Email" name="email" type="email" autoComplete="email" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
        <FormField label="Password" name="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox message={error} />
        <button type="submit" disabled={sending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {sending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        No account? <Link to="/register" className="text-blue-700 underline">Register</Link>
      </p>
    </section>
  );
}

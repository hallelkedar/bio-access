import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { HOME_BY_ROLE } from "../auth/roles";
import { ErrorBox } from "../components/ErrorBox";
import { FormField } from "../components/FormField";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function update(field: keyof typeof form) {
    return (event: { target: { value: string } }) => setForm({ ...form, [field]: event.target.value });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const user = await register(form);
      navigate(HOME_BY_ROLE[user.role], { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err, { 409: "This email is already registered." }));
      setSending(false);
    }
  }

  return (
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">Create an account</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label="Full name" name="full_name" autoComplete="name" required value={form.full_name}
          onChange={update("full_name")} />
        <FormField label="Email" name="email" type="email" autoComplete="email" required value={form.email}
          onChange={update("email")} />
        <FormField label="Phone (optional)" name="phone" type="tel" autoComplete="tel" value={form.phone}
          onChange={update("phone")} hint="For an SMS confirmation, e.g. 050-123-4567" />
        <FormField label="Password" name="password" type="password" autoComplete="new-password" required
          minLength={8} value={form.password} onChange={update("password")} hint="At least 8 characters" />
        <ErrorBox message={error} />
        <button type="submit" disabled={sending}
          className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50">
          {sending ? "Creating account…" : "Register"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Already registered? <Link to="/login" className="text-blue-700 underline">Log in</Link>
      </p>
    </section>
  );
}

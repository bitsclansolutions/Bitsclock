"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { api, errMsg } from "@/lib/client";
import { clientCheck, loginSchema } from "@/lib/validation";
import { safeNextPath } from "@/lib/sanitize";
import { ErrorBanner, Field } from "@/components/ui";
import { AuthShell, SuccessNote } from "@/components/site/AuthShell";

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const justReset = sp.get("reset") === "1";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const payload = { email, password, remember };
    const problem = clientCheck(loginSchema, payload);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/login", { method: "POST", json: payload });
      // A fresh session must not inherit another account's cached data or timer state.
      try {
        sessionStorage.clear();
        localStorage.removeItem("bc:timer:active");
      } catch {
        /* ignore */
      }
      router.replace(safeNextPath(sp.get("next")));
      router.refresh();
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  const forgotHref = email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : "/forgot-password";

  return (
    <AuthShell>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-500">Sign in with the account your administrator created for you.</p>

      <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
        {justReset && !error && <SuccessNote>Your password was updated. Sign in with the new one.</SuccessNote>}
        <ErrorBanner message={error} />
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Field label="Password" htmlFor="password">
          <div className="relative">
            <input id="password" type={show ? "text" : "password"} autoComplete="current-password" required className="field pr-11" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-ink-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 cursor-pointer rounded border-ink-900 accent-ink-900" />
            Remember me
            <span className="text-xs text-ink-400">{remember ? "30 days" : "this session"}</span>
          </label>
          <Link href={forgotHref} className="font-semibold text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <button type="submit" disabled={busy} className="btn btn-dark w-full">
          {busy ? "Signing in…" : "Sign in"} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-ink-500">No account yet? Ask an administrator to add you from the Team page.</p>
    </AuthShell>
  );
}

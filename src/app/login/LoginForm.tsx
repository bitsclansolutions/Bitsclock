"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { api, ApiClientError, errMsg } from "@/lib/client";
import { emailField } from "@/lib/validation";
import { safeNextPath } from "@/lib/sanitize";
import { Field } from "@/components/ui";
import { AuthShell, SuccessNote } from "@/components/site/AuthShell";
import { keepDraftsFor } from "@/lib/drafts";

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Wrong credentials or a lockout: offer the reset link right in the message.
  const [offerReset, setOfferReset] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const justReset = sp.get("reset") === "1";
  const expired = sp.get("expired") === "1";

  /** Format checks only; whether the account exists is never revealed (D-010). */
  const checkFields = () => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = "Enter your email address.";
    else if (!emailField.safeParse(email).success) next.email = "That doesn't look like an email address. Use the format name@company.com.";
    if (!password.trim()) next.password = "Enter your password.";
    setFieldErrors(next);
    return !next.email && !next.password;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOfferReset(false);
    if (!checkFields()) return;
    // Email is trimmed here and on the server; the password goes as typed and the server
    // ignores spaces at its ends (it also accepts an older password that really had them).
    const payload = { email: email.trim(), password, remember };
    setBusy(true);
    try {
      await api("/api/auth/login", { method: "POST", json: payload });
      // A fresh session must not inherit another account's cached data or timer state.
      // Unsaved form drafts survive only when the same person signs back in (R-038).
      keepDraftsFor(email, () => {
        try {
          sessionStorage.clear();
          localStorage.removeItem("bc:timer:active");
        } catch {
          /* ignore */
        }
      });
      // One navigation only: the (app) layout is rendered fresh for the new session anyway,
      // so the extra router.refresh() just rendered the page a second time.
      router.replace(safeNextPath(sp.get("next")));
    } catch (err) {
      setError(errMsg(err));
      setOfferReset(err instanceof ApiClientError && (err.status === 401 || err.status === 429));
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
        {expired && !justReset && !error && (
          <p role="status" className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            Your session expired. Sign in again to continue; anything you were typing is kept.
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-xl bg-[#fbe5e5] px-3.5 py-2.5 text-sm font-medium text-[#b5322b]">
            {error}
            {offerReset && (
              <>
                {" "}
                <Link href={forgotHref} className="font-bold underline underline-offset-2">
                  Reset your password
                </Link>
              </>
            )}
          </div>
        )}
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="field"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
            }}
            onBlur={() => setEmail((v) => v.trim())}
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password}>
          <div className="relative">
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={fieldErrors.password ? true : undefined}
              className="field pr-11"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
              }}
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex cursor-pointer select-none items-center gap-2.5 text-ink-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 cursor-pointer rounded border-brand-600 accent-brand-600" />
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

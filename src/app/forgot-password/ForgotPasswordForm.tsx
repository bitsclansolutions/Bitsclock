"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, MailCheck } from "lucide-react";
import { api, errMsg } from "@/lib/client";
import { clientCheck, forgotPasswordSchema, resetPasswordSchema } from "@/lib/validation";
import { ErrorBanner, Field } from "@/components/ui";
import { AuthShell, SuccessNote } from "@/components/site/AuthShell";

const RESEND_SECONDS = 30;

/**
 * Two steps on one page: ask for the email and send a code, then take the code and the
 * new password. Finishes on /login with a "password updated" note.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(() => sp.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (again = false) => {
    setError("");
    const problem = clientCheck(forgotPasswordSchema, { email });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ ok: true; minutes: number }>("/api/auth/forgot", { method: "POST", json: { email: email.trim() } });
      setMinutes(res.minutes);
      setCooldown(RESEND_SECONDS);
      setResent(again);
      setStep("code");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const payload = { email: email.trim(), code, newPassword: password };
    const problem = clientCheck(resetPasswordSchema, payload);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset", { method: "POST", json: payload });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  if (step === "email") {
    return (
      <AuthShell>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Reset your password</h1>
        <p className="mt-1 text-sm text-ink-500">Enter the email you sign in with. We&apos;ll send a 6-digit code to confirm it&apos;s you.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
          className="mt-8 space-y-4"
          noValidate
        >
          <ErrorBanner message={error} />
          <Field label="Email" htmlFor="fp-email">
            <input id="fp-email" type="email" autoComplete="email" required autoFocus className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <button type="submit" disabled={busy} className="btn btn-dark w-full">
            {busy ? "Sending…" : "Email me a code"} <ArrowRight className="h-4 w-4" />
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-ink-500">
          <Link href="/login" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Check your email</h1>
      <p className="mt-1 text-sm text-ink-500">
        If an account exists for <span className="font-semibold text-ink-900">{email.trim()}</span>, a code is on its way. It expires in {minutes} minutes.
      </p>
      <form onSubmit={reset} className="mt-8 space-y-4" noValidate>
        {resent && !error && (
          <SuccessNote>
            <span className="inline-flex items-center gap-1.5">
              <MailCheck className="h-4 w-4" /> A new code was sent. Only the newest one works.
            </span>
          </SuccessNote>
        )}
        <ErrorBanner message={error} />
        <Field label="6-digit code" htmlFor="fp-code" hint="Check your spam folder if it doesn't arrive within a minute.">
          <input
            id="fp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            className="field text-center text-xl font-extrabold tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
          />
        </Field>
        <Field label="New password" htmlFor="fp-pwd" hint="At least 8 characters with a letter and a number.">
          <div className="relative">
            <input id="fp-pwd" type={show ? "text" : "password"} autoComplete="new-password" required className="field pr-11" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <button type="submit" disabled={busy || code.length < 6} className="btn btn-dark w-full">
          {busy ? "Saving…" : "Set new password"} <ArrowRight className="h-4 w-4" />
        </button>
      </form>
      <div className="mt-6 flex items-center justify-between text-xs text-ink-500">
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setCode("");
            setError("");
            setResent(false);
          }}
          className="inline-flex cursor-pointer items-center gap-1 font-semibold text-brand-700 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Use a different email
        </button>
        <button type="button" onClick={() => void sendCode(true)} disabled={busy || cooldown > 0} className="cursor-pointer font-semibold text-brand-700 hover:underline disabled:cursor-default disabled:text-ink-400 disabled:no-underline">
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
        </button>
      </div>
    </AuthShell>
  );
}

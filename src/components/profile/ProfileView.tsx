"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, KeyRound, Laptop, LogOut, MonitorSmartphone, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg, qs, tzName } from "@/lib/client";
import { broadcastSignOut, invalidate, useApi } from "@/lib/useApi";
import { changePasswordSchema, clientCheck, profileSchema } from "@/lib/validation";
import { LIMITS } from "@/lib/sanitize";
import type { DashboardDTO } from "@/app/api/dashboard/route";
import type { SessionDTO } from "@/lib/sessions";
import { dayKey, fmtHours, startOfDay, startOfMonth, startOfWeek, toISO, toZoned, zonedNow } from "@/lib/time";
import { Avatar, ErrorBanner, Field, Kpi, PasswordInput, Skeleton, cx } from "@/components/ui";

/** Short device label from a user agent string. */
function describeDevice(ua: string | null) {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const os = /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Linux/i.test(ua) ? "Linux" : "";
  const browser = /Edg\//i.test(ua) ? "Edge" : /OPR\//i.test(ua) ? "Opera" : /Chrome\//i.test(ua) ? "Chrome" : /Firefox\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : "Browser";
  return { label: [browser, os].filter(Boolean).join(" on "), mobile };
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function ProfileView() {
  const { user } = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();

  // Profile form
  const [name, setName] = useState(user.name);
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const profileDirty = name.trim() !== user.name || jobTitle.trim() !== (user.jobTitle ?? "");

  // Password form
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState("");

  // Stats (same endpoint as the dashboard, so it is usually already cached)
  const now = zonedNow();
  const statsQ = useApi<DashboardDTO>(
    `/api/dashboard${qs({ tz: tzName(), dayStart: toISO(startOfDay(now)), weekStart: toISO(startOfWeek(now)), monthStart: toISO(startOfMonth(now)) })}`,
    { ttlMs: 20_000 },
  );
  const me = statsQ.data?.me;

  // Signed-in devices
  const sessionsQ = useApi<{ sessions: SessionDTO[] }>("/api/auth/sessions", { ttlMs: 10_000 });
  const sessions = sessionsQ.data?.sessions ?? [];

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    const payload = { name: name.trim(), jobTitle: jobTitle.trim() };
    const problem = clientCheck(profileSchema, payload);
    if (problem) return setProfileError(problem);
    setProfileBusy(true);
    try {
      await api("/api/auth/profile", { method: "PATCH", json: payload });
      invalidate("/api/users", "/api/time-entries", "/api/dashboard");
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      setProfileError(errMsg(err));
    } finally {
      setProfileBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError("");
    if (next !== confirmPwd) return setPwdError("The new passwords don't match.");
    const payload = { currentPassword: current, newPassword: next };
    const problem = clientCheck(changePasswordSchema, payload);
    if (problem) return setPwdError(problem);
    setPwdBusy(true);
    try {
      await api("/api/auth/password", { method: "PATCH", json: payload });
      toast.success("Password changed", "Every other device has been signed out.");
      setCurrent("");
      setNext("");
      setConfirmPwd("");
      invalidate("/api/auth/sessions");
      sessionsQ.refresh();
    } catch (err) {
      setPwdError(errMsg(err));
    } finally {
      setPwdBusy(false);
    }
  };

  const revoke = async (s: SessionDTO) => {
    try {
      await api(`/api/auth/sessions/${s.id}`, { method: "DELETE" });
      invalidate("/api/auth/sessions");
      sessionsQ.refresh();
      toast.success("Device signed out");
    } catch (err) {
      toast.error("Couldn't sign out that device", errMsg(err));
    }
  };

  const signOutEverywhere = async () => {
    const ok = await confirm({ title: "Sign out everywhere?", body: <>Every device, including this one, will need to sign in again.</>, ok: "Sign out everywhere", danger: true });
    if (!ok) return;
    try {
      await api("/api/auth/logout", { method: "POST", json: { everywhere: true } });
    } catch {
      /* cookies are cleared regardless */
    }
    try {
      sessionStorage.clear();
      localStorage.removeItem("bc:timer:active");
    } catch {
      /* ignore */
    }
    // Full page load: wipes this tab's in-memory data and page caches (see AppShell useLogout).
    broadcastSignOut();
    window.location.replace("/login");
  };

  const strength = (() => {
    let s = 0;
    if (next.length >= 8) s++;
    if (next.length >= 12) s++;
    if (/[A-Z]/.test(next) && /[a-z]/.test(next)) s++;
    if (/\d/.test(next)) s++;
    if (/[^A-Za-z0-9]/.test(next)) s++;
    return s;
  })();

  return (
    <div className="space-y-5">
      {/* Identity + stats */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
        <section className="card-accent flex items-center gap-4 p-5" aria-label="Account">
          <Avatar name={user.name} size="lg" color={user.role.color} className="ring-4 ring-white/20" />
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold leading-tight">{user.name}</p>
            <p className="truncate text-sm text-white/75">{user.jobTitle || "No job title yet"}</p>
            <p className="mt-1 truncate text-xs text-white/60">{user.email}</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: user.role.color }} /> {user.role.name}</div>
          </div>
        </section>
        {!me ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-[112px]" />)
        ) : (
          <>
            <Kpi label="Today" value={fmtHours(me.todaySeconds)} icon={<Clock3 className="h-5 w-5" />} sub={dayKey(now) === dayKey(now) ? "Logged so far" : ""} />
            <Kpi label="This week" value={fmtHours(me.weekSeconds)} icon={<CalendarDays className="h-5 w-5" />} sub={`${fmtHours(me.weekBillableSeconds)} billable`} />
            <Kpi label="This month" value={fmtHours(me.monthSeconds)} icon={<Sparkles className="h-5 w-5" />} sub={me.byProject.length ? `${me.byProject.length} project${me.byProject.length === 1 ? "" : "s"} this week` : "No projects yet"} />
          </>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profile details */}
        <section className="card p-6" aria-label="Profile details">
          <h2 className="text-lg font-extrabold text-ink-900">Profile</h2>
          <p className="text-sm text-ink-500">How your name appears across reports and the team list.</p>
          <form onSubmit={saveProfile} className="mt-5 space-y-4" noValidate>
            <ErrorBanner message={profileError} />
            <Field label="Full name" htmlFor="pf-name"><input id="pf-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required maxLength={LIMITS.name} autoComplete="name" /></Field>
            <Field label="Job title" htmlFor="pf-title" hint="Optional. Shown under your name."><input id="pf-title" className="field" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Frontend Developer" maxLength={LIMITS.jobTitle} autoComplete="organization-title" /></Field>
            <Field label="Email" htmlFor="pf-email" hint="Email and role are managed by an administrator from the Team page."><input id="pf-email" className="field" value={user.email} disabled /></Field>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="btn btn-primary" disabled={profileBusy || !profileDirty || !name.trim()}>{profileBusy ? "Saving…" : "Save changes"}</button>
              {profileDirty && <button type="button" className="btn btn-ghost" onClick={() => { setName(user.name); setJobTitle(user.jobTitle ?? ""); }}>Reset</button>}
            </div>
          </form>
        </section>

        {/* Password */}
        <section className="card p-6" aria-label="Password">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-extrabold text-ink-900">Change password</h2>
              <p className="text-sm text-ink-500">At least 8 characters with a letter and a number. Changing it signs out every other device.</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><KeyRound className="h-5 w-5" /></span>
          </div>
          <form onSubmit={savePassword} className="mt-5 space-y-4" noValidate>
            <ErrorBanner message={pwdError} />
            <Field label="Current password" htmlFor="pw-cur"><PasswordInput id="pw-cur" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required maxLength={LIMITS.password} /></Field>
            <Field label="New password" htmlFor="pw-new">
              <PasswordInput id="pw-new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} maxLength={LIMITS.password} />
              {next && (
                <div className="mt-2 flex items-center gap-2" aria-label="Password strength">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className={cx("h-1.5 flex-1 rounded-full", i <= strength ? (strength <= 2 ? "bg-[#c7423a]" : strength <= 3 ? "bg-amber-400" : "bg-brand-500") : "bg-ink-100")} />
                  ))}
                  <span className="w-14 text-right text-xs font-semibold text-ink-500">{strength <= 2 ? "Weak" : strength <= 3 ? "Okay" : "Strong"}</span>
                </div>
              )}
            </Field>
            <Field label="Confirm new password" htmlFor="pw-conf"><PasswordInput id="pw-conf" autoComplete="new-password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} required minLength={8} maxLength={LIMITS.password} /></Field>
            <button type="submit" className="btn btn-primary" disabled={pwdBusy}>{pwdBusy ? "Saving…" : "Update password"}</button>
          </form>
        </section>
      </div>

      {/* Devices */}
      <section className="card p-6" aria-label="Signed-in devices">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-ink-900">Signed-in devices</h2>
            <p className="text-sm text-ink-500">Every browser that holds a session for your account. Sign out any you don&apos;t recognise.</p>
          </div>
          <button type="button" className="btn btn-danger" onClick={signOutEverywhere} disabled={!sessions.length}><LogOut className="h-4 w-4" /> Sign out everywhere</button>
        </div>
        <div className="mt-5 divide-y divide-line">
          {sessionsQ.loading && !sessionsQ.data ? (
            [0, 1].map((i) => <Skeleton key={i} className="my-3 h-14" />)
          ) : sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">No active sessions.</p>
          ) : (
            sessions.map((s) => {
              const d = describeDevice(s.userAgent);
              return (
                <div key={s.id} className="flex items-center gap-4 py-3.5">
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", s.current ? "bg-brand-600 text-white" : "bg-ink-50 text-ink-600")}>
                    {d.mobile ? <Smartphone className="h-[18px] w-[18px]" /> : s.current ? <Laptop className="h-[18px] w-[18px]" /> : <MonitorSmartphone className="h-[18px] w-[18px]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-900">
                      {d.label}
                      {s.current && <span className="chip chip-on text-[11px]">This device</span>}
                      {s.remember && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-500"><ShieldCheck className="h-3 w-3" /> Remembered</span>}
                    </p>
                    <p className="text-xs text-ink-500">
                      Active {relative(s.lastUsedAt)}{s.ip ? ` · ${s.ip}` : ""} · expires {toZoned(s.expiresAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  {!s.current && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => revoke(s)}>Sign out</button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

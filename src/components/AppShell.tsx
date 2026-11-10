"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFocusTrap } from "@/lib/focus";
import { Activity, BarChart3, CalendarDays, Clock3, FolderKanban, LayoutGrid, LogOut, Menu, Settings, ShieldCheck, Square, UserRound, Users, X } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
import { SystemAlerts } from "./SystemAlerts";
import { applyPrefs } from "@/lib/prefs";
import { useUser } from "@/context/UserContext";
import { useTimer } from "@/context/TimerContext";
import { useToast } from "@/context/ToastContext";
import { api, errMsg } from "@/lib/client";
import { prefetch, seed, useLiveUpdates } from "@/lib/useApi";
import type { BootstrapDTO } from "@/app/api/bootstrap/route";
import { fmtClock, fmtHours } from "@/lib/time";
import { accessKey, type Permission } from "@/lib/permissions";
import { Avatar, cx } from "./ui";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; any?: Permission[] };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/tracker", label: "Time tracker", icon: Clock3, any: ["time.track"] },
  { href: "/timesheet", label: "Timesheet", icon: CalendarDays, any: ["time.track", "time.view_all"] },
  { href: "/projects", label: "Projects", icon: FolderKanban, any: ["projects.view", "projects.manage"] },
  { href: "/reports", label: "Reports", icon: BarChart3, any: ["reports.view_own", "reports.view_all"] },
  { href: "/analytics", label: "Analytics", icon: Activity, any: ["reports.view_own", "reports.view_all"] },
  { href: "/team", label: "Team", icon: Users, any: ["users.view", "users.manage", "users.request", "users.deactivate"] },
  { href: "/roles", label: "Roles & permissions", icon: ShieldCheck, any: ["roles.manage"] },
];

export const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": { title: "Hello", subtitle: "Here is what your time looks like today." },
  "/tracker": { title: "Time tracker", subtitle: "Start a timer or log what you already did." },
  "/timesheet": { title: "Timesheet", subtitle: "Hours per project by day, week, month or year." },
  "/projects": { title: "Projects", subtitle: "What your team logs time against, and who can log it." },
  "/reports": { title: "Reports", subtitle: "Totals, trends and every entry, exportable in one click." },
  "/analytics": { title: "Analytics", subtitle: "Drill into a project or a member and see how the time was spent." },
  "/team": { title: "Team", subtitle: "Members, roles and access." },
  "/roles": { title: "Roles & permissions", subtitle: "Define what each role can do." },
  "/profile": { title: "Profile", subtitle: "Your account, password and signed-in devices." },
  "/settings": { title: "Settings", subtitle: "How the app looks and behaves on this device." },
};

/** Sign out this device: tell the server, drop per-session client state, go to the sign-in page. */
function useLogout() {
  return async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookies are cleared server-side on any outcome; continue */
    }
    try {
      sessionStorage.clear();
      localStorage.removeItem("bc:timer:active");
    } catch {
      /* ignore */
    }
    // A full page load, not a client-side navigation: it wipes everything this tab holds in
    // memory (data cache, router cache of rendered pages), so the next person to sign in
    // here never sees this person's data.
    window.location.replace("/login");
  };
}

/** Sunburst-style mark: twelve ticks around a centre, like a clock face. */
export function Logo({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center justify-center text-brand-600", className)} style={{ width: size, height: size }} aria-label="Bitsclock" role="img">
      <svg viewBox="0 0 48 48" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const r1 = i % 3 === 0 ? 9 : 13;
          // Rounded so the server and client render identical attribute strings.
          const p = (v: number) => v.toFixed(2);
          return <line key={i} x1={p(24 + Math.cos(a) * r1)} y1={p(24 + Math.sin(a) * r1)} x2={p(24 + Math.cos(a) * 21)} y2={p(24 + Math.sin(a) * 21)} />;
        })}
      </svg>
    </span>
  );
}

/** Running timer as a compact pill in the header. */
function TimerPill() {
  const { active, elapsed, stop } = useTimer();
  const { can } = useUser();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!can("time.track") || !active) return null;
  const onStop = async () => {
    setBusy(true);
    try {
      const e = await stop();
      toast.success("Timer stopped", e ? `${fmtHours(e.durationSeconds)} logged` : undefined);
      router.refresh();
    } catch (err) {
      toast.error("Couldn't stop the timer", errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-11 items-center gap-3 rounded-full border border-brand-200 bg-white pl-4 pr-1.5 shadow-card">
      <span className="live-dot" />
      <Link href="/tracker" className="hidden max-w-[11rem] truncate text-sm font-semibold text-ink-900 hover:underline sm:inline">
        {active.description || active.project?.name || "Untitled entry"}
      </Link>
      <span className="tabular text-sm font-bold text-brand-700">{fmtClock(elapsed)}</span>
      <button type="button" onClick={onStop} disabled={busy} aria-label="Stop timer" className="btn btn-icon h-8 w-8 bg-[#c7423a] text-white hover:bg-[#ad362f]">
        <Square className="h-3 w-3 fill-current" />
      </button>
    </div>
  );
}

/** The avatar goes straight to the Profile page; Settings and Sign out already live in the rail and the drawer. */
function UserMenu() {
  const { user } = useUser();
  const pathname = usePathname();
  const active = pathname === "/profile" || pathname.startsWith("/profile/");
  return (
    <Link href="/profile" title={`${user.name} · Profile`} aria-label="Profile" aria-current={active ? "page" : undefined} className="flex items-center rounded-full transition-opacity hover:opacity-90">
      <Avatar name={user.name} size="md" color={user.role.color} className={cx("ring-2", active ? "ring-ink-900" : "ring-white")} />
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, can } = useUser();
  const [drawer, setDrawer] = useState(false);
  const logout = useLogout();
  useEffect(() => setDrawer(false), [pathname]);
  // The mobile drawer is a dialog: focus moves in, Tab stays in, Esc closes, focus returns (R-034).
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, drawer);
  useEffect(() => {
    if (!drawer) return;
    drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  // Other people's and other devices' changes appear without a reload.
  useLiveUpdates(accessKey(user));

  // Apply saved display preferences, and warm the client cache with one bulk call
  // instead of a separate request per list.
  useEffect(() => {
    applyPrefs();
    api<BootstrapDTO>("/api/bootstrap")
      .then((b) => {
        if (b.projects) seed("/api/projects", { projects: b.projects });
        if (b.members) seed("/api/users", { members: b.members });
        seed("/api/time-entries/active", { entry: b.active });
      })
      .catch(() => {
        if (can("projects.view")) prefetch("/api/projects");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per session
  }, []);

  const items = NAV.filter((n) => !n.any || n.any.some((p) => can(p)));
  const meta = Object.entries(PAGE_META).find(([href]) => pathname === href || pathname.startsWith(href + "/"))?.[1];
  const isDashboard = pathname.startsWith("/dashboard");
  const title = isDashboard ? `Hello, ${user.name.split(" ")[0]}!` : meta?.title ?? "Bitsclock";
  const subtitle = meta?.subtitle ?? "";

  const railButton = (n: NavItem, labels: boolean) => {
    const active = pathname === n.href || pathname.startsWith(n.href + "/");
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        title={n.label}
        aria-label={n.label}
        aria-current={active ? "page" : undefined}
        className={cx("group flex items-center gap-3 rounded-full transition-colors", labels ? "px-2 py-1.5 hover:bg-ink-50" : "")}
      >
        <span className={cx("flex h-10 w-10 items-center justify-center rounded-full transition-colors", active ? "bg-brand-600 text-white shadow-float" : "text-ink-500 group-hover:bg-brand-50 group-hover:text-brand-600")}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={2} />
        </span>
        {labels && <span className={cx("text-sm", active ? "font-bold text-brand-600" : "font-semibold text-ink-700")}>{n.label}</span>}
      </Link>
    );
  };

  const logoutButton = (labels: boolean) => (
    <button
      type="button"
      onClick={logout}
      title="Sign out"
      aria-label="Sign out"
      className={cx("group flex cursor-pointer items-center gap-3 rounded-full transition-colors", labels ? "w-full px-2 py-1.5 hover:bg-[#fbe5e5]" : "")}
    >
      {/* Muted red at rest (like the other idle rail icons), full red on hover; arrow mirrored to point out to the left. */}
      {/* #c25550 keeps the muted look but meets 3:1 for icons (R-035). */}
      <span className="flex h-10 w-10 items-center justify-center rounded-full text-[#c25550] transition-colors group-hover:bg-[#fbe5e5] group-hover:text-[#a8352e]">
        <LogOut className="h-[19px] w-[19px] -scale-x-100" strokeWidth={2} />
      </span>
      {labels && <span className="text-sm font-semibold text-[#c7423a]">Sign out</span>}
    </button>
  );

  const rail = (
    <nav aria-label="Main" className="flex h-full flex-col items-center justify-between rounded-full bg-white px-1.5 py-3 shadow-card">
      <div className="flex min-h-0 flex-col items-center gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{items.map((n) => railButton(n, false))}</div>
      <div className="flex shrink-0 flex-col items-center gap-1.5 pt-2">
        {railButton({ href: "/settings", label: "Settings", icon: Settings }, false)}
        {logoutButton(false)}
        <div className="pb-0.5 pt-1">
          <UserMenu />
        </div>
      </div>
    </nav>
  );

  return (
    // h-dvh: the visible height on phones, where browser toolbars come and go (R-041).
    <div className="h-dvh overflow-hidden px-4 py-4 sm:px-5 lg:px-6">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white">
        Skip to content
      </a>
      <div className="flex h-full gap-4 lg:gap-6">
        {/* Left column: logo in the corner, pill rail beneath it. Fixed; only the content scrolls. */}
        <aside className="hidden h-full w-[56px] shrink-0 flex-col items-center lg:flex">
          <Link href="/dashboard" className="flex h-[56px] shrink-0 items-center" aria-label="Bitsclock home">
            <Logo size={46} />
          </Link>
          <div className="mt-5 min-h-0 w-[52px] flex-1 pb-1">{rail}</div>
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Menu" className="fade-up absolute inset-y-3 left-3 w-72 max-w-[85vw] overflow-y-auto rounded-3xl bg-white p-4 shadow-pop">
              <div className="mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Logo size={32} />
                  <span className="font-extrabold text-ink-900">Bitsclock</span>
                </span>
                <button type="button" aria-label="Close menu" className="btn btn-ghost btn-icon" onClick={() => setDrawer(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="space-y-1" aria-label="Main">
                {items.map((n) => railButton(n, true))}
                {railButton({ href: "/profile", label: "Profile", icon: UserRound }, true)}
                {railButton({ href: "/settings", label: "Settings", icon: Settings }, true)}
                {logoutButton(true)}
              </nav>
            </div>
          </div>
        )}

        <div className="flex h-full min-w-0 flex-1 flex-col">
          {/* Greeting header, aligned with the logo row. Fixed; does not scroll. */}
          <header className="mb-5 flex min-h-[56px] shrink-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <button type="button" aria-label="Open menu" className="btn btn-icon bg-white shadow-card lg:hidden" onClick={() => setDrawer(true)}>
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-[22px] font-extrabold leading-tight tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
                {subtitle && <p className="text-[13px] text-ink-500">{subtitle}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <TimerPill />
              <GlobalSearch />
              {/* The notifications bell was removed until notifications exist (R-057). */}
              <div className="lg:hidden">
                <UserMenu />
              </div>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="relative -mr-2 min-h-0 flex-1 overflow-y-auto pb-6 pr-2 focus:outline-none">
            <SystemAlerts />
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

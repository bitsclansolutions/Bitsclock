"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/focus";

/** A result id made safe for use in an element id. */
const i2id = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");
import { useRouter } from "next/navigation";
import { Activity, BarChart3, CalendarDays, Clock3, FolderKanban, LayoutGrid, Search, Settings, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useApi } from "@/lib/useApi";
import type { Permission } from "@/lib/permissions";
import type { SearchDTO } from "@/lib/search";
import { fmtHours } from "@/lib/time";
import { Avatar, ProjectDot, cx } from "./ui";

type Group = "Pages" | "Projects" | "Members" | "Entries" | "Roles";
type Result = { id: string; group: Group; title: string; hint?: string; href: string; icon: React.ReactNode };

/** Same access rules as the side menu (AppShell NAV): a page shows only if the user may open it. */
const PAGES: { label: string; href: string; icon: React.ReactNode; keywords: string; any?: Permission[] }[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutGrid className="h-4 w-4" />, keywords: "home overview" },
  { label: "Time tracker", href: "/tracker", icon: <Clock3 className="h-4 w-4" />, keywords: "timer entries log hours", any: ["time.track"] },
  { label: "Timesheet", href: "/timesheet", icon: <CalendarDays className="h-4 w-4" />, keywords: "week grid hours per day calendar", any: ["time.track", "time.view_all"] },
  { label: "Projects", href: "/projects", icon: <FolderKanban className="h-4 w-4" />, keywords: "clients work activities", any: ["projects.view", "projects.manage"] },
  { label: "Reports", href: "/reports", icon: <BarChart3 className="h-4 w-4" />, keywords: "export csv pdf totals", any: ["reports.view_own", "reports.view_all"] },
  { label: "Analytics", href: "/analytics", icon: <Activity className="h-4 w-4" />, keywords: "trends charts drill", any: ["reports.view_own", "reports.view_all"] },
  { label: "Team", href: "/team", icon: <Users className="h-4 w-4" />, keywords: "members people users", any: ["users.view", "users.manage", "users.request", "users.deactivate"] },
  { label: "Roles & permissions", href: "/roles", icon: <ShieldCheck className="h-4 w-4" />, keywords: "access rbac", any: ["roles.manage"] },
  { label: "Profile", href: "/profile", icon: <UserRound className="h-4 w-4" />, keywords: "account password devices sign out" },
  { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" />, keywords: "preferences display" },
];

/** Linear substring match; returns a score so better matches sort first. */
function score(hay: string, needle: string) {
  const h = hay.toLowerCase();
  const i = h.indexOf(needle);
  if (i < 0) return -1;
  return (i === 0 ? 2 : 1) + (h.length < 40 ? 0.5 : 0);
}

/**
 * Header search that expands into a centred overlay. Pages are filtered locally by the
 * user's permissions; entries (all time), projects, members and roles come from
 * /api/search, which applies the same row-level scoping as the list endpoints.
 */
export function GlobalSearch() {
  const router = useRouter();
  const { user, can } = useUser();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Tab stays in the overlay; focus returns to where it was when it closes (R-034).
  useFocusTrap(dialogRef, open);

  // The server searches all data (all time) within the caller's permissions; typing is debounced.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);
  const searchUrl = debounced.length >= 2 ? `/api/search?q=${encodeURIComponent(debounced.slice(0, 100))}` : null;
  const searchQ = useApi<SearchDTO>(searchUrl, { enabled: open && !!searchUrl, ttlMs: 30_000 });
  const pages = useMemo(() => PAGES.filter((p) => !p.any || p.any.some((k) => can(k))), [can]);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    const out: (Result & { s: number })[] = [];
    if (!needle) {
      return pages.slice(0, 6).map((p) => ({ id: p.href, group: "Pages" as const, title: p.label, href: p.href, icon: p.icon }));
    }
    for (const p of pages) {
      const s = Math.max(score(p.label, needle), score(p.keywords, needle));
      if (s >= 0) out.push({ id: p.href, group: "Pages", title: p.label, href: p.href, icon: p.icon, s: s + 1 });
    }
    const d = searchQ.data;
    for (const p of d?.projects ?? []) {
      out.push({ id: `p:${p.id}`, group: "Projects", title: p.name, hint: [p.kind === "activity" ? "Activity" : "Project", p.isArchived ? "Archived" : ""].filter(Boolean).join(" · "), href: `/projects?q=${encodeURIComponent(p.name)}`, icon: <ProjectDot color={p.color} />, s: score(p.name, needle) });
    }
    for (const m of d?.members ?? []) {
      out.push({ id: `m:${m.id}`, group: "Members", title: m.name, hint: [m.jobTitle || m.role.name, m.email].filter(Boolean).join(" · "), href: `/team?q=${encodeURIComponent(m.name)}`, icon: <Avatar name={m.name} size="sm" color={m.role.color} className="!h-6 !w-6 !text-[10px]" />, s: score(m.name, needle) });
    }
    for (const e of d?.entries ?? []) {
      const who = e.userId === user.id ? "" : e.user.name;
      out.push({
        id: `e:${e.id}`,
        group: "Entries",
        title: e.description || e.project?.name || "No description",
        hint: [who, e.project?.name ?? "No project", new Date(e.startTime).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }), fmtHours(e.durationSeconds)].filter(Boolean).join(" · "),
        href: can("time.track") ? `/tracker?q=${encodeURIComponent(e.description || e.project?.name || "")}` : "/timesheet",
        icon: <Clock3 className="h-4 w-4 text-ink-400" />,
        s: 0, // already newest first from the server
      });
    }
    for (const r of d?.roles ?? []) {
      out.push({ id: `r:${r.id}`, group: "Roles", title: r.name, hint: "Role", href: "/roles", icon: <ShieldCheck className="h-4 w-4" style={{ color: r.color }} />, s: score(r.name, needle) });
    }
    const order: Record<Group, number> = { Pages: 0, Entries: 1, Projects: 2, Members: 3, Roles: 4 };
    const perGroup: Partial<Record<Group, number>> = {};
    return out
      .sort((a, b) => order[a.group] - order[b.group] || b.s - a.s)
      .filter((r) => (perGroup[r.group] = (perGroup[r.group] ?? 0) + 1) <= (r.group === "Entries" ? 10 : 6))
      .slice(0, 30);
  }, [q, pages, searchQ.data, can, user.id]);

  useEffect(() => setActive(0), [q]);

  const go = (r: Result) => {
    close();
    router.push(r.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]!);
    }
  };

  const loading = open && q.trim().length >= 2 && (debounced !== q.trim() || searchQ.loading);

  return (
    <>
      {/* Collapsed header pill */}
      <button type="button" onClick={() => setOpen(true)} className="search hidden w-72 cursor-text md:flex" aria-label="Open search">
        <span className="flex-1 text-left text-sm text-ink-400">Search…</span>
        <span className="hidden rounded-md border border-ink-200 px-1.5 text-[10px] font-bold text-ink-400 lg:inline">Ctrl K</span>
        <span className="go"><Search className="h-4 w-4" /></span>
      </button>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-icon h-11 w-11 bg-white text-ink-700 shadow-card md:hidden" aria-label="Open search">
        <Search className="h-[18px] w-[18px]" />
      </button>

      {/* Expanded overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/35 px-4 pt-[10vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div ref={dialogRef} className="fade-up w-full max-w-2xl" role="dialog" aria-modal="true" aria-label="Search">
            <div className="search h-14 w-full border-none bg-white pl-5 shadow-pop">
              <Search className="h-5 w-5 shrink-0 text-ink-500" aria-hidden="true" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search pages, projects, members and entries…"
                aria-label="Search"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${i2id(results[active]!.id)}` : undefined}
                aria-autocomplete="list"
                className="!text-base"
              />
              <button type="button" onClick={close} aria-label="Close search" className="go !h-10 !w-10">
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
            <div id={listId} role="listbox" aria-label="Search results" className="card mt-3 max-h-[60vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-ink-500">{loading ? "Searching…" : `No matches for “${q}”`}</p>
              ) : (
                results.map((r, i) => {
                  const showGroup = i === 0 || results[i - 1]!.group !== r.group;
                  return (
                    <div key={r.id}>
                      {showGroup && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-400">{r.group}</p>}
                      <button
                        id={`${listId}-${i2id(r.id)}`}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        tabIndex={-1}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(r)}
                        className={cx("flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", i === active ? "bg-brand-600 text-white" : "text-ink-900 hover:bg-ink-50")}
                      >
                        <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", i === active ? "bg-white/15" : "bg-ink-50")}>{r.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{r.title}</span>
                          {r.hint && <span className={cx("block truncate text-xs", i === active ? "text-white/70" : "text-ink-500")}>{r.hint}</span>}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-400">Use ↑ ↓ to move, Enter to open, Esc to close</p>
          </div>
        </div>
      )}
    </>
  );
}

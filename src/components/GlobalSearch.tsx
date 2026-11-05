"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/focus";

/** A result id made safe for use in an element id. */
const i2id = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");
import { useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Clock3, FolderKanban, LayoutGrid, Search, Settings, ShieldCheck, Users, X } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { qs, rangeToInstants, tzName } from "@/lib/client";
import { useApi } from "@/lib/useApi";
import type { EntryDTO } from "@/lib/entries";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import { addDays, dayKey, fmtHours } from "@/lib/time";
import { Avatar, ProjectDot, cx } from "./ui";

type Result = { id: string; group: "Pages" | "Projects" | "Members" | "Entries"; title: string; hint?: string; href: string; icon: React.ReactNode };

const PAGES: { label: string; href: string; icon: React.ReactNode; keywords: string }[] = [
  { label: "Dashboard", href: "/dashboard", icon: <LayoutGrid className="h-4 w-4" />, keywords: "home overview" },
  { label: "Time tracker", href: "/tracker", icon: <Clock3 className="h-4 w-4" />, keywords: "timer entries log hours" },
  { label: "Timesheet", href: "/timesheet", icon: <CalendarDays className="h-4 w-4" />, keywords: "week grid hours per day" },
  { label: "Projects", href: "/projects", icon: <FolderKanban className="h-4 w-4" />, keywords: "clients work" },
  { label: "Reports", href: "/reports", icon: <BarChart3 className="h-4 w-4" />, keywords: "export csv pdf totals" },
  { label: "Team", href: "/team", icon: <Users className="h-4 w-4" />, keywords: "members people users" },
  { label: "Roles & permissions", href: "/roles", icon: <ShieldCheck className="h-4 w-4" />, keywords: "access rbac" },
  { label: "Settings", href: "/settings", icon: <Settings className="h-4 w-4" />, keywords: "profile password preferences" },
];

/** Linear substring match; returns a score so better matches sort first. */
function score(hay: string, needle: string) {
  const h = hay.toLowerCase();
  const i = h.indexOf(needle);
  if (i < 0) return -1;
  return (i === 0 ? 2 : 1) + (h.length < 40 ? 0.5 : 0);
}

/**
 * Header search that expands into a centred overlay. Everything it searches is
 * already cached on the client (projects, members, the last 30 days of entries),
 * so results update on every keystroke with a simple linear scan.
 */
export function GlobalSearch() {
  const router = useRouter();
  const { can } = useUser();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Tab stays in the overlay; focus returns to where it was when it closes (R-034).
  useFocusTrap(dialogRef, open);

  const entriesUrl = useMemo(() => {
    const today = new Date();
    const range = rangeToInstants(dayKey(addDays(today, -29)), dayKey(today));
    return `/api/time-entries${qs({ ...range, tz: tzName(), userId: can("time.view_all") ? "all" : "me", limit: 200 })}`;
  }, [can]);
  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects?includeArchived=1", { enabled: open && can("projects.view"), ttlMs: 60_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>("/api/users", { enabled: open && (can("users.view") || can("time.view_all") || can("reports.view_all")), ttlMs: 60_000 });
  const entriesQ = useApi<{ entries: EntryDTO[] }>(entriesUrl, { enabled: open && can("time.track"), ttlMs: 30_000 });

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
      return PAGES.filter((p) => can("time.track") || p.href !== "/tracker").slice(0, 6).map((p) => ({ id: p.href, group: "Pages" as const, title: p.label, href: p.href, icon: p.icon }));
    }
    for (const p of PAGES) {
      const s = Math.max(score(p.label, needle), score(p.keywords, needle));
      if (s >= 0) out.push({ id: p.href, group: "Pages", title: p.label, href: p.href, icon: p.icon, s: s + 1 });
    }
    for (const p of projectsQ.data?.projects ?? []) {
      const s = Math.max(score(p.name, needle), score(p.description, needle) - 0.5);
      if (s >= 0) out.push({ id: `p:${p.id}`, group: "Projects", title: p.name, hint: p.isArchived ? "Archived" : `${fmtHours(p.totalSeconds)} tracked`, href: `/projects?q=${encodeURIComponent(p.name)}`, icon: <ProjectDot color={p.color} />, s });
    }
    for (const m of membersQ.data?.members ?? []) {
      const s = Math.max(score(m.name, needle), score(m.email, needle) - 0.5, score(m.jobTitle, needle) - 0.5);
      if (s >= 0) out.push({ id: `m:${m.id}`, group: "Members", title: m.name, hint: m.jobTitle || m.role.name, href: `/team?q=${encodeURIComponent(m.name)}`, icon: <Avatar name={m.name} size="sm" color={m.role.color} className="!h-6 !w-6 !text-[10px]" />, s });
    }
    for (const e of entriesQ.data?.entries ?? []) {
      const s = Math.max(score(e.description, needle), score(e.project?.name ?? "", needle) - 0.5);
      if (s >= 0) out.push({ id: `e:${e.id}`, group: "Entries", title: e.description || e.project?.name || "No description", hint: `${e.project?.name ?? "No project"} · ${new Date(e.startTime).toLocaleDateString([], { month: "short", day: "numeric" })} · ${fmtHours(e.durationSeconds)}`, href: `/tracker?q=${encodeURIComponent(e.description || "")}`, icon: <Clock3 className="h-4 w-4 text-ink-400" />, s });
    }
    const order = { Pages: 0, Projects: 1, Members: 2, Entries: 3 };
    return out
      .sort((a, b) => order[a.group] - order[b.group] || b.s - a.s)
      .filter((r, i, arr) => arr.filter((x) => x.group === r.group).indexOf(r) < 6)
      .slice(0, 24);
  }, [q, projectsQ.data, membersQ.data, entriesQ.data, can]);

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

  const loading = open && q && (projectsQ.loading || membersQ.loading || entriesQ.loading);

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

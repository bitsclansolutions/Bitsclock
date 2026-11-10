"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, DollarSign, Grid3x3, Pencil, Plus, Sigma, SlidersHorizontal, Trash2 } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg, qs, rangeToInstants, tzName } from "@/lib/client";
import { invalidate, useApi } from "@/lib/useApi";
import type { EntryDTO } from "@/lib/entries";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import type { TimesheetProject, TimesheetResponse } from "@/app/api/timesheet/route";
import { addDays, combineDateTime, dayKey, fmtHM, fmtHours, fmtTime, fmtTimeText, initials, startOfDay, startOfMonth, startOfWeek, toISO, toZoned, zonedNow } from "@/lib/time";
import { EmptyState, ErrorBanner, Field, Kpi, LoadError, Modal, PageHeader, ProjectDot, Seg, Skeleton, cx } from "@/components/ui";
import { Select } from "@/components/Select";
import { RowMenu } from "@/components/RowMenu";
import { EntryModal } from "@/components/tracker/EntryModal";
import { DescriptionInput } from "@/components/tracker/DescriptionInput";
import { CalendarWeek } from "./CalendarWeek";
import { CalendarMonth } from "./CalendarMonth";

const NONE = "__none";
const PREFIXES = ["/api/timesheet", "/api/time-entries", "/api/dashboard", "/api/reports", "/api/projects"];
const SCOPE_KEY = "bc:timesheet:scope";
const LAYOUT_KEY = "bc:timesheet:layout";

type Scope = "day" | "week" | "month" | "year";
type Layout = "calendar" | "grid";
type Row = { id: string; name: string; color: string | null; billable: boolean; archived: boolean };
/** A grid column: a day (key YYYY-MM-DD) or, in the year view, a month (key YYYY-MM). */
type Col = { key: string; date: Date; top: string; bottom: string; isNow: boolean; muted: boolean; future: boolean };
type Cell = { key: string; projectId: string };

/** "1h 30m", "1:30", "1.5", "90m" → seconds, or null when unreadable. */
function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*m(?:in(?:ute)?s?)?)?$/);
  if (m) return Math.round(Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60);
  m = s.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/);
  if (m) return Number(m[1]) * 60;
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Math.round(Number(m[1]) * 3600);
  return null;
}

/** Compact cell value like "2:30". Shared formatter: rounding minutes on their own showed "1:60" (R-052). */
const cellHours = (seconds: number) => fmtHM(seconds);

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** Inclusive local range for a scope around an anchor date. */
function periodFor(scope: Scope, anchor: Date): { from: Date; to: Date } {
  const a = startOfDay(anchor);
  switch (scope) {
    case "day":
      return { from: a, to: a };
    case "week":
      return { from: startOfWeek(a), to: addDays(startOfWeek(a), 6) };
    case "month":
      return { from: startOfMonth(a), to: endOfMonth(a) };
    case "year":
      return { from: new Date(a.getFullYear(), 0, 1), to: new Date(a.getFullYear(), 11, 31) };
  }
}

function shift(scope: Scope, anchor: Date, dir: 1 | -1) {
  switch (scope) {
    case "day":
      return addDays(anchor, dir);
    case "week":
      return addDays(anchor, 7 * dir);
    case "month":
      return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    case "year":
      return new Date(anchor.getFullYear() + dir, 0, 1);
  }
}

function periodLabel(scope: Scope, from: Date, to: Date) {
  switch (scope) {
    case "day":
      return from.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    case "week":
      return `${from.toLocaleDateString([], { day: "numeric", month: "short" })} – ${to.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;
    case "month":
      return from.toLocaleDateString([], { month: "long", year: "numeric" });
    case "year":
      return String(from.getFullYear());
  }
}

function columnsFor(scope: Scope, from: Date, to: Date): Col[] {
  const today = dayKey(zonedNow());
  if (scope === "year") {
    const nowM = monthKey(zonedNow());
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(from.getFullYear(), i, 1);
      const key = monthKey(d);
      return { key, date: d, top: d.toLocaleDateString([], { month: "short" }), bottom: "", isNow: key === nowM, muted: false, future: key > nowM };
    });
  }
  const out: Col[] = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const key = dayKey(d);
    out.push({ key, date: d, top: d.toLocaleDateString([], { weekday: "short" }), bottom: String(d.getDate()), isNow: key === today, muted: d.getDay() === 0 || d.getDay() === 6, future: key > today });
  }
  return out;
}

export function TimesheetView() {
  const { user, can } = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const canViewAll = can("time.view_all");
  const canManageAll = can("time.manage_all");
  const canTrack = can("time.track");

  const [scope, setScope] = useState<Scope>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(zonedNow()));
  const [memberId, setMemberId] = useState("me");
  const [extraRows, setExtraRows] = useState<string[]>([]);
  const [cell, setCell] = useState<Cell | null>(null);
  const [entryModal, setEntryModal] = useState<{ entry: EntryDTO | null; defaults?: { projectId?: string; date?: string; start?: string; end?: string } } | null>(null);

  const [layout, setLayout] = useState<Layout>("calendar");
  // Locale-formatted dates differ between the server and the browser; render them only on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    try {
      const s = localStorage.getItem(SCOPE_KEY);
      if (s === "day" || s === "week" || s === "month" || s === "year") setScope(s);
      const l = localStorage.getItem(LAYOUT_KEY);
      if (l === "calendar" || l === "grid") setLayout(l);
    } catch {
      /* ignore */
    }
  }, []);
  const chooseScope = (s: Scope) => {
    setScope(s);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* ignore */
    }
  };
  const chooseLayout = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* ignore */
    }
  };
  /** Year has no calendar form; everything else follows the layout toggle. */
  const calendar = layout === "calendar" && scope !== "year";

  const { from, to } = useMemo(() => periodFor(scope, anchor), [scope, anchor]);
  const cols = useMemo(() => columnsFor(scope, from, to), [scope, from, to]);
  const isCurrent = dayKey(periodFor(scope, zonedNow()).from) === dayKey(from);
  const viewingOthers = memberId !== "me" && memberId !== user.id;
  const editable = canTrack && (!viewingOthers || canManageAll);
  const todayKey = dayKey(zonedNow());

  const range = rangeToInstants(dayKey(from), dayKey(to));
  const sheetQ = useApi<TimesheetResponse>(`/api/timesheet${qs({ from: range.from, to: range.to, tz: tzName(), userId: memberId })}`, { ttlMs: 15_000 });
  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects?includeArchived=1", { ttlMs: 60_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>(canViewAll ? "/api/users" : null, { ttlMs: 60_000 });
  // Full entries are needed to draw calendar blocks (day/week) and the day's entry list.
  const needEntries = scope === "day" || (scope === "week" && calendar);
  const dayQ = useApi<{ entries: EntryDTO[]; nextCursor: string | null }>(needEntries ? `/api/time-entries${qs({ from: range.from, to: range.to, tz: tzName(), userId: memberId, limit: 500 })}` : null, { ttlMs: 15_000 });

  const projects = useMemo(() => projectsQ.data?.projects ?? [], [projectsQ.data]);
  const members = useMemo(() => membersQ.data?.members ?? [], [membersQ.data]);
  const logProjects = useMemo(() => projects.filter((p) => !p.isArchived && (viewingOthers || p.canLog)), [projects, viewingOthers]);

  useEffect(() => setExtraRows([]), [scope, anchor, memberId]);

  /** seconds per "projectId|columnKey", plus row, column and grand totals. */
  const grid = useMemo(() => {
    const cells = new Map<string, number>();
    const counts = new Map<string, number>();
    const rowTotals = new Map<string, number>();
    const colTotals = new Map<string, number>();
    let billable = 0;
    let total = 0;
    let count = 0;
    const daysWithTime = new Set<string>();
    for (const c of sheetQ.data?.cells ?? []) {
      const pid = c.projectId ?? NONE;
      const k = scope === "year" ? c.key.slice(0, 7) : c.key;
      cells.set(`${pid}|${k}`, (cells.get(`${pid}|${k}`) ?? 0) + c.seconds);
      counts.set(`${pid}|${k}`, (counts.get(`${pid}|${k}`) ?? 0) + c.count);
      rowTotals.set(pid, (rowTotals.get(pid) ?? 0) + c.seconds);
      colTotals.set(k, (colTotals.get(k) ?? 0) + c.seconds);
      billable += c.billableSeconds;
      total += c.seconds;
      count += c.count;
      if (c.seconds > 0) daysWithTime.add(c.key);
    }
    return { cells, counts, rowTotals, colTotals, total, billable, count, daysLogged: daysWithTime.size };
  }, [sheetQ.data, scope]);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map<string, TimesheetProject | ProjectDTO>();
    for (const p of sheetQ.data?.projects ?? []) byId.set(p.id, p);
    for (const p of projects) byId.set(p.id, p);
    const ids = new Set<string>([...grid.rowTotals.keys(), ...extraRows]);
    const out: Row[] = [];
    for (const id of ids) {
      if (id === NONE) continue;
      const p = byId.get(id);
      out.push({ id, name: p?.name ?? "Project", color: p?.color ?? null, billable: p?.billable ?? false, archived: p?.isArchived ?? false });
    }
    out.sort((a, b) => (grid.rowTotals.get(b.id) ?? 0) - (grid.rowTotals.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    if (grid.rowTotals.has(NONE) || extraRows.includes(NONE)) out.push({ id: NONE, name: "No project", color: null, billable: false, archived: false });
    return out;
  }, [sheetQ.data, projects, grid.rowTotals, extraRows]);

  const addableProjects = useMemo(() => {
    const present = new Set(rows.map((r) => r.id));
    return [...logProjects.filter((p) => !present.has(p.id)).map((p) => ({ value: p.id, label: p.name, color: p.color as string | null })), ...(present.has(NONE) ? [] : [{ value: NONE, label: "No project", color: null as string | null }])];
  }, [logProjects, rows]);

  const busiest = useMemo(() => {
    let best: { key: string; secs: number } | null = null;
    for (const [key, secs] of grid.colTotals) if (secs > 0 && (!best || secs > best.secs)) best = { key, secs };
    if (!best) return null;
    const col = cols.find((c) => c.key === best!.key);
    const label = scope === "year" ? col?.date.toLocaleDateString([], { month: "long" }) : scope === "day" ? "Today" : col?.date.toLocaleDateString([], scope === "month" ? { weekday: "short", day: "numeric" } : { weekday: "long" });
    return { label: label ?? best.key, secs: best.secs };
  }, [grid.colTotals, cols, scope]);

  const loading = sheetQ.loading && !sheetQ.data;
  const afterMutation = () => invalidate(...PREFIXES);

  const removeEntry = async (e: EntryDTO) => {
    const ok = await confirm({ title: "Delete this entry?", body: <>“{e.description || e.project?.name || "Untitled"}” ({fmtHours(e.durationSeconds)}) will be removed for good.</>, ok: "Delete", danger: true });
    if (!ok) return;
    try {
      await api(`/api/time-entries/${e.id}`, { method: "DELETE" });
      afterMutation();
      toast.success("Entry deleted");
    } catch (err) {
      toast.error("Couldn't delete the entry", errMsg(err));
    }
  };

  const openCell = (col: Col, r: Row) => {
    if (scope === "year") {
      setAnchor(col.date);
      chooseScope("month");
      return;
    }
    setCell({ key: col.key, projectId: r.id });
  };

  const memberName = memberId === "me" ? user.name : (members.find((m) => m.id === memberId)?.name ?? user.name);
  const cellRow = cell ? rows.find((r) => r.id === cell.projectId) : null;
  const allEntries = useMemo(() => dayQ.data?.entries ?? [], [dayQ.data]);
  const dayEntries = useMemo(() => allEntries.filter((e) => !e.running).sort((a, b) => a.startTime.localeCompare(b.startTime)), [allEntries]);

  /** Click on an empty calendar slot: a one-hour entry from there, never ending in the future. */
  const openSlot = (key: string, minute: number) => {
    let start = combineDateTime(key, { h: Math.floor(minute / 60), m: minute % 60 });
    let end = new Date(start.getTime() + 3600_000);
    const now = zonedNow();
    if (end > now) {
      end = new Date(Math.floor(now.getTime() / 60000) * 60000);
      if (end.getTime() - start.getTime() < 5 * 60000) start = new Date(end.getTime() - 15 * 60000);
    }
    setEntryModal({ entry: null, defaults: { date: key, start: fmtTimeText(start), end: fmtTimeText(end) } });
  };

  const scopeSubtitle: Record<Scope, string> = calendar
    ? {
        day: "The day hour by hour. Click an empty slot to log time, or an entry to edit it.",
        week: "The week hour by hour. Click an empty slot to log time, or an entry to edit it.",
        month: "A calendar of the month with each day's total. Click a day to open it.",
        year: "Hours per project for each month. Click a month to open it.",
      }
    : {
        day: "Every entry of the day, with hours per project.",
        week: "Hours per project for each day of the week. Click a cell to log or edit time.",
        month: "Hours per project for each day of the month. Click a cell to log or edit time.",
        year: "Hours per project for each month. Click a month to open it.",
      };
  const scopeDenominator = scope === "day" ? 1 : scope === "week" ? 7 : scope === "month" ? cols.length : 365;
  const compact = scope === "month";

  return (
    <>
      <PageHeader
        title="Timesheet"
        subtitle={viewingOthers ? `${memberName}'s time. ${scopeSubtitle[scope]}` : scopeSubtitle[scope]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Seg value={scope} onChange={chooseScope} label="Period" options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }]} />
            <span className="mx-1 hidden h-6 w-px bg-ink-100 sm:block" aria-hidden />
            <button type="button" className="btn btn-secondary btn-icon" aria-label={`Previous ${scope}`} onClick={() => setAnchor((a) => shift(scope, a, -1))}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="btn btn-secondary" onClick={() => setAnchor(startOfDay(zonedNow()))} disabled={isCurrent}>{scope === "day" ? "Today" : `This ${scope}`}</button>
            <button type="button" className="btn btn-secondary btn-icon" aria-label={`Next ${scope}`} onClick={() => setAnchor((a) => shift(scope, a, 1))} disabled={dayKey(shift(scope, from, 1)) > todayKey}><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex items-center gap-2 text-base font-extrabold text-ink-900"><CalendarDays className="h-4 w-4 text-brand-600" /> {mounted ? periodLabel(scope, from, to) : <span className="skeleton inline-block h-5 w-40 rounded-md align-middle" />}</p>
        <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
          {canViewAll && (
            <Select
              label="Member"
              value={memberId}
              onChange={setMemberId}
              className="w-56"
              options={[{ value: "me", label: "Me", avatar: user.name }, ...members.filter((m) => m.id !== user.id).map((m) => ({ value: m.id, label: m.name, avatar: m.name, hint: m.isActive ? m.jobTitle || undefined : "Deactivated" }))]}
              searchPlaceholder="Search members…"
            />
          )}
          {editable && scope !== "year" && !calendar && addableProjects.length > 0 && (
            <Select label="Add a project row" value="" onChange={(v) => v && setExtraRows((r) => (r.includes(v) ? r : [...r, v]))} className="w-56" placeholder="Add project row…" options={addableProjects} searchPlaceholder="Search projects…" />
          )}
          {scope !== "year" && (
            <Seg value={layout} onChange={chooseLayout} label="Layout" options={[{ value: "calendar", label: <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Calendar</span> }, { value: "grid", label: <span className="inline-flex items-center gap-1.5"><Grid3x3 className="h-3.5 w-3.5" /> Grid</span> }]} />
          )}
        </div>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi accent label={scope === "day" ? "Today" : `This ${scope}`} value={fmtHours(grid.total)} sub={`${grid.count} entr${grid.count === 1 ? "y" : "ies"}`} icon={<Sigma className="h-5 w-5" />} />
        <Kpi label="Billable" value={fmtHours(grid.billable)} sub={grid.total ? `${Math.round((grid.billable / grid.total) * 100)}% of the ${scope}` : "Nothing logged yet"} icon={<DollarSign className="h-5 w-5" />} />
        <Kpi label="Days logged" value={`${grid.daysLogged} / ${scopeDenominator}`} sub={grid.daysLogged ? `${fmtHours(grid.total / grid.daysLogged)} per logged day` : "No days yet"} icon={<CalendarDays className="h-5 w-5" />} />
        <Kpi label={scope === "year" ? "Busiest month" : scope === "day" ? "Projects" : "Busiest day"} value={scope === "day" ? rows.filter((r) => grid.rowTotals.get(r.id)).length : (busiest?.label ?? "—")} sub={scope === "day" ? "with time today" : busiest ? fmtHours(busiest.secs) : "Log time to see it"} icon={<Clock3 className="h-5 w-5" />} />
      </div>

      {sheetQ.error && !sheetQ.data && <LoadError className="mb-4" what="the timesheet" message={sheetQ.error} onRetry={sheetQ.refresh} />}
      {dayQ.data?.nextCursor && (
        <p role="status" className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The calendar shows the newest 500 entries. Pick one member or a single day to see every block; the totals above include everything.
        </p>
      )}

      {calendar && (scope === "day" || scope === "week") ? (
        dayQ.loading && !dayQ.data ? (
          <Skeleton className="h-[28rem]" />
        ) : (
          <CalendarWeek days={cols} entries={allEntries} totals={grid.colTotals} editable={editable} onSlot={openSlot} onEntry={(e) => editable && setEntryModal({ entry: e })} />
        )
      ) : calendar && scope === "month" ? (
        loading ? (
          <Skeleton className="h-[28rem]" />
        ) : (
          <CalendarMonth
            monthStart={from}
            cells={sheetQ.data?.cells ?? []}
            projects={sheetQ.data?.projects ?? []}
            onDay={(d) => {
              setAnchor(d);
              chooseScope("day");
            }}
          />
        )
      ) : loading ? (
        <Skeleton className="h-72" />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<CalendarDays className="h-6 w-6" />} title={`Nothing logged this ${scope === "day" ? "day" : scope}`} body={editable && scope !== "year" ? "Add a project row above, then click a day to log hours." : `${memberName} has no entries in this period.`} />
        </div>
      ) : (
        <div className={cx("card overflow-x-auto p-2 transition-opacity", sheetQ.stale && "opacity-80")}>
          <table className={cx("w-full border-separate border-spacing-0 text-sm", scope === "day" ? "min-w-[520px]" : scope === "month" ? "min-w-[1500px]" : "min-w-[820px]")}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-4 pb-2 pt-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">Project</th>
                {cols.map((c) => (
                  <th key={c.key} className={cx("pb-2 pt-2 text-center text-[11px] font-semibold uppercase tracking-wide", compact ? "px-0.5" : "px-2", c.isNow ? "text-brand-700" : c.muted ? "text-ink-400" : "text-ink-500")}>
                    <span className="block">{c.top}</span>
                    {c.bottom && <span className={cx("mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold normal-case tracking-normal", c.isNow ? "bg-brand-600 text-white" : "text-ink-800")}>{c.bottom}</span>}
                  </th>
                ))}
                <th className="px-3 pb-2 pt-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="group">
                  <td className="sticky left-0 z-10 rounded-l-2xl bg-white px-4 py-2 group-hover:bg-ink-50">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-extrabold text-white" style={{ background: r.color ?? "#9aa0a9" }} aria-hidden>{r.id === NONE ? "—" : initials(r.name)}</span>
                      <div className="min-w-0">
                        <p className="truncate font-bold text-ink-900">{r.name}</p>
                        <p className="text-[11px] text-ink-500">{r.archived ? "Archived" : r.billable ? "Billable" : "Non-billable"}</p>
                      </div>
                    </div>
                  </td>
                  {cols.map((c) => {
                    const secs = grid.cells.get(`${r.id}|${c.key}`) ?? 0;
                    const canOpen = secs > 0 || (editable && !c.future && !r.archived && scope !== "year");
                    return (
                      <td key={c.key} className={cx("group-hover:bg-ink-50", compact ? "p-0.5" : "p-1", c.muted && "bg-ink-50/60")}>
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => openCell(c, r)}
                          aria-label={`${r.name}, ${scope === "year" ? c.date.toLocaleDateString([], { month: "long" }) : c.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}: ${secs ? fmtHours(secs) : "no time"}`}
                          className={cx(
                            "tabular flex w-full items-center justify-center rounded-xl font-bold transition-colors",
                            compact ? "h-10 text-[12px]" : "h-11 text-sm",
                            secs > 0 ? "bg-brand-50 text-brand-800 hover:bg-brand-100" : canOpen ? "text-ink-300 hover:bg-white hover:text-ink-700 hover:shadow-card" : "text-ink-200",
                          )}
                        >
                          {secs > 0 ? (scope === "year" ? fmtHours(secs) : cellHours(secs)) : canOpen ? <Plus className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" /> : "·"}
                        </button>
                      </td>
                    );
                  })}
                  <td className="tabular rounded-r-2xl px-3 py-2 text-right font-extrabold text-ink-900 group-hover:bg-ink-50">{grid.rowTotals.get(r.id) ? fmtHours(grid.rowTotals.get(r.id)!) : <span className="text-ink-300">0h</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 bg-white px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{scope === "year" ? "Month total" : "Day total"}</td>
                {cols.map((c) => {
                  const secs = grid.colTotals.get(c.key) ?? 0;
                  const strong = scope === "year" ? secs > 0 : secs >= 8 * 3600;
                  return (
                    <td key={c.key} className={cx("pb-2 pt-3 text-center", compact ? "px-0.5" : "px-1")}>
                      <span className={cx("tabular inline-flex justify-center rounded-full px-2 py-1 font-extrabold", compact ? "min-w-[2.75rem] text-[11px]" : "min-w-[3.5rem] text-xs", strong ? "bg-brand-700 text-white" : secs > 0 ? "bg-ink-100 text-ink-900" : "text-ink-300")}>
                        {secs ? (scope === "year" ? fmtHours(secs) : cellHours(secs)) : scope === "year" ? "0h" : "0:00"}
                      </span>
                    </td>
                  );
                })}
                <td className="tabular px-3 pb-2 pt-3 text-right text-base font-extrabold text-ink-900">{fmtHours(grid.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {scope === "day" && (
        <section className="card mt-5 p-5" aria-label="Entries of the day">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-extrabold text-ink-900">Entries</h2>
              <p className="text-sm text-ink-500">Everything logged on {from.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}, in time order.</p>
            </div>
            {editable && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setEntryModal({ entry: null, defaults: { date: dayKey(from) } })}><Plus className="h-4 w-4" /> Add entry</button>
            )}
          </div>
          {dayQ.loading && !dayQ.data ? (
            <Skeleton className="h-24" />
          ) : dayEntries.length === 0 ? (
            <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-500">No entries on this day.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {dayEntries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className="tabular w-28 shrink-0 text-xs font-semibold text-ink-500">{fmtTime(e.startTime)} – {e.endTime ? fmtTime(e.endTime) : "…"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">{e.description || <span className="italic text-ink-400">No description</span>}</p>
                    <p className="flex items-center gap-1.5 text-xs text-ink-500">{e.project ? <><ProjectDot color={e.project.color} /> {e.project.name}</> : "No project"}</p>
                  </div>
                  <span className="tabular text-sm font-extrabold text-ink-900">{fmtHours(e.durationSeconds)}</span>
                  {editable && (
                    <RowMenu label={`Actions for ${e.description || "entry"}`} items={[{ label: "Edit entry", icon: <Pencil className="h-4 w-4" />, onClick: () => setEntryModal({ entry: e }) }, { divider: true }, { label: "Delete entry", icon: <Trash2 className="h-4 w-4" />, onClick: () => removeEntry(e), danger: true }]} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <CellDialog
        cell={cell}
        row={cellRow ?? null}
        memberId={memberId}
        editable={editable && !cellRow?.archived}
        forUserId={viewingOthers ? memberId : undefined}
        onClose={() => setCell(null)}
        onEdit={(e) => setEntryModal({ entry: e })}
        onDelete={removeEntry}
        onExact={(defaults) => setEntryModal({ entry: null, defaults })}
        onAdded={() => {
          afterMutation();
          toast.success("Time logged");
        }}
      />

      <EntryModal
        open={!!entryModal}
        onClose={() => setEntryModal(null)}
        entry={entryModal?.entry ?? null}
        projects={logProjects}
        forUserId={viewingOthers ? memberId : undefined}
        defaults={entryModal?.defaults}
        onSaved={() => {
          afterMutation();
          toast.success(entryModal?.entry ? "Entry updated" : "Entry added");
        }}
      />
    </>
  );
}

/** One project on one day: its entries, a quick duration add, and a link to exact times. */
function CellDialog({
  cell,
  row,
  memberId,
  editable,
  forUserId,
  onClose,
  onEdit,
  onDelete,
  onExact,
  onAdded,
}: {
  cell: Cell | null;
  row: Row | null;
  memberId: string;
  editable: boolean;
  forUserId?: string;
  onClose: () => void;
  onEdit: (e: EntryDTO) => void;
  onDelete: (e: EntryDTO) => void;
  onExact: (defaults: { projectId?: string; date: string; start: string; end: string }) => void;
  onAdded: () => void;
}) {
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dayRange = cell ? rangeToInstants(cell.key, cell.key) : null;
  const dayQ = useApi<{ entries: EntryDTO[] }>(dayRange ? `/api/time-entries${qs({ from: dayRange.from, to: dayRange.to, tz: tzName(), userId: memberId, limit: 500 })}` : null, { ttlMs: 15_000 });
  const dayEntries = useMemo(() => (dayQ.data?.entries ?? []).filter((e) => !e.running), [dayQ.data]);
  const entries = useMemo(() => (cell ? dayEntries.filter((e) => (e.projectId ?? NONE) === cell.projectId).sort((a, b) => a.startTime.localeCompare(b.startTime)) : []), [dayEntries, cell]);

  useEffect(() => {
    if (cell) {
      setDuration("");
      setDescription("");
      setError("");
    }
  }, [cell]);

  if (!cell) return null;
  const date = new Date(cell.key + "T00:00:00");
  const total = entries.reduce((a, e) => a + e.durationSeconds, 0);
  const isToday = cell.key === dayKey(zonedNow());

  /** Start the new block right after the last entry of that day, or at 09:00; never end in the future. */
  const slot = (seconds: number) => {
    const lastEnd = dayEntries.reduce<Date | null>((acc, e) => (e.endTime && (!acc || toZoned(e.endTime) > acc) ? toZoned(e.endTime) : acc), null);
    let start = lastEnd && dayKey(lastEnd) === cell.key ? lastEnd : combineDateTime(cell.key, { h: 9, m: 0 });
    let end = new Date(start.getTime() + seconds * 1000);
    if (isToday && end > zonedNow()) {
      end = toZoned(Math.floor(Date.now() / 60000) * 60000);
      start = new Date(end.getTime() - seconds * 1000);
    }
    return { start, end };
  };

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = parseDuration(duration);
    if (!seconds || seconds <= 0) {
      setError("Enter a duration like 1h 30m, 1:30 or 1.5.");
      return;
    }
    if (seconds > 24 * 3600) {
      setError("A single entry can't be longer than 24 hours.");
      return;
    }
    const { start, end } = slot(seconds);
    setBusy(true);
    setError("");
    try {
      await api("/api/time-entries", {
        method: "POST",
        json: { description, projectId: cell.projectId === NONE ? null : cell.projectId, startTime: toISO(start), endTime: toISO(end), ...(forUserId ? { userId: forUserId } : {}) },
      });
      setDuration("");
      setDescription("");
      onAdded();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const exactDefaults = () => {
    const { start, end } = slot(3600);
    return { projectId: cell.projectId === NONE ? undefined : cell.projectId, date: cell.key, start: fmtTimeText(start), end: fmtTimeText(end) };
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row?.name ?? "Time"}
      description={`${date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} · ${total ? fmtHours(total) : "nothing logged"}`}
      width="max-w-lg"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        {dayQ.loading && !dayQ.data ? (
          <Skeleton className="h-16" />
        ) : entries.length > 0 ? (
          <ul className="divide-y divide-ink-100 rounded-2xl bg-ink-50 px-3">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{e.description || <span className="italic text-ink-400">No description</span>}</p>
                  <p className="tabular text-xs text-ink-500">{fmtTime(e.startTime)} – {e.endTime ? fmtTime(e.endTime) : "…"}</p>
                </div>
                <span className="tabular text-sm font-extrabold text-ink-900">{fmtHours(e.durationSeconds)}</span>
                {editable && (
                  <span className="flex items-center">
                    <button type="button" className="btn btn-ghost btn-icon h-8 w-8" aria-label="Edit entry" onClick={() => onEdit(e)}><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="btn btn-ghost btn-icon h-8 w-8 text-red-600 hover:bg-red-50" aria-label="Delete entry" onClick={() => onDelete(e)}><Trash2 className="h-4 w-4" /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-ink-50 px-4 py-3 text-sm text-ink-500">No entries yet for this day.</p>
        )}

        {editable && (
          <form onSubmit={quickAdd} className="space-y-3" noValidate>
            <ErrorBanner message={error} />
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Field label="Hours" htmlFor="ts-dur">
                <input id="ts-dur" className="field tabular" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1h 30m" inputMode="decimal" autoFocus />
              </Field>
              <Field label="Description" htmlFor="ts-desc">
                <DescriptionInput id="ts-desc" value={description} onChange={setDescription} placeholder="What was this for? (optional)" disabled={busy} onPick={(s) => setDescription(s.description)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onExact(exactDefaults())}><SlidersHorizontal className="h-4 w-4" /> Set exact times</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}><Plus className="h-4 w-4" /> {busy ? "Adding…" : "Add time"}</button>
            </div>
            <p className="text-xs text-ink-500">Quick-added time starts right after the last entry of the day, or at 09:00.</p>
          </form>
        )}
      </div>
    </Modal>
  );
}

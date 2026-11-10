"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Clock3, DollarSign, Play, Plus, Search, Square, Trash2 } from "lucide-react";
import { readPrefs, writePrefs, TRACKER_PAGE_SIZES, TRACKER_WINDOWS, type TrackerPageSize, type TrackerWindow } from "@/lib/prefs";
import { useLatest } from "@/lib/focus";
import { LIMITS } from "@/lib/sanitize";
import { useUser } from "@/context/UserContext";
import { useTimer } from "@/context/TimerContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg, qs, rangeToInstants, tzName } from "@/lib/client";
import { invalidate, useApi } from "@/lib/useApi";
import { clearDraft, loadDraft, useDraft } from "@/lib/drafts";
import type { EntryDTO } from "@/lib/entries";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import { addDays, combineDateTime, dayKey, fmtClock, fmtHM, fmtHours, fmtTime, fmtTimeText, parseTimeText, startOfWeek, toISO, toZoned, zonedNow } from "@/lib/time";
import { EmptyState, Kpi, MiniBars, Seg, Skeleton, cx } from "@/components/ui";
import { ProjectSelect } from "@/components/ProjectSelect";
import { RowMenu } from "@/components/RowMenu";
import { Select } from "@/components/Select";
import { InlineEntryEditor } from "./InlineEntryEditor";
import { DescriptionInput } from "./DescriptionInput";

type Mode = "timer" | "manual";
type Billing = "all" | "billable" | "non_billable";
type EntriesPage = { entries: EntryDTO[]; nextCursor: string | null; total?: number; page?: number; pageCount?: number };

/** Entries loaded per batch in scroll mode. */
const SCROLL_BATCH = 50;

/**
 * The list's date range for a window choice. "All time" starts on 2 Jan 2000: the API only
 * accepts dates after 1 Jan 2000 UTC (so no entry is older), and local midnight on 1 Jan would
 * fall before that in time zones east of UTC.
 */
function windowRange(win: TrackerWindow) {
  const today = zonedNow();
  const from = win === "all" ? "2000-01-02" : win === "year" ? `${today.getFullYear()}-01-01` : dayKey(addDays(today, -(Number(win) - 1)));
  return rangeToInstants(from, dayKey(today));
}

/** Page buttons to show: first, last, and two either side of the current page, with gaps as null. */
function pageList(current: number, count: number): (number | null)[] {
  const keep = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) out.push(null);
    out.push(n);
  });
  return out;
}

const ENTRY_PREFIXES = ["/api/time-entries", "/api/timesheet", "/api/dashboard", "/api/projects", "/api/users", "/api/reports"];

/** Billable / Non-billable as a segmented toggle, like Timer / Manual. Read-only unless `canChange`. */
function BillingToggle({ billable, canChange, title, onChange }: { billable: boolean; canChange: boolean; title: string; onChange: (billable: boolean) => void }) {
  return (
    <div className="shrink-0">
      <Seg
        label="Billing"
        title={title}
        disabled={!canChange}
        value={billable ? "billable" : "non_billable"}
        onChange={(v) => onChange(v === "billable")}
        options={[
          { value: "billable", label: <><DollarSign className="h-3.5 w-3.5" /> Billable</> },
          { value: "non_billable", label: "Non-billable" },
        ]}
      />
    </div>
  );
}

function dayLabel(key: string) {
  const d = new Date(key + "T00:00:00");
  const today = dayKey(zonedNow());
  const yesterday = dayKey(addDays(zonedNow(), -1));
  const long = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
  return key === today ? `Today · ${long}` : key === yesterday ? `Yesterday · ${long}` : long;
}

export function TrackerView() {
  const { user, can } = useUser();
  const timer = useTimer();
  const toast = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const canViewAll = can("time.view_all");
  const canManageAll = can("time.manage_all");

  // Entry bar (defaults come from the saved preferences)
  const [mode, setMode] = useState<Mode>(() => readPrefs().defaultMode);
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  // Billable for the next entry: follows the chosen project's default until the chip is toggled.
  const [billable, setBillable] = useState(false);
  const [billableTouched, setBillableTouched] = useState(false);
  const [mDate, setMDate] = useState(() => dayKey(zonedNow()));
  const [mStart, setMStart] = useState(() => fmtTimeText(toZoned(Date.now() - 3600_000)));
  const [mEnd, setMEnd] = useState(() => fmtTimeText(zonedNow()));
  const [busy, setBusy] = useState(false);
  // What's typed in the entry bar survives an expired session (R-038).
  useDraft("tracker:bar", { description, projectId }, !timer.active && (description !== "" || projectId !== ""));
  useEffect(() => {
    const d = loadDraft<{ description: string; projectId: string }>("tracker:bar");
    if (d) {
      setDescription(d.description);
      setProjectId(d.projectId);
    }
  }, []);

  // Filters
  const [win, setWin] = useState<TrackerWindow>(() => readPrefs().trackerWindow);
  const [billing, setBilling] = useState<Billing>("all");
  const [memberId, setMemberId] = useState("me");
  const [filterProject, setFilterProject] = useState("");
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const viewingOthers = memberId !== "me" && memberId !== user.id;

  // How the list loads: endless scroll or numbered pages (remembered per browser).
  const [loadMode, setLoadModeState] = useState<"scroll" | "pages">(() => readPrefs().trackerLoading);
  const [pageSize, setPageSizeState] = useState<TrackerPageSize>(() => readPrefs().trackerPageSize);
  const setLoadMode = (v: "scroll" | "pages") => {
    setLoadModeState(v);
    writePrefs({ trackerLoading: v });
  };
  const setPageSize = (v: TrackerPageSize) => {
    setPageSizeState(v);
    writePrefs({ trackerPageSize: v });
  };

  // Data (cached, stale-while-revalidate)
  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects", { ttlMs: 60_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>(canViewAll ? "/api/users" : null, { ttlMs: 60_000 });
  // Every filter is applied on the server, so page counts and totals are right.
  const baseUrl = useMemo(
    () =>
      `/api/time-entries${qs({ ...windowRange(win), tz: tzName(), userId: memberId, projectId: filterProject, q: q.trim(), billable: billing === "all" ? undefined : billing, finished: "1" })}`,
    [win, memberId, filterProject, q, billing],
  );
  // Page number belongs to one filter set + page size; any change starts again at page 1.
  const pageKey = `${baseUrl}|${pageSize}`;
  const [pageState, setPageState] = useState({ key: pageKey, n: 1 });
  const pageNo = pageState.key === pageKey ? pageState.n : 1;
  const listTop = useRef<HTMLDivElement>(null);
  const goToPage = (n: number) => {
    setPageState({ key: pageKey, n });
    listTop.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const entriesUrl = loadMode === "pages" ? `${baseUrl}&page=${pageNo}&limit=${pageSize}` : `${baseUrl}&limit=${SCROLL_BATCH}`;
  const entriesQ = useApi<EntriesPage>(entriesUrl);
  // Scroll mode (R-025): the first batch comes from the cache, more is appended as you near the end.
  const [extra, setExtra] = useState<EntryDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  useEffect(() => {
    setExtra([]);
    setNextCursor(entriesQ.data?.nextCursor ?? null);
  }, [entriesQ.data]);
  const entries = useMemo(() => {
    if (!entriesQ.data) return null;
    return loadMode === "pages" ? entriesQ.data.entries : [...entriesQ.data.entries, ...extra];
  }, [entriesQ.data, extra, loadMode]);
  const loadMore = async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api<EntriesPage>(`${entriesUrl}&cursor=${encodeURIComponent(nextCursor)}`);
      setExtra((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      toast.error("Couldn't load more entries", errMsg(e));
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  };
  // Load the next batch when the end of the list scrolls near the screen.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useLatest(loadMore);
  useEffect(() => {
    if (loadMode !== "scroll" || !nextCursor) return;
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && void loadMoreRef.current(), { rootMargin: "0px 0px 400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMode, nextCursor, loadMoreRef]);

  // Today / this week figures come from their own query, so paging and filters never skew them.
  const statsUrl = useMemo(() => {
    const now = zonedNow();
    return `/api/time-entries${qs({ ...rangeToInstants(dayKey(startOfWeek(now)), dayKey(now)), tz: tzName(), userId: "me", finished: "1", limit: 500 })}`;
  }, []);
  const statsQ = useApi<EntriesPage>(statsUrl);

  // What's typed in the running timer's description (for its tooltip and counter).
  const [runningText, setRunningText] = useState("");
  useEffect(() => setRunningText(timer.active?.description ?? ""), [timer.active?.id, timer.active?.description]);

  // The entry being edited in place (its row turns into fields; no dialog).
  const [editingId, setEditingId] = useState<string | null>(null);

  // "Stop and edit" from the long-timer alert lands here with ?edit=<entry id>.
  const router = useRouter();
  const editId = searchParams.get("edit");
  useEffect(() => {
    if (!editId || !entries) return;
    const target = entries.find((e) => e.id === editId);
    if (target) setEditingId(target.id);
    router.replace("/tracker", { scroll: false });
  }, [editId, entries, router]);
  const projects = useMemo(() => projectsQ.data?.projects ?? [], [projectsQ.data]);
  const logProjects = useMemo(() => projects.filter((p) => p.canLog), [projects]);
  useEffect(() => {
    if (billableTouched) return;
    setBillable(logProjects.find((p) => p.id === projectId)?.billable ?? false);
  }, [projectId, logProjects, billableTouched]);
  // D-005: billable follows the project; only members who can edit everyone's time may override it.
  // Same segmented toggle as Timer / Manual; read-only for everyone else.
  const billableChip = (
    <BillingToggle
      billable={billable}
      canChange={canManageAll}
      title={!canManageAll ? "Set by the project" : billableTouched ? "Billing for this entry" : "Follows the project; choose to override"}
      onChange={(b) => {
        setBillableTouched(true);
        setBillable(b);
      }}
    />
  );
  /** Only send billable when it's an override someone is allowed to make; otherwise the project decides. */
  const billableField = canManageAll && billableTouched ? { billable } : {};
  const members = useMemo(() => (membersQ.data?.members ?? []).filter((m) => m.isActive), [membersQ.data]);

  // When the running timer changes elsewhere (header stop button), refresh lists.
  const lastActive = useRef(timer.active?.id);
  useEffect(() => {
    if (lastActive.current !== timer.active?.id) {
      lastActive.current = timer.active?.id;
      invalidate(...ENTRY_PREFIXES);
    }
  }, [timer.active]);

  // The list holds completed entries only; a running timer lives in the bar above and the header pill.
  // (The server already applies the billing filter and leaves out a running timer.)
  const visible = useMemo(() => (entries ?? []).filter((e) => !e.running), [entries]);
  const groups = useMemo(() => {
    const m = new Map<string, EntryDTO[]>();
    for (const e of visible) {
      const k = dayKey(e.startTime);
      (m.get(k) ?? m.set(k, []).get(k)!).push(e);
    }
    return [...m.entries()]
      .map(([key, es]) => ({ key, es, total: es.reduce((s, e) => s + e.durationSeconds, 0) }))
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [visible]);

  const stats = useMemo(() => {
    const today = dayKey(zonedNow());
    const weekStart = startOfWeek(zonedNow());
    const weekKey = dayKey(weekStart);
    const perDay = Array(7).fill(0) as number[];
    let todayS = 0,
      weekS = 0,
      billS = 0,
      weekN = 0;
    for (const e of statsQ.data?.entries ?? []) {
      if (e.userId !== user.id || e.running) continue;
      const k = dayKey(e.startTime);
      if (k === today) todayS += e.durationSeconds;
      if (k >= weekKey) {
        weekS += e.durationSeconds;
        weekN++;
        if (e.billable) billS += e.durationSeconds;
        const idx = Math.floor((toZoned(e.startTime).getTime() - weekStart.getTime()) / 86400_000);
        if (idx >= 0 && idx < 7) perDay[idx] += e.durationSeconds;
      }
    }
    if (timer.active && dayKey(timer.active.startTime) === today) todayS += timer.elapsed;
    return { todayS, weekS, billS, weekN, perDay };
  }, [statsQ.data, user.id, timer.active, timer.elapsed]);

  const manualTimes = useMemo(() => {
    const s = parseTimeText(mStart);
    const e = parseTimeText(mEnd);
    if (!s || !e) return null;
    const a = combineDateTime(mDate, s);
    let b = combineDateTime(mDate, e);
    if (b <= a) b = new Date(b.getTime() + 86400_000);
    return { a, b, seconds: (b.getTime() - a.getTime()) / 1000 };
  }, [mDate, mStart, mEnd]);

  const afterMutation = () => invalidate(...ENTRY_PREFIXES);

  const start = async () => {
    setBusy(true);
    try {
      await timer.start({ description: description.trim(), projectId: projectId || null, ...billableField });
      setDescription("");
      clearDraft("tracker:bar");
      afterMutation();
    } catch (e) {
      toast.error("Couldn't start the timer", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const e = await timer.stop();
      toast.success("Timer stopped", e ? `${fmtHours(e.durationSeconds)} logged` : undefined);
      afterMutation();
    } catch (err) {
      toast.error("Couldn't stop the timer", errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    if (!manualTimes) {
      toast.error("Check the times", "Type them like 09:00 or 2:30pm.");
      return;
    }
    setBusy(true);
    try {
      const { entry } = await api<{ entry: EntryDTO }>("/api/time-entries", {
        method: "POST",
        json: { description: description.trim(), projectId: projectId || null, ...billableField, startTime: toISO(manualTimes.a), endTime: toISO(manualTimes.b) },
      });
      setDescription("");
      clearDraft("tracker:bar");
      toast.success("Entry added", `${fmtHours(entry.durationSeconds)} on ${entry.project?.name ?? "no project"}`);
      afterMutation();
      // Suggest the next slot: same duration, starting where this entry ended. Crossing
      // midnight moves the date forward (23:00–00:00 → next day 00:00–01:00).
      const nextStart = manualTimes.b;
      const nextEnd = new Date(nextStart.getTime() + manualTimes.seconds * 1000);
      setMDate(dayKey(nextStart));
      setMStart(fmtTimeText(nextStart));
      setMEnd(fmtTimeText(nextEnd));
    } catch (e) {
      toast.error("Couldn't add the entry", errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const updateActive = async (patch: { description?: string; projectId?: string | null; billable?: boolean }) => {
    if (!timer.active) return;
    try {
      const { entry } = await api<{ entry: EntryDTO }>(`/api/time-entries/${timer.active.id}`, { method: "PATCH", json: patch });
      timer.setActive(entry);
      afterMutation();
    } catch (e) {
      toast.error("Couldn't update the timer", errMsg(e));
    }
  };

  const continueEntry = async (e: EntryDTO) => {
    if (timer.active) {
      toast.error("Stop the running timer first");
      return;
    }
    if (e.project && !logProjects.some((p) => p.id === e.project!.id)) {
      toast.error(`Can't log time on "${e.project.name}"`, e.project.isArchived ? "The project is archived." : "You're no longer on this project's team.");
      return;
    }
    try {
      await timer.start({ description: e.description, projectId: e.projectId });
      toast.success("Timer started", e.description || e.project?.name || undefined);
      afterMutation();
    } catch (err) {
      toast.error("Couldn't start the timer", errMsg(err));
    }
  };

  const remove = async (e: EntryDTO) => {
    const ok = await confirm({ title: "Delete this entry?", body: <>“{e.description || e.project?.name || "Untitled"}” ({fmtHours(e.durationSeconds)}) will be removed for good.</>, ok: "Delete", danger: true });
    if (!ok) return;
    try {
      await api(`/api/time-entries/${e.id}`, { method: "DELETE" });
      toast.success("Entry deleted");
      afterMutation();
    } catch (err) {
      toast.error("Couldn't delete", errMsg(err));
    }
  };

  const normalizeTime = (v: string, set: (s: string) => void) => {
    const t = parseTimeText(v);
    if (t) set(`${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`);
  };

  const canEdit = (e: EntryDTO) => e.userId === user.id || canManageAll;
  const active = timer.active;

  const memberOptions = useMemo(
    () => [
      { value: "me", label: "My time", avatar: user.name },
      { value: "all", label: "Everyone", color: "#1d2129" as string | null },
      ...members.filter((m) => m.id !== user.id).map((m) => ({ value: m.id, label: m.name, hint: m.jobTitle || undefined, avatar: m.name })),
    ],
    [members, user.name, user.id],
  );

  return (
    <div className="space-y-5">
      {/* Entry bar: shows the running timer with Stop, or the start/manual form. */}
      <section className="card p-3" aria-label="Timer">
        {timer.loading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-[42px] flex-1" />
            <Skeleton className="h-[42px] w-56" />
            <Skeleton className="h-[42px] w-28" />
          </div>
        ) : active ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[0.875rem] border border-brand-200 bg-brand-50 px-3.5 focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-inset focus-within:ring-brand-600">
              <span className="live-dot" />
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-brand-800">Running</span>
              <input
                key={active.id}
                aria-label="What are you working on?"
                className="h-[42px] min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink-900 outline-none"
                defaultValue={active.description}
                maxLength={LIMITS.entryDescription}
                title={runningText.length > 40 ? runningText : undefined}
                placeholder="What are you working on?"
                onInput={(e) => setRunningText(e.currentTarget.value)}
                onFocus={(e) => setRunningText(e.currentTarget.value)}
                onBlur={(e) => e.target.value.trim() !== active.description && updateActive({ description: e.target.value.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {runningText.length >= 400 && (
                <span aria-live="polite" className={cx("tabular shrink-0 text-[11px] font-bold", runningText.length >= LIMITS.entryDescription ? "text-[#b5322b]" : "text-ink-400")}>
                  {runningText.length}/{LIMITS.entryDescription}
                  <span className="sr-only"> characters used</span>
                </span>
              )}
            </div>
            <ProjectSelect className="lg:w-60" value={active.projectId ?? ""} onChange={(v) => updateActive({ projectId: v || null })} projects={active.project && !logProjects.some((p) => p.id === active.project!.id) ? [...logProjects, active.project] : logProjects} />
            <BillingToggle
              billable={active.billable}
              canChange={canManageAll}
              title={canManageAll ? "Billing for this entry" : "Set by the project"}
              onChange={(b) => b !== active.billable && updateActive({ billable: b })}
            />
            <span className="tabular min-w-[7.5rem] px-2 text-center text-[26px] font-extrabold tracking-tight text-ink-900">{fmtClock(timer.elapsed)}</span>
            <button type="button" onClick={stop} disabled={busy} className="btn btn-danger-solid min-w-[6.5rem]">
              <Square className="h-3.5 w-3.5 fill-current" /> Stop
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <DescriptionInput
              className="flex-1"
              value={description}
              onChange={setDescription}
              disabled={busy}
              onSubmit={() => (mode === "timer" ? void start() : void addManual())}
              onPick={(s) => {
                setDescription(s.description);
                if (s.projectId && logProjects.some((p) => p.id === s.projectId)) setProjectId(s.projectId);
              }}
            />
            <ProjectSelect className="xl:w-56" value={projectId} onChange={setProjectId} projects={logProjects} />
            {billableChip}
            {mode === "manual" && (
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Start time" inputMode="numeric" className="field tabular w-[5.25rem] text-center" value={mStart} onChange={(e) => setMStart(e.target.value)} onBlur={(e) => normalizeTime(e.target.value, setMStart)} placeholder="09:00" />
                <span className="text-ink-400">to</span>
                <input aria-label="End time" inputMode="numeric" className="field tabular w-[5.25rem] text-center" value={mEnd} onChange={(e) => setMEnd(e.target.value)} onBlur={(e) => normalizeTime(e.target.value, setMEnd)} placeholder="10:30" />
                <input aria-label="Date" type="date" className="field w-[10rem]" value={mDate} max={dayKey(zonedNow())} onChange={(e) => setMDate(e.target.value)} />
                <span className={cx("tabular w-[4.5rem] text-center text-sm font-extrabold", manualTimes ? "text-ink-900" : "text-[#b5322b]")}>{manualTimes ? fmtHM(manualTimes.seconds) : "—"}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Seg value={mode} onChange={setMode} label="Entry mode" options={[{ value: "timer", label: "Timer" }, { value: "manual", label: "Manual" }]} />
              {mode === "timer" ? (
                <button type="button" onClick={start} disabled={busy} className="btn btn-dark min-w-[6.5rem]">
                  <Play className="h-4 w-4 fill-current" /> Start
                </button>
              ) : (
                <button type="button" onClick={addManual} disabled={busy || !manualTimes} className="btn btn-dark min-w-[6.5rem]">
                  <Plus className="h-4 w-4" /> Add
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Stat tiles */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="My time">
        <Kpi label="Today" value={fmtHours(stats.todayS)} icon={<Clock3 className="h-5 w-5" />} sub={active ? "including the running timer" : undefined} />
        <Kpi label="This week" value={fmtHours(stats.weekS)} icon={<CalendarDays className="h-5 w-5" />} sub={`${stats.weekN} entr${stats.weekN === 1 ? "y" : "ies"}`} chart={<MiniBars values={stats.perDay} />} />
        <Kpi label="Non-billable" value={fmtHours(stats.weekS - stats.billS)} icon={<Clock3 className="h-5 w-5" />} sub="this week" />
        <Kpi accent label="Billable" value={fmtHours(stats.billS)} icon={<DollarSign className="h-5 w-5" />} sub={stats.weekS ? `${Math.round((stats.billS / stats.weekS) * 100)}% of this week` : "this week"} />
      </section>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Seg value={billing} onChange={setBilling} label="Billing" options={[{ value: "all", label: "All" }, { value: "billable", label: "Billable" }, { value: "non_billable", label: "Non-billable" }]} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="search h-[42px] w-60 pl-4">
            <Search className="h-4 w-4 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search entries" aria-label="Search entries" />
          </label>
          {canViewAll && <Select label="Member" value={memberId} onChange={setMemberId} options={memberOptions} className="w-44" searchPlaceholder="Search members…" />}
          <Select
            label="Project filter"
            value={filterProject}
            onChange={setFilterProject}
            className="w-44"
            options={[{ value: "", label: "All projects" }, { value: "none", label: "No project", color: null }, ...projects.map((p) => ({ value: p.id, label: p.name, color: p.color, hint: p.isArchived ? "Archived" : undefined }))]}
            searchPlaceholder="Search projects…"
          />
          <Select label="Window" value={win} onChange={(v) => setWin(v as TrackerWindow)} options={TRACKER_WINDOWS} className="w-40" />
          <Seg label="How entries load" value={loadMode} onChange={setLoadMode} options={[{ value: "scroll", label: "Scroll" }, { value: "pages", label: "Pages" }]} />
        </div>
      </div>

      {entriesQ.error && <p className="rounded-2xl bg-[#fbe5e5] px-4 py-3 text-sm text-[#b5322b]">{entriesQ.error}</p>}

      {/* Completed entries */}
      <div ref={listTop} className="scroll-mt-4" aria-hidden />

      {entries === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Clock3 className="h-6 w-6" />} title={active ? "Your first entry appears here once the timer stops" : "No time tracked yet"} body={q || filterProject || billing !== "all" ? "Nothing matches these filters." : `Start a timer or add an entry. Showing: ${TRACKER_WINDOWS.find((w) => w.value === win)?.label.toLowerCase() ?? "recent entries"}.`} />
        </div>
      ) : (
        <div className={cx("space-y-4 transition-opacity", entriesQ.stale && "opacity-70")}>
          {groups.map((g) => (
            <section key={g.key} className="card" aria-label={dayLabel(g.key)}>
              <header className="flex items-center justify-between px-5 pb-1 pt-4">
                <h2 className="text-sm font-extrabold text-ink-900">{dayLabel(g.key)}</h2>
                <span className="rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-700">
                  Total <span className="tabular font-extrabold text-ink-900">{fmtHours(g.total)}</span>
                </span>
              </header>
              <ul className="px-2 pb-2">
                {g.es.map((e) => {
                  const crosses = e.endTime && dayKey(e.endTime) !== dayKey(e.startTime);
                  const mine = e.userId === user.id;
                  const editable = canEdit(e);
                  if (editable && editingId === e.id) {
                    return (
                      <li key={e.id} className="py-1">
                        <InlineEntryEditor
                          entry={e}
                          projects={logProjects}
                          onCancel={() => setEditingId(null)}
                          onSaved={() => {
                            setEditingId(null);
                            afterMutation();
                            toast.success("Entry updated");
                          }}
                        />
                      </li>
                    );
                  }
                  const text = (
                    <>
                      {e.autoStopped && (
                        <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-semibold not-italic text-amber-900" title="This timer ran past 24 hours and was stopped automatically. Open it to set the real end time.">
                          Auto-stopped, please check
                        </span>
                      )}
                      {e.description || "No description"}
                    </>
                  );
                  // Up to two lines, then "…"; the full text is in the tooltip.
                  const textClass = cx("line-clamp-2 w-full break-words text-left text-sm font-bold", e.description ? "text-ink-900" : "italic text-ink-400");
                  const fullText = e.description.length > 60 ? e.description : undefined;
                  return (
                    // Click anywhere on an editable row to edit it: the description is a button whose
                    // ::after covers the row (stretched button); the play button and menu sit above it.
                    // Three columns from sm up: details | start–end (centred: the side columns are equal) | duration, billing, actions.
                    <li key={e.id} className={cx("relative flex flex-col gap-2 rounded-2xl px-3 py-2.5 transition-colors sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-6", editable && "cursor-pointer hover:bg-ink-50 has-[button[data-edit]:focus-visible]:ring-2 has-[button[data-edit]:focus-visible]:ring-inset has-[button[data-edit]:focus-visible]:ring-brand-600")}>
                      <div className="flex min-w-0 items-center gap-4">
                        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white sm:flex" style={{ background: e.project?.color ?? "#ccd0d6" }} aria-hidden="true">
                          {(e.project?.name ?? "—").slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          {editable ? (
                            <button type="button" data-edit onClick={() => setEditingId(e.id)} title={fullText ? `${fullText}\n\nClick to edit` : "Click to edit"} className={cx(textClass, "cursor-pointer focus:outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']")}>
                              {text}
                            </button>
                          ) : (
                            <p className={textClass} title={fullText}>
                              {text}
                            </p>
                          )}
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                            <span>{e.project?.name ?? "No project"}</span>
                            {(memberId === "all" || viewingOthers) && <span>· {e.user.name}</span>}
                          </p>
                        </div>
                      </div>
                      <span className="tabular whitespace-nowrap text-sm font-semibold text-ink-700 sm:text-center">
                        {fmtTime(e.startTime)} – {fmtTime(e.endTime!)}
                        {crosses && <sup className="ml-0.5 text-[10px] text-ink-400">+1</sup>}
                      </span>
                      <div className="flex items-center justify-between gap-6 sm:justify-end">
                        <span className="tabular w-16 text-right text-sm font-extrabold text-ink-900">{fmtHours(e.durationSeconds)}</span>
                        <span className="flex w-24 justify-center">
                          <span className={e.billable ? "delta-up" : "text-xs text-ink-400"}>{e.billable ? "Billable" : "Non-billable"}</span>
                        </span>
                        <div className="relative z-10 flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Start a new timer from this entry"
                            title={timer.active ? "Stop the running timer first" : "Start a new timer with this entry's details"}
                            disabled={!!timer.active || !mine}
                            onClick={() => continueEntry(e)}
                            className="btn btn-icon h-9 w-9 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:bg-ink-50 disabled:text-ink-300"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </button>
                          {editable ? (
                            <RowMenu label="Entry actions" items={[{ label: "Delete entry", icon: <Trash2 className="h-4 w-4" />, onClick: () => remove(e), danger: true }]} />
                          ) : (
                            <span className="w-8" />
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {loadMode === "scroll" && entries !== null && groups.length > 0 && (
        // Scroll mode: the next batch loads when this comes near the screen. The button is a
        // fallback for keyboards and old browsers.
        <div ref={sentinel} className="flex justify-center py-1" aria-live="polite">
          {nextCursor ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading more entries…" : "Load more entries"}
            </button>
          ) : (
            <p className="text-xs text-ink-400">That&apos;s everything in this range.</p>
          )}
        </div>
      )}

      {loadMode === "pages" && entriesQ.data?.total !== undefined && entriesQ.data.total > 0 && (
        <nav aria-label="Entry pages" className="card flex flex-col items-center gap-3 px-4 py-3 sm:flex-row sm:justify-between">
          <p className="tabular text-sm text-ink-500">
            Showing <span className="font-bold text-ink-900">{(pageNo - 1) * Number(pageSize) + 1}–{Math.min(pageNo * Number(pageSize), entriesQ.data.total)}</span> of{" "}
            <span className="font-bold text-ink-900">{entriesQ.data.total}</span> entries
          </p>
          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goToPage(pageNo - 1)} disabled={pageNo <= 1} aria-label="Previous page">
              ‹ Prev
            </button>
            {pageList(pageNo, entriesQ.data.pageCount ?? 1).map((n, i) =>
              n === null ? (
                <span key={`gap${i}`} className="px-1 text-ink-400" aria-hidden>
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => goToPage(n)}
                  aria-label={`Page ${n}`}
                  aria-current={n === pageNo ? "page" : undefined}
                  className={cx("btn btn-sm tabular min-w-[2.125rem] px-2", n === pageNo ? "btn-primary" : "btn-ghost")}
                >
                  {n}
                </button>
              ),
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goToPage(pageNo + 1)} disabled={pageNo >= (entriesQ.data.pageCount ?? 1)} aria-label="Next page">
              Next ›
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-500">
            Rows per page
            <Select label="Rows per page" value={pageSize} onChange={(v) => setPageSize(v as TrackerPageSize)} options={TRACKER_PAGE_SIZES.map((n) => ({ value: n, label: n }))} className="w-20" />
          </label>
        </nav>
      )}

    </div>
  );
}

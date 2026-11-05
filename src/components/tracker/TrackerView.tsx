"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Clock3, DollarSign, Pencil, Play, Plus, Search, Square, Trash2 } from "lucide-react";
import { readPrefs } from "@/lib/prefs";
import { useUser } from "@/context/UserContext";
import { useTimer } from "@/context/TimerContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg, qs, rangeToInstants, tzName } from "@/lib/client";
import { invalidate, useApi } from "@/lib/useApi";
import type { EntryDTO } from "@/lib/entries";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import { addDays, combineDateTime, dayKey, fmtClock, fmtHM, fmtHours, fmtTime, fmtTimeText, parseTimeText, startOfWeek } from "@/lib/time";
import { EmptyState, Kpi, MiniBars, Seg, Skeleton, cx } from "@/components/ui";
import { ProjectSelect } from "@/components/ProjectSelect";
import { RowMenu } from "@/components/RowMenu";
import { Select } from "@/components/Select";
import { EntryModal } from "./EntryModal";
import { DescriptionInput } from "./DescriptionInput";

type Mode = "timer" | "manual";
type Window = "7" | "14" | "30";
type Billing = "all" | "billable" | "non_billable";

const ENTRY_PREFIXES = ["/api/time-entries", "/api/timesheet", "/api/dashboard", "/api/projects", "/api/users", "/api/reports"];

function dayLabel(key: string) {
  const d = new Date(key + "T00:00:00");
  const today = dayKey(new Date());
  const yesterday = dayKey(addDays(new Date(), -1));
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
  const [mDate, setMDate] = useState(() => dayKey(new Date()));
  const [mStart, setMStart] = useState(() => fmtTimeText(new Date(Date.now() - 3600_000)));
  const [mEnd, setMEnd] = useState(() => fmtTimeText(new Date()));
  const [busy, setBusy] = useState(false);

  // Filters
  const [win, setWin] = useState<Window>(() => readPrefs().trackerWindow);
  const [billing, setBilling] = useState<Billing>("all");
  const [memberId, setMemberId] = useState("me");
  const [filterProject, setFilterProject] = useState("");
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [modal, setModal] = useState<{ entry: EntryDTO | null } | null>(null);
  const viewingOthers = memberId !== "me" && memberId !== user.id;

  // Data (cached, stale-while-revalidate)
  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects", { ttlMs: 60_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>(canViewAll ? "/api/users" : null, { ttlMs: 60_000 });
  const entriesUrl = useMemo(() => {
    const today = new Date();
    const range = rangeToInstants(dayKey(addDays(today, -(Number(win) - 1))), dayKey(today));
    return `/api/time-entries${qs({ ...range, tz: tzName(), userId: memberId, projectId: filterProject, q: q.trim() })}`;
  }, [win, memberId, filterProject, q]);
  const entriesQ = useApi<{ entries: EntryDTO[] }>(entriesUrl);
  const entries = entriesQ.data?.entries ?? null;
  const projects = useMemo(() => projectsQ.data?.projects ?? [], [projectsQ.data]);
  const logProjects = useMemo(() => projects.filter((p) => p.canLog), [projects]);
  useEffect(() => {
    if (billableTouched) return;
    setBillable(logProjects.find((p) => p.id === projectId)?.billable ?? false);
  }, [projectId, logProjects, billableTouched]);
  const billableChip = (
    <button
      type="button"
      className={cx("chip shrink-0", billable && "on")}
      aria-pressed={billable}
      title={billableTouched ? "Billing for this entry" : "Follows the project; click to override"}
      onClick={() => {
        setBillableTouched(true);
        setBillable((b) => !b);
      }}
    >
      <DollarSign className="h-3.5 w-3.5" /> {billable ? "Billable" : "Non-billable"}
    </button>
  );
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
  const completed = useMemo(() => (entries ?? []).filter((e) => !e.running), [entries]);
  const visible = useMemo(() => completed.filter((e) => (billing === "all" ? true : billing === "billable" ? e.billable : !e.billable)), [completed, billing]);
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
    const today = dayKey(new Date());
    const weekStart = startOfWeek(new Date());
    const weekKey = dayKey(weekStart);
    const perDay = Array(7).fill(0) as number[];
    let todayS = 0,
      weekS = 0,
      billS = 0,
      weekN = 0;
    for (const e of completed) {
      if (e.userId !== user.id) continue;
      const k = dayKey(e.startTime);
      if (k === today) todayS += e.durationSeconds;
      if (k >= weekKey) {
        weekS += e.durationSeconds;
        weekN++;
        if (e.billable) billS += e.durationSeconds;
        const idx = Math.floor((new Date(e.startTime).getTime() - weekStart.getTime()) / 86400_000);
        if (idx >= 0 && idx < 7) perDay[idx] += e.durationSeconds;
      }
    }
    if (timer.active && dayKey(timer.active.startTime) === today) todayS += timer.elapsed;
    return { todayS, weekS, billS, weekN, perDay };
  }, [completed, user.id, timer.active, timer.elapsed]);

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
      await timer.start({ description: description.trim(), projectId: projectId || null, billable });
      setDescription("");
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
        json: { description: description.trim(), projectId: projectId || null, billable, startTime: manualTimes.a.toISOString(), endTime: manualTimes.b.toISOString() },
      });
      setDescription("");
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
      { value: "all", label: "Everyone", color: "#1e2a24" as string | null },
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
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[0.875rem] border border-brand-200 bg-brand-50 px-3.5">
              <span className="live-dot" />
              <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-brand-800">Running</span>
              <input
                key={active.id}
                aria-label="What are you working on?"
                className="h-[42px] min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink-900 outline-none"
                defaultValue={active.description}
                placeholder="What are you working on?"
                onBlur={(e) => e.target.value.trim() !== active.description && updateActive({ description: e.target.value.trim() })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </div>
            <ProjectSelect className="lg:w-60" value={active.projectId ?? ""} onChange={(v) => updateActive({ projectId: v || null })} projects={active.project && !logProjects.some((p) => p.id === active.project!.id) ? [...logProjects, active.project] : logProjects} />
            <button type="button" className={cx("chip shrink-0", active.billable && "on")} aria-pressed={active.billable} title="Billing for this entry" onClick={() => updateActive({ billable: !active.billable })}>
              <DollarSign className="h-3.5 w-3.5" /> {active.billable ? "Billable" : "Non-billable"}
            </button>
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
                <input aria-label="Date" type="date" className="field w-[10rem]" value={mDate} max={dayKey(new Date())} onChange={(e) => setMDate(e.target.value)} />
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
          <Select label="Window" value={win} onChange={(v) => setWin(v as Window)} options={[{ value: "7", label: "Last 7 days" }, { value: "14", label: "Last 14 days" }, { value: "30", label: "Last 30 days" }]} className="w-36" />
          {(canManageAll || !viewingOthers) && (
            <button type="button" className="btn btn-secondary" onClick={() => setModal({ entry: null })}>
              <Plus className="h-4 w-4" /> Add entry
            </button>
          )}
        </div>
      </div>

      {entriesQ.error && <p className="rounded-2xl bg-[#fbe5e5] px-4 py-3 text-sm text-[#b5322b]">{entriesQ.error}</p>}

      {/* Completed entries */}
      {entries === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Clock3 className="h-6 w-6" />} title={active ? "Your first entry appears here once the timer stops" : "No time tracked yet"} body={q || filterProject || billing !== "all" ? "Nothing matches these filters." : `Start a timer or add an entry. The last ${win} days show here.`} />
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
                  return (
                    <li key={e.id} className="flex flex-col gap-2 rounded-2xl px-3 py-2.5 transition-colors hover:bg-ink-50 sm:flex-row sm:items-center sm:gap-4">
                      <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white sm:flex" style={{ background: e.project?.color ?? "#c3cac6" }} aria-hidden="true">
                        {(e.project?.name ?? "—").slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cx("truncate text-sm font-bold", e.description ? "text-ink-900" : "italic text-ink-400")}>{e.description || "No description"}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                          <span>{e.project?.name ?? "No project"}</span>
                          {(memberId === "all" || viewingOthers) && <span>· {e.user.name}</span>}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-5">
                        <span className="tabular text-xs text-ink-500">
                          {fmtTime(e.startTime)} – {fmtTime(e.endTime!)}
                          {crosses && <sup className="ml-0.5 text-[10px] text-ink-400">+1</sup>}
                        </span>
                        <span className="tabular w-16 text-right text-sm font-extrabold text-ink-900">{fmtHours(e.durationSeconds)}</span>
                        <span className={cx("w-24 text-center", e.billable ? "delta-up" : "text-xs text-ink-400")}>{e.billable ? "Billable" : "Non-billable"}</span>
                        <div className="flex items-center gap-1">
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
                          {canEdit(e) ? (
                            <RowMenu
                              label="Entry actions"
                              items={[
                                { label: "Edit entry", icon: <Pencil className="h-4 w-4" />, onClick: () => setModal({ entry: e }) },
                                { divider: true as const },
                                { label: "Delete entry", icon: <Trash2 className="h-4 w-4" />, onClick: () => remove(e), danger: true },
                              ]}
                            />
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

      <EntryModal
        open={!!modal}
        onClose={() => setModal(null)}
        entry={modal?.entry ?? null}
        projects={logProjects}
        forUserId={viewingOthers && memberId !== "all" ? memberId : undefined}
        onSaved={() => {
          afterMutation();
          toast.success(modal?.entry ? "Entry updated" : "Entry added");
        }}
      />
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Clock3, DollarSign, Hash, TrendingUp, X } from "lucide-react";
import { HoursBars, TrendArea } from "@/components/charts";
import { useUser } from "@/context/UserContext";
import { qs, rangeToInstants, tzName } from "@/lib/client";
import { useApi } from "@/lib/useApi";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import type { ReportResponse } from "@/app/api/reports/route";
import type { BillableFilter, ReportData } from "@/lib/reports";
import type { EntryDTO } from "@/lib/entries";
import { PERIODS, dayKey, dayLabel, daysInRange, fmtHours, fmtTime, periodRange, type PeriodKey } from "@/lib/time";
import { Avatar, EmptyState, ProjectDot, Skeleton, cx } from "@/components/ui";
import { Select } from "@/components/Select";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pct(now: number, before: number) {
  if (!before) return now ? 100 : 0;
  return Math.round(((now - before) / before) * 100);
}

/** KPI with a change pill against the previous period. */
function Stat({ label, value, icon, delta, hint, accent = false }: { label: string; value: string; icon: React.ReactNode; delta: number | null; hint: string; accent?: boolean }) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className={cx(accent ? "card-accent" : "card", "flex items-center gap-4 px-5 py-4")}>
      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", accent ? "bg-white/15 text-white" : "bg-brand-50 text-brand-700")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cx("text-[13px] font-medium", accent ? "text-white/80" : "text-ink-500")}>{label}</p>
        <div className="flex items-center gap-2">
          <p className={cx("tabular text-[22px] font-extrabold leading-tight tracking-tight", accent ? "text-white" : "text-ink-900")}>{value}</p>
          {delta !== null && (
            <span className={cx(accent ? "inline-flex items-center rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white" : up ? "delta-up" : "delta-down")}>
              {up ? <ArrowUpRight className="mr-0.5 h-3 w-3" /> : <ArrowDownRight className="mr-0.5 h-3 w-3" />}
              {Math.abs(delta)}%
            </span>
          )}
        </div>
        <p className={cx("mt-0.5 truncate text-xs", accent ? "text-white/70" : "text-ink-500")}>{hint}</p>
      </div>
    </div>
  );
}

/** Align this period and the previous one day-by-day for the trend chart. */
function trendSeries(now: ReportData["byDay"], prev: ReportData["byDay"] | undefined, from: string, to: string) {
  const days = daysInRange(from, to);
  const nowMap = new Map(now.map((d) => [d.key, d.seconds]));
  const prevSorted = prev ? [...prev].sort((a, b) => a.key.localeCompare(b.key)) : [];
  const prevByOffset = new Map<number, number>();
  if (prev) {
    const prevStart = new Date(from + "T00:00:00");
    prevStart.setDate(prevStart.getDate() - days);
    for (const d of prevSorted) {
      const off = Math.round((new Date(d.key + "T00:00:00").getTime() - prevStart.getTime()) / 86400_000);
      prevByOffset.set(off, d.seconds);
    }
  }
  const out: { label: string; current: number; previous: number }[] = [];
  const cursor = new Date(from + "T00:00:00");
  for (let i = 0; i < days; i++) {
    const key = dayKey(cursor);
    out.push({
      label: cursor.toLocaleDateString([], { month: "short", day: "numeric" }),
      current: Math.round(((nowMap.get(key) ?? 0) / 3600) * 100) / 100,
      previous: Math.round(((prevByOffset.get(i) ?? 0) / 3600) * 100) / 100,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function AnalyticsView() {
  const { user, can } = useUser();
  const canAll = can("reports.view_all");

  const [period, setPeriod] = useState<PeriodKey>("this_month");
  const [range, setRange] = useState(() => periodRange("this_month"));
  const [memberId, setMemberId] = useState<string>(canAll ? "all" : "me");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState<BillableFilter>("all");
  const [focusMember, setFocusMember] = useState("");

  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects?includeArchived=1", { ttlMs: 60_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>(canAll ? "/api/users" : null, { ttlMs: 60_000 });
  const projects = useMemo(() => projectsQ.data?.projects ?? [], [projectsQ.data]);
  const members = useMemo(() => membersQ.data?.members ?? [], [membersQ.data]);

  const validRange = !!range.from && !!range.to && range.from <= range.to;
  const query = useMemo(() => qs({ ...rangeToInstants(range.from, range.to), tz: tzName(), userId: memberId, projectId, billable: billable === "all" ? "" : billable, compare: 1 }), [range, memberId, projectId, billable]);
  const reportQ = useApi<ReportResponse>(validRange ? `/api/reports${query}` : null, { ttlMs: 30_000 });
  const report = reportQ.data?.report ?? null;
  const previous = reportQ.data?.previous ?? null;

  const choosePeriod = (k: PeriodKey) => {
    setPeriod(k);
    if (k !== "custom") setRange(periodRange(k));
  };

  const focusedProject = projectId && projectId !== "none" ? projects.find((p) => p.id === projectId) ?? null : null;
  const trend = useMemo(() => (report ? trendSeries(report.byDay, previous?.byDay, range.from, range.to) : []), [report, previous, range]);

  // Client-side distributions from the entries themselves.
  const entries = useMemo(() => (report ? (focusMember ? report.entries.filter((e) => e.userId === focusMember) : report.entries) : []), [report, focusMember]);
  const weekday = useMemo(() => {
    const out = WEEKDAYS.map((label) => ({ label, hours: 0 }));
    for (const e of entries) out[(new Date(e.startTime).getDay() + 6) % 7]!.hours += e.durationSeconds / 3600;
    return out.map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 }));
  }, [entries]);
  const hours = useMemo(() => {
    const out = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}`, hours: 0 }));
    for (const e of entries) {
      // Spread each entry across the hours it covers.
      let t = new Date(e.startTime).getTime();
      const end = t + e.durationSeconds * 1000;
      while (t < end) {
        const d = new Date(t);
        const hourEnd = new Date(d).setMinutes(60, 0, 0);
        const slice = Math.min(end, hourEnd) - t;
        out[d.getHours()]!.hours += slice / 3600_000;
        t = hourEnd;
      }
    }
    return out.map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10 }));
  }, [entries]);
  const byDayGroups = useMemo(() => {
    const groups = new Map<string, EntryDTO[]>();
    for (const e of entries) {
      const k = dayKey(e.startTime);
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  }, [entries]);

  const t = report?.totals;
  const p = previous?.totals;
  const billablePct = t && t.seconds ? Math.round((t.billableSeconds / t.seconds) * 100) : 0;
  const prevBillablePct = p && p.seconds ? Math.round((p.billableSeconds / p.seconds) * 100) : 0;
  const periodLabel = PERIODS.find((x) => x.key === period)?.label ?? "Custom";
  const maxProject = report ? Math.max(1, ...report.byProject.map((x) => x.seconds)) : 1;
  const maxMember = report ? Math.max(1, ...report.byMember.map((x) => x.seconds)) : 1;

  return (
    <div className="space-y-5">
      {/* Filters: one row */}
      <section className="card flex flex-wrap items-end gap-3 p-4 xl:flex-nowrap" aria-label="Analytics filters">
        <div className="w-full min-w-[9rem] flex-1 sm:w-auto">
          <label className="label" htmlFor="a-period">Period</label>
          <Select id="a-period" value={period} onChange={(v) => choosePeriod(v as PeriodKey)} options={PERIODS.map((x) => ({ value: x.key, label: x.label }))} />
        </div>
        <div className="shrink-0">
          <label className="label" htmlFor="a-from">From</label>
          <input id="a-from" type="date" className="field w-[9.5rem]" value={range.from} max={range.to} onChange={(e) => { setPeriod("custom"); setRange({ ...range, from: e.target.value }); }} />
        </div>
        <div className="shrink-0">
          <label className="label" htmlFor="a-to">To</label>
          <input id="a-to" type="date" className="field w-[9.5rem]" value={range.to} min={range.from} onChange={(e) => { setPeriod("custom"); setRange({ ...range, to: e.target.value }); }} />
        </div>
        {canAll && (
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor="a-member">Members</label>
            <Select
              id="a-member"
              value={memberId}
              onChange={(v) => { setMemberId(v); setFocusMember(""); }}
              options={[{ value: "all", label: "Whole team", color: "#1e2a24" as string | null }, { value: "me", label: "Only me", avatar: user.name }, ...members.filter((m) => m.id !== user.id).map((m) => ({ value: m.id, label: m.name, avatar: m.name, hint: m.isActive ? m.jobTitle || undefined : "Deactivated" }))]}
              searchPlaceholder="Search members…"
            />
          </div>
        )}
        <div className="min-w-[10rem] flex-1">
          <label className="label" htmlFor="a-project">Project</label>
          <Select
            id="a-project"
            value={projectId}
            onChange={setProjectId}
            options={[{ value: "", label: "All projects" }, { value: "none", label: "No project", color: null }, ...projects.map((x) => ({ value: x.id, label: x.name, color: x.color, hint: x.isArchived ? "Archived" : undefined }))]}
            searchPlaceholder="Search projects…"
          />
        </div>
        <div className="w-[9.5rem] shrink-0">
          <label className="label" htmlFor="a-billing">Billing</label>
          <Select id="a-billing" value={billable} onChange={(v) => setBillable(v as BillableFilter)} options={[{ value: "all", label: "All entries" }, { value: "billable", label: "Billable" }, { value: "non_billable", label: "Non-billable" }]} />
        </div>
      </section>

      {reportQ.error && <p className="rounded-2xl bg-[#fbe5e5] px-4 py-3 text-sm text-[#b5322b]">{reportQ.error}</p>}

      {!report || !t ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}</div>
      ) : (
        <div className={cx("space-y-5 transition-opacity", reportQ.stale && "opacity-70")}>
          {/* Focus banner */}
          {(focusedProject || focusMember) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-500">Focused on</span>
              {focusedProject && (
                <button type="button" onClick={() => setProjectId("")} className="chip chip-on inline-flex items-center gap-1.5"><ProjectDot color={focusedProject.color} /> {focusedProject.name} <X className="h-3 w-3" /></button>
              )}
              {focusMember && (
                <button type="button" onClick={() => setFocusMember("")} className="chip chip-on inline-flex items-center gap-1.5">{report.byMember.find((m) => m.id === focusMember)?.name ?? "Member"} <X className="h-3 w-3" /></button>
              )}
            </div>
          )}

          {/* KPIs vs previous period */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total time" value={fmtHours(t.seconds)} icon={<Clock3 className="h-5 w-5" />} delta={p ? pct(t.seconds, p.seconds) : null} hint={p ? `${fmtHours(p.seconds)} in the previous ${daysInRange(range.from, range.to)} days` : periodLabel} />
            <Stat label="Billable share" value={`${billablePct}%`} icon={<DollarSign className="h-5 w-5" />} delta={p ? billablePct - prevBillablePct : null} hint={`${fmtHours(t.billableSeconds)} billable`} />
            <Stat label="Entries" value={String(t.entries)} icon={<Hash className="h-5 w-5" />} delta={p ? pct(t.entries, p.entries) : null} hint={`${t.members} member${t.members === 1 ? "" : "s"} · ${t.projects} project${t.projects === 1 ? "" : "s"}`} />
            <Stat accent label="Average per active day" value={fmtHours(t.avgPerActiveDay)} icon={<TrendingUp className="h-5 w-5" />} delta={p ? pct(t.avgPerActiveDay, p.avgPerActiveDay) : null} hint={t.busiestDay ? `Busiest ${new Date(t.busiestDay.key + "T00:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${fmtHours(t.busiestDay.seconds)}` : `${t.activeDays} active days`} />
          </div>

          {t.entries === 0 ? (
            <div className="card"><EmptyState icon={<Activity className="h-6 w-6" />} title="Nothing to analyse yet" body="No completed entries match these filters." /></div>
          ) : (
            <>
              {/* Trend vs previous period */}
              <section className="card p-5" aria-label="Trend">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-ink-900">Trend against the previous period</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-700"><span className="h-2 w-2 rounded-full bg-brand-600" /> This period <span className="ml-1 h-2 w-2 rounded-full bg-ink-300" /> Previous</span>
                </div>
                <div className="h-64">
                  <TrendArea data={trend} />
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Projects: click to focus */}
                <section className="card p-5" aria-label="Projects">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-extrabold text-ink-900">By project</h2>
                    <span className="text-xs text-ink-500">Click a project to drill in</span>
                  </div>
                  <ul className="space-y-2">
                    {report.byProject.map((x) => {
                      const prevRow = previous?.byProject.find((y) => y.id === x.id);
                      const d = prevRow ? pct(x.seconds, prevRow.seconds) : null;
                      const active = (x.id ?? "none") === projectId;
                      return (
                        <li key={x.id ?? "none"}>
                          <button type="button" onClick={() => setProjectId(active ? "" : x.id ?? "none")} className={cx("w-full cursor-pointer rounded-2xl px-3 py-2.5 text-left transition-colors", active ? "bg-ink-900 text-white" : "hover:bg-ink-50")}>
                            <div className="flex items-center gap-3">
                              <ProjectDot color={x.color} />
                              <span className="min-w-0 flex-1 truncate text-sm font-bold">{x.name}</span>
                              {d !== null && <span className={cx(active ? "text-white/80 text-[11px] font-bold" : d >= 0 ? "delta-up" : "delta-down")}>{d >= 0 ? "+" : ""}{d}%</span>}
                              <span className="tabular text-sm font-extrabold">{fmtHours(x.seconds)}</span>
                              <span className={cx("w-10 text-right text-xs", active ? "text-white/70" : "text-ink-500")}>{Math.round(x.share)}%</span>
                            </div>
                            <div className={cx("mt-1.5 h-1.5 overflow-hidden rounded-full", active ? "bg-white/20" : "bg-ink-100")}>
                              <div className="h-full rounded-full" style={{ width: `${(x.seconds / maxProject) * 100}%`, background: active ? "#fff" : x.color }} />
                            </div>
                            <p className={cx("mt-1 text-[11px]", active ? "text-white/70" : "text-ink-500")}>{x.entries} entries · {x.members} member{x.members === 1 ? "" : "s"} · {x.seconds ? Math.round((x.billableSeconds / x.seconds) * 100) : 0}% billable</p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* Members (team view) or weekday split */}
                {canAll && report.byMember.length > 1 ? (
                  <section className="card p-5" aria-label="Members">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-base font-extrabold text-ink-900">By member</h2>
                      <span className="text-xs text-ink-500">Click a member to focus the entries</span>
                    </div>
                    <ul className="space-y-1.5">
                      {report.byMember.map((m) => {
                        const prevRow = previous?.byMember.find((y) => y.id === m.id);
                        const d = prevRow ? pct(m.seconds, prevRow.seconds) : null;
                        const active = focusMember === m.id;
                        return (
                          <li key={m.id}>
                            <button type="button" onClick={() => setFocusMember(active ? "" : m.id)} className={cx("flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors", active ? "bg-ink-900 text-white" : "hover:bg-ink-50")}>
                              <Avatar name={m.name} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold">{m.name}</span>
                                <span className={cx("block h-1.5 w-full overflow-hidden rounded-full", active ? "bg-white/20" : "bg-ink-100")}><span className={cx("block h-full rounded-full", active ? "bg-white" : "bg-brand-500")} style={{ width: `${(m.seconds / maxMember) * 100}%` }} /></span>
                              </span>
                              {d !== null && <span className={cx(active ? "text-[11px] font-bold text-white/80" : d >= 0 ? "delta-up" : "delta-down")}>{d >= 0 ? "+" : ""}{d}%</span>}
                              <span className="tabular text-sm font-extrabold">{fmtHours(m.seconds)}</span>
                              <span className={cx("w-10 text-right text-xs", active ? "text-white/70" : "text-ink-500")}>{Math.round(m.share)}%</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : (
                  <section className="card p-5" aria-label="Weekday split">
                    <h2 className="mb-3 text-base font-extrabold text-ink-900">By weekday</h2>
                    <div className="h-56">
                      <HoursBars data={weekday} />
                    </div>
                  </section>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {canAll && report.byMember.length > 1 && (
                  <section className="card p-5" aria-label="Weekday split">
                    <h2 className="mb-3 text-base font-extrabold text-ink-900">By weekday</h2>
                    <div className="h-52">
                      <HoursBars data={weekday} />
                    </div>
                  </section>
                )}
                <section className={cx("card p-5", !(canAll && report.byMember.length > 1) && "lg:col-span-2")} aria-label="Time of day">
                  <h2 className="mb-3 text-base font-extrabold text-ink-900">Time of day</h2>
                  <div className="h-52">
                    <HoursBars data={hours} color="#2a8f5c" tight labelSuffix=":00" />
                  </div>
                </section>
              </div>

              {/* Entries for the focus */}
              <section className="card p-5" aria-label="Entries">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-ink-900">
                    {focusedProject ? `Entries on ${focusedProject.name}` : projectId === "none" ? "Entries without a project" : "Entries"}
                    {focusMember ? ` · ${report.byMember.find((m) => m.id === focusMember)?.name ?? ""}` : ""}
                  </h2>
                  <span className="text-xs text-ink-500">{entries.length} entries · last 14 days shown</span>
                </div>
                <div className="space-y-4">
                  {byDayGroups.map(([key, rows]) => (
                    <div key={key}>
                      <div className="mb-1.5 flex items-center justify-between px-1">
                        <p className="text-xs font-bold uppercase tracking-wide text-ink-500">{dayLabel(key)}</p>
                        <p className="tabular text-xs font-bold text-ink-700">{fmtHours(rows.reduce((s, e) => s + e.durationSeconds, 0))}</p>
                      </div>
                      <ul className="divide-y divide-line rounded-2xl bg-ink-50/60">
                        {rows.map((e) => (
                          <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                            <ProjectDot color={e.project?.color} />
                            <span className={cx("min-w-0 flex-1 truncate text-sm", e.description ? "font-semibold text-ink-900" : "italic text-ink-400")}>{e.description || e.project?.name || "No description"}</span>
                            {canAll && <span className="hidden text-xs text-ink-500 sm:block">{e.user.name}</span>}
                            {e.billable && <span className="chip text-[10px]">Billable</span>}
                            <span className="tabular hidden text-xs text-ink-500 md:block">{fmtTime(e.startTime)} – {e.endTime ? fmtTime(e.endTime) : "…"}</span>
                            <span className="tabular w-16 text-right text-sm font-extrabold text-ink-900">{fmtHours(e.durationSeconds)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

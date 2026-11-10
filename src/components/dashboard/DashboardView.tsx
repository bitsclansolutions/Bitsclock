"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Clock3, DollarSign, FolderKanban, Play, Users } from "lucide-react";
import { HoursArea, StackedDayBars } from "@/components/charts";
import { useUser } from "@/context/UserContext";
import { useTimer } from "@/context/TimerContext";
import { qs, tzName } from "@/lib/client";
import { useApi } from "@/lib/useApi";
import type { DashboardDTO } from "@/app/api/dashboard/route";
import { addDays, dayKey, fmtClock, fmtHours, fmtTime, startOfDay, startOfMonth, startOfWeek, toISO, toZoned, zonedNow } from "@/lib/time";
import { Avatar, EmptyState, Kpi, LoadError, MiniBars, MiniLine, Progress, ProjectDot, Skeleton } from "@/components/ui";

function LiveElapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular text-sm font-bold text-ink-900">{fmtClock((now - new Date(since).getTime()) / 1000)}</span>;
}

function weekSeries(byDay: { key: string; seconds: number; billableSeconds: number }[]) {
  const start = startOfWeek(zonedNow());
  const map = new Map(byDay.map((d) => [d.key, d]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const row = map.get(dayKey(d));
    return {
      label: d.toLocaleDateString([], { weekday: "short" }),
      hours: Math.round(((row?.seconds ?? 0) / 3600) * 100) / 100,
      billable: Math.round(((row?.billableSeconds ?? 0) / 3600) * 100) / 100,
      nonBillable: Math.round((((row?.seconds ?? 0) - (row?.billableSeconds ?? 0)) / 3600) * 100) / 100,
    };
  });
}


export function DashboardView() {
  const { user, can } = useUser();
  const timer = useTimer();
  const url = useMemo(() => {
    const now = zonedNow();
    return `/api/dashboard${qs({ tz: tzName(), dayStart: toISO(startOfDay(now)), weekStart: toISO(startOfWeek(now)), monthStart: toISO(startOfMonth(now)) })}`;
  }, []);
  const { data, error, refresh } = useApi<DashboardDTO>(url, { ttlMs: 20_000 });

  const mySeries = useMemo(() => (data ? weekSeries(data.me.week) : []), [data]);
  const teamSeries = useMemo(() => (data?.team ? weekSeries(data.team.week) : []), [data]);
  const todaySeconds = (data?.me.todaySeconds ?? 0) + (timer.active && dayKey(timer.active.startTime) === dayKey(zonedNow()) ? timer.elapsed : 0);

  if (error && !data) return <LoadError what="your dashboard" message={error} onRetry={refresh} />;

  if (!data) {
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}</div>
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>
      </div>
    );
  }

  const billablePct = data.me.weekSeconds ? Math.round((data.me.weekBillableSeconds / data.me.weekSeconds) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="My time">
        <Kpi label="Today" value={fmtHours(todaySeconds)} icon={<Clock3 className="h-5 w-5" />} chart={<MiniBars values={mySeries.map((d) => d.hours)} />} />
        <Kpi label="This week" value={fmtHours(data.me.weekSeconds)} icon={<CalendarDays className="h-5 w-5" />} chart={<MiniLine values={mySeries.map((d) => d.hours)} />} />
        <Kpi label="This month" value={fmtHours(data.me.monthSeconds)} icon={<FolderKanban className="h-5 w-5" />} sub={`${data.me.byProject.length} project${data.me.byProject.length === 1 ? "" : "s"} this week`} />
        <Kpi accent label="Billable this week" value={`${billablePct}%`} icon={<DollarSign className="h-5 w-5" />} sub={`${fmtHours(data.me.weekBillableSeconds)} billable`} chart={<MiniLine accent values={mySeries.map((d) => d.billable)} />} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Week chart */}
        <section className="card p-5 lg:col-span-2" aria-label="This week">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-extrabold text-ink-900">This week</h2>
              <p className="text-xs text-ink-500">Hours per day, billable against non-billable</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-700">
              <span className="h-2 w-2 rounded-full bg-brand-600" /> Billable <span className="ml-1 h-2 w-2 rounded-full bg-brand-200" /> Non-billable
            </span>
          </div>
          <div className="h-60">
            <StackedDayBars data={mySeries} />
          </div>
        </section>

        {/* Profile / now card */}
        <section className="card flex flex-col items-center p-6 text-center" aria-label="Profile">
          <Avatar name={user.name} size="lg" color={user.role.color} className="ring-4 ring-brand-50" />
          <p className="mt-3 text-base font-extrabold text-ink-900">{user.name}</p>
          <p className="text-xs text-ink-500">{user.email}</p>
          <div className="mt-5 grid w-full grid-cols-3 gap-2">
            {[
              { l: "Projects", v: data.me.byProject.length },
              { l: "Entries", v: data.me.week.reduce((s, d) => s + d.entries, 0) },
              { l: "Days", v: data.me.week.length },
            ].map((s) => (
              <div key={s.l}>
                <p className="text-[11px] text-ink-500">{s.l}</p>
                <p className="tabular text-xl font-extrabold text-ink-900">{s.v}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 w-full rounded-2xl bg-ink-50 p-4 text-left">
            {timer.active ? (
              <>
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-brand-700"><span className="live-dot" /> Tracking now</p>
                <p className="mt-1 truncate text-sm font-bold text-ink-900">{timer.active.description || "No description"}</p>
                <p className="flex items-center gap-1.5 text-xs text-ink-500"><ProjectDot color={timer.active.project?.color} /> {timer.active.project?.name ?? "No project"}</p>
                <p className="tabular mt-2 text-2xl font-extrabold text-ink-900">{fmtClock(timer.elapsed)}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-ink-900">No timer running</p>
                <p className="text-xs text-ink-500">Start one when you begin a task.</p>
                {can("time.track") && (
                  <Link href="/tracker" className="btn btn-primary btn-sm mt-3">
                    <Play className="h-3.5 w-3.5 fill-current" /> Start a timer
                  </Link>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent */}
        <section className="card lg:col-span-2" aria-label="Recent entries">
          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <h2 className="text-base font-extrabold text-ink-900">Recent entries</h2>
            {can("time.track") && (
              <Link href="/tracker" className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline">
                View all <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          {data.me.recent.length === 0 ? (
            <EmptyState title="Nothing logged yet" body="Your latest entries will appear here." />
          ) : (
            <ul className="px-2 pb-2">
              {data.me.recent.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-ink-50">
                  <span className="h-9 w-1 rounded-full" style={{ background: e.project?.color ?? "#ccd0d6" }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-900">{e.description || e.project?.name || "No description"}</p>
                    <p className="text-xs text-ink-500">{e.project?.name ?? "No project"} · {toZoned(e.startTime).toLocaleDateString([], { month: "short", day: "numeric" })}, {fmtTime(e.startTime)}</p>
                  </div>
                  <span className="tabular text-sm font-extrabold text-ink-900">{fmtHours(e.durationSeconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* My projects this week */}
        <section className="card p-5" aria-label="My projects">
          <h2 className="text-base font-extrabold text-ink-900">Projects this week</h2>
          {data.me.byProject.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No time tracked yet this week.</p>
          ) : (
            <ul className="mt-4 space-y-3.5">
              {data.me.byProject.slice(0, 5).map((p) => (
                <li key={p.id ?? "none"}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2 truncate font-semibold text-ink-800"><ProjectDot color={p.color} /> {p.name}</span>
                    <span className="tabular font-bold text-ink-900">{fmtHours(p.seconds)}</span>
                  </div>
                  <Progress value={p.share} color={p.color} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Team */}
      {data.team && (
        <section aria-label="Team overview" className="space-y-4">
          <div className="flex items-end justify-between pt-2">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-ink-900">Team</h2>
              <p className="text-xs text-ink-500">Everyone&apos;s time this week.</p>
            </div>
            {can("reports.view_all") && (
              <Link href="/reports" className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline">
                Open reports <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Team today" value={fmtHours(data.team.todaySeconds)} icon={<Clock3 className="h-5 w-5" />} />
            <Kpi label="Team this week" value={fmtHours(data.team.weekSeconds)} icon={<CalendarDays className="h-5 w-5" />} chart={<MiniBars values={teamSeries.map((d) => d.hours)} />} />
            <Kpi label="Billable share" value={data.team.weekSeconds ? `${Math.round((data.team.weekBillableSeconds / data.team.weekSeconds) * 100)}%` : "—"} icon={<DollarSign className="h-5 w-5" />} sub={`${fmtHours(data.team.weekBillableSeconds)} billable`} />
            <Kpi accent label="Tracking now" value={data.team.activeTimers.length} icon={<Users className="h-5 w-5" />} sub={`${data.team.memberCount} active members · ${data.team.activeProjects} projects`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Team hours this week</h3>
              <div className="h-52">
                <HoursArea data={teamSeries} />
              </div>
            </div>
            <div className="card p-5">
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Tracking right now</h3>
              {data.team.activeTimers.length === 0 ? (
                <p className="text-sm text-ink-500">Nobody has a timer running.</p>
              ) : (
                <ul className="space-y-3">
                  {data.team.activeTimers.map((t) => (
                    <li key={t.id} className="flex items-center gap-3">
                      <Avatar name={t.user.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-ink-900">{t.user.name}</p>
                        <p className="truncate text-xs text-ink-500">{t.description || "No description"} · {t.project?.name ?? "No project"}</p>
                      </div>
                      <LiveElapsed since={t.startTime} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Top members</h3>
              {data.team.byMember.length === 0 ? <p className="text-sm text-ink-500">No time tracked this week.</p> : (
                <ul className="space-y-3.5">
                  {data.team.byMember.slice(0, 6).map((m) => (
                    <li key={m.id}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-semibold text-ink-800"><Avatar name={m.name} size="sm" /> {m.name}</span>
                        <span className="tabular font-bold text-ink-900">{fmtHours(m.seconds)}</span>
                      </div>
                      <Progress value={m.share} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card p-5">
              <h3 className="mb-3 text-base font-extrabold text-ink-900">Top projects</h3>
              {data.team.byProject.length === 0 ? <p className="text-sm text-ink-500">No time tracked this week.</p> : (
                <ul className="space-y-3.5">
                  {data.team.byProject.slice(0, 6).map((p) => (
                    <li key={p.id ?? "none"}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-2 font-semibold text-ink-800"><ProjectDot color={p.color} /> {p.name}</span>
                        <span className="tabular font-bold text-ink-900">{fmtHours(p.seconds)} <span className="text-xs font-semibold text-ink-400">· {p.share}%</span></span>
                      </div>
                      <Progress value={p.share} color={p.color} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

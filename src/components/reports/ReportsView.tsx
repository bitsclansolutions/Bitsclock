"use client";

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, Clock3, DollarSign, Download, FileSpreadsheet, FileText, Hash, TrendingUp } from "lucide-react";
import { ProjectDonut, StackedDayBars } from "@/components/charts";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { errMsg, qs, rangeToInstants, tzName } from "@/lib/client";
import { useApi } from "@/lib/useApi";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import type { ReportData, BillableFilter } from "@/lib/reports";
import { PERIODS, daysInRange, fmtHours, fmtTime, periodRange, type PeriodKey } from "@/lib/time";
import { Avatar, EmptyState, Kpi, PageHeader, ProjectDot, Seg, Skeleton, cx } from "@/components/ui";
import { Select } from "@/components/Select";
import { exportReportPdf } from "@/lib/report-pdf";

type Level = "summary" | "detailed";

function fillDays(byDay: ReportData["byDay"], from: string, to: string) {
  const map = new Map(byDay.map((d) => [d.key, d]));
  const out: { label: string; key: string; billable: number; nonBillable: number }[] = [];
  const cursor = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  const weekly = daysInRange(from, to) > 45;
  let bucket: (typeof out)[number] | null = null;
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    const row = map.get(key);
    const b = (row?.billableSeconds ?? 0) / 3600;
    const n = (row?.nonBillableSeconds ?? 0) / 3600;
    if (weekly) {
      if (!bucket || cursor.getDay() === 1) {
        bucket = { label: cursor.toLocaleDateString([], { month: "short", day: "numeric" }), key, billable: 0, nonBillable: 0 };
        out.push(bucket);
      }
      bucket.billable += b;
      bucket.nonBillable += n;
    } else {
      out.push({ label: cursor.toLocaleDateString([], { month: "short", day: "numeric" }), key, billable: b, nonBillable: n });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.map((r) => ({ ...r, billable: Math.round(r.billable * 100) / 100, nonBillable: Math.round(r.nonBillable * 100) / 100 }));
}

export function ReportsView() {
  const { user, can } = useUser();
  const toast = useToast();
  const canAll = can("reports.view_all");
  const canExport = can("reports.export");

  const [period, setPeriod] = useState<PeriodKey>("this_week");
  const [range, setRange] = useState(() => periodRange("this_week"));
  const [level, setLevel] = useState<Level>("summary");
  const [memberId, setMemberId] = useState<string>(canAll ? "all" : "me");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState<BillableFilter>("all");
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE = 25;

  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects?includeArchived=1", { ttlMs: 60_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>(canAll ? "/api/users" : null, { ttlMs: 60_000 });
  const projects = useMemo(() => projectsQ.data?.projects ?? [], [projectsQ.data]);
  const members = useMemo(() => membersQ.data?.members ?? [], [membersQ.data]);

  const validRange = !!range.from && !!range.to && range.from <= range.to;
  // The summary level doesn't need the entry list, which is most of the payload.
  const baseQuery = useMemo(() => qs({ ...rangeToInstants(range.from, range.to), tz: tzName(), userId: memberId, projectId, billable: billable === "all" ? "" : billable }), [range, memberId, projectId, billable]);
  const query = `${baseQuery}&kind=${level}`;
  const reportQ = useApi<{ report: ReportData }>(validRange ? `/api/reports${query}` : null, { ttlMs: 30_000 });
  const report = reportQ.data?.report ?? null;

  const choosePeriod = (k: PeriodKey) => {
    setPeriod(k);
    setPage(1);
    if (k !== "custom") setRange(periodRange(k));
  };

  const series = useMemo(() => (report ? fillDays(report.byDay, range.from, range.to) : []), [report, range]);
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "Custom";
  const scopeLabel = memberId === "all" ? "Whole team" : memberId === "me" ? user.name : members.find((m) => m.id === memberId)?.name ?? "Member";
  const projectLabel = projectId === "none" ? "No project" : projectId ? projects.find((p) => p.id === projectId)?.name ?? "Project" : "All projects";
  const billingLabel = billable === "billable" ? "Billable only" : billable === "non_billable" ? "Non-billable only" : "All entries";

  const downloadCsv = (kind: "detailed" | "summary") => {
    // A file download, not a page navigation: trigger it through a temporary anchor.
    const a = document.createElement("a");
    a.href = `/api/reports/export${baseQuery}&kind=${kind}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const downloadPdf = async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportReportPdf(report, { title: "Time report", periodLabel, from: range.from, to: range.to, preparedFor: user.name, scopeLabel, projectLabel, billingLabel, tz: tzName() }, level === "detailed");
    } catch (e) {
      toast.error("Couldn't build the PDF", errMsg(e));
    } finally {
      setExporting(false);
    }
  };

  const t = report?.totals;
  const billablePct = t && t.seconds ? Math.round((t.billableSeconds / t.seconds) * 100) : 0;
  const pageEntries = report ? report.entries.slice((page - 1) * PAGE, page * PAGE) : [];
  const pages = report ? Math.max(1, Math.ceil(report.entries.length / PAGE)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader
        subtitle="Pick a period and filters; the report updates as you change them."
        actions={canExport ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => downloadCsv("detailed")} disabled={!report || !t?.entries}><FileSpreadsheet className="h-4 w-4" /> CSV</button>
            <button type="button" className="btn btn-secondary" onClick={() => downloadCsv("summary")} disabled={!report || !t?.entries}><Download className="h-4 w-4" /> Summary CSV</button>
            <button type="button" className="btn btn-dark" onClick={downloadPdf} disabled={!report || exporting}><FileText className="h-4 w-4" /> {exporting ? "Building…" : "Export PDF"}</button>
          </>
        ) : null}
      />

      {/* Filters */}
      <section className="card flex flex-wrap items-end gap-3 p-4 xl:flex-nowrap" aria-label="Report filters">
        <div className="w-full min-w-[9rem] flex-1 sm:w-auto">
          <label className="label" htmlFor="r-period">Period</label>
          <Select id="r-period" value={period} onChange={(v) => choosePeriod(v as PeriodKey)} options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
        </div>
        <div className="shrink-0">
          <label className="label" htmlFor="r-from">From</label>
          <input id="r-from" type="date" className="field w-[9.5rem]" value={range.from} max={range.to} onChange={(e) => { setPeriod("custom"); setRange({ ...range, from: e.target.value }); }} />
        </div>
        <div className="shrink-0">
          <label className="label" htmlFor="r-to">To</label>
          <input id="r-to" type="date" className="field w-[9.5rem]" value={range.to} min={range.from} onChange={(e) => { setPeriod("custom"); setRange({ ...range, to: e.target.value }); }} />
        </div>
        {canAll && (
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor="r-member">Members</label>
            <Select
              id="r-member"
              value={memberId}
              onChange={setMemberId}
              options={[{ value: "all", label: "Whole team", color: "#1e2a24" as string | null }, { value: "me", label: "Only me", avatar: user.name }, ...members.filter((m) => m.id !== user.id).map((m) => ({ value: m.id, label: m.name, avatar: m.name, hint: m.isActive ? m.jobTitle || undefined : "Deactivated" }))]}
              searchPlaceholder="Search members…"
            />
          </div>
        )}
        <div className="min-w-[10rem] flex-1">
          <label className="label" htmlFor="r-project">Project</label>
          <Select
            id="r-project"
            value={projectId}
            onChange={setProjectId}
            options={[{ value: "", label: "All projects" }, { value: "none", label: "No project", color: null }, ...projects.map((p) => ({ value: p.id, label: p.name, color: p.color, hint: p.isArchived ? "Archived" : undefined }))]}
            searchPlaceholder="Search projects…"
          />
        </div>
        <div className="w-[9.5rem] shrink-0">
          <label className="label" htmlFor="r-billing">Billing</label>
          <Select id="r-billing" value={billable} onChange={(v) => setBillable(v as BillableFilter)} options={[{ value: "all", label: "All entries" }, { value: "billable", label: "Billable" }, { value: "non_billable", label: "Non-billable" }]} />
        </div>
        <div className="shrink-0 xl:ml-auto">
          <label className="label">Level</label>
          <div className="flex h-[42px] items-center">
            <Seg value={level} onChange={setLevel} options={[{ value: "summary", label: "Summary" }, { value: "detailed", label: "Detailed" }]} />
          </div>
        </div>
      </section>

      {reportQ.error && <p className="rounded-2xl bg-[#fbe5e5] px-4 py-3 text-sm text-[#b5322b]">{reportQ.error}</p>}

      {!report ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[84px]" />)}</div>
      ) : t ? (
        <div className={cx("space-y-5 transition-opacity", reportQ.stale && "opacity-70")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Total time" value={fmtHours(t.seconds)} icon={<Clock3 className="h-5 w-5" />} sub={`${periodLabel} · ${daysInRange(range.from, range.to)} days`} />
            <Kpi label="Billable" value={fmtHours(t.billableSeconds)} icon={<DollarSign className="h-5 w-5" />} sub={`${billablePct}% of tracked time`} />
            <Kpi label="Entries" value={t.entries} icon={<Hash className="h-5 w-5" />} sub={`${t.members} member${t.members === 1 ? "" : "s"} · ${t.projects} project${t.projects === 1 ? "" : "s"}`} />
            <Kpi accent label="Average per active day" value={fmtHours(t.avgPerActiveDay)} icon={<TrendingUp className="h-5 w-5" />} sub={t.busiestDay ? `Busiest: ${new Date(t.busiestDay.key + "T00:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} (${fmtHours(t.busiestDay.seconds)})` : `${t.activeDays} active days`} />
          </div>

          {t.entries === 0 ? (
            <div className="card"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No time in this period" body="Try a wider period or different filters." /></div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <section className="card p-5 lg:col-span-2" aria-label="Time per day">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-extrabold text-ink-900">Time per {daysInRange(range.from, range.to) > 45 ? "week" : "day"}</h2>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-700"><span className="h-2 w-2 rounded-full bg-brand-600" /> Billable <span className="ml-1 h-2 w-2 rounded-full bg-brand-200" /> Non-billable</span>
                  </div>
                  <div className="h-64">
                    <StackedDayBars data={series} dense={series.length > 20} />
                  </div>
                </section>
                <section className="card p-5" aria-label="Time by project">
                  <h2 className="text-base font-extrabold text-ink-900">By project</h2>
                  <div className="h-44">
                    <ProjectDonut data={report.byProject.map((p) => ({ id: p.id ?? "none", name: p.name, color: p.color, value: Math.round((p.seconds / 3600) * 100) / 100 }))} />
                  </div>
                  <ul className="mt-2 space-y-2 text-sm">
                    {report.byProject.slice(0, 6).map((p) => (
                      <li key={p.id ?? "none"} className="flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-ink-800"><ProjectDot color={p.color} /><span className="truncate">{p.name}</span></span>
                        <span className="tabular shrink-0 text-ink-500"><b className="text-ink-900">{fmtHours(p.seconds)}</b> · {p.share}%</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <div className={cx("grid gap-4", report.byMember.length > 1 || canAll ? "lg:grid-cols-2" : "")}>
                <section className="card overflow-x-auto" aria-label="Projects table">
                  <h2 className="px-5 pb-1 pt-5 text-base font-extrabold text-ink-900">Projects</h2>
                  <table className="table">
                    <thead><tr><th>Project</th><th className="num">Time</th><th className="num">Billable</th><th className="num">Entries</th><th className="num">Share</th></tr></thead>
                    <tbody>
                      {(level === "detailed" ? report.byProject : report.byProject.slice(0, 8)).map((p) => (
                        <tr key={p.id ?? "none"}>
                          <td><span className="inline-flex items-center gap-2 font-semibold text-ink-900"><ProjectDot color={p.color} />{p.name}</span></td>
                          <td className="num font-bold text-ink-900">{fmtHours(p.seconds)}</td>
                          <td className="num">{fmtHours(p.billableSeconds)}</td>
                          <td className="num">{p.entries}</td>
                          <td className="num">{p.share}%</td>
                        </tr>
                      ))}
                      {level === "summary" && report.byProject.length > 8 && <tr><td colSpan={5} className="text-xs text-ink-400">+ {report.byProject.length - 8} more in the detailed report</td></tr>}
                    </tbody>
                  </table>
                </section>
                {(report.byMember.length > 1 || canAll) && (
                  <section className="card overflow-x-auto" aria-label="Members table">
                    <h2 className="px-5 pb-1 pt-5 text-base font-extrabold text-ink-900">Members</h2>
                    <table className="table">
                      <thead><tr><th>Member</th><th className="num">Time</th><th className="num">Billable</th><th className="num">Entries</th><th className="num">Share</th></tr></thead>
                      <tbody>
                        {(level === "detailed" ? report.byMember : report.byMember.slice(0, 8)).map((m) => (
                          <tr key={m.id}>
                            <td><span className="inline-flex items-center gap-2 font-semibold text-ink-900"><Avatar name={m.name} size="sm" />{m.name}</span></td>
                            <td className="num font-bold text-ink-900">{fmtHours(m.seconds)}</td>
                            <td className="num">{fmtHours(m.billableSeconds)}</td>
                            <td className="num">{m.entries}</td>
                            <td className="num">{m.share}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}
              </div>

              {level === "detailed" && (
                <section className="card overflow-x-auto" aria-label="Time entries">
                  <div className="flex items-center justify-between px-5 pb-1 pt-5">
                    <h2 className="text-base font-extrabold text-ink-900">Time entries <span className="text-sm font-semibold text-ink-500">({report.entries.length})</span></h2>
                    {pages > 1 && (
                      <div className="flex items-center gap-2 text-sm">
                        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                        <span className="text-ink-500">{page} / {pages}</span>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
                      </div>
                    )}
                  </div>
                  <table className="table min-w-[760px]">
                    <thead><tr><th>Date</th><th>Member</th><th>Project</th><th>Description</th><th>Start – End</th><th className="num">Duration</th><th>Billable</th></tr></thead>
                    <tbody>
                      {pageEntries.map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap text-ink-700"><span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-ink-400" />{new Date(e.startTime).toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" })}</span></td>
                          <td className="whitespace-nowrap">{e.user.name}</td>
                          <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><ProjectDot color={e.project?.color} />{e.project?.name ?? "No project"}</span></td>
                          <td className="max-w-xs truncate">{e.description || <span className="italic text-ink-400">No description</span>}</td>
                          <td className="tabular whitespace-nowrap text-ink-500">{fmtTime(e.startTime)} – {e.endTime ? fmtTime(e.endTime) : "…"}</td>
                          <td className="num font-bold text-ink-900">{fmtHours(e.durationSeconds)}</td>
                          <td>{e.billable ? <span className="delta-up">Billable</span> : <span className="text-ink-400">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

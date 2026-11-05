"use client";

import { useMemo } from "react";
import type { TimesheetCell, TimesheetProject } from "@/app/api/timesheet/route";
import { addDays, dayKey, fmtHours, startOfWeek } from "@/lib/time";
import { cx } from "@/components/ui";

const NONE = "__none";

/** Month calendar: one cell per day with its total and the top projects, like a calendar app's month view. */
export function CalendarMonth({
  monthStart,
  cells,
  projects,
  onDay,
}: {
  monthStart: Date;
  cells: TimesheetCell[];
  projects: TimesheetProject[];
  onDay: (date: Date) => void;
}) {
  const todayKey = dayKey(new Date());
  const month = monthStart.getMonth();
  const weeks = useMemo(() => {
    const first = startOfWeek(monthStart);
    const last = new Date(monthStart.getFullYear(), month + 1, 0);
    const out: Date[][] = [];
    for (let d = first; d <= last || out.length === 0 || out[out.length - 1]!.length < 7; d = addDays(d, 1)) {
      if (out.length === 0 || out[out.length - 1]!.length === 7) out.push([]);
      out[out.length - 1]!.push(d);
      if (d > last && out[out.length - 1]!.length === 7) break;
    }
    return out;
  }, [monthStart, month]);

  const byDay = useMemo(() => {
    const names = new Map(projects.map((p) => [p.id, p]));
    const map = new Map<string, { total: number; items: { id: string; name: string; color: string | null; seconds: number }[] }>();
    for (const c of cells) {
      const d = map.get(c.key) ?? { total: 0, items: [] };
      d.total += c.seconds;
      const p = c.projectId ? names.get(c.projectId) : null;
      d.items.push({ id: c.projectId ?? NONE, name: p?.name ?? (c.projectId ? "Project" : "No project"), color: p?.color ?? null, seconds: c.seconds });
      map.set(c.key, d);
    }
    for (const d of map.values()) d.items.sort((a, b) => b.seconds - a.seconds);
    return map;
  }, [cells, projects]);

  const weekdays = weeks[0]!.map((d) => d.toLocaleDateString([], { weekday: "short" }));

  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-ink-100">
        {weekdays.map((w, i) => (
          <div key={w} className={cx("px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide", weeks[0]![i]!.getDay() === 0 || weeks[0]![i]!.getDay() === 6 ? "text-ink-400" : "text-ink-500")}>{w}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-ink-100 last:border-b-0">
          {week.map((d) => {
            const key = dayKey(d);
            const inMonth = d.getMonth() === month;
            const data = byDay.get(key);
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            const future = key > todayKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onDay(d)}
                className={cx(
                  "flex min-h-[6.5rem] flex-col items-stretch gap-1 border-l border-ink-100 p-2 text-left transition-colors first:border-l-0 hover:bg-ink-50",
                  !inMonth && "bg-ink-50/40 text-ink-300",
                  weekend && inMonth && "bg-ink-50/60",
                )}
                aria-label={`${d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}: ${data ? fmtHours(data.total) : "no time"}`}
              >
                <span className="flex items-center justify-between">
                  <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold", key === todayKey ? "bg-brand-600 text-white" : inMonth ? "text-ink-800" : "text-ink-300")}>{d.getDate()}</span>
                  {data && inMonth && <span className={cx("tabular rounded-full px-1.5 py-0.5 text-[11px] font-bold", data.total >= 8 * 3600 ? "bg-brand-700 text-white" : "bg-brand-50 text-brand-800")}>{fmtHours(data.total)}</span>}
                </span>
                {inMonth && data && (
                  <span className="flex flex-col gap-0.5">
                    {data.items.slice(0, 3).map((it) => (
                      <span key={it.id} className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-ink-700">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: it.color ?? "#9aa0a9" }} />
                        <span className="truncate">{it.name}</span>
                        <span className="tabular ml-auto shrink-0 text-ink-500">{fmtHours(it.seconds)}</span>
                      </span>
                    ))}
                    {data.items.length > 3 && <span className="text-[11px] text-ink-400">+{data.items.length - 3} more</span>}
                  </span>
                )}
                {inMonth && !data && !future && <span className="mt-auto text-[11px] text-ink-300">—</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

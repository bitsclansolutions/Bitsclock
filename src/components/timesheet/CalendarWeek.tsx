"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EntryDTO } from "@/lib/entries";
import { dayKey, fmtHours, fmtTime, hourLabel } from "@/lib/time";
import { cx } from "@/components/ui";

export const HOUR_PX = 56;
const SNAP_MIN = 15;

export type CalendarDay = { key: string; date: Date; isNow: boolean; muted: boolean; future: boolean };

type Block = { entry: EntryDTO; top: number; height: number; startMin: number; endMin: number; continues: boolean; continued: boolean };

/** Minutes since local midnight. */
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

/**
 * Split entries into per-day blocks positioned by local start/end time. An entry that
 * crosses midnight is drawn on both days, clipped at the boundary. Running entries end "now".
 */
function blocksFor(entries: EntryDTO[], days: CalendarDay[], now: Date) {
  const byDay = new Map<string, Block[]>(days.map((d) => [d.key, []]));
  for (const e of entries) {
    const start = new Date(e.startTime);
    const end = e.endTime ? new Date(e.endTime) : now;
    if (end <= start) continue;
    let cursor = start;
    while (cursor < end) {
      const key = dayKey(cursor);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(24, 0, 0, 0);
      const segEnd = end < dayEnd ? end : dayEnd;
      const list = byDay.get(key);
      if (list) {
        const startMin = minutesOf(cursor);
        const endMin = segEnd.getTime() === dayEnd.getTime() ? 1440 : minutesOf(segEnd);
        list.push({ entry: e, startMin, endMin, top: (startMin / 60) * HOUR_PX, height: Math.max(20, ((endMin - startMin) / 60) * HOUR_PX), continues: segEnd.getTime() === dayEnd.getTime() && end > dayEnd, continued: cursor.getTime() !== start.getTime() });
      }
      cursor = dayEnd;
    }
  }
  return byDay;
}

export function CalendarWeek({
  days,
  entries,
  totals,
  editable,
  onSlot,
  onEntry,
}: {
  days: CalendarDay[];
  entries: EntryDTO[];
  totals: Map<string, number>;
  editable: boolean;
  /** Click on an empty slot: local day key and the snapped minute of the day. */
  onSlot: (key: string, minute: number) => void;
  onEntry: (e: EntryDTO) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Open on the working day, not at midnight: when the calendar first shows, scroll the page
  // (not the calendar) so the earlier of 8:00 or the first entry is in view. Only once, so
  // moving between weeks doesn't make the page jump.
  useEffect(() => {
    const el = scroller.current;
    const page = el?.closest("main");
    if (!el || !page) return;
    const firstStart = Math.min(24 * 60, ...entries.map((e) => minutesOf(new Date(e.startTime))));
    const target = Math.max(0, Math.min(firstStart, 8 * 60) - 30);
    const gridTop = el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
    // Leave room above for the sticky day headers.
    page.scrollTop = Math.max(0, gridTop + (target / 60) * HOUR_PX - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocks = useMemo(() => blocksFor(entries, days, now), [entries, days, now]);
  const nowMin = minutesOf(now);
  const todayKey = dayKey(now);
  const single = days.length === 1;

  const clickSlot = (day: CalendarDay, e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || day.future) return;
    if ((e.target as HTMLElement).closest("[data-entry]")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN;
    if (day.key === todayKey && minute > nowMin) return;
    onSlot(day.key, Math.max(0, Math.min(23 * 60 + 45, minute)));
  };

  // Under 480 px a multi-day grid is too narrow to read, so phones get a list per day (R-041).
  const narrowList =
    days.length > 1 ? (
      <div className="card divide-y divide-ink-100 p-0 min-[480px]:hidden">
        {days.map((d) => {
          const list = (blocks.get(d.key) ?? []).slice().sort((a, b) => a.startMin - b.startMin);
          return (
            <section key={d.key} aria-label={d.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className={cx("text-sm font-extrabold", d.isNow ? "text-brand-700" : "text-ink-900")}>{d.date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</h3>
                {totals.get(d.key) ? <span className="tabular text-xs font-bold text-ink-500">{fmtHours(totals.get(d.key)!)}</span> : null}
                {editable && !d.future && (
                  <button type="button" onClick={() => onSlot(d.key, d.key === todayKey ? Math.max(0, Math.floor((nowMin - 60) / SNAP_MIN) * SNAP_MIN) : 9 * 60)} className="btn btn-ghost btn-sm ml-auto">
                    + Add
                  </button>
                )}
              </div>
              {list.length === 0 ? (
                <p className="mt-1 text-xs text-ink-500">Nothing logged.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {list.map((b) => (
                    <li key={`${b.entry.id}-${b.startMin}`}>
                      <button type="button" onClick={() => onEntry(b.entry)} className="flex w-full items-center gap-3 rounded-xl border-l-[3px] bg-ink-50 px-3 py-2 text-left" style={{ borderLeftColor: b.entry.project?.color ?? "#6b717c" }}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-900">{b.entry.description || b.entry.project?.name || "No description"}</span>
                          <span className="tabular text-xs text-ink-500">
                            {fmtTime(b.entry.startTime)} – {b.entry.endTime ? fmtTime(b.entry.endTime) : "now"}
                          </span>
                        </span>
                        <span className="tabular text-sm font-bold text-ink-900">{fmtHours(b.entry.durationSeconds)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    ) : null;

  return (
    <>
    {narrowList}
    {/* overflow-clip (not hidden) keeps the rounded corners without making the card a scroll
        container, so the day headers can stick to the top while the page scrolls. */}
    <div className={cx("card overflow-clip p-0", days.length > 1 && "hidden min-[480px]:block")}>
      {/* Day headers: stay in view while the page scrolls through the hours */}
      <div className="sticky top-0 z-20 grid rounded-t-[1.25rem] border-b border-ink-100 bg-white" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => (
          <div key={d.key} className={cx("flex items-center gap-2 border-l border-ink-100 px-3 py-2.5", single ? "justify-start" : "justify-center")}>
            <span className={cx("text-[11px] font-semibold uppercase tracking-wide", d.isNow ? "text-brand-700" : d.muted ? "text-ink-400" : "text-ink-500")}>{d.date.toLocaleDateString([], { weekday: "short" })}</span>
            <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold", d.isNow ? "bg-brand-600 text-white" : "text-ink-800")}>{d.date.getDate()}</span>
            {totals.get(d.key) ? <span className="tabular rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-800">{fmtHours(totals.get(d.key)!)}</span> : null}
            {editable && !d.future && (
              // Keyboard (and touch) way to add an entry; clicking a slot is the mouse shortcut (R-057).
              <button
                type="button"
                onClick={() => onSlot(d.key, d.key === todayKey ? Math.max(0, Math.floor((nowMin - 60) / SNAP_MIN) * SNAP_MIN) : 9 * 60)}
                aria-label={`Add an entry on ${d.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}`}
                className="ml-auto rounded-full px-1.5 text-sm font-bold text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                +
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Time grid: full height; the page scrolls, not the calendar */}
      <div ref={scroller}>
        <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          {/* Hour gutter */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] font-semibold text-ink-400" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d.key}
              onClick={(e) => clickSlot(d, e)}
              className={cx("relative border-l border-ink-100", d.muted && "bg-ink-50/50", editable && !d.future && "cursor-crosshair")}
              style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour) - 1px), var(--color-ink-100) calc(var(--hour) - 1px), var(--color-ink-100) var(--hour))", ["--hour" as string]: `${HOUR_PX}px` }}
              aria-label={d.date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}
            >
              {blocks.get(d.key)?.map((b) => {
                const color = b.entry.project?.color ?? "#6b717c";
                const short = b.height < 34;
                return (
                  <button
                    key={`${b.entry.id}-${b.startMin}`}
                    type="button"
                    data-entry
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEntry(b.entry);
                    }}
                    title={`${b.entry.description || b.entry.project?.name || "Entry"} · ${fmtTime(b.entry.startTime)} – ${b.entry.endTime ? fmtTime(b.entry.endTime) : "now"} · ${fmtHours(b.entry.running ? (now.getTime() - new Date(b.entry.startTime).getTime()) / 1000 : b.entry.durationSeconds)}`}
                    className={cx(
                      "absolute left-1 right-1 overflow-hidden rounded-lg border-l-[3px] px-2 text-left shadow-sm transition-[filter] hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
                      short ? "py-0.5" : "py-1",
                      b.entry.running && "animate-pulse",
                      b.continued && "rounded-t-none",
                      b.continues && "rounded-b-none",
                    )}
                    style={{ top: b.top, height: b.height, background: `color-mix(in srgb, ${color} 14%, white)`, borderLeftColor: color }}
                  >
                    <span className={cx("block truncate font-bold text-ink-900", short ? "text-[11px] leading-4" : "text-xs leading-4")}>
                      {b.entry.description || b.entry.project?.name || "No description"}
                      {short && <span className="tabular ml-1.5 font-semibold text-ink-500">{fmtTime(b.entry.startTime)}</span>}
                    </span>
                    {!short && (
                      <span className="tabular block truncate text-[11px] leading-4 text-ink-600">
                        {fmtTime(b.entry.startTime)} – {b.entry.endTime ? fmtTime(b.entry.endTime) : "now"}
                        {b.entry.project && b.entry.description ? ` · ${b.entry.project.name}` : ""}
                      </span>
                    )}
                  </button>
                );
              })}
              {d.key === todayKey && (
                <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }} aria-hidden>
                  <span className="-ml-1 h-2 w-2 rounded-full bg-[#c7423a]" />
                  <span className="h-px flex-1 bg-[#c7423a]" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Lock, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { api, errMsg } from "@/lib/client";
import { invalidate, useApi } from "@/lib/useApi";
import { currentTimeZone, dayKey, toISO, zonedNow, zoneOffsetMs } from "@/lib/time";
import type { WorkspaceDTO } from "@/lib/workspace";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { DEFAULT_PREFS, readPrefs, writePrefs, TRACKER_PAGE_SIZES, TRACKER_WINDOWS, type Prefs } from "@/lib/prefs";
import { Avatar, RoleBadge, Seg, cx } from "@/components/ui";
import { Select } from "@/components/Select";

type Section = "preferences" | "permissions" | "workspace";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode; blurb: string; adminOnly?: boolean }[] = [
  { id: "preferences", label: "Preferences", icon: <SlidersHorizontal className="h-4 w-4" />, blurb: "Tracker defaults and display" },
  { id: "permissions", label: "Permissions", icon: <ShieldCheck className="h-4 w-4" />, blurb: "What your role allows" },
  { id: "workspace", label: "Workspace", icon: <Lock className="h-4 w-4" />, blurb: "Time zone and invoiced time", adminOnly: true },
];

/** "GMT+05:00"-style offset of a zone right now, for the picker's hints. */
function offsetLabel(tz: string) {
  const mins = Math.round(zoneOffsetMs(Date.now(), tz) / 60_000);
  const sign = mins < 0 ? "−" : "+";
  const a = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** Every IANA zone the browser knows, sorted by offset then name. */
function zoneOptions(current: string) {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    /* older browsers */
  }
  if (!zones.includes(current)) zones = [current, ...zones];
  if (!zones.includes("UTC")) zones.push("UTC");
  return zones
    .map((z) => ({ z, off: zoneOffsetMs(Date.now(), z) }))
    .sort((a, b) => a.off - b.off || a.z.localeCompare(b.z))
    .map(({ z }) => ({ value: z, label: z.replace(/_/g, " "), hint: offsetLabel(z) }));
}

/**
 * The workspace time zone (D-012), Administrator only: every member sees and enters time
 * in it, and every report, total and day boundary uses it.
 */
function TimeZoneSection() {
  const toast = useToast();
  const q = useApi<WorkspaceDTO>("/api/workspace", { ttlMs: 30_000 });
  const current = q.data?.timeZone ?? currentTimeZone();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? current;
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => zoneOptions(current), [current]);
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/workspace", { method: "PATCH", json: { timeZone: value } });
      toast.success("Time zone saved", `Everyone now sees and logs time in ${value.replace(/_/g, " ")}.`);
      // Every date on screen has to be redrawn in the new zone.
      window.setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error("Couldn't save the time zone", errMsg(e));
      setBusy(false);
    }
  };
  return (
    <section className="card p-6" aria-label="Time zone">
      <h2 className="text-lg font-extrabold text-ink-900">Time zone</h2>
      <p className="text-sm text-ink-500">Everyone sees and enters time in this zone, whatever their computer is set to. Days, weeks and months in every report and total start at midnight in this zone. Saved entries keep their exact moment; only how they are shown changes.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div>
          <p className="label" aria-hidden>Workspace time zone</p>
          <Select label="Workspace time zone" value={value} onChange={setDraft} options={options} className="w-72" menuWidth={320} searchPlaceholder="Search, e.g. Karachi" disabled={q.loading && !q.data} />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || value === current} onClick={save}>{busy ? "Saving…" : "Save time zone"}</button>
      </div>
      <p className="mt-3 text-xs text-ink-500">Currently {current.replace(/_/g, " ")} ({offsetLabel(current)}).</p>
    </section>
  );
}

/**
 * The invoicing lock date (D-005), Administrator only. Entries that start before it can
 * only be created, edited or deleted by the Administrator.
 */
function WorkspaceSection() {
  const toast = useToast();
  const q = useApi<WorkspaceDTO>("/api/workspace", { ttlMs: 30_000 });
  const current = q.data?.lockDate ? dayKey(q.data.lockDate) : "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? current;
  const [busy, setBusy] = useState(false);
  const save = async (next: string) => {
    setBusy(true);
    try {
      // Midnight at the start of the chosen day, in the workspace time zone.
      const lockDate = next ? toISO(new Date(next + "T00:00:00")) : null;
      await api("/api/workspace", { method: "PATCH", json: { lockDate } });
      invalidate("/api/workspace");
      setDraft(null);
      toast.success(next ? "Lock date saved" : "Lock date removed", next ? `Time before ${new Date(next + "T00:00:00").toLocaleDateString()} is now locked for everyone but you.` : undefined);
    } catch (e) {
      toast.error("Couldn't save the lock date", errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-6" aria-label="Workspace">
      <h2 className="text-lg font-extrabold text-ink-900">Lock invoiced time</h2>
      <p className="text-sm text-ink-500">Entries that start before the lock date can&apos;t be added, edited or deleted by anyone except you, so invoiced hours stay as billed. Every change is recorded in the audit log.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="lock-date">Locked before</label>
          <input id="lock-date" type="date" className="field w-[11rem]" value={value} max={dayKey(zonedNow())} onChange={(e) => setDraft(e.target.value)} disabled={q.loading && !q.data} />
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || !value || value === current} onClick={() => save(value)}>{busy ? "Saving…" : "Save lock date"}</button>
        {current && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save("")}>Remove lock</button>}
      </div>
      <p className="mt-3 text-xs text-ink-500">{current ? `Currently locked before ${new Date(current + "T00:00:00").toLocaleDateString()}.` : "Nothing is locked yet."}</p>
    </section>
  );
}

export function SettingsView() {
  const { user, can } = useUser();
  const toast = useToast();
  const [section, setSection] = useState<Section>("preferences");

  // Preferences (per device)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => setPrefs(readPrefs()), []);
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs(writePrefs({ [k]: v }));
    toast.success("Preference saved");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      {/* Section nav */}
      <aside className="space-y-4">
        <Link href="/profile" className="card group flex items-center gap-3 p-4 transition-shadow hover:shadow-pop">
          <Avatar name={user.name} color={user.role.color} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-ink-900">{user.name}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            <div className="mt-1"><RoleBadge name={user.role.name} color={user.role.color} /></div>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-50 text-ink-500 transition-colors group-hover:bg-brand-600 group-hover:text-white" aria-hidden><ArrowRight className="h-4 w-4" /></span>
        </Link>
        <p className="px-1 text-xs text-ink-500">Name, password and signed-in devices live on your <Link href="/profile" className="font-semibold text-ink-900 underline-offset-2 hover:underline">profile</Link>.</p>
        <nav className="card p-2" aria-label="Settings sections">
          {SECTIONS.filter((s) => !s.adminOnly || user.isAdmin).map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? "page" : undefined} className={cx("flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", section === s.id ? "bg-brand-600 text-white" : "text-ink-800 hover:bg-ink-50")}>
              <span className={cx("flex h-8 w-8 items-center justify-center rounded-full", section === s.id ? "bg-white/15" : "bg-brand-50 text-brand-700")}>{s.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{s.label}</span>
                <span className={cx("block truncate text-xs", section === s.id ? "text-white/70" : "text-ink-500")}>{s.blurb}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Section content */}
      <div className="space-y-5">
        {section === "preferences" && (
          <section className="card p-6" aria-label="Preferences">
            <h2 className="text-lg font-extrabold text-ink-900">Preferences</h2>
            <p className="text-sm text-ink-500">Saved on this device. They change how the app looks and behaves for you here.</p>
            <div className="mt-5 divide-y divide-line">
              {[
                { label: "Tracker opens in", hint: "Timer starts the clock now; Manual logs a start and end time.", control: <Seg label="Tracker opens in" value={prefs.defaultMode} onChange={(v) => setPref("defaultMode", v)} options={[{ value: "timer", label: "Timer" }, { value: "manual", label: "Manual" }]} /> },
                { label: "Entries shown by default", hint: "How far back the time tracker lists when it opens.", control: <Select label="Entries shown by default" value={prefs.trackerWindow} onChange={(v) => setPref("trackerWindow", v as Prefs["trackerWindow"])} options={TRACKER_WINDOWS} className="w-44" /> },
                { label: "Entry list loads", hint: "Scroll keeps loading as you reach the end; Pages shows numbered pages.", control: <Seg label="Entry list loads" value={prefs.trackerLoading} onChange={(v) => setPref("trackerLoading", v)} options={[{ value: "scroll", label: "Scroll" }, { value: "pages", label: "Pages" }]} /> },
                { label: "Rows per page", hint: "Used when the entry list shows pages.", control: <Seg label="Rows per page" value={prefs.trackerPageSize} onChange={(v) => setPref("trackerPageSize", v)} options={TRACKER_PAGE_SIZES.map((n) => ({ value: n, label: n }))} /> },
                { label: "Time format", hint: "How start and end times are written.", control: <Seg label="Time format" value={prefs.timeFormat} onChange={(v) => setPref("timeFormat", v)} options={[{ value: "24h", label: "14:30" }, { value: "12h", label: "2:30 PM" }]} /> },
                { label: "Week starts on", hint: "Affects weekly totals and charts.", control: <Seg label="Week starts on" value={prefs.weekStart} onChange={(v) => setPref("weekStart", v)} options={[{ value: "monday", label: "Monday" }, { value: "sunday", label: "Sunday" }]} /> },
                { label: "Tick the tab title while a timer runs", hint: "Shows the elapsed time in the browser tab.", control: <Seg label="Tick the tab title while a timer runs" value={prefs.tickingTitle ? "on" : "off"} onChange={(v) => setPref("tickingTitle", v === "on")} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} /> },
                { label: "Long-timer reminder", hint: "Warn when a timer has run longer than this.", control: <Seg label="Long-timer reminder" value={String(prefs.longTimerHours)} onChange={(v) => setPref("longTimerHours", Number(v))} options={[{ value: "4", label: "4h" }, { value: "8", label: "8h" }, { value: "12", label: "12h" }, { value: "0", label: "Never" }]} /> },
              ].map((row) => (
                <div key={row.label} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-ink-900">{row.label}</p>
                    <p className="text-xs text-ink-500">{row.hint}</p>
                  </div>
                  {row.control}
                </div>
              ))}
            </div>
          </section>
        )}

        {section === "workspace" && user.isAdmin && (
          <>
            <TimeZoneSection />
            <WorkspaceSection />
          </>
        )}

        {section === "permissions" && (
          <section className="card p-6" aria-label="Permissions">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-extrabold text-ink-900">Your permissions</h2>
                <p className="text-sm text-ink-500">Granted by the <b>{user.role.name}</b> role. Administrators change roles from the Team page.</p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Bell className="h-5 w-5" /></span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {PERMISSION_GROUPS.map((g) => (
                <div key={g.key} className="rounded-2xl bg-ink-50 p-4">
                  <p className="text-sm font-bold text-ink-900">{g.label}</p>
                  <ul className="mt-2 space-y-1.5">
                    {g.permissions.map((p) => {
                      const on = can(p.key);
                      return (
                        <li key={p.key} className={cx("flex items-center gap-2 text-sm", on ? "text-ink-800" : "text-ink-400 line-through")}>
                          <span className={cx("h-2 w-2 rounded-full", on ? "bg-brand-500" : "bg-ink-300")} /> {p.label}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

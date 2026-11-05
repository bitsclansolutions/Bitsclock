"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, DollarSign, X } from "lucide-react";
import { api, errMsg } from "@/lib/client";
import { clientCheck, entryUpdateSchema } from "@/lib/validation";
import type { EntryDTO } from "@/lib/entries";
import { combineDateTime, dayKey, fmtHours, fmtTimeText, parseTimeText } from "@/lib/time";
import { Seg, cx } from "@/components/ui";
import { ProjectSelect, type ProjectLite } from "@/components/ProjectSelect";
import { useUser } from "@/context/UserContext";
import { clearDraft, loadDraft, useDraft } from "@/lib/drafts";
import { DescriptionInput } from "./DescriptionInput";

type Draft = { description: string; projectId: string; billable: boolean; date: string; start: string; end: string };

/**
 * Edits a finished entry in place: the row turns into fields (no dialog). Same rules as the
 * API: overlap, 24 h, lock date, and billable only for time.manage_all (D-005).
 * Enter saves, Escape cancels. Unsaved input survives an expired session (R-038).
 */
export function InlineEntryEditor({ entry, projects, onSaved, onCancel }: { entry: EntryDTO; projects: ProjectLite[]; onSaved: (e: EntryDTO) => void; onCancel: () => void }) {
  const canOverrideBillable = useUser().can("time.manage_all");
  const draftKey = `entry:${entry.id}`;
  const [initial] = useState<Draft>(
    () =>
      loadDraft<Draft>(draftKey) ?? {
        description: entry.description,
        projectId: entry.projectId ?? "",
        billable: entry.billable,
        date: dayKey(entry.startTime),
        start: fmtTimeText(entry.startTime),
        end: entry.endTime ? fmtTimeText(entry.endTime) : "",
      },
  );
  const [description, setDescription] = useState(initial.description);
  const [projectId, setProjectId] = useState(initial.projectId);
  const [billable, setBillable] = useState(initial.billable);
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useDraft(draftKey, { description, projectId, billable, date, start, end } satisfies Draft, true);

  // Keep the entry's current project selectable even if it has since been archived.
  const options = useMemo(() => (entry.project && !projects.some((p) => p.id === entry.project!.id) ? [...projects, entry.project] : projects), [projects, entry.project]);

  // Picking another project brings that project's billing default (D-005); it can be overridden after.
  const changeProject = (id: string) => {
    if (id === projectId) return;
    setProjectId(id);
    setBillable(options.find((p) => p.id === id)?.billable ?? false);
  };

  const times = useMemo(() => {
    const s = parseTimeText(start);
    const e = parseTimeText(end);
    if (!s || !e) return null;
    const startAt = combineDateTime(date, s);
    let endAt = combineDateTime(date, e);
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + 86400_000); // crossed midnight
    return { startAt, endAt, seconds: (endAt.getTime() - startAt.getTime()) / 1000 };
  }, [date, start, end]);

  const cancel = () => {
    clearDraft(draftKey);
    onCancel();
  };

  const save = async () => {
    if (!times) {
      setError("Enter times like 09:00 or 2:30pm.");
      return;
    }
    const body: Record<string, unknown> = {
      description,
      projectId: projectId || null,
      ...(canOverrideBillable ? { billable } : {}),
      startTime: times.startAt.toISOString(),
      endTime: times.endAt.toISOString(),
    };
    const problem = clientCheck(entryUpdateSchema, body);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { entry: saved } = await api<{ entry: EntryDTO }>(`/api/time-entries/${entry.id}`, { method: "PATCH", json: body });
      clearDraft(draftKey);
      onSaved(saved);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  // Escape anywhere in the row cancels (inner popups stop Escape themselves first).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      cancel();
    }
  };

  const descRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = descRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    el?.focus();
    // Cursor at the end, so typing continues the description.
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const normalize = (v: string, set: (s: string) => void) => {
    const t = parseTimeText(v);
    if (t) set(`${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={onKeyDown}
      aria-label="Edit entry"
      className="space-y-2 rounded-2xl bg-brand-50/60 p-3 ring-1 ring-inset ring-brand-200"
    >
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start">
        <div ref={descRef} className="min-w-0 flex-1">
          <DescriptionInput
            multiline
            value={description}
            onChange={setDescription}
            placeholder="What did you work on?"
            disabled={busy}
            onSubmit={() => void save()}
            onPick={(s) => {
              setDescription(s.description);
              if (s.projectId && options.some((p) => p.id === s.projectId)) changeProject(s.projectId);
            }}
          />
        </div>
        <ProjectSelect className="xl:w-52" value={projectId} onChange={changeProject} projects={options} />
        <div className="shrink-0" title={canOverrideBillable ? "Billing for this entry" : "Set by the project"}>
          <Seg
            label="Billing"
            disabled={!canOverrideBillable}
            value={billable ? "billable" : "non_billable"}
            onChange={(v) => setBillable(v === "billable")}
            options={[
              { value: "billable", label: <><DollarSign className="h-3.5 w-3.5" /> Billable</> },
              { value: "non_billable", label: "Non-billable" },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Date" type="date" className="field w-[10rem]" value={date} onChange={(e) => setDate(e.target.value)} required />
        <input aria-label="Start time" inputMode="numeric" className="field tabular w-[5.25rem] text-center" value={start} onChange={(e) => setStart(e.target.value)} onBlur={(e) => normalize(e.target.value, setStart)} placeholder="09:00" required />
        <span className="text-ink-400">to</span>
        <input aria-label="End time" inputMode="numeric" className="field tabular w-[5.25rem] text-center" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={(e) => normalize(e.target.value, setEnd)} placeholder="10:30" required />
        <span className={cx("tabular w-16 text-center text-sm font-extrabold", times ? "text-ink-900" : "text-[#b5322b]")} aria-live="polite">
          {times ? fmtHours(times.seconds) : "—"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy}>
            <X className="h-4 w-4" /> Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Check className="h-4 w-4" /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-[#b5322b]">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/client";
import { clientCheck, entryManualSchema, entryUpdateSchema } from "@/lib/validation";
import type { EntryDTO } from "@/lib/entries";
import { combineDateTime, dayKey, fmtHours, fmtTimeText, parseTimeText } from "@/lib/time";
import { DollarSign } from "lucide-react";
import { ErrorBanner, Field, Modal, Seg, cx } from "@/components/ui";
import { ProjectSelect, type ProjectLite } from "@/components/ProjectSelect";
import { useUser } from "@/context/UserContext";
import { clearDraft, loadDraft, useDraft } from "@/lib/drafts";
import { DescriptionInput } from "./DescriptionInput";

type Props = {
  open: boolean;
  onClose: () => void;
  entry: EntryDTO | null; // null = new manual entry
  projects: ProjectLite[];
  forUserId?: string; // when creating for another member (needs time.manage_all)
  onSaved: (entry: EntryDTO) => void;
  /** Prefill for a new entry. `date` is a local day key (YYYY-MM-DD); start/end are time texts like "09:00". */
  defaults?: { description?: string; projectId?: string; date?: string; start?: string; end?: string };
};

export function EntryModal({ open, onClose, entry, projects, forUserId, onSaved, defaults }: Props) {
  // D-005: billable follows the project; only time.manage_all may override it.
  const canOverrideBillable = useUser().can("time.manage_all");
  const editing = !!entry;
  const running = !!entry && entry.running;
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  // Until the user flips the toggle, billable follows the chosen project's default.
  const [billableTouched, setBillableTouched] = useState(false);
  const [date, setDate] = useState(dayKey(new Date()));
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Unsaved input survives an expired session (R-038).
  const draftKey = `entry:${entry?.id ?? "new"}`;
  type Draft = { description: string; projectId: string; date: string; start: string; end: string };
  useDraft(draftKey, { description, projectId, date, start, end } satisfies Draft, open);
  const close = () => {
    clearDraft(draftKey);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    setError("");
    setBillableTouched(!!entry);
    if (entry) {
      setDescription(entry.description);
      setProjectId(entry.projectId ?? "");
      setBillable(entry.billable);
      setDate(dayKey(entry.startTime));
      setStart(fmtTimeText(entry.startTime));
      setEnd(entry.endTime ? fmtTimeText(entry.endTime) : "");
    } else {
      const now = new Date();
      setDescription(defaults?.description ?? "");
      setProjectId(defaults?.projectId ?? "");
      setDate(defaults?.date ?? dayKey(now));
      setStart(defaults?.start ?? fmtTimeText(new Date(now.getTime() - 3600_000)));
      setEnd(defaults?.end ?? fmtTimeText(now));
    }
    const draft = loadDraft<Draft>(`entry:${entry?.id ?? "new"}`);
    if (draft) {
      setDescription(draft.description);
      setProjectId(draft.projectId);
      setDate(draft.date);
      setStart(draft.start);
      setEnd(draft.end);
    }
  }, [open, entry, defaults]);

  // Include the entry's current project even if it has since been archived.
  const options = useMemo(() => {
    if (entry?.project && !projects.some((p) => p.id === entry.project!.id)) return [...projects, entry.project];
    return projects;
  }, [projects, entry]);

  useEffect(() => {
    if (!open || billableTouched) return;
    setBillable(options.find((p) => p.id === projectId)?.billable ?? false);
  }, [open, projectId, options, billableTouched]);

  const times = useMemo(() => {
    const s = parseTimeText(start);
    const e = running ? null : parseTimeText(end);
    if (!s || (!running && !e)) return null;
    const startAt = combineDateTime(date, s);
    let endAt = running ? null : combineDateTime(date, e!);
    // An end earlier than the start means the entry crossed midnight.
    if (endAt && endAt <= startAt) endAt = new Date(endAt.getTime() + 86400_000);
    return { startAt, endAt, seconds: endAt ? (endAt.getTime() - startAt.getTime()) / 1000 : 0 };
  }, [date, start, end, running]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!times) {
      setError("Enter times like 09:00 or 2:30pm.");
      return;
    }
    // Build the exact payload and run the API's own schema on it before sending.
    // Without the override permission the project decides, so billable isn't sent at all.
    const billableField = canOverrideBillable ? { billable } : {};
    const patchBody: Record<string, unknown> = { description, projectId: projectId || null, ...billableField, startTime: times.startAt.toISOString() };
    if (!running && times.endAt) patchBody.endTime = times.endAt.toISOString();
    const createBody = { description, projectId: projectId || null, ...billableField, startTime: times.startAt.toISOString(), endTime: times.endAt?.toISOString() ?? "", ...(forUserId ? { userId: forUserId } : {}) };
    const problem = editing && entry ? clientCheck(entryUpdateSchema, patchBody) : clientCheck(entryManualSchema, createBody);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editing && entry) {
        const { entry: saved } = await api<{ entry: EntryDTO }>(`/api/time-entries/${entry.id}`, { method: "PATCH", json: patchBody });
        onSaved(saved);
      } else {
        const { entry: saved } = await api<{ entry: EntryDTO }>("/api/time-entries", { method: "POST", json: createBody });
        onSaved(saved);
      }
      close();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const normalize = (v: string, set: (s: string) => void) => {
    const t = parseTimeText(v);
    if (t) set(`${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? (running ? "Edit running timer" : "Edit time entry") : "Add time entry"}
      description={editing ? "Change what was worked on, the project or the times." : "Log work you already did with its start and end time."}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" form="entry-form" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add entry"}
          </button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner message={error} />
        <Field label="Description" hint="Optional." htmlFor="e-desc">
          <DescriptionInput
            multiline
            id="e-desc"
            value={description}
            onChange={setDescription}
            placeholder="e.g. Fix checkout bug"
            disabled={busy}
            onPick={(s) => {
              setDescription(s.description);
              if (s.projectId && options.some((p) => p.id === s.projectId)) setProjectId(s.projectId);
            }}
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Project" htmlFor="e-project">
            <ProjectSelect id="e-project" value={projectId} onChange={setProjectId} projects={options} />
          </Field>
          {canOverrideBillable ? (
            <Field label="Billing" hint={billableTouched ? undefined : "Follows the project"}>
              <Seg
                value={billable ? "billable" : "non_billable"}
                onChange={(v) => {
                  setBillableTouched(true);
                  setBillable(v === "billable");
                }}
                label="Billing"
                options={[{ value: "billable", label: <span className="inline-flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Billable</span> }, { value: "non_billable", label: "Non-billable" }]}
              />
            </Field>
          ) : (
            <Field label="Billing" hint="Set by the project">
              <Seg
                disabled
                value={billable ? "billable" : "non_billable"}
                onChange={() => {}}
                label="Billing"
                options={[{ value: "billable", label: <span className="inline-flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> Billable</span> }, { value: "non_billable", label: "Non-billable" }]}
              />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-3">
          <Field label="Date" htmlFor="e-date">
            <input id="e-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Start" htmlFor="e-start">
            <input id="e-start" inputMode="numeric" className="field tabular w-24 text-center" value={start} onChange={(e) => setStart(e.target.value)} onBlur={(e) => normalize(e.target.value, setStart)} placeholder="09:00" required />
          </Field>
          {!running && (
            <Field label="End" htmlFor="e-end">
              <input id="e-end" inputMode="numeric" className="field tabular w-24 text-center" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={(e) => normalize(e.target.value, setEnd)} placeholder="10:30" required />
            </Field>
          )}
        </div>
        {running ? (
          <p className="text-xs text-ink-500">This timer is still running. Stop it to set an end time.</p>
        ) : (
          <div className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2 text-sm">
            <span className="text-ink-500">Duration</span>
            <span className={cx("tabular font-bold", !times ? "text-red-600" : "text-ink-900")}>{times ? fmtHours(times.seconds) : "Check the times"}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

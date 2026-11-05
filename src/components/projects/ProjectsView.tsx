"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Coffee, DollarSign, FolderKanban, LayoutGrid, List, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg } from "@/lib/client";
import { clientCheck, projectCreateSchema, projectUpdateSchema } from "@/lib/validation";
import { invalidate, useApi } from "@/lib/useApi";
import type { ProjectDTO } from "@/app/api/projects/route";
import type { MemberDTO } from "@/app/api/users/route";
import { PROJECT_COLORS, fmtHours, initials } from "@/lib/time";
import { Avatar, Badge, EmptyState, ErrorBanner, Field, LoadError, Modal, PageHeader, Seg, Skeleton, cx } from "@/components/ui";
import { RowMenu, type RowMenuItem } from "@/components/RowMenu";

type Kind = "project" | "activity";
type FormState = { name: string; description: string; color: string; billable: boolean; memberMode: "all" | "selected"; memberIds: string[]; kind: Kind };
type View = "cards" | "list";
const PREFIXES = ["/api/projects", "/api/time-entries", "/api/dashboard", "/api/reports"];
const VIEW_KEY = "bc:projects:view";

/** Overlapping avatars for a project's team, with a "+N" tail. */
function TeamAvatars({ people, total, everyone }: { people: MemberDTO[]; total: number; everyone: boolean }) {
  const shown = people.slice(0, 5);
  const extra = Math.max(0, total - shown.length);
  return (
    <span className="flex items-center gap-2">
      {shown.length > 0 && (
        <span className="flex -space-x-2">
          {shown.map((m) => (
            <Avatar key={m.id} name={m.name} size="sm" color={m.role.color} className="ring-2 ring-white" />
          ))}
          {extra > 0 && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-[11px] font-bold text-ink-700 ring-2 ring-white">+{extra}</span>}
        </span>
      )}
      <span className="text-xs font-semibold text-ink-600">{everyone ? "Whole team" : `${total} member${total === 1 ? "" : "s"}`}</span>
    </span>
  );
}

function CardStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="tabular truncate text-sm font-extrabold text-ink-900">{value}</p>
    </div>
  );
}

function MemberPicker({ members, selected, onChange }: { members: MemberDTO[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return members.filter((m) => !t || m.name.toLowerCase().includes(t) || m.email.toLowerCase().includes(t) || m.role.name.toLowerCase().includes(t));
  }, [members, q]);
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <div className="rounded-2xl border border-ink-200">
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-ink-100 px-3 py-2 focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand-600">
        <Search className="h-4 w-4 text-ink-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" aria-label="Search members" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => onChange(list.every((m) => selected.includes(m.id)) ? selected.filter((id) => !list.some((m) => m.id === id)) : Array.from(new Set([...selected, ...list.map((m) => m.id)])))}>
          {list.every((m) => selected.includes(m.id)) ? "Clear" : "Select all"}
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto p-1">
        {list.length === 0 && <li className="px-3 py-4 text-center text-sm text-ink-500">No members match</li>}
        {list.map((m) => {
          const on = selected.includes(m.id);
          return (
            <li key={m.id}>
              <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-ink-50", on && "bg-brand-50/60")}>
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={on} onChange={(e) => toggle(m.id, e.target.checked)} />
                <Avatar name={m.name} size="sm" color={m.role.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{m.name}</span>
                  <span className="block truncate text-xs text-ink-500">{m.jobTitle || m.role.name}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProjectsView() {
  const { user, can } = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const manage = can("projects.manage");

  const projectsQ = useApi<{ projects: ProjectDTO[] }>("/api/projects?includeArchived=1", { ttlMs: 30_000 });
  const membersQ = useApi<{ members: MemberDTO[] }>(manage ? "/api/users" : null, { ttlMs: 60_000 });
  const projects = projectsQ.data?.projects ?? null;
  const members = useMemo(() => (membersQ.data?.members ?? []).filter((m) => m.isActive), [membersQ.data]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const searchParams = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>("cards");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "list" || saved === "cards") setView(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [modal, setModal] = useState<{ project: ProjectDTO | null } | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | Kind>("all");
  const [form, setForm] = useState<FormState>({ name: "", description: "", color: PROJECT_COLORS[0]!, billable: true, memberMode: "all", memberIds: [], kind: "project" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (projectsQ.error) toast.error("Couldn't load projects", projectsQ.error);
  }, [projectsQ.error, toast]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (projects ?? []).filter((p) => (showArchived || !p.isArchived) && (kindFilter === "all" || p.kind === kindFilter) && (!term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)));
  }, [projects, showArchived, kindFilter, q]);

  const openNew = (kind: Kind = "project") => {
    const used = new Set((projects ?? []).map((p) => p.color));
    setForm({ name: "", description: "", color: PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[(projects?.length ?? 0) % PROJECT_COLORS.length]!, billable: kind === "project", memberMode: "all", memberIds: [], kind });
    setError("");
    setModal({ project: null });
  };
  const openEdit = (p: ProjectDTO) => {
    setForm({ name: p.name, description: p.description, color: p.color, billable: p.billable, memberMode: p.memberMode, memberIds: p.memberIds, kind: p.kind });
    setError("");
    setModal({ project: p });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.memberMode === "selected" && form.memberIds.length === 0) {
      setError("Pick at least one member, or allow all members.");
      return;
    }
    const body = { ...form, memberIds: form.memberMode === "selected" ? form.memberIds : [] };
    // Same schema the API enforces, run here first so mistakes are caught before the round trip.
    const problem = modal?.project ? clientCheck(projectUpdateSchema, body) : clientCheck(projectCreateSchema, body);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (modal?.project) {
        await api(`/api/projects/${modal.project.id}`, { method: "PATCH", json: body });
        toast.success("Project updated");
      } else {
        await api("/api/projects", { method: "POST", json: body });
        toast.success("Project created", `"${form.name}" is ready for time tracking.`);
      }
      setModal(null);
      invalidate(...PREFIXES);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (p: ProjectDTO) => {
    try {
      await api(`/api/projects/${p.id}`, { method: "PATCH", json: { isArchived: !p.isArchived } });
      toast.success(p.isArchived ? "Project restored" : "Project archived", p.isArchived ? "Members can log time on it again." : "No new time can be logged on it. History is kept.");
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error("Couldn't update the project", errMsg(err));
    }
  };

  const remove = async (p: ProjectDTO) => {
    const ok = await confirm({ title: `Delete "${p.name}"?`, body: "This only works for projects with no time entries. Otherwise archive it to keep the history.", ok: "Delete", danger: true });
    if (!ok) return;
    try {
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      toast.success("Project deleted");
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error("Couldn't delete the project", errMsg(err));
    }
  };

  /** People on a project: everyone active for "all", otherwise the picked members (only resolvable when the member list is loaded). */
  const teamOf = (p: ProjectDTO) => (p.memberMode === "all" ? members : (p.memberIds.map((id) => memberById.get(id)).filter(Boolean) as MemberDTO[]));
  const teamTotal = (p: ProjectDTO) => (p.memberMode === "all" ? members.length || p.contributorCount : p.memberIds.length);
  const maxTotal = Math.max(1, ...visible.map((p) => p.totalSeconds));

  const menuFor = (p: ProjectDTO): RowMenuItem[] => [
    { label: "Edit project", icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(p) },
    { label: "Manage team", icon: <Users className="h-4 w-4" />, onClick: () => openEdit(p) },
    p.isArchived
      ? { label: "Restore project", icon: <ArchiveRestore className="h-4 w-4" />, onClick: () => toggleArchive(p) }
      : { label: "Archive project", icon: <Archive className="h-4 w-4" />, onClick: () => toggleArchive(p), hint: "No new time can be logged; history is kept" },
    { divider: true },
    { label: "Delete project", icon: <Trash2 className="h-4 w-4" />, onClick: () => remove(p), danger: true, disabled: p.entryCount > 0, hint: p.entryCount > 0 ? "Has time entries; archive it instead" : undefined },
  ];

  const chips = (p: ProjectDTO) => (
    <>
      {p.kind === "activity" && <Badge tone="purple"><Coffee className="h-3 w-3" /> Activity</Badge>}
      {p.billable ? <Badge tone="green"><DollarSign className="h-3 w-3" /> Billable</Badge> : <Badge tone="neutral">Non-billable</Badge>}
      {p.isArchived && <Badge tone="neutral"><Archive className="h-3 w-3" /> Archived</Badge>}
      {!p.canLog && !p.isArchived && p.memberMode === "selected" && <Badge tone="neutral">Not on team</Badge>}
    </>
  );

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={manage ? "Create the projects your team logs time against, and choose who can log time on each." : "Projects you can log time against."}
        actions={manage ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => openNew("activity")} title="A non-project bucket such as lunch, meetings or training">
              <Coffee className="h-4 w-4" /> New activity
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openNew("project")}>
              <Plus className="h-4 w-4" /> New project
            </button>
          </>
        ) : null}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="search max-w-sm flex-1">
          <Search className="h-4 w-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects" />
        </label>
        <Seg value={kindFilter} onChange={setKindFilter} label="Kind" options={[{ value: "all", label: "All" }, { value: "project", label: "Projects" }, { value: "activity", label: "Activities" }]} />
        <button type="button" className={cx("chip", showArchived && "on")} onClick={() => setShowArchived((s) => !s)}>
          <Archive className="h-3.5 w-3.5" /> Archived
        </button>
        <span className="ml-auto text-sm text-ink-500">{visible.length} project{visible.length === 1 ? "" : "s"}</span>
        <Seg value={view} onChange={chooseView} label="View" options={[{ value: "cards", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Cards</span> }, { value: "list", label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" /> List</span> }]} />
      </div>

      {projects === null && projectsQ.error ? (
        <LoadError what="projects" message={projectsQ.error} onRetry={projectsQ.refresh} />
      ) : projects === null ? (
        view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-60" />)}</div>
        ) : (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        )
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState icon={<FolderKanban className="h-6 w-6" />} title={q ? "No projects match" : kindFilter === "activity" ? "No activities yet" : "No projects yet"} body={manage ? (kindFilter === "activity" ? "Activities are non-project buckets like lunch breaks or internal meetings that members can log time against." : "Create a project with a name and description; members can then log time against it.") : "Ask an administrator to create projects."} action={manage && !q ? <button type="button" className="btn btn-primary btn-sm" onClick={() => openNew(kindFilter === "activity" ? "activity" : "project")}><Plus className="h-4 w-4" /> {kindFilter === "activity" ? "New activity" : "New project"}</button> : undefined} />
        </div>
      ) : view === "cards" ? (
        <div className={cx("grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3", projectsQ.stale && "opacity-80")}>
          {visible.map((p) => (
            <article key={p.id} className={cx("card flex flex-col p-5 transition-shadow hover:shadow-pop", p.isArchived && "opacity-70")} aria-label={p.name}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold text-white shadow-sm" style={{ background: p.color }} aria-hidden>{initials(p.name)}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-extrabold leading-tight text-ink-900">{p.name}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{chips(p)}</div>
                </div>
                {manage && <RowMenu label={`Actions for ${p.name}`} items={menuFor(p)} />}
              </div>
              <p className={cx("mt-3 line-clamp-2 min-h-[2.5rem] text-sm", p.description ? "text-ink-500" : "italic text-ink-400")}>{p.description || "No description"}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <TeamAvatars people={teamOf(p)} total={teamTotal(p)} everyone={p.memberMode === "all"} />
                <span className="shrink-0 text-xs text-ink-500">{p.contributorCount} logged time</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-ink-50 px-4 py-3">
                <CardStat label="Total logged" value={fmtHours(p.totalSeconds)} />
                <CardStat label="My time" value={fmtHours(p.mySeconds)} />
                <CardStat label="Entries" value={p.entryCount} />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(2, (p.totalSeconds / maxTotal) * 100)}%`, background: p.color }} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={cx("card p-2 transition-opacity", projectsQ.stale && "opacity-80")}>
          {/* Header row */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_7rem_9rem_5.5rem_3rem] items-center gap-3 px-4 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500 lg:grid">
            <span>Project</span>
            <span>Team</span>
            <span>Billing</span>
            <span>Total logged</span>
            <span className="text-right">My time</span>
            <span />
          </div>
          <ul className="space-y-1">
            {visible.map((p) => (
              <li key={p.id} className={cx("grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-ink-50 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_7rem_9rem_5.5rem_3rem]", p.isArchived && "opacity-70")}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold text-white" style={{ background: p.color }} aria-hidden>{initials(p.name)}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink-900">
                      <span className="truncate">{p.name}</span>
                      <span className="flex items-center gap-1 lg:hidden">{chips(p)}</span>
                      {p.isArchived && <span className="hidden lg:inline"><Badge tone="neutral">Archived</Badge></span>}
                    </p>
                    {p.description && <p className="truncate text-xs text-ink-500">{p.description}</p>}
                  </div>
                </div>
                <div className="hidden lg:block"><TeamAvatars people={teamOf(p)} total={teamTotal(p)} everyone={p.memberMode === "all"} /></div>
                <div className="hidden lg:block">{p.billable ? <Badge tone="green"><DollarSign className="h-3 w-3" /> Billable</Badge> : <Badge tone="neutral">Non-billable</Badge>}</div>
                <div className="hidden lg:block">
                  <p className="tabular text-sm font-extrabold text-ink-900">{fmtHours(p.totalSeconds)}</p>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.totalSeconds / maxTotal) * 100)}%`, background: p.color }} /></div>
                </div>
                <p className="tabular hidden text-right text-sm text-ink-700 lg:block">{fmtHours(p.mySeconds)}</p>
                <div className="flex justify-end">{manage && <RowMenu label={`Actions for ${p.name}`} items={menuFor(p)} />}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.project ? (form.kind === "activity" ? "Edit activity" : "Edit project") : form.kind === "activity" ? "New activity" : "New project"}
        description={form.kind === "activity" ? "A non-project bucket members can log time against, such as lunch, meetings or training. Usually non-billable." : "Name, description, billing and who can log time on it."}
        width="max-w-xl"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" form="project-form" className="btn btn-primary" disabled={busy || !form.name.trim()}>{busy ? "Saving…" : modal?.project ? "Save changes" : form.kind === "activity" ? "Create activity" : "Create project"}</button>
          </>
        }
      >
        <form id="project-form" onSubmit={save} className="space-y-5">
          <ErrorBanner message={error} />
          <Field label="Type">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
              <button type="button" role="radio" aria-checked={form.kind === "project"} onClick={() => setForm({ ...form, kind: "project" })} className={cx("chip", form.kind === "project" && "on")}><FolderKanban className="h-3.5 w-3.5" /> Project</button>
              <button type="button" role="radio" aria-checked={form.kind === "activity"} onClick={() => setForm({ ...form, kind: "activity", billable: modal?.project ? form.billable : false })} className={cx("chip", form.kind === "activity" && "on")}><Coffee className="h-3.5 w-3.5" /> Activity</button>
            </div>
          </Field>
          <Field label={form.kind === "activity" ? "Activity name" : "Project name"} htmlFor="p-name">
            <input id="p-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={form.kind === "activity" ? "e.g. Lunch break" : "e.g. Website Redesign"} maxLength={80} required />
          </Field>
          <Field label="Description" htmlFor="p-desc" hint={form.kind === "activity" ? "Optional. When members should log time here." : "Optional. What the project is about, so members pick the right one."}>
            <textarea id="p-desc" className="field min-h-20" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Colour">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project colour">
                {PROJECT_COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => setForm({ ...form, color: c })} className={cx("h-7 w-7 cursor-pointer rounded-full border-2 transition-transform", form.color === c ? "scale-110 border-ink-900" : "border-transparent hover:scale-105")} style={{ background: c }} />
                ))}
              </div>
            </Field>
            <Field label="Billing" hint="Entries on this project inherit this.">
              <div className="flex gap-1" role="radiogroup" aria-label="Billing">
                <button type="button" role="radio" aria-checked={form.billable} onClick={() => setForm({ ...form, billable: true })} className={cx("chip", form.billable && "on")}><DollarSign className="h-3.5 w-3.5" /> Billable</button>
                <button type="button" role="radio" aria-checked={!form.billable} onClick={() => setForm({ ...form, billable: false })} className={cx("chip", !form.billable && "on")}>Non-billable</button>
              </div>
            </Field>
          </div>
          <Field label="Who can log time" hint={form.memberMode === "all" ? "Every active member can pick this project." : "Only the selected members see this project when tracking."}>
            <div className="flex gap-1" role="radiogroup" aria-label="Team">
              <button type="button" role="radio" aria-checked={form.memberMode === "all"} onClick={() => setForm({ ...form, memberMode: "all" })} className={cx("chip", form.memberMode === "all" && "on")}><Users className="h-3.5 w-3.5" /> All members</button>
              <button type="button" role="radio" aria-checked={form.memberMode === "selected"} onClick={() => setForm({ ...form, memberMode: "selected", memberIds: form.memberIds.length ? form.memberIds : [user.id] })} className={cx("chip", form.memberMode === "selected" && "on")}>Selected members{form.memberMode === "selected" && form.memberIds.length > 0 && <span className="n">{form.memberIds.length}</span>}</button>
            </div>
          </Field>
          {form.memberMode === "selected" && (membersQ.data ? <MemberPicker members={members} selected={form.memberIds} onChange={(ids) => setForm({ ...form, memberIds: ids })} /> : <Skeleton className="h-40" />)}
        </form>
      </Modal>
    </>
  );
}

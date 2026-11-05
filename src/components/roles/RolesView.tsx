"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg } from "@/lib/client";
import { clientCheck, roleCreateSchema } from "@/lib/validation";
import { invalidate, useApi } from "@/lib/useApi";
import type { RoleDTO } from "@/lib/roles";
import { ADMIN_ONLY_PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { PROJECT_COLORS } from "@/lib/time";
import { Badge, ErrorBanner, Field, LoadError, Modal, PageHeader, Skeleton, cx } from "@/components/ui";
import { RowMenu } from "@/components/RowMenu";
import { Select } from "@/components/Select";

type Draft = { name: string; description: string; color: string; permissions: Set<string> };
const emptyDraft = (): Draft => ({ name: "", description: "", color: "#2563eb", permissions: new Set(["time.track", "projects.view", "reports.view_own"]) });
const PREFIXES = ["/api/roles", "/api/users"];
const ADMIN_ONLY = new Set<string>(ADMIN_ONLY_PERMISSIONS);
// Managing members and roles stays with the Administrator (D-001), so those keys are never offered.
const GROUPS = PERMISSION_GROUPS.map((g) => ({ ...g, permissions: g.permissions.filter((p) => !ADMIN_ONLY.has(p.key)) }));

export function RolesView() {
  const toast = useToast();
  const confirm = useConfirm();
  const rolesQ = useApi<{ roles: RoleDTO[] }>("/api/roles", { ttlMs: 60_000 });
  const roles = rolesQ.data?.roles ?? null;

  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RoleDTO | null>(null);
  const [reassignTo, setReassignTo] = useState("");

  useEffect(() => {
    if (rolesQ.error) toast.error("Couldn't load roles", rolesQ.error);
  }, [rolesQ.error, toast]);

  useEffect(() => {
    if (roles && selectedId === null) setSelectedId(roles[0]?.id ?? null);
  }, [roles, selectedId]);

  const selected = useMemo(() => (selectedId && selectedId !== "new" ? roles?.find((r) => r.id === selectedId) ?? null : null), [roles, selectedId]);

  useEffect(() => {
    setError("");
    if (selectedId === "new") setDraft(emptyDraft());
    else if (selected) setDraft({ name: selected.name, description: selected.description, color: selected.color, permissions: new Set(selected.permissions) });
  }, [selectedId, selected]);

  const locked = !!selected?.isAdmin;
  const dirty = selected
    ? draft.name !== selected.name || draft.description !== selected.description || draft.color !== selected.color || draft.permissions.size !== selected.permissions.length || selected.permissions.some((p) => !draft.permissions.has(p))
    : selectedId === "new";

  const toggle = (key: Permission, on: boolean) => {
    setDraft((d) => {
      const next = new Set(d.permissions);
      if (on) next.add(key);
      else next.delete(key);
      return { ...d, permissions: next };
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: draft.name, description: draft.description, color: draft.color, permissions: [...draft.permissions] };
    // Same schema the API enforces, run here first so mistakes are caught before the round trip.
    const problem = clientCheck(roleCreateSchema, body);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (selectedId === "new") {
        const { role } = await api<{ role: { id: string } }>("/api/roles", { method: "POST", json: body });
        toast.success("Role created", `Assign "${draft.name}" to members from the Team page.`);
        invalidate(...PREFIXES);
        setSelectedId(role.id);
      } else if (selected) {
        await api(`/api/roles/${selected.id}`, { method: "PATCH", json: selected.isSystem ? { description: body.description, color: body.color, permissions: body.permissions } : body });
        toast.success("Role updated", "Members with this role get the new permissions on their next request.");
        invalidate(...PREFIXES);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const askDelete = async (r: RoleDTO) => {
    if (r.userCount > 0) {
      setReassignTo(roles?.find((x) => x.name === "Employee")?.id ?? "");
      setDeleteTarget(r);
      return;
    }
    const ok = await confirm({ title: `Delete the "${r.name}" role?`, body: "Nobody has this role, so nothing else changes.", ok: "Delete", danger: true });
    if (ok) await doDelete(r, "");
  };

  const doDelete = async (r: RoleDTO, target: string) => {
    setBusy(true);
    try {
      await api(`/api/roles/${r.id}${target ? `?reassignTo=${encodeURIComponent(target)}` : ""}`, { method: "DELETE" });
      toast.success("Role deleted");
      setDeleteTarget(null);
      setSelectedId(null);
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error("Couldn't delete the role", errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Define what each role can do, then assign roles to members from the Team page."
        actions={<button type="button" className="btn btn-primary" onClick={() => setSelectedId("new")}><Plus className="h-4 w-4" /> New role</button>}
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-2" aria-label="Roles">
          {roles === null && rolesQ.error ? (
            <LoadError what="roles" message={rolesQ.error} onRetry={rolesQ.refresh} />
          ) : roles === null ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />) : roles.map((r) => (
            // A real button on the name covers the card (stretched with ::after); the "⋮" menu sits
            // above it, so no interactive element is nested inside another (R-057).
            <div
              key={r.id}
              className={cx("card relative w-full p-3.5 text-left transition-colors hover:border-ink-400 has-[button[data-select]:focus-visible]:ring-2 has-[button[data-select]:focus-visible]:ring-inset has-[button[data-select]:focus-visible]:ring-brand-600", selectedId === r.id && "border-brand-600 ring-1 ring-inset ring-brand-600")}
            >
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden="true" />
                <button
                  type="button"
                  data-select
                  onClick={() => setSelectedId(r.id)}
                  aria-current={selectedId === r.id ? "true" : undefined}
                  className="min-w-0 cursor-pointer truncate text-left font-semibold text-ink-900 after:absolute after:inset-0 after:rounded-[inherit] focus:outline-none"
                >
                  {r.name}
                </button>
                {r.isAdmin ? <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-400" aria-label="Locked" /> : r.isSystem ? <Badge tone="neutral" className="ml-auto">System</Badge> : null}
                {!r.isAdmin && (
                  <span className={cx("relative z-10", r.isSystem ? "" : "ml-auto", "-mr-1.5")}>
                    <RowMenu
                      label={`Actions for ${r.name}`}
                      items={[
                        { label: "Edit permissions", icon: <Pencil className="h-4 w-4" />, onClick: () => setSelectedId(r.id) },
                        ...(r.isSystem ? [] : [{ divider: true as const }, { label: "Delete role", icon: <Trash2 className="h-4 w-4" />, onClick: () => askDelete(r), danger: true }]),
                      ]}
                    />
                  </span>
                )}
              </div>
              {r.description && <p className="mt-1 line-clamp-2 text-xs text-ink-500">{r.description}</p>}
              <p className="mt-1.5 flex items-center gap-1 text-xs text-ink-500"><Users className="h-3 w-3" /> {r.userCount} member{r.userCount === 1 ? "" : "s"} · {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}</p>
            </div>
          ))}
          {selectedId === "new" && (
            <div className="card border-dashed border-brand-400 p-3.5 ring-1 ring-inset ring-brand-100">
              <p className="font-semibold text-ink-900">{draft.name || "New role"}</p>
              <p className="text-xs text-ink-500">Not saved yet</p>
            </div>
          )}
        </aside>

        <section className="card p-5" aria-label="Role editor">
          {!selected && selectedId !== "new" ? (
            <p className="text-sm text-ink-500">Select a role to view or edit it.</p>
          ) : (
            <form onSubmit={save} className="space-y-6">
              <ErrorBanner message={error} />
              {locked && (
                <div className="flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-sm text-ink-700">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <span>The Administrator role always has every permission and can&apos;t be edited or deleted. There is exactly one Administrator; only they can manage members and roles.</span>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <Field label="Role name" htmlFor="role-name" hint={selected?.isSystem && !locked ? "System role names can't be changed, but their permissions can." : undefined}>
                  <input id="role-name" className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={locked || !!selected?.isSystem} required maxLength={50} placeholder="e.g. Team Lead" />
                </Field>
                <Field label="Colour">
                  <div className="flex flex-wrap gap-1.5 pt-1.5" role="radiogroup" aria-label="Role colour">
                    {PROJECT_COLORS.map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={c} disabled={locked} onClick={() => setDraft({ ...draft, color: c })} className={cx("h-6 w-6 cursor-pointer rounded-full border-2 transition-transform disabled:cursor-not-allowed", draft.color === c ? "scale-110 border-ink-900" : "border-transparent hover:scale-105")} style={{ background: c }} />
                    ))}
                  </div>
                </Field>
              </div>
              <Field label="Description" htmlFor="role-desc">
                <input id="role-desc" className="field" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} disabled={locked} maxLength={300} placeholder="What this role is for" />
              </Field>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 font-bold text-ink-900"><ShieldCheck className="h-4 w-4 text-brand-700" /> Permissions</h3>
                  <span className="text-xs text-ink-500">{locked ? "all" : draft.permissions.size} selected</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {GROUPS.map((g) => {
                    const all = g.permissions.every((p) => locked || draft.permissions.has(p.key));
                    return (
                      <fieldset key={g.key} className="rounded-lg border border-ink-200 p-3.5" disabled={locked}>
                        <legend className="px-1 text-sm font-semibold text-ink-900">{g.label}</legend>
                        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-500">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={all} onChange={(e) => g.permissions.forEach((p) => toggle(p.key, e.target.checked))} /> Select all
                        </label>
                        <ul className="space-y-1">
                          {g.permissions.map((p) => (
                            <li key={p.key}>
                              <label className={cx("flex items-start gap-2.5 rounded-md p-1.5 transition-colors", locked ? "" : "cursor-pointer hover:bg-ink-50")}>
                                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={locked || draft.permissions.has(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                                <span>
                                  <span className="block text-sm font-medium text-ink-900">{p.label}</span>
                                  <span className="block text-xs text-ink-500">{p.description}</span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        {g.key === "team" && <p className="mt-2 px-1.5 text-xs text-ink-500">Adding members, changing roles and resetting passwords stay with the Administrator.</p>}
                      </fieldset>
                    );
                  })}
                </div>
              </div>

              {!locked && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
                  {selected && !selected.isSystem ? (
                    <button type="button" className="btn btn-danger" onClick={() => askDelete(selected)} disabled={busy}><Trash2 className="h-4 w-4" /> Delete role</button>
                  ) : <span />}
                  <div className="flex gap-2">
                    {selectedId === "new" && <button type="button" className="btn btn-secondary" onClick={() => setSelectedId(roles?.[0]?.id ?? null)}>Cancel</button>}
                    <button type="submit" className="btn btn-primary" disabled={busy || !dirty || !draft.name.trim()}>{busy ? "Saving…" : selectedId === "new" ? "Create role" : "Save changes"}</button>
                  </div>
                </div>
              )}
            </form>
          )}
        </section>
      </div>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title={`Delete "${deleteTarget?.name ?? ""}"?`} width="max-w-md" footer={<><button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="btn btn-danger-solid" disabled={busy || !reassignTo} onClick={() => deleteTarget && doDelete(deleteTarget, reassignTo)}>Move members and delete</button></>}>
        <p className="text-sm text-ink-700">{deleteTarget?.userCount} member{deleteTarget?.userCount === 1 ? " has" : "s have"} this role. Choose the role they should get instead.</p>
        <div className="mt-3">
          <label className="label" htmlFor="reassign">Move members to</label>
          <Select id="reassign" value={reassignTo} onChange={setReassignTo} placeholder="Choose a role…" options={(roles ?? []).filter((r) => r.id !== deleteTarget?.id && !r.isAdmin).map((r) => ({ value: r.id, label: r.name, color: r.color }))} searchable={false} />
        </div>
      </Modal>
    </>
  );
}

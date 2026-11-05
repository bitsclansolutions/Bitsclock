"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, KeyRound, LayoutGrid, List, Mail, Pencil, Search, Trash2, UserMinus, UserPlus, UserRoundCheck, Users } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg } from "@/lib/client";
import { adminResetPasswordSchema, clientCheck, userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { invalidate, useApi } from "@/lib/useApi";
import type { MemberDTO } from "@/app/api/users/route";
import type { RoleDTO } from "@/lib/roles";
import { fmtDate, fmtHours, startOfWeek } from "@/lib/time";
import { Avatar, Badge, EmptyState, ErrorBanner, Field, Modal, PageHeader, RoleBadge, Seg, Skeleton, cx } from "@/components/ui";
import { RowMenu, type RowMenuItem } from "@/components/RowMenu";
import { Select } from "@/components/Select";

type Form = { name: string; email: string; jobTitle: string; roleId: string; password: string };
type View = "cards" | "list";
/** What the API sends back after creating a member or resetting a password. */
type CredentialResult = { emailSent: boolean; tempPassword?: string };
/** Shown when the invitation / reset email could not be sent, so the administrator can pass the password on. */
type Credentials = { name: string; email: string; password: string };
const blank = (roleId: string): Form => ({ name: "", email: "", jobTitle: "", roleId, password: "" });
const PREFIXES = ["/api/users", "/api/roles", "/api/dashboard", "/api/projects"];
const VIEW_KEY = "bc:team:view";

/** "Today", "Yesterday", "3 days ago" or a short date. */
function lastActive(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtDate(d, days > 300 ? { year: "numeric" } : {});
}

/** One copyable line in the credentials modal. */
function CredRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the value is still selectable */
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{label}</p>
        <p className="select-all truncate font-mono text-sm text-ink-900">{value}</p>
      </div>
      <button type="button" onClick={copy} className="btn btn-secondary btn-sm shrink-0" aria-label={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="tabular truncate text-sm font-extrabold text-ink-900">{value}</p>
    </div>
  );
}

export function TeamView() {
  const { user, can } = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const manage = can("users.manage");

  const weekStart = useMemo(() => startOfWeek(new Date()).toISOString(), []);
  const membersQ = useApi<{ members: MemberDTO[] }>(`/api/users?weekStart=${encodeURIComponent(weekStart)}`, { ttlMs: 30_000 });
  const rolesQ = useApi<{ roles: RoleDTO[] }>("/api/roles", { ttlMs: 60_000 });
  const members = membersQ.data?.members ?? null;
  const roles = useMemo(() => rolesQ.data?.roles ?? [], [rolesQ.data]);

  const searchParams = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [showInactive, setShowInactive] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
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
  const [modal, setModal] = useState<{ member: MemberDTO | null } | null>(null);
  const [pwdFor, setPwdFor] = useState<MemberDTO | null>(null);
  const [pwd, setPwd] = useState("");
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [form, setForm] = useState<Form>(blank(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (membersQ.error) toast.error("Couldn't load the team", membersQ.error);
  }, [membersQ.error, toast]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (members ?? []).filter(
      (m) =>
        (showInactive || m.isActive) &&
        (!roleFilter || m.role.id === roleFilter) &&
        (!term || m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term) || m.role.name.toLowerCase().includes(term) || m.jobTitle.toLowerCase().includes(term)),
    );
  }, [members, q, showInactive, roleFilter]);

  const defaultRole = roles.find((r) => r.name === "Employee")?.id ?? roles.find((r) => !r.isAdmin)?.id ?? "";
  const roleOptions = useMemo(() => roles.map((r) => ({ value: r.id, label: r.name, color: r.color, hint: r.description || undefined })), [roles]);

  const openNew = () => {
    setForm(blank(defaultRole));
    setError("");
    setModal({ member: null });
  };
  const openEdit = (m: MemberDTO) => {
    setForm({ name: m.name, email: m.email, jobTitle: m.jobTitle, roleId: m.role.id, password: "" });
    setError("");
    setModal({ member: m });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const updateBody = { name: form.name, email: form.email, jobTitle: form.jobTitle, roleId: form.roleId };
    // Same schema the API enforces, run here first so mistakes are caught before the round trip.
    const problem = modal?.member ? clientCheck(userUpdateSchema, updateBody) : clientCheck(userCreateSchema, form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (modal?.member) {
        await api(`/api/users/${modal.member.id}`, { method: "PATCH", json: updateBody });
        toast.success("Member updated");
      } else {
        const res = await api<CredentialResult>("/api/users", { method: "POST", json: form });
        if (res.emailSent) toast.success("Invitation sent", `${form.name} received the sign-in link and a temporary password at ${form.email}.`);
        else setCreds({ name: form.name, email: form.email, password: res.tempPassword ?? form.password });
      }
      setModal(null);
      invalidate(...PREFIXES);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdFor) return;
    const problem = clientCheck(adminResetPasswordSchema, { password: pwd });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<CredentialResult>(`/api/users/${pwdFor.id}/reset-password`, { method: "POST", json: { password: pwd } });
      if (res.emailSent) toast.success("Password reset", `${pwdFor.name} was signed out everywhere and emailed the new password.`);
      else setCreds({ name: pwdFor.name, email: pwdFor.email, password: res.tempPassword ?? pwd });
      setPwdFor(null);
      setPwd("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (m: MemberDTO) => {
    const ok = await confirm({
      title: m.isActive ? `Deactivate ${m.name}?` : `Reactivate ${m.name}?`,
      body: m.isActive ? "They won't be able to sign in. Their time entries stay in reports and any running timer is stopped." : "They will be able to sign in again.",
      ok: m.isActive ? "Deactivate" : "Reactivate",
      danger: m.isActive,
    });
    if (!ok) return;
    try {
      await api(`/api/users/${m.id}`, { method: "PATCH", json: { isActive: !m.isActive } });
      toast.success(m.isActive ? "Member deactivated" : "Member reactivated");
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error("Couldn't update the member", errMsg(err));
    }
  };

  const removeMember = async (m: MemberDTO) => {
    const ok = await confirm({ title: `Delete ${m.name}?`, body: "This only works for members with no time entries. Otherwise deactivate them so their history stays in reports.", ok: "Delete", danger: true });
    if (!ok) return;
    try {
      await api(`/api/users/${m.id}`, { method: "DELETE" });
      toast.success("Member deleted");
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error("Couldn't delete the member", errMsg(err));
    }
  };

  const activeCount = (members ?? []).filter((m) => m.isActive).length;
  const maxWeek = Math.max(1, ...visible.map((m) => m.weekSeconds));

  const menuFor = (m: MemberDTO): RowMenuItem[] => [
    { label: "Edit member", icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(m) },
    { label: "Reset password", icon: <KeyRound className="h-4 w-4" />, onClick: () => { setPwdFor(m); setPwd(""); setError(""); } },
    ...(m.id !== user.id
      ? [
          m.isActive
            ? { label: "Deactivate", icon: <UserMinus className="h-4 w-4" />, onClick: () => toggleActive(m), hint: "Blocks sign-in; keeps their time in reports" }
            : { label: "Reactivate", icon: <UserRoundCheck className="h-4 w-4" />, onClick: () => toggleActive(m) },
          { divider: true as const },
          { label: "Delete member", icon: <Trash2 className="h-4 w-4" />, onClick: () => removeMember(m), danger: true, hint: "Only for members with no time entries" },
        ]
      : []),
  ];

  const statusChips = (m: MemberDTO) => (
    <>
      <RoleBadge name={m.role.name} color={m.role.color} />
      {!m.isActive && <Badge tone="neutral">Deactivated</Badge>}
      {m.running && <Badge tone="green"><span className="live-dot" /> Tracking now</Badge>}
      {m.id === user.id && <Badge tone="neutral">You</Badge>}
    </>
  );

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={manage ? "Add members, assign roles and manage access." : "Everyone in the workspace."}
        actions={manage ? <button type="button" className="btn btn-primary" onClick={openNew}><UserPlus className="h-4 w-4" /> Add member</button> : null}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="search w-full max-w-sm">
          <Search className="h-4 w-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, title or role" aria-label="Search members" />
        </label>
        <Select label="Role filter" value={roleFilter} onChange={setRoleFilter} className="w-44" options={[{ value: "", label: "All roles" }, ...roleOptions.map((o) => ({ value: o.value, label: o.label, color: o.color }))]} />
        <button type="button" className={cx("chip", showInactive && "on")} onClick={() => setShowInactive((s) => !s)}>
          Show deactivated
        </button>
        <span className="text-sm text-ink-500 lg:ml-auto">{visible.length} shown · {activeCount} active</span>
        <Seg value={view} onChange={chooseView} label="View" options={[{ value: "cards", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Cards</span> }, { value: "list", label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" /> List</span> }]} />
      </div>

      {members === null ? (
        view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : visible.length === 0 ? (
        <div className="card"><EmptyState icon={<Users className="h-6 w-6" />} title="No members match" /></div>
      ) : view === "cards" ? (
        <div className={cx("grid gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3", membersQ.stale && "opacity-80")}>
          {visible.map((m) => (
            <article key={m.id} className={cx("card flex flex-col p-5 transition-shadow hover:shadow-pop", !m.isActive && "opacity-70")} aria-label={m.name}>
              <div className="flex items-start gap-3">
                <Avatar name={m.name} size="lg" color={m.isActive ? m.role.color : "#94a3b8"} className="ring-2 ring-white shadow-sm" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-extrabold leading-tight text-ink-900">{m.name}</h3>
                  <p className="truncate text-sm text-ink-500">{m.jobTitle || "No job title"}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">{statusChips(m)}</div>
                </div>
                {manage && <RowMenu label={`Actions for ${m.name}`} items={menuFor(m)} />}
              </div>
              <a href={`mailto:${m.email}`} className="mt-3 inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-500 hover:text-ink-900"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{m.email}</span></a>
              <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-ink-50 px-4 py-3">
                <Stat label="This week" value={fmtHours(m.weekSeconds)} />
                <Stat label="All time" value={fmtHours(m.totalSeconds)} />
                <Stat label="Projects" value={m.projectCount} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-500">
                <span>Last active <span className="font-semibold text-ink-700">{lastActive(m.lastActiveAt)}</span></span>
                <span>Joined {fmtDate(m.createdAt, { year: "numeric" })}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(2, (m.weekSeconds / maxWeek) * 100)}%`, background: m.role.color }} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={cx("card p-2 transition-opacity", membersQ.stale && "opacity-80")}>
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_8rem_6.5rem_6.5rem_3rem] items-center gap-3 px-4 pb-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500 lg:grid">
            <span>Member</span>
            <span>Role</span>
            <span>Status</span>
            <span>This week</span>
            <span className="text-right">All time</span>
            <span className="text-right">Last active</span>
            <span />
          </div>
          <ul className="space-y-1">
            {visible.map((m) => (
              <li key={m.id} className={cx("grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-ink-50 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_8rem_6.5rem_6.5rem_3rem]", !m.isActive && "opacity-70")}>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} color={m.isActive ? m.role.color : "#94a3b8"} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink-900">
                      <span className="truncate">{m.name}</span>
                      {m.id === user.id && <span className="text-xs font-normal text-ink-400">(you)</span>}
                      <span className="flex items-center gap-1 lg:hidden">{statusChips(m)}</span>
                    </p>
                    <p className="truncate text-xs text-ink-500">{m.jobTitle ? `${m.jobTitle} · ` : ""}{m.email}</p>
                  </div>
                </div>
                <div className="hidden lg:block"><RoleBadge name={m.role.name} color={m.role.color} /></div>
                <div className="hidden lg:block">{m.running ? <Badge tone="green"><span className="live-dot" /> Tracking now</Badge> : m.isActive ? <Badge tone="brand">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}</div>
                <div className="hidden lg:block">
                  <p className="tabular text-sm font-extrabold text-ink-900">{fmtHours(m.weekSeconds)}</p>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max(2, (m.weekSeconds / maxWeek) * 100)}%`, background: m.role.color }} /></div>
                </div>
                <p className="tabular hidden text-right text-sm text-ink-700 lg:block">{fmtHours(m.totalSeconds)}</p>
                <p className="hidden text-right text-xs text-ink-500 lg:block">{lastActive(m.lastActiveAt)}</p>
                <div className="flex justify-end">{manage && <RowMenu label={`Actions for ${m.name}`} items={menuFor(m)} />}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.member ? "Edit member" : "Add member"}
        description={modal?.member ? "Change their details or role." : "They'll get an email with the sign-in link and a temporary password."}
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button type="submit" form="member-form" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : modal?.member ? "Save changes" : "Add member"}</button></>}
      >
        <form id="member-form" onSubmit={save} className="space-y-4">
          <ErrorBanner message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="u-name"><input id="u-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></Field>
            <Field label="Job title" htmlFor="u-title"><input id="u-title" className="field" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="e.g. Developer" maxLength={80} /></Field>
          </div>
          <Field label="Email" htmlFor="u-email"><input id="u-email" type="email" className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field label="Role" htmlFor="u-role" hint={modal?.member?.id === user.id ? "You can't change your own role." : roles.find((r) => r.id === form.roleId)?.description}>
            <Select id="u-role" value={form.roleId} onChange={(v) => setForm({ ...form, roleId: v })} options={roleOptions} placeholder="Choose a role" disabled={modal?.member?.id === user.id} />
          </Field>
          {!modal?.member && (
            <Field label="Temporary password" htmlFor="u-pwd" hint="Optional. Leave blank to generate one. It's included in the invitation email; they can change it from Settings.">
              <input id="u-pwd" type="text" autoComplete="off" className="field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Generate one for me" />
            </Field>
          )}
        </form>
      </Modal>

      <Modal
        open={!!pwdFor}
        onClose={() => setPwdFor(null)}
        title={`Reset password for ${pwdFor?.name ?? ""}`}
        description="They're signed out on every device and emailed the new temporary password."
        width="max-w-md"
        footer={<><button type="button" className="btn btn-secondary" onClick={() => setPwdFor(null)}>Cancel</button><button type="submit" form="pwd-form" className="btn btn-primary" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button></>}
      >
        <form id="pwd-form" onSubmit={resetPassword} className="space-y-4">
          <ErrorBanner message={error} />
          <Field label="Temporary password" htmlFor="rp-pwd" hint="Optional. Leave blank to generate one.">
            <input id="rp-pwd" type="text" autoComplete="off" className="field" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Generate one for me" />
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!creds}
        onClose={() => setCreds(null)}
        title="Share these sign-in details"
        description={`The email to ${creds?.name ?? "them"} couldn't be sent, so pass these on securely. The password is shown only once.`}
        width="max-w-md"
        footer={<button type="button" className="btn btn-primary" onClick={() => setCreds(null)}>Done</button>}
      >
        {creds && (
          <div className="space-y-2.5">
            <CredRow label="Sign-in page" value={`${window.location.origin}/login`} />
            <CredRow label="Email" value={creds.email} />
            <CredRow label="Temporary password" value={creds.password} />
          </div>
        )}
      </Modal>
    </>
  );
}

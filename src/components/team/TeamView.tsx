"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArchiveRestore, Check, Copy, Inbox, KeyRound, LayoutGrid, List, Mail, Pencil, Search, Trash2, UserMinus, UserPlus, UserRoundCheck, Users, X } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/context/ToastContext";
import { useConfirm } from "@/context/ConfirmContext";
import { api, errMsg } from "@/lib/client";
import { adminResetPasswordSchema, clientCheck, memberRequestCreateSchema, userCreateSchema, userUpdateSchema } from "@/lib/validation";
import type { MemberRequestDTO } from "@/lib/member-requests";
import { clearDraft, loadDraft, useDraft } from "@/lib/drafts";
import { invalidate, useApi } from "@/lib/useApi";
import type { MemberDTO } from "@/app/api/users/route";
import type { RoleDTO } from "@/lib/roles";
import { fmtDate, fmtHours, startOfWeek, toISO, zonedNow } from "@/lib/time";
import { Avatar, Badge, EmptyState, ErrorBanner, Field, LoadError, Modal, PageHeader, RoleBadge, Seg, Skeleton, cx } from "@/components/ui";
import { RowMenu, type RowMenuItem } from "@/components/RowMenu";
import { Select } from "@/components/Select";

type Form = { name: string; email: string; jobTitle: string; roleId: string; password: string };
type View = "cards" | "list";
/** What the API sends back after creating a member or resetting a password. */
type CredentialResult = { emailSent: boolean; tempPassword?: string };
/** Shown when the invitation / reset email could not be sent, so the administrator can pass the password on. */
type Credentials = { name: string; email: string; password: string };
const blank = (roleId: string): Form => ({ name: "", email: "", jobTitle: "", roleId, password: "" });
const PREFIXES = ["/api/users", "/api/roles", "/api/dashboard", "/api/projects", "/api/member-requests"];
type RequestForm = { name: string; email: string; jobTitle: string; roleId: string; note: string };
const VIEW_KEY = "bc:team:view";

/** "Today", "Yesterday", "3 days ago" or a short date. */
function lastActive(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtDate(iso, days > 300 ? { year: "numeric" } : {});
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
  // D-001: only the Administrator manages members; others may request or deactivate.
  const manage = user.isAdmin;
  const canDeactivate = can("users.deactivate");
  const canRequest = can("users.request") && !user.isAdmin;
  const requestsQ = useApi<{ requests: MemberRequestDTO[] }>(manage || canRequest ? "/api/member-requests" : null, { ttlMs: 15_000 });
  const requests = requestsQ.data?.requests ?? [];
  const pending = requests.filter((r) => r.status === "pending");
  const [requestForm, setRequestForm] = useState<RequestForm | null>(null);

  const weekStart = useMemo(() => toISO(startOfWeek(zonedNow())), []);
  const membersQ = useApi<{ members: MemberDTO[] }>(`/api/users?weekStart=${encodeURIComponent(weekStart)}`, { ttlMs: 30_000 });
  const rolesQ = useApi<{ roles: RoleDTO[] }>("/api/roles", { ttlMs: 60_000 });
  const members = membersQ.data?.members ?? null;
  const roles = useMemo(() => rolesQ.data?.roles ?? [], [rolesQ.data]);

  const searchParams = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  // Status filter: active, deactivated, both, or (Administrator) deleted accounts (D-011).
  const [status, setStatus] = useState<"active" | "inactive" | "all" | "deleted">("active");
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

  // Deleted members (Administrator, D-011) load only while that filter is on, and are shown
  // with the same card and row as everyone else.
  const showDeleted = status === "deleted" && manage;
  const deletedQ = useApi<{ members: MemberDTO[] }>(showDeleted ? `/api/users?deleted=1&weekStart=${encodeURIComponent(weekStart)}` : null, { ttlMs: 10_000 });
  const source = showDeleted ? (deletedQ.data?.members ?? null) : members;
  const listQ = showDeleted ? deletedQ : membersQ;

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (source ?? []).filter(
      (m) =>
        (showDeleted || status === "all" || (status === "active" ? m.isActive : !m.isActive)) &&
        (!roleFilter || m.role.id === roleFilter) &&
        (!term || m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term) || m.role.name.toLowerCase().includes(term) || m.jobTitle.toLowerCase().includes(term)),
    );
  }, [source, q, status, roleFilter, showDeleted]);

  const defaultRole = roles.find((r) => r.name === "Employee")?.id ?? roles.find((r) => !r.isAdmin)?.id ?? "";
  const roleOptions = useMemo(() => roles.map((r) => ({ value: r.id, label: r.name, color: r.color, hint: r.description || undefined })), [roles]);
  // There is exactly one Administrator (D-001): the role is never offered when adding, editing or requesting.
  const assignableRoleOptions = useMemo(() => roles.filter((r) => !r.isAdmin).map((r) => ({ value: r.id, label: r.name, color: r.color, hint: r.description || undefined })), [roles]);

  // Unsaved add-member and request forms survive an expired session (R-038). The temporary
  // password is deliberately left out of the draft.
  useDraft("team:new-member", { ...form, password: "" }, !!modal && !modal.member);
  useDraft("team:request", requestForm, !!requestForm);
  const closeMemberModal = () => {
    if (!modal?.member) clearDraft("team:new-member");
    setModal(null);
  };
  const closeRequest = () => {
    clearDraft("team:request");
    setRequestForm(null);
  };

  const openNew = () => {
    setForm(loadDraft<Form>("team:new-member") ?? blank(defaultRole));
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
      closeMemberModal();
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

  /** Delete a member (Administrator, D-011): the account goes, their time entries stay. */
  const removeMember = async (m: MemberDTO) => {
    const ok = await confirm({
      title: `Delete ${m.name}?`,
      body: `Their account is removed: they can't sign in and they disappear from Team and every list. Their ${fmtHours(m.totalSeconds)} of time entries stay in reports as "${m.name} (deleted)". ${m.email} can be invited again. You can restore the account from Deleted members.`,
      ok: "Delete member",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/users/${m.id}`, { method: "DELETE" });
      toast.success("Member deleted", `${m.name}'s time entries were kept.`);
      invalidate(...PREFIXES, "/api/time-entries", "/api/reports");
    } catch (err) {
      toast.error("Couldn't delete the member", errMsg(err));
    }
  };

  /** Undo a delete (Administrator, D-011): the member comes back deactivated. */
  const restoreMember = async (m: MemberDTO) => {
    const ok = await confirm({ title: `Restore ${m.name}?`, body: `${m.name} comes back as a deactivated member with ${m.email}. Reactivate them afterwards so they can sign in.`, ok: "Restore" });
    if (!ok) return;
    try {
      await api(`/api/users/${m.id}/restore`, { method: "POST" });
      toast.success("Member restored", `${m.name} is back under Deactivated.`);
      invalidate(...PREFIXES, "/api/time-entries", "/api/reports");
      deletedQ.refresh();
    } catch (err) {
      toast.error("Couldn't restore the member", errMsg(err));
    }
  };

  /** R-049: the invitation email failed earlier; send a fresh temporary password by email. */
  const resendInvite = async (m: MemberDTO) => {
    try {
      const res = await api<CredentialResult>(`/api/users/${m.id}/reset-password`, { method: "POST", json: { password: "" } });
      if (res.emailSent) toast.success("Invite sent again", `${m.name} received a new temporary password at ${m.email}.`);
      else setCreds({ name: m.name, email: m.email, password: res.tempPassword ?? "" });
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error("Couldn't resend the invite", errMsg(err));
    }
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm) return;
    const problem = clientCheck(memberRequestCreateSchema, requestForm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/member-requests", { method: "POST", json: requestForm });
      toast.success("Request sent", `The Administrator will review adding ${requestForm.name}.`);
      closeRequest();
      invalidate("/api/member-requests");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (r: MemberRequestDTO, decision: "approve" | "reject") => {
    if (decision === "reject") {
      const ok = await confirm({ title: `Reject the request for ${r.name}?`, body: `${r.requestedBy.name} asked to add ${r.email}. Nobody is created.`, ok: "Reject", danger: true });
      if (!ok) return;
    }
    try {
      const res = await api<CredentialResult & { status: string }>(`/api/member-requests/${r.id}`, { method: "POST", json: { decision } });
      if (decision === "reject") toast.success("Request rejected");
      else if (res.emailSent) toast.success("Member added", `${r.name} received the sign-in link and a temporary password at ${r.email}.`);
      else setCreds({ name: r.name, email: r.email, password: res.tempPassword ?? "" });
      invalidate(...PREFIXES);
    } catch (err) {
      toast.error(decision === "approve" ? "Couldn't approve the request" : "Couldn't reject the request", errMsg(err));
      invalidate("/api/member-requests");
    }
  };

  const activeCount = (members ?? []).filter((m) => m.isActive).length;
  const maxWeek = Math.max(1, ...visible.map((m) => m.weekSeconds));
  const isAdminMember = (m: MemberDTO) => roles.find((r) => r.id === m.role.id)?.isAdmin ?? m.role.name === "Administrator";

  const menuFor = (m: MemberDTO): RowMenuItem[] => {
    if (m.deletedAt) return manage ? [{ label: "Restore member", icon: <ArchiveRestore className="h-4 w-4" />, onClick: () => restoreMember(m), hint: "Comes back deactivated" }] : [];
    const adminRow = isAdminMember(m);
    const self = m.id === user.id;
    if (!manage) {
      // users.deactivate holders: deactivate only, never the Administrator or themselves.
      return canDeactivate && !adminRow && !self && m.isActive
        ? [{ label: "Deactivate", icon: <UserMinus className="h-4 w-4" />, onClick: () => toggleActive(m), hint: "Blocks sign-in; keeps their time in reports" }]
        : [];
    }
    return [
      { label: "Edit member", icon: <Pencil className="h-4 w-4" />, onClick: () => openEdit(m) },
      ...(m.inviteEmailFailed && m.isActive && !adminRow ? [{ label: "Resend invite", icon: <Mail className="h-4 w-4" />, onClick: () => resendInvite(m), hint: "New temporary password by email" }] : []),
      ...(!adminRow ? [{ label: "Reset password", icon: <KeyRound className="h-4 w-4" />, onClick: () => { setPwdFor(m); setPwd(""); setError(""); } }] : []),
      ...(!self && !adminRow
        ? [
            m.isActive
              ? { label: "Deactivate", icon: <UserMinus className="h-4 w-4" />, onClick: () => toggleActive(m), hint: "Blocks sign-in; keeps their time in reports" }
              : { label: "Reactivate", icon: <UserRoundCheck className="h-4 w-4" />, onClick: () => toggleActive(m) },
            // Soft delete (D-011): the account goes, the time entries stay.
            { divider: true as const },
            { label: "Delete member", icon: <Trash2 className="h-4 w-4" />, onClick: () => removeMember(m), danger: true, hint: "Removes the account; keeps their time entries" },
          ]
        : []),
    ];
  };

  const statusChips = (m: MemberDTO) => (
    <>
      <RoleBadge name={m.role.name} color={m.role.color} />
      {m.deletedAt ? <Badge tone="red">Deleted {fmtDate(m.deletedAt)}</Badge> : !m.isActive && <Badge tone="neutral">Deactivated</Badge>}
      {manage && m.inviteEmailFailed && m.isActive && <Badge tone="amber">Invite email failed</Badge>}
      {m.running && <Badge tone="green"><span className="live-dot" /> Tracking now</Badge>}
      {m.id === user.id && <Badge tone="neutral">You</Badge>}
    </>
  );

  return (
    <>
      <PageHeader
        title="Team"
        subtitle={manage ? "Add members, assign roles and manage access." : "Everyone in the workspace."}
        actions={
          manage ? (
            <button type="button" className="btn btn-primary" onClick={openNew}><UserPlus className="h-4 w-4" /> Add member</button>
          ) : canRequest ? (
            <button type="button" className="btn btn-primary" onClick={() => { setError(""); setRequestForm(loadDraft<RequestForm>("team:request") ?? { name: "", email: "", jobTitle: "", roleId: defaultRole, note: "" }); }}><UserPlus className="h-4 w-4" /> Request member</button>
          ) : null
        }
      />

      {(manage ? pending.length > 0 : requests.length > 0) && (
        <section className="card mb-5 p-4" aria-label={manage ? "Member requests waiting for you" : "Your member requests"}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-900">
            <Inbox className="h-4 w-4 text-brand-700" /> {manage ? `Member requests (${pending.length})` : "Your requests"}
          </h2>
          <ul className="divide-y divide-ink-100">
            {(manage ? pending : requests).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">
                    {r.name} <span className="font-normal text-ink-500">· {r.email}</span>
                  </p>
                  <p className="text-xs text-ink-500">
                    {r.jobTitle ? `${r.jobTitle} · ` : ""}as <span className="font-medium text-ink-700">{r.role.name}</span>
                    {manage ? ` · asked by ${r.requestedBy.name}` : ""} · {fmtDate(r.createdAt)}
                    {r.note ? ` · “${r.note}”` : ""}
                  </p>
                </div>
                {manage ? (
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(r, "reject")}><X className="h-3.5 w-3.5" /> Reject</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(r, "approve")}><Check className="h-3.5 w-3.5" /> Approve</button>
                  </div>
                ) : (
                  <Badge tone={r.status === "approved" ? "green" : "neutral"}>{r.status === "pending" ? "Waiting for approval" : r.status === "approved" ? "Approved" : "Rejected"}</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="search w-full max-w-sm">
          <Search className="h-4 w-4 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, title or role" aria-label="Search members" />
        </label>
        <Select label="Role filter" value={roleFilter} onChange={setRoleFilter} className="w-44" options={[{ value: "", label: "All roles" }, ...roleOptions.map((o) => ({ value: o.value, label: o.label, color: o.color }))]} />
        <Seg
          label="Member status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Deactivated" },
            { value: "all", label: "All" },
            ...(manage ? [{ value: "deleted" as const, label: <span className="inline-flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Deleted</span> }] : []),
          ]}
        />
        {/* lg:ml-auto here is what pushes the count and the Cards / List toggle to the right. */}
        <span className="text-sm text-ink-500 lg:ml-auto">{showDeleted ? `${visible.length} deleted` : `${visible.length} shown · ${activeCount} active`}</span>
        <Seg value={view} onChange={chooseView} label="View" options={[{ value: "cards", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Cards</span> }, { value: "list", label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" /> List</span> }]} />
      </div>

      {source === null && listQ.error ? (
        <LoadError what={showDeleted ? "deleted members" : "the team"} message={listQ.error} onRetry={listQ.refresh} />
      ) : source === null ? (
        view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        )
      ) : visible.length === 0 ? (
        <div className="card">
          {showDeleted ? (
            <EmptyState icon={<Trash2 className="h-6 w-6" />} title={source?.length ? "No deleted members match" : "No deleted members"} body="Members you delete show here. Their time entries stay in reports." />
          ) : (
            <EmptyState icon={<Users className="h-6 w-6" />} title="No members match" />
          )}
        </div>
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
                {menuFor(m).length > 0 && <RowMenu label={`Actions for ${m.name}`} items={menuFor(m)} />}
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
                <div className="hidden lg:block">{m.deletedAt ? <Badge tone="red">Deleted</Badge> : m.running ? <Badge tone="green"><span className="live-dot" /> Tracking now</Badge> : m.isActive ? <Badge tone="brand">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}</div>
                <div className="hidden lg:block">
                  <p className="tabular text-sm font-extrabold text-ink-900">{fmtHours(m.weekSeconds)}</p>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100" aria-hidden><div className="h-full rounded-full" style={{ width: `${Math.max(2, (m.weekSeconds / maxWeek) * 100)}%`, background: m.role.color }} /></div>
                </div>
                <p className="tabular hidden text-right text-sm text-ink-700 lg:block">{fmtHours(m.totalSeconds)}</p>
                <p className="hidden text-right text-xs text-ink-500 lg:block">{lastActive(m.lastActiveAt)}</p>
                <div className="flex justify-end">{menuFor(m).length > 0 && <RowMenu label={`Actions for ${m.name}`} items={menuFor(m)} />}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={closeMemberModal}
        title={modal?.member ? "Edit member" : "Add member"}
        description={modal?.member ? "Change their details or role." : "They'll get an email with the sign-in link and a temporary password."}
        footer={<><button type="button" className="btn btn-secondary" onClick={closeMemberModal}>Cancel</button><button type="submit" form="member-form" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : modal?.member ? "Save changes" : "Add member"}</button></>}
      >
        <form id="member-form" onSubmit={save} className="space-y-4">
          <ErrorBanner message={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="u-name"><input id="u-name" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></Field>
            <Field label="Job title" htmlFor="u-title"><input id="u-title" className="field" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="e.g. Developer" maxLength={80} /></Field>
          </div>
          <Field label="Email" htmlFor="u-email"><input id="u-email" type="email" className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field
            label="Role"
            htmlFor="u-role"
            hint={modal?.member && isAdminMember(modal.member) ? "There is exactly one Administrator; this role can't change." : roles.find((r) => r.id === form.roleId)?.description}
          >
            <Select
              id="u-role"
              value={form.roleId}
              onChange={(v) => setForm({ ...form, roleId: v })}
              options={modal?.member && isAdminMember(modal.member) ? roleOptions : assignableRoleOptions}
              placeholder="Choose a role"
              disabled={!!modal?.member && (modal.member.id === user.id || isAdminMember(modal.member))}
            />
          </Field>
          {!modal?.member && (
            <Field label="Temporary password" htmlFor="u-pwd" hint="Optional. Leave blank to generate one. It's included in the invitation email; they can change it from their Profile.">
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

      <Modal
        open={!!requestForm}
        onClose={closeRequest}
        title="Request a new member"
        description="The Administrator reviews the request. Once approved, the person gets an email with the sign-in link and a temporary password."
        footer={<><button type="button" className="btn btn-secondary" onClick={closeRequest}>Cancel</button><button type="submit" form="request-form" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button></>}
      >
        {requestForm && (
          <form id="request-form" onSubmit={submitRequest} className="space-y-4">
            <ErrorBanner message={error} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="rq-name"><input id="rq-name" className="field" value={requestForm.name} onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })} required maxLength={80} /></Field>
              <Field label="Job title" htmlFor="rq-title"><input id="rq-title" className="field" value={requestForm.jobTitle} onChange={(e) => setRequestForm({ ...requestForm, jobTitle: e.target.value })} maxLength={80} /></Field>
            </div>
            <Field label="Email" htmlFor="rq-email"><input id="rq-email" type="email" className="field" value={requestForm.email} onChange={(e) => setRequestForm({ ...requestForm, email: e.target.value })} required /></Field>
            <Field label="Role" htmlFor="rq-role" hint={roles.find((r) => r.id === requestForm.roleId)?.description}>
              <Select id="rq-role" value={requestForm.roleId} onChange={(v) => setRequestForm({ ...requestForm, roleId: v })} options={assignableRoleOptions} placeholder="Choose a role" />
            </Field>
            <Field label="Note for the Administrator" htmlFor="rq-note" hint="Optional, e.g. start date or team.">
              <input id="rq-note" className="field" value={requestForm.note} onChange={(e) => setRequestForm({ ...requestForm, note: e.target.value })} maxLength={300} />
            </Field>
          </form>
        )}
      </Modal>
    </>
  );
}

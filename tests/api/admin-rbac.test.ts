import { describe, expect, it } from "vitest";
import { GET as listUsers, POST as createUser } from "@/app/api/users/route";
import { POST as restoreUser } from "@/app/api/users/[id]/restore/route";
import { GET as listEntries } from "@/app/api/time-entries/route";
import { POST as login } from "@/app/api/auth/login/route";
import { makeEntry } from "../helpers/entries";
import { newBrowser } from "../helpers/cookies";
import * as userRoute from "@/app/api/users/[id]/route";
import { PATCH as patchUser } from "@/app/api/users/[id]/route";
import { POST as resetPassword } from "@/app/api/users/[id]/reset-password/route";
import { POST as createRole } from "@/app/api/roles/route";
import { PATCH as patchRole, DELETE as deleteRole } from "@/app/api/roles/[id]/route";
import { GET as listRequests, POST as createRequest } from "@/app/api/member-requests/route";
import { POST as decideRequest } from "@/app/api/member-requests/[id]/route";
import { POST as startTimer } from "@/app/api/time-entries/start/route";
import { prisma } from "@/lib/prisma";
import { call } from "../helpers/http";
import { makeAdmin, makeRole, makeUser, signIn, TEST_PASSWORD } from "../helpers/factories";
import { systemRoles } from "../helpers/db";

const newMember = (roleId: string, email = `new-${Math.random().toString(36).slice(2, 8)}@example.test`) => ({ name: "New Person", email, roleId });

/** A role that still carries users.manage / roles.manage rows, as roles could before D-001. */
async function legacyDelegatedRole() {
  const role = await makeRole(["users.view"]);
  await prisma.rolePermission.createMany({ data: [{ roleId: role.id, permission: "users.manage" }, { roleId: role.id, permission: "roles.manage" }] });
  return role;
}

describe("H1: delegated admins can't escalate (D-001)", () => {
  it("users.manage and roles.manage can't be granted to a role", async () => {
    await signIn(await makeAdmin());
    for (const permission of ["users.manage", "roles.manage"]) {
      const res = await call(createRole, "POST", "/api/roles", { body: { name: `R ${permission}`, permissions: ["time.track", permission] } });
      expect(res.status).toBe(400);
    }
  });

  it("a legacy role row granting users.manage gives no power: every escalation path is 403", async () => {
    const { admin } = await systemRoles();
    const realAdmin = await makeAdmin();
    const insider = await makeUser({ role: await legacyDelegatedRole() });
    const sidekick = await makeUser();
    await signIn(insider);
    // The four reproductions from the security audit:
    expect((await call(createUser, "POST", "/api/users", { body: { ...newMember(admin.id), password: "Shadow1234x" } })).status).toBe(403);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: sidekick.id }, body: { roleId: admin.id } })).status).toBe(403);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: realAdmin.id }, body: { email: "owned@example.test" } })).status).toBe(403);
    expect((await call(resetPassword, "POST", "/api/users/x/reset-password", { params: { id: realAdmin.id }, body: {} })).status).toBe(403);
    // And the roles.manage paths:
    expect((await call(patchRole, "PATCH", "/api/roles/x", { params: { id: insider.roleId }, body: { permissions: ["time.manage_all"] } })).status).toBe(403);
    expect((await call(deleteRole, "DELETE", "/api/roles/x", { params: { id: insider.roleId }, query: `?reassignTo=${admin.id}` })).status).toBe(403);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: insider.id }, include: { role: true } });
    expect(after.role.name).not.toBe("Administrator");
  });

  it("even the Administrator can't create or promote a second Administrator", async () => {
    const { admin } = await systemRoles();
    await signIn(await makeAdmin());
    const employee = await makeUser();
    const adminsBefore = await prisma.user.count({ where: { roleId: admin.id } });
    expect((await call(createUser, "POST", "/api/users", { body: newMember(admin.id) })).status).toBe(403);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: employee.id }, body: { roleId: admin.id } })).status).toBe(403);
    const custom = await makeRole(["time.track"]);
    await makeUser({ role: custom });
    expect((await call(deleteRole, "DELETE", "/api/roles/x", { params: { id: custom.id }, query: `?reassignTo=${admin.id}` })).status).toBe(403);
    expect(await prisma.user.count({ where: { roleId: admin.id } })).toBe(adminsBefore);
  });

  it("the Administrator account can't be demoted, deactivated or deleted (R-019)", async () => {
    const { employee } = await systemRoles();
    const admin = await makeAdmin();
    await signIn(admin);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: admin.id }, body: { roleId: employee.id } })).status).toBe(400);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: admin.id }, body: { isActive: false } })).status).toBe(400);
    expect((await call(resetPassword, "POST", "/api/users/x/reset-password", { params: { id: admin.id }, body: {} })).status).toBe(403);
  });

  it("the Administrator account can't be deleted, not even by itself (D-011)", async () => {
    const admin = await makeAdmin();
    await signIn(admin);
    expect((await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: admin.id } })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).deletedAt).toBeNull();
  });

  it("parallel attempts to remove the Administrator all fail (R-069, real Postgres)", async () => {
    const { employee } = await systemRoles();
    const admin = await makeAdmin();
    const deactivator = await makeUser({ role: await makeRole(["users.deactivate"]) });
    const jarAdmin = await signIn(admin);
    const jarDeact = await signIn(deactivator);
    const { switchJar } = await import("../helpers/cookies");
    const attempts = await Promise.all([
      (async () => (switchJar(jarAdmin), call(patchUser, "PATCH", "/api/users/x", { params: { id: admin.id }, body: { roleId: employee.id } })))(),
      (async () => (switchJar(jarDeact), call(patchUser, "PATCH", "/api/users/x", { params: { id: admin.id }, body: { isActive: false } })))(),
    ]);
    expect(attempts.every((r) => r.status >= 400)).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, include: { role: true } });
    expect(after.isActive).toBe(true);
    expect(after.role.name).toBe("Administrator");
  });
});

describe("users.deactivate (D-001)", () => {
  it("deactivates a member: sessions revoked, timer stopped, audit written", async () => {
    const deactivator = await makeUser({ role: await makeRole(["users.deactivate"]) });
    const leaver = await makeUser();
    await signIn(leaver);
    await call(startTimer, "POST", "/api/time-entries/start", { body: {} });
    await signIn(deactivator);
    const res = await call(patchUser, "PATCH", "/api/users/x", { params: { id: leaver.id }, body: { isActive: false } });
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(row.isActive).toBe(false);
    expect(row.tokenVersion).toBe(1);
    expect(await prisma.refreshSession.count({ where: { userId: leaver.id, revokedAt: null } })).toBe(0);
    expect(await prisma.timeEntry.count({ where: { userId: leaver.id, endTime: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "user.deactivate", targetId: leaver.id, actorId: deactivator.id } })).toBe(1);
  });

  it("can't do anything else, can't touch the Administrator, can't deactivate themselves", async () => {
    const { employee } = await systemRoles();
    const admin = await makeAdmin();
    const deactivator = await makeUser({ role: await makeRole(["users.deactivate"]) });
    const other = await makeUser();
    await signIn(deactivator);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: admin.id }, body: { isActive: false } })).status).toBe(403);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: deactivator.id }, body: { isActive: false } })).status).toBe(400);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: other.id }, body: { roleId: employee.id } })).status).toBe(403);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: other.id }, body: { isActive: true } })).status).toBe(403);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: other.id }, body: { isActive: false, name: "Renamed" } })).status).toBe(403);
  });
});

describe("member delete is a soft delete (D-011)", () => {
  const range = `?from=2000-01-02T00:00:00.000Z&to=${encodeURIComponent(new Date(Date.now() + 86400_000).toISOString())}&userId=all`;

  it("removes the account, keeps the entries, frees the email", async () => {
    const admin = await makeAdmin();
    const leaver = await makeUser();
    await makeEntry(leaver.id, new Date(Date.now() - 3 * 3600_000).toISOString(), 60, { description: "Kept work" });
    await signIn(leaver);
    await call(startTimer, "POST", "/api/time-entries/start", { body: {} });
    await signIn(admin);

    expect((await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: leaver.id } })).status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: leaver.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
    expect(row.deletedEmail).toBe(leaver.email);
    expect(row.email).not.toBe(leaver.email);
    expect(await prisma.refreshSession.count({ where: { userId: leaver.id, revokedAt: null } })).toBe(0);
    // Entries stay (the running timer was stopped, not removed).
    expect(await prisma.timeEntry.count({ where: { userId: leaver.id } })).toBe(2);
    expect(await prisma.timeEntry.count({ where: { userId: leaver.id, endTime: null } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "user.delete", targetId: leaver.id } })).toBe(1);

    // Gone from Team and pickers; listed under deleted members with the real email.
    const team = await call<{ members: { id: string }[] }>(listUsers, "GET", "/api/users");
    expect(team.body.members.some((m) => m.id === leaver.id)).toBe(false);
    // Same shape as the normal list (same card/row on Team), with the email on record.
    const gone = await call<{ members: { id: string; email: string; deletedAt: string | null; totalSeconds: number }[] }>(listUsers, "GET", "/api/users", { query: "?deleted=1" });
    expect(gone.body.members).toEqual([expect.objectContaining({ id: leaver.id, email: leaver.email, totalSeconds: expect.any(Number) })]);
    expect(gone.body.members[0]!.deletedAt).not.toBeNull();

    // Their entries still show, marked.
    const list = await call<{ entries: { user: { id: string; name: string } }[] }>(listEntries, "GET", "/api/time-entries", { query: range });
    const theirs = list.body.entries.filter((e) => e.user.id === leaver.id);
    expect(theirs.length).toBe(2);
    expect(theirs.every((e) => e.user.name.endsWith("(deleted)"))).toBe(true);

    // They can't sign in, and the address can be invited again.
    newBrowser();
    expect((await call(login, "POST", "/api/auth/login", { body: { email: leaver.email, password: TEST_PASSWORD } })).status).toBe(401);
    await signIn(admin);
    const { employee } = await systemRoles();
    expect((await call(createUser, "POST", "/api/users", { body: newMember(employee.id, leaver.email) })).status).toBe(201);
  });

  it("only the Administrator can delete; deleted members can't be edited or deleted twice", async () => {
    const deactivator = await makeUser({ role: await makeRole(["users.deactivate", "users.view"]) });
    const target = await makeUser();
    await signIn(deactivator);
    expect((await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: target.id } })).status).toBe(403);
    expect((await call(listUsers, "GET", "/api/users", { query: "?deleted=1" })).status).toBe(403);
    await signIn(await makeAdmin());
    expect((await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: target.id } })).status).toBe(200);
    expect((await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: target.id } })).status).toBe(404);
    expect((await call(patchUser, "PATCH", "/api/users/x", { params: { id: target.id }, body: { name: "Back" } })).status).toBe(404);
    expect((await call(resetPassword, "POST", "/api/users/x/reset-password", { params: { id: target.id }, body: {} })).status).toBe(404);
  });

  it("restore brings the member back deactivated, unless the email was reused", async () => {
    const { employee } = await systemRoles();
    await signIn(await makeAdmin());
    const a = await makeUser();
    const b = await makeUser();
    await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: a.id } });
    await call(userRoute.DELETE, "DELETE", "/api/users/x", { params: { id: b.id } });

    expect((await call(restoreUser, "POST", "/api/users/x/restore", { params: { id: a.id } })).status).toBe(200);
    const back = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(back).toMatchObject({ email: a.email, deletedAt: null, deletedEmail: null, isActive: false });

    // b's address is given to someone new, so b can't be restored with it.
    expect((await call(createUser, "POST", "/api/users", { body: newMember(employee.id, b.email) })).status).toBe(201);
    expect((await call(restoreUser, "POST", "/api/users/x/restore", { params: { id: b.id } })).status).toBe(409);
  });
});

describe("member requests (D-001)", () => {
  it("request → approve creates the member once; a second approval is refused", async () => {
    const { employee } = await systemRoles();
    const requester = await makeUser({ role: await makeRole(["users.request"]) });
    await signIn(requester);
    const email = "requested@example.test";
    const created = await call<{ request: { id: string } }>(createRequest, "POST", "/api/member-requests", { body: newMember(employee.id, email) });
    expect(created.status).toBe(201);
    expect((await call(createRequest, "POST", "/api/member-requests", { body: newMember(employee.id, email) })).status).toBe(409);
    const mine = await call<{ requests: { status: string }[] }>(listRequests, "GET", "/api/member-requests");
    expect(mine.body.requests.map((r) => r.status)).toEqual(["pending"]);
    // The requester can't approve their own request.
    expect((await call(decideRequest, "POST", "/api/member-requests/x", { params: { id: created.body.request.id }, body: { decision: "approve" } })).status).toBe(403);

    await signIn(await makeAdmin());
    const approved = await call<{ emailSent: boolean; tempPassword?: string }>(decideRequest, "POST", "/api/member-requests/x", { params: { id: created.body.request.id }, body: { decision: "approve" } });
    expect(approved.status).toBe(201);
    // SMTP is off in tests, so the temporary password comes back once for the Administrator to pass on.
    expect(approved.body.emailSent).toBe(false);
    expect(approved.body.tempPassword).toMatch(/^\S{12}$/);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const again = await call(decideRequest, "POST", "/api/member-requests/x", { params: { id: created.body.request.id }, body: { decision: "approve" } });
    expect(again.status).toBe(409);
  });

  it("parallel approvals of the same request create exactly one member (R-069, real Postgres)", async () => {
    const { employee } = await systemRoles();
    const requester = await makeUser({ role: await makeRole(["users.request"]) });
    const request = await prisma.memberRequest.create({ data: { name: "Racer", email: "racer@example.test", roleId: employee.id, requestedById: requester.id } });
    await signIn(await makeAdmin());
    const results = await Promise.all(Array.from({ length: 4 }, () => call(decideRequest, "POST", "/api/member-requests/x", { params: { id: request.id }, body: { decision: "approve" } })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.user.count({ where: { email: "racer@example.test" } })).toBe(1);
  });

  it("a request can't ask for the Administrator role or an existing member's email", async () => {
    const { admin, employee } = await systemRoles();
    const existing = await makeUser();
    await signIn(await makeUser({ role: await makeRole(["users.request"]) }));
    expect((await call(createRequest, "POST", "/api/member-requests", { body: newMember(admin.id) })).status).toBe(403);
    expect((await call(createRequest, "POST", "/api/member-requests", { body: newMember(employee.id, existing.email) })).status).toBe(409);
  });

  it("reject marks the request rejected and creates nobody", async () => {
    const { employee } = await systemRoles();
    const requester = await makeUser({ role: await makeRole(["users.request"]) });
    const request = await prisma.memberRequest.create({ data: { name: "Nope", email: "nope@example.test", roleId: employee.id, requestedById: requester.id } });
    await signIn(await makeAdmin());
    expect((await call(decideRequest, "POST", "/api/member-requests/x", { params: { id: request.id }, body: { decision: "reject" } })).status).toBe(200);
    expect((await prisma.memberRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("rejected");
    expect(await prisma.user.count({ where: { email: "nope@example.test" } })).toBe(0);
  });

  it("users without users.request get 403", async () => {
    const { employee } = await systemRoles();
    await signIn(await makeUser());
    expect((await call(createRequest, "POST", "/api/member-requests", { body: newMember(employee.id) })).status).toBe(403);
    expect((await call(listRequests, "GET", "/api/member-requests")).status).toBe(403);
  });
});

describe("audit log", () => {
  it("records member creation, role changes and password resets", async () => {
    const admin = await makeAdmin();
    const { employee } = await systemRoles();
    const custom = await makeRole(["time.track"]);
    await signIn(admin);
    const created = await call<{ member: { id: string } }>(createUser, "POST", "/api/users", { body: newMember(employee.id) });
    const id = created.body.member.id;
    await call(patchUser, "PATCH", "/api/users/x", { params: { id }, body: { roleId: custom.id } });
    await call(resetPassword, "POST", "/api/users/x/reset-password", { params: { id }, body: {} });
    const actions = (await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    // SMTP is off in tests, so each email that couldn't go out is recorded too (R-049).
    expect(actions).toEqual(["user.create", "user.email_failed", "user.role_change", "user.password_reset", "user.email_failed"]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).inviteEmailFailedAt).not.toBeNull();
  });
});

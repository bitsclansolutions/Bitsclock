import { describe, expect, it } from "vitest";
import { GET as searchRoute } from "@/app/api/search/route";
import type { SearchDTO } from "@/lib/search";
import { call } from "../helpers/http";
import { makeAdmin, makeRole, makeUser, signIn } from "../helpers/factories";
import { makeEntry, makeProject } from "../helpers/entries";

const run = (q: string) => call<SearchDTO>(searchRoute, "GET", "/api/search", { query: "?" + new URLSearchParams({ q }).toString() });

describe("global search respects permissions", () => {
  it("a member finds only their own entries, from any date, and no members or roles", async () => {
    const role = await makeRole(["time.track", "projects.view"]);
    const me = await makeUser({ role });
    const other = await makeUser({ name: "Zebra Other" });
    await makeEntry(me.id, "2024-01-05T09:00:00Z", 30, { description: "Quokka design review" });
    await makeEntry(other.id, "2026-01-05T09:00:00Z", 30, { description: "Quokka secret work" });
    await signIn(me);

    const res = await run("quokka");
    expect(res.status).toBe(200);
    expect(res.body.entries?.map((e) => e.description)).toEqual(["Quokka design review"]);
    expect(res.body.members).toBeNull();
    expect(res.body.roles).toBeNull();
  });

  it("only shows projects the member may log time on", async () => {
    const role = await makeRole(["time.track", "projects.view"]);
    const me = await makeUser({ role });
    await makeProject({ name: "Walrus open" });
    await makeProject({ name: "Walrus private", memberMode: "selected" });
    await signIn(me);

    const res = await run("walrus");
    expect(res.body.projects?.map((p) => p.name)).toEqual(["Walrus open"]);
  });

  it("time viewers find everyone's entries but no members without a member permission", async () => {
    const role = await makeRole(["time.track", "time.view_all", "reports.view_all"]);
    const lead = await makeUser({ role });
    const other = await makeUser({ name: "Narwhal Person" });
    await makeEntry(other.id, "2025-06-01T09:00:00Z", 15, { description: "Standup" });
    await signIn(lead);

    const res = await run("narwhal");
    expect(res.body.entries?.map((e) => e.user.name)).toEqual(["Narwhal Person"]);
    expect(res.body.members).toBeNull();
  });

  it("users.view alone finds members but no entries of others or roles", async () => {
    const role = await makeRole(["users.view"]);
    const viewer = await makeUser({ role });
    const other = await makeUser({ name: "Ocelot Person" });
    await makeEntry(other.id, "2025-06-01T09:00:00Z", 15, { description: "Ocelot task" });
    await signIn(viewer);

    const res = await run("ocelot");
    expect(res.body.members?.map((m) => m.name)).toEqual(["Ocelot Person"]);
    expect(res.body.entries).toBeNull();
    expect(res.body.projects).toBeNull();
    expect(res.body.roles).toBeNull();
  });

  it("the Administrator also finds roles and member emails", async () => {
    const admin = await makeAdmin();
    await makeRole([], "Platypus role");
    await makeUser({ name: "Platypus Member" });
    await signIn(admin);

    const res = await run("platypus");
    expect(res.body.roles?.map((r) => r.name)).toEqual(["Platypus role"]);
    expect(res.body.members?.[0]?.email).toMatch(/@example\.test$/);
  });

  it("rejects a one-character query and requires sign-in", async () => {
    await signIn(await makeUser());
    expect((await run("a")).status).toBe(400);
  });
});

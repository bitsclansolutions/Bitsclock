import { describe, expect, it } from "vitest";
import { GET as changes } from "@/app/api/changes/route";
import { POST as createEntry } from "@/app/api/time-entries/route";
import { call } from "../helpers/http";
import { makeAdmin, makeUser, signIn } from "../helpers/factories";
import { minutesFromNow } from "../helpers/entries";
import { newBrowser, switchJar } from "../helpers/cookies";

const token = async () => (await call<{ token: string }>(changes, "GET", "/api/changes")).body.token;

describe("GET /api/changes (change feed)", () => {
  it("moves when the caller's own entries change", async () => {
    const me = await makeUser();
    await signIn(me);
    const before = await token();
    const res = await call(createEntry, "POST", "/api/time-entries", { body: { description: "Feed test", startTime: minutesFromNow(-60), endTime: minutesFromNow(-30) } });
    expect(res.status).toBe(201);
    expect(await token()).not.toBe(before);
  });

  it("a team viewer's token moves when someone else logs time; a member's does not", async () => {
    const admin = await makeAdmin();
    const member = await makeUser();
    const other = await makeUser();

    const adminJar = await signIn(admin);
    const adminBefore = await token();
    const memberJar = await signIn(member);
    const memberBefore = await token();

    await signIn(other);
    await call(createEntry, "POST", "/api/time-entries", { body: { description: "Other's work", startTime: minutesFromNow(-60), endTime: minutesFromNow(-30) } });

    switchJar(adminJar);
    expect(await token()).not.toBe(adminBefore);
    switchJar(memberJar);
    expect(await token()).toBe(memberBefore);
  });

  it("requires sign-in", async () => {
    newBrowser();
    expect((await call(changes, "GET", "/api/changes")).status).toBe(401);
  });
});

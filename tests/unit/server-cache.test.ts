import { beforeEach, describe, expect, it } from "vitest";
import { __resetCacheForTests, cached, entryTags, invalidateEntries, invalidateTags } from "@/lib/server-cache";

beforeEach(() => __resetCacheForTests());

describe("server cache", () => {
  it("doesn't keep a value whose load was overtaken by an invalidation (R-017)", async () => {
    let release!: () => void;
    const slow = cached("k", { ttlMs: 60_000, tags: ["projects"] }, () => new Promise<string>((r) => (release = () => r("stale"))));
    invalidateTags("projects"); // a write lands while the load is still running
    release();
    expect(await slow).toBe("stale"); // the caller that asked still gets an answer
    let loads = 0;
    const next = await cached("k", { ttlMs: 60_000, tags: ["projects"] }, async () => (loads++, "fresh"));
    expect(next).toBe("fresh");
    expect(loads).toBe(1);
  });

  it("one member's write doesn't clear another member's cache, but clears team views (R-030)", async () => {
    let loads = 0;
    const load = async () => ++loads;
    await cached("mine:a", { ttlMs: 60_000, tags: entryTags(["a"]) }, load);
    await cached("mine:b", { ttlMs: 60_000, tags: entryTags(["b"]) }, load);
    await cached("team", { ttlMs: 60_000, tags: entryTags(undefined) }, load);
    expect(loads).toBe(3);
    invalidateEntries("a");
    await cached("mine:a", { ttlMs: 60_000, tags: entryTags(["a"]) }, load); // reloads
    await cached("mine:b", { ttlMs: 60_000, tags: entryTags(["b"]) }, load); // still cached
    await cached("team", { ttlMs: 60_000, tags: entryTags(undefined) }, load); // reloads
    expect(loads).toBe(5);
  });

  it("drops expired values and stays bounded (R-050)", async () => {
    let loads = 0;
    await cached("short", { ttlMs: 1, tags: ["settings"] }, async () => ++loads);
    await new Promise((r) => setTimeout(r, 5));
    await cached("short", { ttlMs: 1, tags: ["settings"] }, async () => ++loads);
    expect(loads).toBe(2);
    for (let i = 0; i < 2100; i++) await cached(`fill:${i}`, { ttlMs: 60_000, tags: ["settings"] }, async () => i);
    // The earliest keys were evicted; the newest are still there.
    let reloaded = 0;
    await cached("fill:0", { ttlMs: 60_000, tags: ["settings"] }, async () => (reloaded++, 0));
    await cached("fill:2099", { ttlMs: 60_000, tags: ["settings"] }, async () => (reloaded++, 0));
    expect(reloaded).toBe(1);
  });
});

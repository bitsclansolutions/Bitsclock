import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake Upstash: INCRBY/PEXPIRE on an in-memory map, counting round trips.
const store = new Map<string, number>();
let roundTrips = 0;
vi.mock("@/lib/kv", () => ({
  kvEnabled: true,
  kv: vi.fn(async () => null),
  kvPipeline: vi.fn(async (cmds: (string | number)[][]) => {
    roundTrips++;
    return cmds.map(([op, key, n]) => {
      if (op === "INCRBY") {
        const v = (store.get(String(key)) ?? 0) + Number(n);
        store.set(String(key), v);
        return v;
      }
      return 1;
    });
  }),
}));

const { rateLimitFast, __resetRateLimitsForTests } = await import("@/lib/rate-limit");
const flush = () => new Promise((r) => setImmediate(r));
const shared = () => [...store.values()].reduce((a, b) => a + b, 0);

describe("rateLimitFast", () => {
  beforeEach(() => {
    store.clear();
    roundTrips = 0;
    __resetRateLimitsForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T10:00:00.100Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("a burst of normal traffic costs one Redis call, and the rest is synced on a later request", async () => {
    for (let i = 0; i < 4; i++) expect((await rateLimitFast("k", 100, 60_000)).ok).toBe(true);
    await flush();
    expect(roundTrips).toBe(1);
    vi.setSystemTime(new Date("2026-11-10T10:00:01.200Z"));
    await rateLimitFast("k", 100, 60_000);
    await flush();
    expect(roundTrips).toBe(2);
    expect(shared()).toBe(5);
  });

  it("blocks exactly at the limit", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 14; i++) {
      results.push((await rateLimitFast("k2", 10, 60_000)).ok);
      await flush();
    }
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.slice(10).every((ok) => !ok)).toBe(true);
  });

  it("sees hits from other instances within a second", async () => {
    await rateLimitFast("k3", 10, 60_000);
    await flush();
    for (const k of store.keys()) store.set(k, 10); // another instance used up the limit
    vi.setSystemTime(new Date("2026-11-10T10:00:01.200Z"));
    await rateLimitFast("k3", 10, 60_000); // next sync learns the shared count
    await flush();
    expect((await rateLimitFast("k3", 10, 60_000)).ok).toBe(false);
  });
});

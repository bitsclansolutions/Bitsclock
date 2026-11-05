import { handler, jsonCached, requireUser } from "@/lib/api";
import { getActiveEntry } from "@/lib/entries";
import { cached } from "@/lib/server-cache";

export const GET = handler(async (req) => {
  const me = await requireUser();
  const entry = await cached(`active:${me.id}`, { ttlMs: 10_000, tags: ["entries"] }, () => getActiveEntry(me.id));
  return jsonCached(req, { entry }, { maxAge: 5, swr: 30 });
});

import { ApiError, handler, json, jsonCached, parseBody, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { createManualEntry, listEntries } from "@/lib/entries";
import { parseReportQuery } from "@/lib/report-query";
import { cached, entryTags, invalidateEntries, paramsKey } from "@/lib/server-cache";
import { entryManualSchema } from "@/lib/validation";

/**
 * One page of entries, newest first. `?limit=` up to 500. Either `?cursor=` from the previous
 * page's `nextCursor` (scroll loading), or `?page=N` for numbered pages with `total`/`pageCount`.
 * No range cap here (only one page is ever read), so the tracker can offer "All time".
 */
export const GET = handler(async (req) => {
  const me = await requirePermission("time.track");
  const url = new URL(req.url);
  const f = await parseReportQuery(url, me, "time.view_all", { maxDays: null });
  const page = await cached(`entries:${me.id}:${paramsKey(url.searchParams)}`, { ttlMs: 15_000, tags: [...entryTags(f.userIds), "projects", "users", "roles"] }, () =>
    listEntries(f, { limit: f.limit, cursor: f.cursor, page: f.page }),
  );
  return jsonCached(req, page, { maxAge: 10 });
});

export const POST = handler(async (req) => {
  const me = await requirePermission("time.track");
  const body = await parseBody(req, entryManualSchema);
  const targetUserId = body.userId && body.userId !== "me" ? body.userId : me.id;
  if (targetUserId !== me.id && !hasPermission(me, "time.manage_all")) throw new ApiError(403, "You can only log time for yourself.");
  const entry = await createManualEntry(me, targetUserId, body);
  invalidateEntries(targetUserId);
  return json({ entry }, { status: 201 });
});

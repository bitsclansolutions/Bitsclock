import { ApiError, handler, json, jsonCached, parseBody, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { createManualEntry, listEntries } from "@/lib/entries";
import { parseReportQuery } from "@/lib/report-query";
import { cached, invalidateTags, paramsKey } from "@/lib/server-cache";
import { entryManualSchema } from "@/lib/validation";

export const GET = handler(async (req) => {
  const me = await requirePermission("time.track");
  const url = new URL(req.url);
  const f = parseReportQuery(url, me, "time.view_all");
  const entries = await cached(`entries:${me.id}:${paramsKey(url.searchParams)}`, { ttlMs: 15_000, tags: ["entries", "projects", "users"] }, () =>
    listEntries({ userIds: f.userIds, from: f.from, to: f.to, projectId: f.projectId, q: f.q }),
  );
  return jsonCached(req, { entries }, { maxAge: 10 });
});

export const POST = handler(async (req) => {
  const me = await requirePermission("time.track");
  const body = await parseBody(req, entryManualSchema);
  const targetUserId = body.userId && body.userId !== "me" ? body.userId : me.id;
  if (targetUserId !== me.id && !hasPermission(me, "time.manage_all")) throw new ApiError(403, "You can only log time for yourself.");
  const entry = await createManualEntry(targetUserId, body);
  invalidateTags("entries");
  return json({ entry }, { status: 201 });
});

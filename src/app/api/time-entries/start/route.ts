import { handler, json, parseBody, requirePermission } from "@/lib/api";
import { startTimer } from "@/lib/entries";
import { invalidateEntries } from "@/lib/server-cache";
import { entryStartSchema } from "@/lib/validation";

export const POST = handler(async (req) => {
  const me = await requirePermission("time.track");
  const body = await parseBody(req, entryStartSchema);
  const entry = await startTimer(me, body);
  invalidateEntries(me.id);
  return json({ entry }, { status: 201 });
});

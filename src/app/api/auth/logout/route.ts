import { handler, json, parseBody } from "@/lib/api";
import { endSession, getSessionUser } from "@/lib/auth";
import { revokeAllSessions } from "@/lib/sessions";
import { logoutSchema } from "@/lib/validation";

/** Sign out this device, or every device when `{ everywhere: true }` is sent. */
export const POST = handler(async (req) => {
  const body = req.headers.get("content-type")?.includes("application/json") ? await parseBody(req, logoutSchema) : { everywhere: false };
  if (body.everywhere) {
    const me = await getSessionUser();
    if (me) await revokeAllSessions(me.id);
  }
  await endSession();
  return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

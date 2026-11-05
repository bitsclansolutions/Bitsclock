import { cookies } from "next/headers";
import { handler, json, requireUser } from "@/lib/api";
import { REFRESH_COOKIE } from "@/lib/auth";
import { listSessions } from "@/lib/sessions";

/** The caller's own signed-in devices. Nobody can list another member's sessions. */
export const GET = handler(async () => {
  const me = await requireUser();
  const store = await cookies();
  const sessions = await listSessions(me.id, store.get(REFRESH_COOKIE)?.value);
  return json({ sessions }, { headers: { "Cache-Control": "no-store" } });
});

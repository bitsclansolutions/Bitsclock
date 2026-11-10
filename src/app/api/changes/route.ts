import { handler, json, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { projectScope } from "@/lib/projects";
import { changeToken, entryTags } from "@/lib/server-cache";

/**
 * Change feed for the browser: a token that changes whenever data this user can see
 * changes (anyone's entries for team viewers, otherwise their own; members, roles,
 * projects, settings). The app polls it every few seconds while visible and refreshes
 * its data when the token moves. No data is returned, only the token.
 */
export const GET = handler(async () => {
  const me = await requireUser();
  const { seeAll } = projectScope(me);
  const team = seeAll || hasPermission(me, "users.view") || hasPermission(me, "time.view_all");
  const token = await changeToken(["users", "roles", "projects", "settings", ...(team ? entryTags(undefined) : entryTags([me.id]))]);
  return json({ token }, { headers: { "Cache-Control": "no-store" } });
});

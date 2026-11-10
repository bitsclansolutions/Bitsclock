import { handler, json, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { projectScope } from "@/lib/projects";
import { changeToken, entryTags } from "@/lib/server-cache";
import { workspaceTimeZone } from "@/lib/workspace";
import { accessKey } from "@/lib/permissions";

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
  const [token, timeZone] = await Promise.all([
    changeToken(["users", "roles", "projects", "settings", ...(team ? entryTags(undefined) : entryTags([me.id]))]),
    workspaceTimeZone(),
  ]);
  // The zone too: an open app reloads when the Administrator changes it (D-012).
  // And the caller's access: when their role or its permissions change, the app reloads so
  // the menu and cached pages match what they may do now.
  return json({ token, timeZone, access: accessKey(me) }, { headers: { "Cache-Control": "no-store" } });
});

import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { TeamView } from "@/components/team/TeamView";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await getSessionUser();
  const allowed = user && (["users.view", "users.manage", "users.request", "users.deactivate"] as const).some((p) => hasPermission(user, p));
  if (!user || !allowed) return <Forbidden what="the team page" />;
  return <TeamView />;
}

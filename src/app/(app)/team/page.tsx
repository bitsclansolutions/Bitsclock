import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { TeamView } from "@/components/team/TeamView";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await getSessionUser();
  if (!user || !(hasPermission(user, "users.view") || hasPermission(user, "users.manage"))) return <Forbidden what="the team page" />;
  return <TeamView />;
}

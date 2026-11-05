import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { RolesView } from "@/components/roles/RolesView";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "roles.manage")) return <Forbidden what="roles and permissions" />;
  return <RolesView />;
}

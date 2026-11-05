import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { ProjectsView } from "@/components/projects/ProjectsView";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user || !(hasPermission(user, "projects.view") || hasPermission(user, "projects.manage"))) return <Forbidden what="projects" />;
  return <ProjectsView />;
}

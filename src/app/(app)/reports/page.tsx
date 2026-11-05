import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { ReportsView } from "@/components/reports/ReportsView";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await getSessionUser();
  if (!user || !(hasPermission(user, "reports.view_own") || hasPermission(user, "reports.view_all"))) return <Forbidden what="reports" />;
  return <ReportsView />;
}

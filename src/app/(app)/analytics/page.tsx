import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const user = await getSessionUser();
  if (!user || !(hasPermission(user, "reports.view_own") || hasPermission(user, "reports.view_all"))) return <Forbidden what="analytics" />;
  return <AnalyticsView />;
}

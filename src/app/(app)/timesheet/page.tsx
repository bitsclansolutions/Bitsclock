import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { TimesheetView } from "@/components/timesheet/TimesheetView";

export const metadata: Metadata = { title: "Timesheet" };

export default async function TimesheetPage() {
  const user = await getSessionUser();
  if (!user || !(hasPermission(user, "time.track") || hasPermission(user, "time.view_all"))) return <Forbidden what="the timesheet" />;
  return <TimesheetView />;
}

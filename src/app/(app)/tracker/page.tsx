import type { Metadata } from "next";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { Forbidden } from "@/components/Forbidden";
import { TrackerView } from "@/components/tracker/TrackerView";

export const metadata: Metadata = { title: "Time tracker" };

export default async function TrackerPage() {
  const user = await getSessionUser();
  if (!user || !hasPermission(user, "time.track")) return <Forbidden what="time tracking" />;
  return <TrackerView />;
}

import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { Landing } from "@/components/site/Landing";

export const metadata: Metadata = {
  title: "Bitsclock · Time tracking for teams",
  description: "Start timers, log hours against projects, and export team reports as CSV or PDF. Roles and permissions you define.",
};

export default async function Home() {
  const user = await getSessionUser();
  return <Landing signedIn={!!user} />;
}

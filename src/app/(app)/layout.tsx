import { redirect } from "next/navigation";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { workspaceTimeZone } from "@/lib/workspace";
import { UserProvider } from "@/context/UserContext";
import { ToastProvider } from "@/context/ToastContext";
import { TimerProvider } from "@/context/TimerContext";
import { ConfirmProvider } from "@/context/ConfirmContext";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, timeZone] = await Promise.all([getSessionUser(), workspaceTimeZone()]);
  // Through a route that clears the stale cookies first; a bare redirect to /login would loop (R-046).
  if (!user) redirect("/api/auth/signed-out");
  return (
    <UserProvider user={user} timeZone={timeZone}>
      <ToastProvider>
        <ConfirmProvider>
          <TimerProvider enabled={hasPermission(user, "time.track")}>
            <AppShell>{children}</AppShell>
          </TimerProvider>
        </ConfirmProvider>
      </ToastProvider>
    </UserProvider>
  );
}

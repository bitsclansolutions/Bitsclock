import { redirect } from "next/navigation";
import { getSessionUser, hasPermission } from "@/lib/auth";
import { UserProvider } from "@/context/UserContext";
import { ToastProvider } from "@/context/ToastContext";
import { TimerProvider } from "@/context/TimerContext";
import { ConfirmProvider } from "@/context/ConfirmContext";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <UserProvider user={user}>
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

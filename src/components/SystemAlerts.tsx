"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock3, WifiOff, X } from "lucide-react";
import { errMsg, onLatency } from "@/lib/client";
import { useToast } from "@/context/ToastContext";
import { readPrefs } from "@/lib/prefs";
import { fmtHours } from "@/lib/time";
import { useTimer } from "@/context/TimerContext";
import { cx } from "./ui";

type Alert = { id: string; tone: "warn" | "danger" | "info"; icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode; dismissible?: boolean };

/**
 * Status alerts stacked at the top of the content area:
 * offline, slow connection, and a timer that has been running for a long time.
 */
export function SystemAlerts() {
  const [offline, setOffline] = useState(false);
  const [slow, setSlow] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const { active, elapsed, stop } = useTimer();
  const router = useRouter();
  const toast = useToast();
  const [stopping, setStopping] = useState(false);

  /** R-040: stop the forgotten timer, then open it on the tracker so the end time can be corrected. */
  const stopAndEdit = async () => {
    setStopping(true);
    try {
      const stopped = await stop();
      router.push(stopped ? `/tracker?edit=${encodeURIComponent(stopped.id)}` : "/tracker");
    } catch (e) {
      toast.error("Couldn't stop the timer", errMsg(e));
    } finally {
      setStopping(false);
    }
  };

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    // "Slow" when the median of recent API round trips is above 4 seconds.
    return onLatency((samples) => {
      if (samples.length < 3) return;
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      setSlow(median > 4000);
    });
  }, []);

  const longHours = readPrefs().longTimerHours;
  const longTimer = !!active && longHours > 0 && elapsed >= longHours * 3600;

  const alerts: Alert[] = [];
  if (offline) {
    alerts.push({ id: "offline", tone: "danger", icon: <WifiOff className="h-4 w-4" />, title: "You're offline", body: "Changes can't be saved until the connection returns. The page will keep working with what it already loaded." });
  } else if (slow) {
    alerts.push({ id: "slow", tone: "warn", icon: <AlertTriangle className="h-4 w-4" />, title: "Slow connection", body: "Requests are taking several seconds. The app keeps showing cached data while it waits.", dismissible: true });
  }
  if (longTimer && active) {
    alerts.push({
      id: `long:${active.id}`,
      tone: "info",
      icon: <Clock3 className="h-4 w-4" />,
      title: `Timer running for ${fmtHours(elapsed)}`,
      body: "Still working on it? If you forgot to stop it, stop it now and set the time you actually finished. Timers stop on their own after 24 hours.",
      action: (
        <button type="button" className="btn btn-sm btn-primary" disabled={stopping} onClick={stopAndEdit}>
          {stopping ? "Stopping…" : "Stop and edit"}
        </button>
      ),
      dismissible: true,
    });
  }

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 space-y-2" role="status" aria-live="polite">
      {visible.map((a) => (
        <div
          key={a.id}
          className={cx(
            "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
            a.tone === "danger" && "bg-[#fbe5e5] text-[#8f2520]",
            a.tone === "warn" && "bg-amber-50 text-amber-900",
            a.tone === "info" && "bg-brand-50 text-brand-900",
          )}
        >
          <span className="mt-0.5 shrink-0">{a.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">{a.title}</p>
            {a.body && <p className="text-[13px] opacity-80">{a.body}</p>}
          </div>
          {a.action}
          {a.dismissible && (
            <button type="button" aria-label="Dismiss" onClick={() => setDismissed((s) => new Set(s).add(a.id))} className="-mr-1 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

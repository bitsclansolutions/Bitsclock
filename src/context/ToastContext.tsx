"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error" | "info"; title: string; body?: string };
type Ctx = {
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  // Hovering or focusing the stack pauses every countdown, so a toast can be read (R-057).
  const [paused, setPaused] = useState(false);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((kind: Toast["kind"], title: string, body?: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, title, body }]);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      success: (t, b) => push("success", t, b),
      error: (t, b) => push("error", t, b),
      info: (t, b) => push("info", t, b),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto"
        aria-live="polite"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPaused(false)}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} paused={paused} onDone={dismiss}>
          <div
            className="pointer-events-auto fade-up flex w-full max-w-sm items-start gap-3 rounded-xl border border-ink-200 bg-white p-3.5 shadow-pop"
            role={t.kind === "error" ? "alert" : "status"}
          >
            {t.kind === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />}
            {t.kind === "error" && <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
            {t.kind === "info" && <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-ink-500">{t.body}</p>}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="cursor-pointer rounded-md p-1 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              onClick={() => dismiss(t.id)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          </ToastItem>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Counts down while not paused; keeps the time left across pauses. */
function ToastItem({ toast, paused, onDone, children }: { toast: Toast; paused: boolean; onDone: (id: number) => void; children: React.ReactNode }) {
  const left = useRef(toast.kind === "error" ? 8000 : 4500);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => onDone(toast.id), left.current);
    return () => {
      window.clearTimeout(t);
      left.current = Math.max(1000, left.current - (Date.now() - started));
    };
  }, [paused, toast.id, onDone]);
  return <>{children}</>;
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

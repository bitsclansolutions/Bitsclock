"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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

  const push = useCallback((kind: Toast["kind"], title: string, body?: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, title, body }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
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
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
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
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

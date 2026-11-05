"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui";

type Options = { title: string; body?: React.ReactNode; ok?: string; cancel?: string; danger?: boolean };
type Ctx = (opts: Options) => Promise<boolean>;

const ConfirmCtx = createContext<Ctx | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<Ctx>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmCtx.Provider value={value}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title ?? ""}
        width="max-w-md"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
              {opts?.cancel ?? "Cancel"}
            </button>
            <button type="button" className={opts?.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => close(true)}>
              {opts?.ok ?? "Confirm"}
            </button>
          </>
        }
      >
        <div className="text-sm text-ink-700">{opts?.body}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx;
}

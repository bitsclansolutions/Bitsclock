"use client";

import { createContext, useContext, useMemo } from "react";
import type { SessionUser } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";

type Ctx = { user: SessionUser; can: (p: Permission) => boolean };

const UserCtx = createContext<Ctx | null>(null);

export function UserProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const value = useMemo<Ctx>(
    () => ({ user, can: (p) => user.isAdmin || user.permissions.includes(p) }),
    [user],
  );
  return <UserCtx.Provider value={value}>{children}</UserCtx.Provider>;
}

export function useUser() {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error("useUser must be used inside UserProvider");
  return ctx;
}
